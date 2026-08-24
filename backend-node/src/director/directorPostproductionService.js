const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseFfmpegProbe } = require('./comfyuiClient');

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function escapeFilterPath(value) {
  let resolved = path.resolve(String(value)).replaceAll('\\', '/');
  if (/^[A-Za-z]:/.test(resolved)) resolved = resolved.replace(/^([A-Za-z]):/, '$1\\:');
  return resolved.replaceAll("'", "\\'");
}

function normalizeColor(color = {}) {
  const brightness = Number(color.brightness ?? 0);
  const contrast = Number(color.contrast ?? 1);
  const saturation = Number(color.saturation ?? 1);
  if (![brightness, contrast, saturation].every(Number.isFinite)) throw new Error('Invalid color correction values');
  if (contrast <= 0 || saturation <= 0) throw new Error('Color contrast and saturation must be positive');
  return { brightness, contrast, saturation };
}

function buildPostproductionPlan({
  inputPath,
  outputPath,
  subtitlePath = null,
  musicPath = null,
  ttsPath = null,
  audioPaths = [],
  color = {},
  upscale = null,
  fps = 24,
  audioPolicy = 'replace_or_mix',
} = {}) {
  if (!inputPath || !outputPath) throw new Error('Postproduction inputPath and outputPath are required');
  const output = {
    width: Number(upscale?.width || 864),
    height: Number(upscale?.height || 480),
    fps: Number(fps),
    pixelFormat: 'yuv420p',
  };
  if (![output.width, output.height, output.fps].every(Number.isFinite) || output.width <= 0 || output.height <= 0 || output.fps <= 0) {
    throw new Error('Postproduction output dimensions and fps must be positive numbers');
  }
  const filters = [];
  if (upscale) {
    const mode = upscale.mode || 'ffmpeg-lanczos';
    if (mode !== 'ffmpeg-lanczos') throw new Error(`Unsupported upscale mode: ${mode}`);
    filters.push(`scale=${output.width}:${output.height}:flags=lanczos`);
  }
  const normalizedColor = normalizeColor(color);
  if (normalizedColor.brightness !== 0 || normalizedColor.contrast !== 1 || normalizedColor.saturation !== 1) {
    filters.push(`eq=brightness=${normalizedColor.brightness}:contrast=${normalizedColor.contrast}:saturation=${normalizedColor.saturation}`);
  }
  if (subtitlePath) filters.push(`subtitles='${escapeFilterPath(subtitlePath)}':charenc=UTF-8`);
  const videoFilter = filters.join(',');
  const extraAudioPaths = [
    ...(musicPath ? [musicPath] : []),
    ...(ttsPath ? [ttsPath] : []),
    ...(Array.isArray(audioPaths) ? audioPaths.filter(Boolean) : []),
  ];
  const audioInputs = [...new Set(extraAudioPaths)];
  const args = ['-y', '-i', inputPath];
  for (const audioPath of audioInputs) args.push('-i', audioPath);

  if (audioInputs.length) {
    const vf = videoFilter ? `[0:v]${videoFilter}[vout]` : '[0:v]null[vout]';
    const audioInputsForMix = audioInputs.map((_, index) => `[${index + 1}:a]`).join('');
    const audio = `${audioInputsForMix}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=2[aout]`;
    args.push('-filter_complex', `${vf};${audio}`, '-map', '[vout]', '-map', '[aout]');
  } else {
    if (videoFilter) args.push('-vf', videoFilter);
    args.push('-map', '0:v', '-map', '0:a?');
  }
  args.push(
    '-r', String(output.fps),
    '-pix_fmt', output.pixelFormat,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  );
  return {
    version: 'director_postproduction_v1',
    inputPath,
    outputPath,
    output,
    audioPolicy,
    subtitlePath,
    musicPath,
    ttsPath,
    audioInputs,
    audioPaths: audioInputs,
    color: normalizedColor,
    upscale: upscale ? { mode: upscale.mode || 'ffmpeg-lanczos', width: output.width, height: output.height } : null,
    args,
    command: [quote('ffmpeg'), ...args.map((arg) => String(arg).startsWith('-') ? String(arg) : quote(arg))].join(' '),
  };
}

function parseProbe(probe) {
  if (typeof probe === 'string') return JSON.parse(probe);
  return probe || {};
}

function validatePostproductionProbe(probeInput, expected = {}) {
  const probe = parseProbe(probeInput);
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video') || {};
  const audio = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
  const parseRate = (value) => {
    const [a, b] = String(value || '').split('/').map(Number);
    return b ? a / b : Number(value);
  };
  if (Number(expected.width) && Number(video.width) !== Number(expected.width)) throw new Error('Postproduction output dimensions do not match');
  if (Number(expected.height) && Number(video.height) !== Number(expected.height)) throw new Error('Postproduction output dimensions do not match');
  if (Number(expected.fps) && Math.abs(parseRate(video.r_frame_rate || video.avg_frame_rate) - Number(expected.fps)) > 0.01) throw new Error('Postproduction output fps does not match');
  if (expected.requireAudio && !audio) throw new Error('Postproduction output is missing audio');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Postproduction output duration is invalid');
  return { status: 'passed', duration, width: Number(video.width), height: Number(video.height), fps: parseRate(video.r_frame_rate || video.avg_frame_rate), videoCodec: video.codec_name || null, audioCodec: audio?.codec_name || null, probe };
}

async function executePostproduction({ plan, runCommand, ffmpegPath = 'ffmpeg', probePath = 'ffprobe' } = {}) {
  if (!plan || !Array.isArray(plan.args)) throw new Error('A postproduction plan is required');
  if (typeof runCommand !== 'function') throw new Error('A postproduction command runner is required');
  const render = await runCommand(ffmpegPath, plan.args);
  if (!render || render.code !== 0) throw new Error(render?.stderr || render?.error || 'Postproduction FFmpeg failed');
  const probeRun = await runCommand(probePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', plan.outputPath]);
  let probeOutput = probeRun?.stdout;
  if (!probeRun || probeRun.code !== 0 || !probeOutput) {
    const fallback = await runCommand(ffmpegPath, ['-hide_banner', '-i', plan.outputPath]);
    const parsed = parseFfmpegProbe(`${fallback?.stderr || ''}\n${fallback?.stdout || ''}`);
    if (!parsed.streams?.length || !parsed.format?.duration) throw new Error(probeRun?.stderr || probeRun?.error || 'Postproduction media probe failed');
    probeOutput = parsed;
  }
  const quality = validatePostproductionProbe(probeOutput, { ...plan.output, requireAudio: Boolean(plan.audioInputs?.length || plan.musicPath || plan.ttsPath) });
  let outputSha256 = null;
  if (fs.existsSync(plan.outputPath)) {
    outputSha256 = crypto.createHash('sha256').update(fs.readFileSync(plan.outputPath)).digest('hex');
  }
  return { outputPath: plan.outputPath, outputSha256, quality, probe: quality.probe, plan };
}

module.exports = { buildPostproductionPlan, validatePostproductionProbe, executePostproduction };
