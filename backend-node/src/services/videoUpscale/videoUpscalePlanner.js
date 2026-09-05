const { upscaleError } = require('./upscaleErrors');

function validateSourceMedia(media, config = {}) {
  const expectedWidth = Number(config.expected_source_width || 1312);
  const expectedHeight = Number(config.expected_source_height || 736);
  const scale = Number(config.scale || 2);
  if (Number(media?.width) !== expectedWidth || Number(media?.height) !== expectedHeight) {
    throw upscaleError(
      'UNSUPPORTED_SOURCE_DIMENSIONS',
      `云端超分工作流要求 ${expectedWidth}×${expectedHeight}，实际为 ${media?.width || 0}×${media?.height || 0}`
    );
  }
  if (!Number.isInteger(Number(media?.frameCount)) || Number(media.frameCount) <= 0) {
    throw upscaleError('INVALID_SOURCE_MEDIA', '无法取得有效的视频帧数');
  }
  if (!Number.isInteger(Number(media?.fpsNumerator)) || Number(media.fpsNumerator) <= 0
      || !Number.isInteger(Number(media?.fpsDenominator)) || Number(media.fpsDenominator) <= 0) {
    throw upscaleError('INVALID_SOURCE_MEDIA', '无法取得有效的视频帧率');
  }
  return { width: expectedWidth * scale, height: expectedHeight * scale };
}

function buildSegmentPlan({ frameCount, frameCap = 240, overlapFrames = 4 }) {
  frameCount = Number(frameCount);
  frameCap = Number(frameCap);
  overlapFrames = Number(overlapFrames);
  if (!Number.isInteger(frameCount) || frameCount <= 0) throw new Error('frameCount must be a positive integer');
  if (!Number.isInteger(frameCap) || frameCap <= 0) throw new Error('frameCap must be a positive integer');
  if (!Number.isInteger(overlapFrames) || overlapFrames < 0 || overlapFrames >= frameCap) {
    throw new Error('overlapFrames must be smaller than frameCap');
  }
  const step = frameCap - overlapFrames;
  const segments = [];
  for (let startFrame = 0, index = 0; startFrame < frameCount; startFrame += step, index += 1) {
    const count = Math.min(frameCap, frameCount - startFrame);
    segments.push({
      index,
      startFrame,
      frameCount: count,
      trimLeadingFrames: index === 0 ? 0 : Math.min(overlapFrames, count),
    });
    if (startFrame + count >= frameCount) break;
  }
  return segments;
}

module.exports = { validateSourceMedia, buildSegmentPlan };
