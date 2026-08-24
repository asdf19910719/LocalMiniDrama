const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getFfmpegPath } = require('../utils/ffmpegPath');

const execFileAsync = promisify(execFile);

function rate(value) {
  const [a, b] = String(value || '').split('/').map(Number);
  return b ? a / b : Number(value || 0);
}

function streamDuration(stream, fallback = 0) {
  const duration = Number(stream?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : Number(fallback || 0);
}

function evaluateArtifactQuality({ ffprobe = {}, analysisText = '', boundaryScore = null } = {}) {
  const streams = ffprobe.streams || [];
  const video = streams.find((stream) => stream.codec_type === 'video') || {};
  const audio = streams.find((stream) => stream.codec_type === 'audio') || null;
  const formatDuration = Number(ffprobe.format?.duration || 0);
  const videoDuration = streamDuration(video, formatDuration);
  const audioDuration = streamDuration(audio, formatDuration);
  const text = String(analysisText || '');
  const issues = [];
  const blackDurations = [...text.matchAll(/black_duration:([0-9.]+)/gi)].map((match) => Number(match[1]));
  if (blackDurations.some((duration) => duration >= 0.2)) {
    issues.push({ code: 'BLACK_FRAMES', severity: 'error', message: 'Detected a black segment of at least 0.2 seconds' });
  }
  const freezeDurations = [...text.matchAll(/freeze_duration:([0-9.]+)/gi)].map((match) => Number(match[1]));
  if (freezeDurations.some((duration) => duration >= 0.8)) {
    issues.push({ code: 'FROZEN_VIDEO', severity: 'warning', message: 'Detected a frozen segment of at least 0.8 seconds' });
  }
  if (/invalid nal|error while decoding|corrupt|missing picture|concealing .* errors/i.test(text)) {
    issues.push({ code: 'DECODE_ERROR', severity: 'error', message: 'Decoder reported corrupt or invalid video data' });
  }
  if (audio && videoDuration && audioDuration && Math.abs(videoDuration - audioDuration) > 0.15) {
    issues.push({ code: 'AV_DESYNC', severity: 'error', message: `Audio/video duration differs by ${Math.abs(videoDuration - audioDuration).toFixed(2)}s` });
  }
  if (boundaryScore !== null && Number(boundaryScore) > 8) {
    issues.push({ code: 'BOUNDARY_JUMP', severity: 'warning', message: 'Shot boundary differs sharply from nearby motion' });
  }
  if (!video.width || !video.height || !rate(video.r_frame_rate || video.avg_frame_rate)) {
    issues.push({ code: 'MEDIA_METADATA_MISSING', severity: 'error', message: 'Video dimensions or frame rate are missing' });
  }
  return {
    version: 'director_quality_v1',
    status: issues.some((issue) => issue.severity === 'error') ? 'failed' : issues.length ? 'warning' : 'passed',
    issues,
    media: {
      width: Number(video.width || 0), height: Number(video.height || 0),
      fps: rate(video.r_frame_rate || video.avg_frame_rate),
      videoCodec: video.codec_name || null, audioCodec: audio?.codec_name || null,
      videoDuration, audioDuration: audio ? audioDuration : null,
    },
  };
}

async function analyzeArtifact({ artifactPath, ffprobe = {}, ffmpegPath = getFfmpegPath(), runCommand = execFileAsync } = {}) {
  if (!artifactPath) throw new Error('artifactPath is required');
  let analysisText = '';
  let executionFailed = false;
  try {
    const result = await runCommand(ffmpegPath, [
      '-hide_banner', '-i', artifactPath,
      '-vf', 'blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-50dB:d=0.8',
      '-af', 'silencedetect=n=-50dB:d=1', '-f', 'null', '-',
    ], { maxBuffer: 8 * 1024 * 1024 });
    analysisText = `${result?.stderr || ''}\n${result?.stdout || ''}`;
  } catch (error) {
    executionFailed = true;
    analysisText = `${error?.stderr || ''}\n${error?.stdout || ''}\n${error?.message || ''}`;
  }
  const detectorUnavailable = executionFailed || !analysisText.trim() || /spawn .*not found|ENOENT|no such file|failed to start/i.test(analysisText);
  const quality = evaluateArtifactQuality({ ffprobe, analysisText });
  if (detectorUnavailable) {
    return {
      ...quality,
      status: 'analysis_failed',
      analyzer: {
        status: 'failed',
        tool: ffmpegPath,
        message: analysisText.trim() || 'FFmpeg quality analysis did not produce detector output',
      },
      issues: [...quality.issues, { code: 'QUALITY_ANALYZER_UNAVAILABLE', severity: 'warning', message: 'FFmpeg quality analysis did not produce detector output' }],
    };
  }
  return { ...quality, analyzer: { status: 'completed', tool: ffmpegPath } };
}

module.exports = { analyzeArtifact, evaluateArtifactQuality };
