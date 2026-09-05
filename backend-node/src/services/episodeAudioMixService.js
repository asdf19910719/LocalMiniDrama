const { spawnSync } = require('node:child_process');
const { getFfmpegPath } = require('../utils/ffmpegPath');

const BGM_MODES = new Set(['none', 'episode_track', 'per_segment']);
const SPEECH_OWNERS = new Set(['h3_native', 'post_tts', 'none']);

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function buildEpisodeAudioMixPlan({
  basePath = null,
  outputPath = null,
  baseHasAudio = true,
  bgmMode = 'none',
  bgmPath = null,
  bgmLevel = 0.22,
  bgmFadeInMs = 500,
  bgmFadeOutMs = 700,
  duckingDb = -8,
  dialogueOwner = 'post_tts',
  narrationOwner = 'post_tts',
  dialoguePath = null,
  narrationPath = null,
  durationSeconds,
  targetLufs = -14,
  truePeak = -1,
} = {}) {
  const duration = finitePositive(durationSeconds, 5);
  const mode = BGM_MODES.has(bgmMode) ? bgmMode : 'none';
  if (mode === 'episode_track' && !String(bgmPath || '').trim()) {
    const error = new Error('整集 BGM 模式需要项目媒体目录内可用的音频文件');
    error.code = 'EPISODE_BGM_MEDIA_REQUIRED';
    throw error;
  }
  const dialogue = SPEECH_OWNERS.has(dialogueOwner) ? dialogueOwner : 'post_tts';
  const narration = SPEECH_OWNERS.has(narrationOwner) ? narrationOwner : 'post_tts';
  const inputs = [];
  const inputLabels = [];
  const addInput = (filePath, type) => {
    if (!filePath) return;
    inputs.push(filePath);
    inputLabels.push({ index: inputs.length, type });
  };
  if (dialogue === 'post_tts') addInput(dialoguePath, 'dialogue');
  if (narration === 'post_tts') addInput(narrationPath, 'narration');
  if (mode === 'episode_track') addInput(bgmPath, 'bgm');

  const filters = [];
  if (baseHasAudio) {
    filters.push(`[0:a]atrim=duration=${duration},asetpts=PTS-STARTPTS[base]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[base]`);
  }

  const bgmInput = inputLabels.find((item) => item.type === 'bgm');
  const speechLabels = inputLabels.filter((item) => item.type === 'dialogue' || item.type === 'narration')
    .map((item) => `[${item.index}:a]`);
  let speechOut = null;
  const speechSplit = bgmInput ? 'asplit=3[speech_sc][speech_bgm_sc][speech]' : 'asplit=2[speech_sc][speech]';
  if (speechLabels.length === 1) {
    filters.push(`${speechLabels[0]}atrim=duration=${duration},asetpts=PTS-STARTPTS,${speechSplit}`);
    speechOut = '[speech]';
  } else if (speechLabels.length > 1) {
    filters.push(`${speechLabels.join('')}amix=inputs=${speechLabels.length}:duration=longest:normalize=0,atrim=duration=${duration},${speechSplit}`);
    speechOut = '[speech]';
  }

  let baseOut = '[base]';
  const duckingRatio = Math.max(1, Math.min(20, 1 + Math.abs(Number(duckingDb) || 0) / 2));
  if (speechOut) {
    filters.push(`[base][speech_sc]sidechaincompress=threshold=0.03:ratio=${duckingRatio}:attack=20:release=300[ducked]`);
    baseOut = '[ducked]';
  }

  const mixLabels = [baseOut];
  if (speechOut) mixLabels.push(speechOut);
  if (bgmInput) {
    const fadeIn = Math.max(0, Number(bgmFadeInMs) || 0) / 1000;
    const fadeOut = Math.max(0, Number(bgmFadeOutMs) || 0) / 1000;
    const fadeOutStart = Math.max(0, duration - fadeOut);
    const bgmOutput = speechOut ? 'bgm_raw' : 'bgm';
    filters.push(`[${bgmInput.index}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${Number(bgmLevel) || 0.22},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut}[${bgmOutput}]`);
    if (speechOut) {
      filters.push(`[bgm_raw][speech_bgm_sc]sidechaincompress=threshold=0.03:ratio=${duckingRatio}:attack=20:release=300[bgm]`);
    }
    mixLabels.push('[bgm]');
  }

  if (mixLabels.length > 1) {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[mixed]`);
  } else {
    filters.push(`${mixLabels[0]}anull[mixed]`);
  }
  filters.push(`[mixed]loudnorm=I=${Number(targetLufs)}:TP=${Number(truePeak)}:LRA=11[aout]`);

  return {
    version: 'episode_audio_mix_v1',
    basePath,
    outputPath,
    durationSeconds: duration,
    bgmMode: mode,
    dialogueOwner: dialogue,
    narrationOwner: narration,
    inputs,
    filterComplex: filters.join(';'),
    maps: ['0:v', '[aout]'],
    codecArgs: ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest'],
  };
}

function runEpisodeAudioMix(plan, { ffmpegPath = getFfmpegPath(), runCommand = null } = {}) {
  if (!plan?.basePath || !plan?.outputPath) throw new Error('Audio mix plan requires basePath and outputPath');
  const args = ['-y', '-i', plan.basePath];
  for (const input of plan.inputs) args.push('-i', input);
  args.push('-filter_complex', plan.filterComplex);
  for (const map of plan.maps) args.push('-map', map);
  args.push(...plan.codecArgs, plan.outputPath);
  if (typeof runCommand === 'function') return runCommand(ffmpegPath, args);
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const error = new Error(result.error?.message || result.stderr || 'Episode audio mix failed');
    error.code = 'EPISODE_AUDIO_MIX_FAILED';
    throw error;
  }
  return plan.outputPath;
}

module.exports = { buildEpisodeAudioMixPlan, runEpisodeAudioMix };
