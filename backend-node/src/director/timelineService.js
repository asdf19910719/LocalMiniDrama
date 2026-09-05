const crypto = require('node:crypto');
const { buildPostproductionPlan } = require('./directorPostproductionService');
const { assertAllowedLocalPath } = require('./directorGovernance');

const ALLOWED_TRANSITIONS = new Set(['cut', 'fade', 'dissolve']);

function id() { return crypto.randomUUID(); }
function parseFps(value) {
  if (typeof value === 'number') return value;
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  return denominator ? numerator / denominator : Number(value);
}
function probeFor(artifact) {
  try { return JSON.parse(artifact.ffprobe_json || '{}'); } catch (_) { return {}; }
}
function videoStream(probe) { return (probe.streams || []).find((stream) => stream.codec_type === 'video') || probe.streams?.[0] || {}; }
function audioStream(probe) { return (probe.streams || []).find((stream) => stream.codec_type === 'audio') || null; }
function selectedArtifact(db, artifactId) {
  const artifact = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(artifactId);
  if (!artifact || artifact.status !== 'ready') throw new Error(`Artifact ${artifactId} is not ready`);
  const selected = db.prepare(`SELECT 1 FROM director_candidate_groups
    WHERE selected_artifact_id = ? AND status = 'selected' LIMIT 1`).get(artifactId);
  if (!selected) throw new Error(`Artifact ${artifactId} is not selected`);
  return artifact;
}

function validateTimeline(db, {
  version = 'timeline_v1',
  output = {},
  clips = [],
  audioSources = [],
  audioPolicy = 'mix',
  allowedLocalRoots = null,
} = {}) {
  if (version !== 'timeline_v1') throw new Error(`Unsupported timeline version: ${version}`);
  if (!Array.isArray(clips) || clips.length === 0) throw new Error('Timeline must contain clips');
  if (!Array.isArray(audioSources)) throw new Error('audioSources must be an array');
  if (new Set(audioSources).size !== audioSources.length) throw new Error('Duplicate audio source');
  if (audioSources.length) throw new Error('Timeline audio sources are not rendered in V1; use Director postproduction inputs');
  const normalized = [];
  let expectedStart = 0;
  let baseline = null;
  for (const clip of clips) {
    if (!clip || !clip.artifactId) throw new Error('Timeline clip artifactId is required');
    if (!Number.isFinite(clip.startTime) || !Number.isFinite(clip.duration) || clip.startTime < 0 || clip.duration <= 0) {
      throw new Error('Timeline clip timing is invalid');
    }
    if (!Number.isFinite(clip.sourceOffset) || !Number.isFinite(clip.sourceDuration) || clip.sourceOffset < 0 || clip.sourceDuration <= 0) {
      throw new Error('Timeline clip source timing is invalid');
    }
    const artifact = selectedArtifact(db, clip.artifactId);
    if (Array.isArray(allowedLocalRoots)) assertAllowedLocalPath(artifact.artifact_path, allowedLocalRoots, { mustExist: true, kind: 'file' });
    const stream = videoStream(probeFor(artifact));
    const fps = parseFps(stream.r_frame_rate || stream.avg_frame_rate);
    const media = { fps, width: Number(stream.width), height: Number(stream.height), pixelFormat: stream.pix_fmt };
    if (!baseline) baseline = media;
    const target = {
      fps: Number(output.fps) || baseline.fps,
      width: Number(output.width) || baseline.width,
      height: Number(output.height) || baseline.height,
      pixelFormat: output.pixelFormat || baseline.pixelFormat,
    };
    for (const key of ['fps', 'width', 'height', 'pixelFormat']) {
      if (target[key] && media[key] && Math.abs(Number(target[key]) - Number(media[key])) > 0.001) {
        throw new Error(`Timeline media mismatch: ${key}`);
      }
    }
    if (Math.abs(clip.startTime - expectedStart) > 0.001) {
      throw new Error(clip.startTime < expectedStart ? 'Timeline clips overlap' : 'Timeline has a gap');
    }
    const mediaDuration = Number(probeFor(artifact).format?.duration || 0);
    if (mediaDuration > 0 && Math.abs(clip.sourceDuration - mediaDuration) > 0.05) {
      throw new Error('Timeline source duration does not match the media probe');
    }
    if (mediaDuration > 0 && clip.sourceOffset + clip.duration > mediaDuration + 0.001) throw new Error('Timeline clip source range exceeds media duration');
    if (clip.sourceOffset + clip.duration > clip.sourceDuration + 0.001) throw new Error('Timeline clip source range exceeds declared source duration');
    if (clip.transition) {
      if (!ALLOWED_TRANSITIONS.has(clip.transition.type) || !Number.isFinite(clip.transition.duration) || clip.transition.duration < 0 || clip.transition.duration > clip.duration) {
        throw new Error('Invalid timeline transition');
      }
    }
    expectedStart = clip.startTime + clip.duration;
    normalized.push({
      artifactId: clip.artifactId,
      artifactPath: artifact.artifact_path,
      sha256: artifact.sha256,
      startTime: clip.startTime,
      duration: clip.duration,
      sourceOffset: clip.sourceOffset,
      sourceDuration: clip.sourceDuration,
      transition: clip.transition || null,
      hasAudio: Boolean(audioStream(probeFor(artifact))),
    });
  }
  normalized.forEach((clip, index) => {
    const transition = clip.transition;
    if (!transition) return;
    if (index === normalized.length - 1 && (transition.type !== 'cut' || transition.duration !== 0)) {
      throw new Error('The last clip cannot declare a transition');
    }
    if (transition.type === 'cut' && transition.duration !== 0) {
      throw new Error('Cut transition duration must be zero');
    }
    if (transition.type !== 'cut') {
      const next = normalized[index + 1];
      if (!next || transition.duration <= 0 || transition.duration > Math.min(clip.duration, next.duration)) {
        throw new Error('Timeline transition duration exceeds an adjacent clip');
      }
    }
  });
  const transitionOverlap = normalized.slice(0, -1).reduce((sum, clip) => {
    const transition = clip.transition;
    return sum + (transition && transition.type !== 'cut' ? transition.duration : 0);
  }, 0);
  return {
    version,
    output: {
      width: Number(output.width || baseline.width),
      height: Number(output.height || baseline.height),
      fps: Number(output.fps || baseline.fps),
      pixelFormat: output.pixelFormat || baseline.pixelFormat,
    },
    clips: normalized,
    audioSources: [...audioSources],
    audioPolicy,
    totalDuration: Number((expectedStart - transitionOverlap).toFixed(6)),
  };
}

function shellQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}` + '"';
}

function buildFfmpegCommand(timeline, { ffmpegPath = 'ffmpeg', outputPath }) {
  if (!outputPath) throw new Error('outputPath is required');
  const args = ['-y'];
  const filters = [];
  timeline.clips.forEach((clip, index) => {
    args.push('-i', clip.artifactPath);
    filters.push(`[${index}:v]trim=start=${clip.sourceOffset}:duration=${clip.duration},setpts=PTS-STARTPTS[v${index}]`);
    if (clip.hasAudio) {
      filters.push(`[${index}:a]atrim=start=${clip.sourceOffset}:duration=${clip.duration},asetpts=PTS-STARTPTS[a${index}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${clip.duration},asetpts=PTS-STARTPTS[a${index}]`);
    }
  });
  const hasTimedTransition = timeline.clips.slice(0, -1)
    .some((clip) => clip.transition && clip.transition.type !== 'cut' && clip.transition.duration > 0);
  if (!hasTimedTransition) {
    const concatInputs = timeline.clips.map((_, index) => `[v${index}][a${index}]`).join('');
    filters.push(`${concatInputs}concat=n=${timeline.clips.length}:v=1:a=1[vout][aout]`);
  } else {
    let currentLabel = 'v0';
    let currentAudioLabel = 'a0';
    let currentDuration = timeline.clips[0].duration;
    for (let index = 1; index < timeline.clips.length; index += 1) {
      const transition = timeline.clips[index - 1].transition || { type: 'cut', duration: 0 };
      const outputLabel = index === timeline.clips.length - 1 ? 'vout' : `vchain${index}`;
      const audioOutputLabel = index === timeline.clips.length - 1 ? 'aout' : `achain${index}`;
      if (transition.type === 'cut' || transition.duration === 0) {
        filters.push(`[${currentLabel}][v${index}]concat=n=2:v=1:a=0[${outputLabel}]`);
        filters.push(`[${currentAudioLabel}][a${index}]concat=n=2:v=0:a=1[${audioOutputLabel}]`);
        currentDuration += timeline.clips[index].duration;
      } else {
        const ffmpegTransition = transition.type === 'fade' ? 'fadeblack' : 'fade';
        const offset = Number((currentDuration - transition.duration).toFixed(6));
        filters.push(`[${currentLabel}][v${index}]xfade=transition=${ffmpegTransition}:duration=${transition.duration}:offset=${offset}[${outputLabel}]`);
        filters.push(`[${currentAudioLabel}][a${index}]acrossfade=d=${transition.duration}:c1=tri:c2=tri[${audioOutputLabel}]`);
        currentDuration += timeline.clips[index].duration - transition.duration;
      }
      currentLabel = outputLabel;
      currentAudioLabel = audioOutputLabel;
    }
  }
  args.push('-filter_complex', filters.join(';'));
  args.push('-map', '[vout]', '-map', '[aout]', '-r', String(timeline.output.fps), '-s', `${timeline.output.width}x${timeline.output.height}`);
  if (timeline.output.pixelFormat) args.push('-pix_fmt', timeline.output.pixelFormat);
  args.push('-c:v', 'libx264', '-c:a', 'aac', outputPath);
  const command = [shellQuote(ffmpegPath), ...args.map((arg) => String(arg).startsWith('-') ? String(arg) : shellQuote(arg))].join(' ');
  return { args, command };
}

function createTimeline(db, timeline, { outputPath, ffmpegPath = 'ffmpeg', postproduction = null, now } = {}) {
  const createdAt = now || new Date().toISOString();
  const command = buildFfmpegCommand(timeline, { ffmpegPath, outputPath });
  const timelineId = id();
  const manifest = {
    version: timeline.version,
    input: timeline,
    output: timeline.output,
    ffmpegPath,
    command: command.command,
    commandArgs: command.args,
    createdAt,
  };
  if (postproduction) {
    const postInput = postproduction.inputPath || outputPath;
    const postOutput = postproduction.outputPath || `${outputPath}.post.mp4`;
    manifest.postproduction = buildPostproductionPlan({
      ...postproduction,
      inputPath: postInput,
      outputPath: postOutput,
      fps: postproduction.fps || timeline.output.fps,
    });
  }
  db.prepare(`INSERT INTO director_timelines
    (id, version, status, input_json, manifest_json, ffmpeg_command, output_path, created_at)
    VALUES (?, ?, 'validated', ?, ?, ?, ?, ?)`).run(
    timelineId, timeline.version, JSON.stringify(timeline), JSON.stringify(manifest), command.command, outputPath, createdAt
  );
  return db.prepare('SELECT * FROM director_timelines WHERE id = ?').get(timelineId);
}

function getTimeline(db, timelineId) {
  return db.prepare('SELECT * FROM director_timelines WHERE id = ?').get(timelineId) || null;
}

module.exports = { validateTimeline, buildFfmpegCommand, createTimeline, getTimeline };
