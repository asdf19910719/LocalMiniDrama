const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateImportTarget,
  buildProjectCards,
  getProjectListModel,
  buildEpisodeRows,
  buildCreationSources,
  canAdvanceAssetMatches,
} = require('./production-studio-v2.1-project-hub-prototype-model.js');

test('项目列表只暴露最近工作和少量健康摘要而不输出四阶段仪表盘', () => {
  const page = getProjectListModel();
  const project = page.items[0];

  assert.equal(project.id, 7);
  assert.deepEqual(project.recentWork, {
    episodeId: 1,
    label: '第 1 集《无人楼层》',
    stage: 'storyboard',
    stageLabel: '分镜',
    progress: '7/10',
  });
  assert.deepEqual(project.health, [
    { kind: 'running', label: '生成中 1', target: 'tasks' },
    { kind: 'attention', label: '待处理 1', target: 'overview' },
    { kind: 'refresh', label: '需要更新 1', target: 'overview' },
  ]);
  assert.equal(project.continueLabel, '继续第 1 集 · 分镜');
  assert.equal('stages' in project, false);
  assert.equal(project.cover.source, 'current-storyboard');
});

test('项目搜索排序和状态筛选返回真实结果及明确选项', () => {
  const searched = getProjectListModel({ query: '雾港' });
  assert.deepEqual(searched.items.map(item => item.id), [9]);
  assert.equal(searched.resultCount, 1);
  assert.equal(searched.totalCount, 2);

  const attention = getProjectListModel({ status: 'needs-attention' });
  assert.deepEqual(attention.items.map(item => item.id), [7]);

  const sorted = getProjectListModel({ sort: 'name-asc' });
  assert.deepEqual(sorted.items.map(item => item.id), [7, 9]);
  assert.deepEqual(sorted.statusOptions.map(item => item.id), [
    'all', 'in-progress', 'needs-attention', 'completed', 'archived',
  ]);
});

test('项目列表无结果、任务暂停和索引失败都返回唯一恢复动作', () => {
  const noResults = getProjectListModel({ query: '不存在的项目' });
  assert.equal(noResults.items.length, 0);
  assert.deepEqual(noResults.emptyState.actions.map(item => item.id), ['clear-filters']);

  const paused = getProjectListModel({ scenarioId: 'task-paused' });
  assert.equal(paused.banner.kind, 'attention');
  assert.equal(paused.items[0].health[0].label, '任务需要处理 1');
  assert.deepEqual(paused.banner.actions.map(item => item.id), ['open-project-tasks']);

  const failed = getProjectListModel({ scenarioId: 'load-failed' });
  assert.equal(failed.kind, 'error');
  assert.deepEqual(failed.actions.map(item => item.id), [
    'retry-project-index', 'rebuild-project-index', 'open-data-tools',
  ]);
});

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
