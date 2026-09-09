const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createStoryboardModel,
  addTimedSegment,
  splitTimedSegment,
  compileGenerationEnvelope,
} = require('./production-studio-v2.1-prototype-model.js');

test('一个分镜可只含一个时段，并映射为 provider 请求时长', () => {
  const model = createStoryboardModel();

  assert.equal(model.timedSegments.length, 1);
  assert.equal(model.timedSegments[0].startSeconds, 0);
  assert.equal(model.timedSegments[0].endSeconds, 7);

  const envelope = compileGenerationEnvelope(model);
  assert.equal(envelope.plannedDurationSeconds, 7);
  assert.equal(envelope.requestDurationSeconds, 8);
  assert.equal(envelope.storyboardId, 'SB-03');
});

test('新增和拆分时段后，分镜时段保持连续且总时长不变', () => {
  let model = createStoryboardModel();
  model = addTimedSegment(model);

  assert.equal(model.timedSegments.length, 2);
  assert.deepEqual(
    model.timedSegments.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds]),
    [[0, 7], [7, 10]],
  );

  model = splitTimedSegment(model, model.timedSegments[0].id);
  assert.equal(model.timedSegments.length, 3);
  assert.equal(model.timedSegments.at(-1).endSeconds, 10);
  assert.ok(model.timedSegments.every((segment, index, segments) =>
    index === 0 || segment.startSeconds === segments[index - 1].endSeconds));
});

test('编译请求包含逐时段资产绑定和仅提示词级的风格门禁', () => {
  const model = createStoryboardModel();
  const envelope = compileGenerationEnvelope(model);

  assert.deepEqual(envelope.timedSegments[0].sceneAssetIds, ['SCENE-hotel-corridor']);
  assert.deepEqual(envelope.timedSegments[0].characterStateIds, ['CHAR-linxia-night-shift']);
  assert.deepEqual(envelope.timedSegments[0].propIds, ['PROP-service-cart', 'PROP-room-phone']);
  assert.equal(envelope.promptStyleGate.passed, true);
  assert.equal(envelope.promptStyleGate.checks.styleBlockExactOnce, true);
  assert.equal(envelope.promptStyleGate.checks.negativeClausesPresent, true);
  assert.equal(envelope.promptStyleGate.checks.requestSnapshotByteEqual, true);
  assert.equal('styleConformanceGate' in envelope, false);
});

test('provider 不支持多时段时给出可执行的拆分建议', () => {
  const model = addTimedSegment(createStoryboardModel());
  const envelope = compileGenerationEnvelope(model, {
    id: 'provider-single-segment',
    name: '单时段视频模型',
    allowedDurations: [5, 8, 10, 15],
    maxDurationSeconds: 15,
    supportsMultipleTimedSegments: false,
  });

  assert.equal(envelope.compatibility.passed, false);
  assert.equal(envelope.compatibility.code, 'MULTI_SEGMENT_UNSUPPORTED');
  assert.equal(envelope.compatibility.suggestedAction, 'split-storyboard');
});

test('分镜阶段提交首次正式视频，短片阶段以镜头审核和修复为主', () => {
  const html = fs.readFileSync(
    path.join(__dirname, 'production-studio-v2.1-prototype.html'),
    'utf8',
  );
  const storyboardSection = html.match(/<section class="screen simple active" data-screen="storyboard">([\s\S]*?)<section class="screen simple" data-screen="cut">/)[1];
  const cutSection = html.match(/<section class="screen simple" data-screen="cut">([\s\S]*?)<aside class="drawer"/)[1];

  assert.match(storyboardSection, /预检并生成视频候选/);
  assert.match(storyboardSection, /预计费用/);
  assert.match(cutSection, /镜头审核/);
  assert.match(cutSection, /重新生成或补充候选/);
  assert.doesNotMatch(cutSection, /仅短片阶段/);
  assert.doesNotMatch(html, /id="batchButton"/);
});

test('外部来源预览使用唯一 episode-package 2.1 合同', () => {
  const html = fs.readFileSync(
    path.join(__dirname, 'production-studio-v2.1-prototype.html'),
    'utf8',
  );
  const sourcePreview = html.match(/function openSourcePreview\(\) \{([\s\S]*?)document\.getElementById\('segmentList'\)/)[1];

  assert.match(sourcePreview, /schema: 'local-mini-drama\.episode-package'/);
  assert.match(sourcePreview, /version: '2\.1'/);
  assert.match(sourcePreview, /story_scenes:/);
  assert.match(sourcePreview, /shot_packages:/);
  assert.doesNotMatch(sourcePreview, /schema_version|storyboards:/);
});
