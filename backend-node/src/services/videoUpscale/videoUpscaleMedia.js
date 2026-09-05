const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { getFfmpegPath, getFfprobePath } = require('../../utils/ffmpegPath');
const { upscaleError } = require('./upscaleErrors');

function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${file} exited with code ${code}`));
    });
  });
}

function parseFraction(value) {
  const [left, right = '1'] = String(value || '').split('/');
  const numerator = Number(left);
  const denominator = Number(right);
  if (!Number.isInteger(numerator) || numerator <= 0 || !Number.isInteger(denominator) || denominator <= 0) {
    throw upscaleError('INVALID_SOURCE_MEDIA', `无效帧率：${value}`);
  }
  return { numerator, denominator };
}

function parseProbe(payload) {
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) throw upscaleError('INVALID_SOURCE_MEDIA', '文件中没有视频流');
  const fps = parseFraction(video.avg_frame_rate || video.r_frame_rate);
  let duration = Number(video.duration || payload?.format?.duration || 0);
  let frameCount = Number(video.nb_read_frames || video.nb_frames || 0);
  if (!Number.isInteger(frameCount) || frameCount <= 0) frameCount = Math.round(duration * fps.numerator / fps.denominator);
  if (!Number.isFinite(duration) || duration <= 0) duration = frameCount * fps.denominator / fps.numerator;
  if (!Number.isInteger(frameCount) || frameCount <= 0) throw upscaleError('INVALID_SOURCE_MEDIA', '无法取得视频帧数');
  return {
    width: Number(video.width),
    height: Number(video.height),
    fpsNumerator: fps.numerator,
    fpsDenominator: fps.denominator,
    frameCount,
    duration,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

async function probe(filePath, runner = runProcess) {
  const result = await runner(getFfprobePath(), [
    '-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,duration:format=duration',
    '-of', 'json', filePath,
  ]);
  try { return parseProbe(JSON.parse(result.stdout)); }
  catch (error) {
    if (error.code) throw error;
    throw upscaleError('INVALID_SOURCE_MEDIA', `ffprobe 返回无效数据：${error.message}`, { cause: error });
  }
}

function fingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return crypto.createHash('sha256')
    .update(`${path.resolve(filePath)}\0${stat.size}\0${stat.mtimeMs}`)
    .digest('hex');
}

async function validateSegment(filePath, job, segment) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return false;
  try {
    const info = await probe(filePath);
    return info.width === job.target_width
      && info.height === job.target_height
      && info.frameCount === segment.requested_frame_count
      && Math.abs(info.fpsNumerator / info.fpsDenominator - job.source_fps_num / job.source_fps_den) < 0.01;
  } catch (_) { return false; }
}

function buildStitchArgs(job, segments, outputPath) {
  const args = ['-y', '-hide_banner', '-loglevel', 'warning'];
  for (const segment of segments) args.push('-i', segment.local_output_path);
  const sourceIndex = segments.length;
  args.push('-i', job.source_path);
  const filters = [];
  const labels = [];
  for (let index = 0; index < segments.length; index += 1) {
    const label = `v${index}`;
    const trim = Number(segments[index].overlap_frames || 0);
    filters.push(trim > 0
      ? `[${index}:v]trim=start_frame=${trim},setpts=PTS-STARTPTS[${label}]`
      : `[${index}:v]setpts=PTS-STARTPTS[${label}]`);
    labels.push(`[${label}]`);
  }
  filters.push(`${labels.join('')}concat=n=${segments.length}:v=1:a=0[joined]`);
  filters.push(`[joined]scale=${job.target_width}:${job.target_height}:flags=lanczos[outv]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[outv]');
  if (job.source_has_audio) args.push('-map', `${sourceIndex}:a:0?`);
  args.push(
    '-frames:v', String(job.source_frame_count),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p'
  );
  if (job.source_has_audio) {
    const exactDuration = (job.source_frame_count * job.source_fps_den / job.source_fps_num).toFixed(9);
    args.push('-af', `apad=whole_dur=${exactDuration}`, '-t', exactDuration, '-c:a', 'aac', '-b:a', '192k');
  }
  else args.push('-an');
  args.push('-movflags', '+faststart', outputPath);
  return args;
}

async function stitch(job, segments, outputPath, runner = runProcess) {
  if (!segments.length || segments.some((segment) => !segment.local_output_path)) {
    throw upscaleError('SEGMENTS_INCOMPLETE', '超分分段尚未全部下载');
  }
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.part.mp4`;
  try {
    await runner(getFfmpegPath(), buildStitchArgs(job, segments, temporary));
    await fs.promises.rename(temporary, outputPath);
  } catch (error) {
    try { await fs.promises.unlink(temporary); } catch (_) {}
    throw upscaleError('STITCH_FAILED', `超分分段拼接失败：${error.message}`, { cause: error });
  }
  return outputPath;
}

async function validateFinal(filePath, job) {
  const info = await probe(filePath);
  const fpsDiff = Math.abs(info.fpsNumerator / info.fpsDenominator - job.source_fps_num / job.source_fps_den);
  const durationTolerance = Math.max(job.source_fps_den / job.source_fps_num, 0.05);
  if (info.width !== job.target_width || info.height !== job.target_height
      || Math.abs(info.frameCount - job.source_frame_count) > 1
      || fpsDiff >= 0.01
      || Math.abs(info.duration - job.source_frame_count * job.source_fps_den / job.source_fps_num) > durationTolerance
      || (job.source_has_audio && !info.hasAudio)) {
    throw upscaleError('FINAL_VALIDATION_FAILED', '超分成片的尺寸、帧率、帧数、时长或音轨校验失败', { details: info });
  }
  return true;
}

module.exports = {
  runProcess,
  parseProbe,
  probe,
  fingerprint,
  validateSegment,
  buildStitchArgs,
  stitch,
  validateFinal,
};
