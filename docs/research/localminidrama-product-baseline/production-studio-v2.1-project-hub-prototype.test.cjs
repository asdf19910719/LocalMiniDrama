const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateImportTarget,
  buildProjectCards,
  buildEpisodeRows,
  buildCreationSources,
  canAdvanceAssetMatches,
} = require('./production-studio-v2.1-project-hub-prototype-model.js');

test('外部 JSON 可以创建新剧集', () => {
  const result = evaluateImportTarget({ mode: 'create_new' });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'create_episode');
});

test('外部 JSON 可以填充空白剧集', () => {
  const result = evaluateImportTarget({
    mode: 'fill_existing',
    episode: { id: 12, isBlank: true, reasons: [] },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'fill_blank_episode');
  assert.equal(result.episodeId, 12);
});

test('外部 JSON 拒绝合并或覆盖非空剧集', () => {
  const result = evaluateImportTarget({
    mode: 'fill_existing',
    episode: {
      id: 7,
      isBlank: false,
      reasons: ['script_content_not_empty', 'has_storyboards', 'storyboard_has_media'],
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'TARGET_NOT_BLANK');
  assert.deepEqual(result.availableActions, ['choose_blank_episode', 'create_new_episode', 'cancel']);
  assert.equal(result.availableActions.includes('merge'), false);
  assert.equal(result.availableActions.includes('overwrite'), false);
});

test('项目和剧集摘要暴露可审计阶段状态、阻塞和导入来源', () => {
  const project = buildProjectCards()[0];
  const episode = buildEpisodeRows()[0];

  assert.equal(project.continueStage, 'storyboard');
  assert.equal(project.runningTasks, 1);
  assert.equal(project.stages.assets.status, 'ready_for_review');
  assert.equal('progress' in project, false);
  assert.equal(episode.importSource.schemaVersion, '2.1');
  assert.equal(episode.stages.storyboard.status, 'in_progress');
  assert.equal(episode.stages.cut.status, 'in_progress');
  assert.equal(episode.blockers, 1);
});

test('新建项目和剧集使用同一组六来源', () => {
  const sources = buildCreationSources();
  assert.equal(sources.length, 6);
  assert.deepEqual(sources.map((item) => item.id), ['blank', 'ai', 'novel', 'external_ai', 'episode_json', 'source_video']);
});

test('资产匹配冲突未决时不能进入下一步', () => {
  const matches = [{ status: 'reuse' }, { status: 'conflict', decision: null }];
  assert.equal(canAdvanceAssetMatches(matches), false);
  matches[1].decision = 'create_new';
  assert.equal(canAdvanceAssetMatches(matches), true);
});
