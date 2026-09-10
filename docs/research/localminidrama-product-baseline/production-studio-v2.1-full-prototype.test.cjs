const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modelPath = path.resolve(__dirname, 'production-studio-v2.1-full-prototype-model.js');
const htmlPath = path.resolve(__dirname, 'production-studio-v2.1-full-prototype.html');
const model = fs.existsSync(modelPath) ? require(modelPath) : null;
const hubModel = require('./production-studio-v2.1-project-hub-prototype-model.js');

test('统一原型模型文件存在并暴露路由接口', () => {
  assert.ok(model, 'production-studio-v2.1-full-prototype-model.js 不存在');
  assert.equal(typeof model.buildPrototypeRouteRegistry, 'function');
  assert.equal(typeof model.parsePrototypeLocation, 'function');
  assert.equal(typeof model.formatPrototypeLocation, 'function');
  assert.equal(typeof model.transitionPrototypeState, 'function');
});

test('路由注册表覆盖全部一级产品目的地', () => {
  assert.ok(model, '统一原型模型不存在');
  const ids = model.buildPrototypeRouteRegistry().map(item => item.id);
  assert.deepEqual(ids, [
    'projects', 'project-new', 'project-import', 'project-overview',
    'project-bible', 'project-episodes', 'project-assets', 'external-ai-wizard',
    'studio-script', 'studio-assets', 'studio-storyboard', 'studio-cut',
    'library', 'tasks', 'quick-create', 'canvas', 'settings-ai', 'settings-general', 'settings-data',
  ]);
});

test('剧本草稿在确认前可结构化，AI和历史均按上下文渐进出现', () => {
  const blank = model.getScriptStageModel('7', '3', 'blocked');
  assert.deepEqual(blank.emptyStart.actions.map(item => item.id), [
    'paste-import', 'ai-draft', 'manual-write',
  ]);
  assert.equal(blank.emptyStart.actions[1].label, 'AI 生成剧本');
  assert.equal(blank.stageNavigation[1].label, '设定');
  assert.equal(blank.versionComparison.canCompare, false);

  const active = model.getScriptStageModel('7', '1', 'stale');
  assert.equal(active.aiAssistant.presentation, 'menu');
  assert.equal(active.revisionHistory.presentation, 'drawer');
  assert.equal(active.revisionHistory.actionLabel, '历史版本');
  assert.equal(active.primaryAction.label, '检查并确认');
  assert.equal(active.versionComparison.canCompare, true);
  assert.deepEqual(active.aiActions.filter(item => item.requiresSelection).map(item => item.id), [
    'rewrite-selection', 'expand-selection', 'condense-selection',
  ]);
});

test('数据管理退出项目一级导航并按职责拆到项目菜单与高级数据工具', () => {
  assert.equal(typeof model.getProjectSectionNavigation, 'function');
  assert.equal(typeof model.getProjectOperationsModel, 'function');
  assert.equal(typeof model.getAdvancedDataToolsModel, 'function');

  assert.deepEqual(model.getProjectSectionNavigation('7').map(item => item.id), [
    'project-overview', 'project-episodes', 'project-assets',
  ]);

  const operations = model.getProjectOperationsModel('7');
  assert.deepEqual(operations.actions.map(item => item.id), [
    'export-backup', 'restore-backup', 'delete-project',
  ]);
  assert.equal(operations.advancedToolsTarget.routeId, 'settings-data');
  assert.equal(operations.actions.find(item => item.id === 'delete-project').recoverable, true);

  const dataTools = model.getAdvancedDataToolsModel('default');
  assert.deepEqual(dataTools.tools.map(item => item.id), [
    'integrity-check', 'media-relocation', 'migration-journal', 'physical-cleanup',
  ]);
  assert.equal(dataTools.tools.find(item => item.id === 'physical-cleanup').requiresDryRun, true);

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /data-route-id="project-data"/);
  assert.match(html, /data-project-menu/);
  assert.match(html, /data-data-tool="\$\{item\.id\}"/);
});

test('高级数据工具把完整性告警定位为可恢复的问题清单', () => {
  const registry = model.buildPrototypeRouteRegistry().find(item => item.id === 'settings-data');
  for (const scenario of ['integrity-checking', 'integrity-success', 'integrity-warning', 'integrity-failed', 'integrity-partial']) {
    assert.ok(registry.scenarios.includes(scenario), scenario);
  }

  const page = model.getAdvancedDataToolsModel('integrity-warning');
  assert.equal(page.integrity.readOnly, true);
  assert.deepEqual(page.integrity.scope, [
    'SQLite 结构与外键', '媒体存在性、大小与 hash', '对象引用与项目/剧集关系',
    '任务索引', '受控目录边界', '孤儿与重复文件',
  ]);
  assert.deepEqual(page.integrity.issues.map(item => item.id), ['media-offline', 'task-index-stale']);
  assert.deepEqual(page.integrity.issues.map(item => item.recovery.id), ['open-media-relocation', 'rebuild-task-index']);
  assert.deepEqual(page.scenario.actions.map(item => item.id), ['open-media-relocation', 'rebuild-task-index']);
});

test('高级数据工具以预览和报告保护重定位、迁移恢复与物理清理', () => {
  const page = model.getAdvancedDataToolsModel('default');
  assert.equal(page.mediaRelocation.updateRequiresExplicitConfirmation, true);
  assert.deepEqual(page.mediaRelocation.matchingKeys, ['相对路径', '文件名', '文件大小', 'hash', '媒体类型', '项目/剧集上下文']);
  assert.deepEqual(page.mediaRelocation.previewItems.map(item => item.matchState), ['unique', 'ambiguous', 'hash-mismatch', 'not-found', 'out-of-boundary']);
  assert.equal(page.mediaRelocation.previewItems.find(item => item.matchState === 'hash-mismatch').canConfirmUpdate, false);

  const migration = model.getAdvancedDataToolsModel('migration-failed').migration.records.find(item => item.status === 'failed');
  assert.deepEqual(migration.actions.map(item => item.id), ['open-journal', 'view-backup', 'continue-migration', 'rollback-migration', 'open-manual-recovery', 'export-migration-report']);
  assert.equal(migration.rollbackState, 'available');

  const cleanup = model.getAdvancedDataToolsModel('cleanup-blocked').cleanup;
  assert.equal(cleanup.requiresDryRun, true);
  assert.equal(cleanup.confirmationPhrase, '永久清理');
  assert.equal(cleanup.requiresSecondConfirmation, true);
  assert.deepEqual(cleanup.preview.blocked.map(item => item.reason), ['仍有引用', '活动任务占用', '路径越界', '首次迁移备份']);
  assert.equal(cleanup.report.preserved, true);

  const readOnly = model.getAdvancedDataToolsModel('read-only').scenario.actions[0];
  const activeTaskBlocking = model.getAdvancedDataToolsModel('active-task-blocking').scenario.actions[0];
  assert.equal(readOnly.target.routeId, 'settings-general');
  assert.equal(activeTaskBlocking.target.routeId, 'tasks');
});

test('媒体重定位确认汇总在提交瞬间纳入已选人工匹配', () => {
  assert.equal(typeof model.getMediaRelocationConfirmationSummary, 'function');
  const relocation = model.getAdvancedDataToolsModel('default').mediaRelocation;
  assert.deepEqual(model.getMediaRelocationConfirmationSummary(relocation, []), {
    unique: 181, manual: 0, total: 181, blocked: 4,
  });
  assert.deepEqual(model.getMediaRelocationConfirmationSummary(relocation, ['linxia-voice', 'unknown-item']), {
    unique: 181, manual: 1, total: 182, blocked: 4,
  });
});

test('高级数据工具原型提供可操作的检查、重定位、迁移与清理闭环', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const marker of [
    'function openDataIntegrityDrawer', 'data-integrity-recovery', 'function openMediaRelocationDrawer',
    'data-relocation-candidate', 'data-relocation-confirm', 'function openMigrationJournalDrawer',
    'data-migration-rollback-input', 'function openPhysicalCleanupDrawer', 'data-cleanup-dry-run',
    'data-cleanup-confirm-input', 'data-cleanup-execute', 'function openDataCleanupReport',
    'data-data-scenario-action', 'data-cleanup-blocked-item',
  ]) assert.match(html, new RegExp(marker));
  assert.doesNotMatch(html, /物理清理演示完成；已生成清理报告/);
});

test('地址可往返保留项目、剧集和演示场景', () => {
  assert.ok(model, '统一原型模型不存在');
  const hash = model.formatPrototypeLocation(
    'studio-storyboard',
    { projectId: '7', episodeId: '1' },
    'provider-blocked',
  );
  assert.equal(hash, '#/projects/7/episodes/1/storyboard?scenario=provider-blocked');
  assert.deepEqual(model.parsePrototypeLocation(hash), {
    routeId: 'studio-storyboard',
    params: { projectId: '7', episodeId: '1' },
    scenarioId: 'provider-blocked',
  });
});

test('项目列表搜索排序和筛选写入地址并可完整恢复', () => {
  const hash = model.formatPrototypeLocation('projects', {
    query: '雾港', status: 'needs-attention', sort: 'name-asc',
  });
  assert.equal(hash, '#/projects?q=%E9%9B%BE%E6%B8%AF&status=needs-attention&sort=name-asc');
  assert.deepEqual(model.parsePrototypeLocation(hash), {
    routeId: 'projects',
    params: { query: '雾港', status: 'needs-attention', sort: 'name-asc' },
    scenarioId: 'default',
  });
});

test('项目列表注册索引加载失败恢复场景', () => {
  const projects = model.buildPrototypeRouteRegistry().find(item => item.id === 'projects');
  assert.ok(projects.scenarios.includes('load-failed'));
});

test('未知地址安全回到项目列表并保留诊断标记', () => {
  assert.ok(model, '统一原型模型不存在');
  assert.deepEqual(model.parsePrototypeLocation('#/unknown'), {
    routeId: 'projects',
    params: {},
    scenarioId: 'default',
    notFound: true,
  });
});

test('外部 AI 回流继续使用同一个 package attempt', () => {
  assert.ok(model, '统一原型模型不存在');
  const waiting = { flow: 'external-ai', status: 'waiting_external', packageId: 'pkg-21' };
  const validating = model.transitionPrototypeState(waiting, {
    type: 'select-result',
    file: 'episode.json',
  });
  assert.equal(validating.status, 'validating_result');
  assert.equal(validating.packageId, 'pkg-21');
  assert.equal(validating.selectedFile, 'episode.json');
});

test('项目剧集中心统一展示剧集状态、阶段筛选和六类来源', () => {
  assert.equal(typeof model.getProjectEpisodesModel, 'function');
  const page = model.getProjectEpisodesModel('7', 'default');
  assert.equal(page.projectId, '7');
  assert.equal(page.title, '凌晨两点的客房服务');
  assert.deepEqual(page.stats, {
    total: 8,
    active: 2,
    needsAttention: 1,
    completed: 2,
  });
  assert.deepEqual(page.rows.map(item => item.episodeId), ['1', '2', '3']);
  assert.equal(page.creationEntry.primary.id, 'new-episode');
  assert.deepEqual(page.creationEntry.secondary.items.map(item => item.id), [
    'package-import', 'external-ai', 'novel-split', 'source-video',
  ]);
});

test('新建剧集直达空白剧本，外部 AI 通过独立可恢复向导回流草稿', () => {
  const entry = model.getEpisodeCreationEntryModel('7');
  assert.equal(entry.primary.id, 'new-episode');
  assert.equal(entry.primary.target.routeId, 'studio-script');
  assert.equal(entry.secondary.label, '导入 / 协作');
  assert.equal(model.getEpisodeCreationSourceTarget('blank', { projectShellCreated: true }).routeId, 'studio-script');

  const wizard = model.getExternalAiWizardModel('7', { step: 'compiled-context' });
  assert.equal(wizard.presentation, 'page');
  assert.equal(wizard.resumable, true);
  assert.deepEqual(wizard.stepOrder, [
    'target', 'compiled-context', 'task-note', 'package-preview',
    'waiting-result', 'result-file', 'import-preview', 'imported-draft',
  ]);
  assert.equal(wizard.context.compiled, true);
  assert.equal(wizard.context.readOnly, true);
  assert.equal(wizard.context.editableFields.length, 1);
  assert.equal(wizard.context.editableFields[0].id, 'task-note');
  assert.deepEqual(wizard.package.outputActions.map(item => item.id), [
    'download-package', 'copy-prompt', 'copy-context', 'open-task-directory',
  ]);
  assert.equal(wizard.resultFile.requiredChecks.some(item => item.id === 'package_id'), true);
  assert.equal(wizard.resultFile.requiredChecks.some(item => item.id === 'assets_digest'), true);
  assert.equal(wizard.resultFile.requiredChecks.some(item => item.id === 'nonempty-target'), true);
  assert.equal(wizard.importResult.writesApprovedScript, false);
  assert.equal(wizard.importResult.createsMediaTasks, false);
  assert.equal(wizard.importResult.writesDraftOnly, true);
});

test('默认项目导航隐藏项目设置并将分镜访问与媒体生成分离', () => {
  assert.deepEqual(
    model.getProjectSectionNavigation('7').map(item => item.label),
    ['概览', '剧集', '项目素材'],
  );
  assert.deepEqual(
    model.getEpisodeStageNavigation('7', '2').map(item => item.label),
    ['剧本', '设定', '分镜', '短片'],
  );
  const episode = model.getProjectEpisodesModel('7').rows.find(item => item.episodeId === '2');
  assert.equal(episode.stages.storyboard.navigationAccess, 'available');
  assert.equal(episode.stages.storyboard.mediaGenerationAccess, 'blocked');
  assert.deepEqual(model.parsePrototypeLocation('#/projects/7/bible'), {
    routeId: 'project-bible',
    params: { projectId: '7' },
    scenarioId: 'default',
  });
});

test('单人创作者导航不暴露项目设置，阶段可进入而媒体生成单独受控', () => {
  assert.deepEqual(
    model.getProjectSectionNavigation('7').map(item => item.label),
    ['概览', '剧集', '项目素材'],
  );
  assert.deepEqual(
    model.getEpisodeStageNavigation('7', '2').map(item => item.label),
    ['剧本', '设定', '分镜', '短片'],
  );
  const page = model.getProjectEpisodesModel('7');
  const row = page.rows.find(item => item.episodeId === '2');
  assert.equal(row.stages.storyboard.navigationAccess, 'available');
  assert.equal(row.stages.storyboard.mediaGenerationAccess, 'blocked');
  assert.equal(row.stages.storyboard.access, 'available');
  assert.equal(row.stages.assets.access, 'available');
  assert.equal(row.stages.cut.navigationAccess, 'unavailable');

  assert.equal(page.stageFilters, undefined);
  assert.equal(page.archivedRows, undefined);
  assert.deepEqual(page.statusFilters.map(item => item.id), [
    'all', 'needs-attention', 'in-progress', 'completed',
  ]);
  assert.deepEqual(page.managementActions.map(item => item.id), [
    'rename', 'reorder', 'view-source', 'delete',
  ]);
  assert.equal(page.managementActions.find(item => item.id === 'delete').recoverable, true);
  assert.equal('durationTarget' in row, false);
  assert.equal(row.estimatedDuration, '约 85 秒');
});

test('剧集中心使用紧凑头、工作状态筛选和真实最近工作时间', () => {
  const page = model.getProjectEpisodesModel('7', 'default');
  assert.equal(page.header.mode, 'compact');
  assert.deepEqual(page.stats, {
    total: 8,
    active: 2,
    needsAttention: 1,
    completed: 2,
  });
  assert.deepEqual(page.statusFilters.map(item => item.id), [
    'all', 'needs-attention', 'in-progress', 'completed',
  ]);
  assert.equal(page.search.debounceMs, 280);
  assert.equal(page.defaultSort, 'number-asc');
  assert.deepEqual(page.rows.map(item => item.updatedAt), [
    '2026-09-09T10:42:00+08:00',
    '2026-09-09T11:18:00+08:00',
    '2026-09-07T16:05:00+08:00',
  ]);

  const needsAttention = model.getProjectEpisodesModel('7', 'filter-status-needs-attention');
  assert.deepEqual(needsAttention.visibleRows.map(item => item.episodeId), ['1']);

  const empty = model.getProjectEpisodesModel('7', 'empty');
  assert.deepEqual(empty.stats, { total: 0, active: 0, needsAttention: 0, completed: 0 });
  assert.equal(empty.emptyState.kind, 'project-empty');
  const filterEmpty = model.getProjectEpisodesModel('7', 'filter-status-completed');
  assert.equal(filterEmpty.emptyState.kind, 'filter-empty');
  assert.equal(filterEmpty.emptyState.action.id, 'clear-filters');
});

test('分镜阶段始终可进入，仅成片保留前置条件', () => {
  const page = model.getProjectEpisodesModel('7', 'default');
  const episode2 = page.rows.find(item => item.episodeId === '2');
  assert.equal(episode2.stages.storyboard.access, 'available');

  assert.deepEqual(model.getEpisodeNavigationTarget({
    projectId: '7', episodeId: '2', action: 'stage', stage: 'storyboard',
  }), {
    routeId: 'studio-storyboard',
    params: { projectId: '7', episodeId: '2' },
    scenarioId: 'default',
  });

  assert.deepEqual(model.getEpisodeNavigationTarget({
    projectId: '7', episodeId: '2', action: 'stage', stage: 'cut',
  }), {
    blocked: true,
    routeId: 'project-episodes',
    params: { projectId: '7', focusId: '2', workspaceTab: 'storyboard' },
    scenarioId: 'gate-blocked',
    reason: '请先完成分镜与必需镜头视频',
  });

  assert.deepEqual(model.getEpisodeNavigationTarget({
    projectId: '7', episodeId: '1', action: 'resume',
  }), {
    routeId: 'studio-storyboard',
    params: {
      projectId: '7', episodeId: '1', sceneId: 'scene-02', shotId: 'shot-03',
      candidateId: 'video-03-b',
    },
    scenarioId: 'default',
  });
});

test('六类来源先选择安全目标并为已有项目计算下一集编号', () => {
  assert.equal(typeof model.getEpisodeTargetSelectorModel, 'function');
  const focused = model.getEpisodeTargetSelectorModel('7', 'script-import', { focusEpisodeId: '3' });
  assert.equal(focused.nextEpisodeNumber, 9);
  assert.equal(focused.selectedTargetId, 'fill_blank:3');
  assert.deepEqual(focused.targets.map(item => [item.id, item.allowed]), [
    ['create_new:9', true],
    ['fill_blank:3', true],
  ]);
  assert.equal(focused.targets.some(item => item.id === 'episode:1'), false);

  const newProject = model.getEpisodeTargetSelectorModel('new-project', 'blank', { creationContext: 'new-project' });
  assert.deepEqual(newProject.targets.map(item => item.id), ['create_new:1']);
  assert.equal(newProject.selectedTargetId, 'create_new:1');
});

test('外部 AI 等待任务持久化并用冻结标识匹配回流结果', () => {
  assert.equal(typeof model.getExternalAiCollaborationTaskModel, 'function');
  const task = model.getExternalAiCollaborationTaskModel('7', 'waiting');
  assert.equal(task.taskId, 'external-ai-pkg-ep09');
  assert.equal(task.target.label, '创建第 9 集');
  assert.equal(task.packageId, 'pkg_ep09_20260909');
  assert.equal(task.assetsDigest, '4f92c881…0a7d');
  assert.equal(task.persisted, true);
  assert.equal(task.visibleInTaskCenter, true);
  assert.deepEqual(task.actions.map(item => item.id), [
    'select-result', 'download-package', 'copy-prompt', 'cancel-attempt',
  ]);
  assert.equal(task.resultMatch.required.every(item => item.status === 'matched'), true);

  const taskCenter = model.getTaskCenterModel({ projectId: '7', focusTaskId: task.taskId });
  const externalTask = taskCenter.groups.flatMap(group => group.tasks).find(item => item.id === task.taskId);
  assert.equal(externalTask.focused, true);
  assert.equal(externalTask.type, 'external-ai');
  assert.equal(externalTask.creatorStatus, '等待外部 AI 结果');
});

test('制作包预览使用真实目标、可判读内容和精确素材版本', () => {
  const target = model.getEpisodePackageImportModel(1, { targetMode: 'create_new' });
  assert.equal(target.targetEpisodeNumber, 9);
  assert.equal(target.targets[0].label, '创建第 9 集');
  assert.equal(target.file.status, 'validated');

  const script = model.getEpisodePackageImportModel(2, { targetMode: 'create_new' });
  assert.ok(script.episodeSummary.synopsisPreview.length > 0);
  assert.ok(script.scriptPreview.paragraphs.length >= 2);
  assert.equal(script.contentIssues.some(item => item.severity === 'blocking'), false);

  const matches = model.getEpisodePackageImportModel(3, {
    assetDecisions: { 'scene-room-208': 'reuse:scene-208:v4:night', 'prop-note': 'skip' },
  });
  assert.equal(matches.canAdvance, true);
  assert.equal(matches.matches.find(item => item.id === 'scene-room-208').decision.assetVersionId, 'scene-208:v4:night');

  const structure = model.getEpisodePackageImportModel(4);
  assert.equal(structure.validation.find(item => item.id === 'provider-duration').level, 'info');
  assert.equal(structure.validation.find(item => item.id === 'provider-duration').label, '生成前校验');

  const commit = model.getEpisodePackageImportModel(5, { targetMode: 'create_new' });
  assert.equal(commit.targetEpisodeNumber, 9);
  assert.deepEqual(commit.writeSummary, {
    createdCharacters: 1,
    reusedAssets: 1,
    createdAssets: 5,
    skippedObjects: 1,
    externalMedia: 0,
  });
});

test('导入成功投影真实目标剧集并把所有成功动作绑定同一剧集', () => {
  const page = model.getProjectEpisodesModel('7', 'import-succeeded');
  assert.equal(page.scenario.resultEpisodeId, '3');
  assert.equal(page.scenario.actions.every(item => item.episodeId === '3'), true);
  const imported = page.rows.find(item => item.episodeId === '3');
  assert.equal(imported.isBlank, false);
  assert.equal(imported.title, '208 房没有住客');
  assert.equal(imported.importSource.kind, 'external-ai-result');
  assert.equal(imported.stages.script.status, 'draft');
  assert.equal(imported.stages.storyboard.status, 'imported_draft');
  assert.equal(imported.highlighted, true);
});

test('剧集继续动作恢复真实阶段而空白剧集直达剧本页', () => {
  assert.equal(typeof model.getEpisodeNavigationTarget, 'function');
  assert.deepEqual(model.getEpisodeNavigationTarget({
    projectId: '7', episodeId: '1', action: 'resume',
  }), {
    routeId: 'studio-storyboard',
    params: {
      projectId: '7', episodeId: '1', sceneId: 'scene-02', shotId: 'shot-03',
      candidateId: 'video-03-b',
    },
    scenarioId: 'default',
  });
  assert.deepEqual(model.getEpisodeNavigationTarget({
    projectId: '7', episodeId: '2', action: 'stage', stage: 'script',
  }), {
    routeId: 'studio-script',
    params: { projectId: '7', episodeId: '2' },
    scenarioId: 'default',
  });
  assert.deepEqual(model.getEpisodeNavigationTarget({
    projectId: '7', episodeId: '3', action: 'resume',
  }), {
    routeId: 'studio-script',
    params: { projectId: '7', episodeId: '3' },
    scenarioId: 'blocked',
  });
});

test('外部 AI 协作冻结一个任务包并把结果接回统一五步导入', () => {
  assert.equal(typeof model.getEpisodeCreationFlow, 'function');
  const flow = model.getEpisodeCreationFlow('external_ai');
  assert.deepEqual(flow.steps, [
    '生成创作上下文', '创建本集任务包', '前往外部 AI 协作',
    '选择结果 JSON', '五步预览并导入',
  ]);
  assert.equal(flow.package.packageId, 'pkg_ep03_20260909');
  assert.equal(flow.package.assetsDigest, '4f92c881…0a7d');
  assert.deepEqual(flow.package.downloadFormats, ['任务包.zip', '单文件任务.json']);
  assert.equal(flow.package.sameProtocol, true);
  assert.equal(flow.resultImport.reusesPackageAttempt, true);
  assert.deepEqual(flow.resultImport.targetModes, ['create_new', 'fill_blank']);
  assert.equal(flow.createsPaidMediaTasks, false);
});

test('单集制作包五步导入先保护目标和资产匹配再以零媒体任务写入', () => {
  assert.equal(typeof model.getEpisodePackageImportModel, 'function');
  const target = model.getEpisodePackageImportModel(1, { targetMode: 'fill_blank' });
  assert.equal(target.stepTitle, '目标与文件');
  assert.deepEqual(target.allowedTargetModes, ['create_new', 'fill_blank']);
  assert.equal(target.disallowedTargetModes.includes('overwrite'), true);

  const conflict = model.getEpisodePackageImportModel(3, { assetConflictResolved: false });
  assert.equal(conflict.canAdvance, false);
  assert.equal(conflict.unresolvedConflicts, 2);
  const resolved = model.getEpisodePackageImportModel(3, { assetConflictResolved: true });
  assert.equal(resolved.canAdvance, true);

  const commit = model.getEpisodePackageImportModel(5, { targetMode: 'create_new' });
  assert.equal(commit.transactional, true);
  assert.equal(commit.remoteGenerationCost, 0);
  assert.deepEqual(commit.createdMediaTasks, []);
});

test('剧集管理提供回收站式删除并保留外部来源审计入口', () => {
  const page = model.getProjectEpisodesModel('7', 'default');
  assert.deepEqual(page.managementActions.map(item => item.id), [
    'rename', 'reorder', 'view-source', 'delete',
  ]);
  assert.equal(page.managementActions.find(item => item.id === 'delete').recoverable, true);
  const imported = page.rows.find(item => item.episodeId === '1');
  assert.equal(imported.importSource.schemaVersion, '2.1');
  assert.ok(imported.importSource.sha256);
  assert.ok(imported.importSource.reportId);
});

test('外部来源审计的四类只读证据均可单独查看且不可修改', () => {
  assert.equal(typeof model.getEpisodeSourceAuditModel, 'function');
  const audit = model.getEpisodeSourceAuditModel('7', '1', 'raw');

  assert.equal(audit.readOnly, true);
  assert.equal(audit.immutable, true);
  assert.deepEqual(audit.sections.map(item => item.id), [
    'raw', 'normalized', 'matches', 'report',
  ]);
  assert.equal(audit.activeSection.id, 'raw');
  assert.equal(audit.packageId, 'pkg_ep01_20260908');
  assert.ok(audit.sha256);
  assert.ok(audit.activeSection.entries.length > 0);
  assert.throws(
    () => model.getEpisodeSourceAuditModel('7', '1', 'editable'),
    /Unknown episode source audit section/,
  );
});

test('剧集中心高风险异常都给出可执行恢复动作', () => {
  for (const scenarioId of [
    'external-ai-waiting', 'json-target-not-blank', 'asset-match-conflict',
    'import-failed', 'import-succeeded',
  ]) {
    const page = model.getProjectEpisodesModel('7', scenarioId);
    assert.ok(page.scenario, `${scenarioId} 缺少场景模型`);
    assert.ok(page.scenario.actions.length > 0, `${scenarioId} 缺少恢复或成功动作`);
  }
  assert.deepEqual(
    model.getProjectEpisodesModel('7', 'json-target-not-blank').scenario.actions.map(item => item.id),
    ['choose-blank', 'create-new', 'cancel'],
  );
});

test('剧本阶段把保存、版本、解析和批准拆成可恢复的独立动作', () => {
  assert.equal(typeof model.getScriptStageModel, 'function');
  const page = model.getScriptStageModel('7', '1', 'default');
  assert.equal(page.autosave.delayMs, 800);
  assert.equal(page.autosave.browserRecoveryCopy, true);
  assert.equal(page.currentRevision.id, 'script-r12');
  assert.equal(page.approval.createsRevisionOnly, true);
  assert.equal(page.approval.autoRefreshDownstream, false);
  assert.deepEqual(page.assetExtraction.diff, { added: 2, changed: 3, removed: 1, locked: 2 });
  for (const scenarioId of ['blocked', 'stale', 'diff', 'save-failed']) {
    const scenario = model.getScriptStageModel('7', '1', scenarioId).scenario;
    assert.ok(scenario.actions.length > 0, `${scenarioId} 缺少恢复动作`);
  }
});

test('剧本页用唯一状态源投影保存状态和动态主操作', () => {
  const saved = model.getScriptStageModel('7', '1', 'default');
  assert.deepEqual(saved.editor.persistence, {
    state: 'saved',
    label: '已保存于 14:32',
    hasRecoveryCopy: false,
  });
  assert.deepEqual(saved.primaryAction, {
    id: 'check-and-confirm',
    label: '检查并确认',
    enabled: true,
    reason: '',
  });
  assert.equal(saved.autosave.userMessage, '更改会自动保存');
  assert.equal(saved.header.backLabel, '返回剧集');
  assert.equal(saved.header.title, '剧本');

  const saving = model.getScriptStageModel('7', '1', 'saving');
  assert.equal(saving.editor.persistence.state, 'saving');
  assert.equal(saving.primaryAction.enabled, false);

  const failed = model.getScriptStageModel('7', '1', 'save-failed');
  assert.equal(failed.editor.persistence.state, 'save_failed');
  assert.equal(failed.editor.persistence.hasRecoveryCopy, true);
  assert.equal(failed.primaryAction.id, 'retry-save');

  const approved = model.getScriptStageModel('7', '1', 'approval-succeeded');
  assert.equal(approved.approval.state, 'approved');
  assert.deepEqual(approved.primaryAction, {
    id: 'enter-assets',
    label: '进入设定',
    enabled: true,
    reason: '',
  });
});

test('空剧本和版本冲突投影真实内容并阻止错误确认', () => {
  const empty = model.getScriptStageModel('7', '1', 'blocked');
  assert.equal(empty.scenes.length, 0);
  assert.equal(empty.editor.content, '');
  assert.equal(empty.editor.isEmpty, true);
  assert.equal(empty.primaryAction.enabled, false);
  assert.match(empty.primaryAction.reason, /剧本为空/);
  assert.deepEqual(empty.assetExtraction.diff, { added: 0, changed: 0, removed: 0, locked: 0 });
  assert.equal(empty.assetExtraction.items.length, 0);

  const conflict = model.getScriptStageModel('7', '1', 'conflict');
  assert.equal(conflict.editor.persistence.state, 'conflict');
  assert.equal(conflict.primaryAction.id, 'resolve-conflict');
  assert.equal(conflict.conflict.localContent.length > 0, true);
  assert.equal(conflict.conflict.serverContent.length > 0, true);
  assert.equal(conflict.conflict.autoOverwrite, false);
});

test('编辑保存检查确认形成可恢复的单向状态转换', () => {
  const initial = model.getScriptStageModel('7', '1', 'default');
  const dirty = model.editScriptDraft(initial, 'scene-02', '林夏：楼层并不存在。');
  assert.equal(dirty.editor.persistence.state, 'dirty');
  assert.equal(dirty.primaryAction.enabled, false);

  const saving = model.startScriptDraftSave(dirty);
  assert.equal(saving.editor.persistence.state, 'saving');
  const saved = model.completeScriptDraftSave(saving, '14:40');
  assert.equal(saved.editor.persistence.label, '已保存于 14:40');
  assert.equal(saved.primaryAction.id, 'check-and-confirm');

  const checked = model.checkScriptDraftForApproval(saved);
  assert.equal(checked.approval.check.completed, true);
  assert.equal(checked.primaryAction.id, 'confirm-new-version');
  const approving = model.startScriptApproval(checked);
  assert.equal(approving.approval.state, 'approving');
  assert.equal(approving.primaryAction.id, 'approval-processing');
  const approved = model.approveScriptDraft(approving);
  assert.equal(approved.approval.state, 'approved');
  assert.equal(approved.primaryAction.id, 'enter-assets');
  assert.equal(approved.approval.autoRefreshDownstream, false);
});

test('AI 改写先生成候选和差异并只在应用后修改草稿', () => {
  const initial = model.getScriptStageModel('7', '1', 'default');
  const original = initial.editor.content;
  const processing = model.startScriptAiCandidate(initial, {
    mode: 'rewrite-selection',
    scope: '当前场次选中段落',
  });
  assert.equal(processing.aiWorkflow.state, 'processing');
  assert.equal(processing.editor.content, original);

  const ready = model.completeScriptAiCandidate(processing, {
    candidateText: '林夏压低声音：这一层从来没有登记过。',
  });
  assert.equal(ready.aiWorkflow.state, 'candidate_ready');
  assert.equal(ready.aiWorkflow.diff.added > 0, true);
  assert.equal(ready.editor.content, original);

  const applied = model.applyScriptAiCandidate(ready);
  assert.equal(applied.editor.content, '林夏压低声音：这一层从来没有登记过。');
  assert.equal(applied.editor.persistence.state, 'dirty');
  assert.equal(applied.aiWorkflow.state, 'applied');
});

test('版本比较提供场次级真实差异且历史恢复只创建新草稿', () => {
  const page = model.getScriptStageModel('7', '1', 'diff');
  assert.equal(page.versionComparison.rows.length > 0, true);
  assert.deepEqual(page.versionComparison.rows[0], {
    sceneLabel: '场次 02 · 13 层走廊',
    kind: '修改',
    before: '林夏走进走廊，灯光闪烁。',
    after: '林夏握紧门卡，走廊尽头再次响起服务铃。',
  });
  assert.equal(page.revisions.every(item => !/script-r\d+/.test(item.label)), true);

  const restored = model.createScriptDraftFromHistory(page, 'approved');
  assert.equal(restored.currentRevision.status, '草稿');
  assert.equal(restored.currentRevision.sourceLabel, '由已确认版本复制');
  assert.equal(restored.revisions.filter(item => item.status === 'approved').length, 1);
});

test('确认检查展示可决策素材变化和具体下游影响', () => {
  const page = model.getScriptStageModel('7', '1', 'default');
  assert.deepEqual(page.assetExtraction.diff, { added: 2, changed: 3, removed: 1, locked: 2 });
  assert.equal(page.assetExtraction.label, '预计素材变化');
  assert.equal(page.assetExtraction.items.length, 4);
  assert.deepEqual(page.approval.downstreamImpact, {
    characterChanges: 2,
    sceneChanges: 1,
    staleShots: 6,
    preservedVideos: 4,
  });
  assert.equal(page.approval.autoDeleteMedia, false);
  assert.equal(page.approval.autoRegenerateMedia, false);

  const ignored = model.decideScriptAssetChange(page, 'asset-remove-guest', 'ignore');
  assert.equal(ignored.assetExtraction.items.find(item => item.id === 'asset-remove-guest').decision, 'ignore');
  assert.equal(ignored.currentRevision.status, '草稿');
});

test('场次操作保留单人所需编辑能力并实时重算全剧摘要', () => {
  const page = model.getScriptStageModel('7', '1', 'default');
  assert.deepEqual(page.episodeSummary, { totalWords: 1272, estimatedDuration: '约 8 分 30 秒' });
  assert.deepEqual(page.scenes[1].metadata, { interiorExterior: '内景', location: '13 层走廊', timeOfDay: '深夜' });

  const renamed = model.renameScriptScene(page, 'scene-02', '内景 · 禁用楼层 · 深夜');
  assert.equal(renamed.scenes[1].heading, '内景 · 禁用楼层 · 深夜');
  const duplicated = model.duplicateScriptScene(renamed, 'scene-02');
  assert.equal(duplicated.scenes.length, 5);
  const moved = model.moveScriptScene(duplicated, duplicated.scenes[2].id, -1);
  assert.equal(moved.scenes[1].id, duplicated.scenes[2].id);
  const deleted = model.deleteScriptScene(moved, moved.scenes[1].id);
  assert.equal(deleted.scenes.length, 4);
  assert.equal(deleted.sceneUndo.available, true);
  assert.equal(model.undoDeleteScriptScene(deleted).scenes.length, 5);
});

test('切换和新增场次使用各自正文且不丢失当前草稿', () => {
  const page = model.getScriptStageModel('7', '1', 'default');
  const selected = model.selectScriptScene(page, 'scene-03');
  assert.equal(selected.editor.selectedSceneId, 'scene-03');
  assert.match(selected.editor.content, /208 门口/);
  const added = model.addScriptScene(selected);
  assert.equal(added.scenes.length, 5);
  assert.equal(added.editor.selectedSceneId, added.scenes[4].id);
  assert.equal(added.editor.content, '');
  assert.equal(added.editor.persistence.state, 'dirty');
});

test('设定只选择本集生产版本并在进入分镜时固化快照', () => {
  assert.equal(typeof model.getEpisodeAssetsStageModel, 'function');
  const page = model.getEpisodeAssetsStageModel('7', '1', 'default');
  assert.deepEqual(page.requiredGroups.map(item => item.id), ['characters', 'scenes', 'props', 'voices']);
  assert.equal(page.snapshot.immutable, true);
  assert.equal(page.snapshot.entryAction, 'enter-storyboard');
  assert.equal(page.snapshot.confirmAction, undefined);
  assert.equal(page.snapshot.autoRefreshFromProject, false);
  assert.equal(page.mediaReadiness.status, 'needs-attention');
  assert.deepEqual(page.mediaReadiness.blockers.map(item => item.id), ['manager-voice']);
  assert.equal(model.getEpisodeAssetsStageModel('7', '1', 'candidate-compare').scenario.actions.length > 0, true);
});

test('本集设定不完整时仍能进入分镜，但受影响镜头不能提交媒体任务', () => {
  const page = model.getEpisodeAssetsStageModel('7', '1', 'blocked');
  assert.equal(page.storyboardEntry.allowed, true);
  assert.equal(page.storyboardEntry.target.routeId, 'studio-storyboard');
  assert.equal(page.storyboardEntry.savesSnapshotOnClick, true);
  assert.equal(page.mediaReadiness.status, 'needs-attention');

  const guard = model.getStoryboardMediaGenerationGuard('7', '1', 'shot-03', 'needs-attention');
  assert.equal(guard.enabled, false);
  assert.deepEqual(guard.recoveryTarget, {
    routeId: 'studio-assets',
    params: { projectId: '7', episodeId: '1', shotId: 'shot-03' },
  });
  const readyGuard = model.getStoryboardMediaGenerationGuard('7', '1', 'shot-03', 'ready');
  assert.equal(readyGuard.enabled, true);
  assert.equal(readyGuard.recoveryTarget, null);

  const storyboard = model.getStoryboardStageModel('7', '1', 'default');
  assert.equal(storyboard.mediaReadiness.status, 'needs-attention');
  assert.equal(storyboard.mediaReadiness.text, '有 2 项可稍后处理');
  assert.equal(storyboard.mediaReadiness.recovery.target.routeId, 'studio-assets');
  const unapproved = model.getEpisodeAssetsStageModel('7', '2', 'default');
  assert.equal(unapproved.mediaReadiness.status, 'script-unapproved');
  assert.equal(unapproved.storyboardEntry.allowed, true);
});

test('设定覆盖首次准备、就绪、检查、快照和媒体异常完整生命周期', () => {
  const definition = model.buildPrototypeRouteRegistry().find(item => item.id === 'studio-assets');
  assert.deepEqual(definition.scenarios, [
    'default', 'blocked', 'stale', 'candidate-compare', 'look-change',
    'loading', 'first-preparation', 'ready', 'checking', 'snapshot-saving',
    'snapshot-succeeded', 'check-failed', 'snapshot-failed', 'media-offline',
    'external-package', 'external-package-mismatch',
  ]);
  const blocked = model.getEpisodeAssetsStageModel('7', '1', 'default');
  assert.deepEqual(blocked.pageContext, {
    breadcrumb: ['凌晨两点的客房服务', '第 1 集'],
    backLabel: '返回剧集',
    backTarget: { routeId: 'project-episodes', params: { projectId: '7' } },
  });
  assert.equal(blocked.mediaReadiness.summary, '有 2 项可稍后处理');
  assert.equal(blocked.primaryAction.label, '进入分镜');
  assert.equal(blocked.primaryAction.allowed, true);
  const ready = model.getEpisodeAssetsStageModel('7', '1', 'ready');
  assert.equal(ready.mediaReadiness.status, 'ready');
  assert.equal(ready.mediaReadiness.summary, '本集设定已准备好');
  assert.equal(ready.primaryAction.label, '进入分镜');
  assert.equal(model.getEpisodeAssetsStageModel('7', '1', 'checking').mediaReadiness.status, 'checking');
  assert.equal(model.getEpisodeAssetsStageModel('7', '1', 'snapshot-failed').mediaReadiness.status, 'snapshot-failed');
  assert.equal(model.getEpisodeAssetsStageModel('7', '1', 'snapshot-succeeded').primaryAction.target.routeId, 'studio-storyboard');
});

test('设定以缩略图比较本集旧版和项目新版且只修改本集选择', () => {
  assert.equal(typeof model.getEpisodeAssetVersionComparisonModel, 'function');
  assert.equal(typeof model.applyEpisodeAssetDecision, 'function');
  const comparison = model.getEpisodeAssetVersionComparisonModel('linxia-hotel');
  assert.deepEqual(comparison.versions.map(item => item.role), ['episode-current', 'project-latest']);
  assert.ok(comparison.versions.every(item => item.thumbnail && item.source && item.updatedAt));
  assert.deepEqual(comparison.affectedLocations, ['场次 01 · 分镜 02', '场次 02 · 分镜 03']);
  assert.equal(comparison.actions.find(item => item.id === 'use-project-latest').changesProjectDefault, false);
  const page = model.getEpisodeAssetsStageModel('7', '1', 'default');
  const updated = model.applyEpisodeAssetDecision(page, { type: 'use-project-latest', targetId: 'linxia-hotel' });
  const character = updated.requiredGroups.flatMap(group => group.items).find(item => item.id === 'linxia-hotel');
  assert.equal(character.episodeSelection, 'v3');
  assert.equal(updated.reviewItems.some(item => item.targetId === 'linxia-hotel'), false);
  assert.equal(updated.mediaReadiness.warnings.length, 0);
});

test('设定就地解决条件音色并在解除阻塞后允许进入分镜', () => {
  assert.equal(typeof model.getEpisodeVoiceResolutionModel, 'function');
  const voice = model.getEpisodeVoiceResolutionModel('manager-voice');
  assert.equal(voice.requiredByPolicy, true);
  assert.deepEqual(voice.sources.map(item => item.id), ['preset', 'library', 'upload', 'extract']);
  assert.ok(voice.candidates.every(item => item.previewAction === '试听'));
  assert.equal(voice.actions.find(item => item.id === 'use-model-default').changesAudioPolicy, true);
  const page = model.getEpisodeAssetsStageModel('7', '1', 'default');
  const resolved = model.applyEpisodeAssetDecision(page, { type: 'use-voice', targetId: 'manager-voice', candidateId: 'voice-manager-02' });
  assert.equal(resolved.mediaReadiness.blockers.length, 0);
  assert.equal(resolved.mediaReadiness.status, 'ready');
  assert.equal(resolved.audioPolicy, '人物参考音色');
  assert.equal(resolved.primaryAction.label, '进入分镜');
  assert.equal(resolved.storyboardEntry.allowed, true);
});

test('设定追踪外部制作包映射并只准备真实缺失素材', () => {
  const page = model.getEpisodeAssetsStageModel('7', '1', 'external-package');
  assert.deepEqual(page.externalPackage.summary, { provided: 6, reused: 3, created: 2, skipped: 1, missing: 1 });
  assert.deepEqual(page.externalPackage.columns, ['外部包候选', '项目当前图', '本集选择']);
  assert.ok(page.externalPackage.mappings.every(item => item.decision && item.status));
  assert.equal(page.missingMaterialsAction.label, '准备缺失素材');
  assert.deepEqual(page.missingMaterialsPreflight.items.map(item => item.id), ['manager-voice']);
  assert.equal(page.missingMaterialsPreflight.taskCount, 1);
  assert.equal(page.missingMaterialsPreflight.estimatedCost, '¥0.08');
  const mismatch = model.getEpisodeAssetsStageModel('7', '1', 'external-package-mismatch');
  assert.equal(mismatch.primaryAction.id, 'review-package-mismatch');
  assert.equal(mismatch.mediaReadiness.status, 'needs-attention');
  assert.equal(mismatch.storyboardEntry.allowed, true);
});

test('设定主界面使用个人用户语言且完整继承项带视觉预览', () => {
  const page = model.getEpisodeAssetsStageModel('7', '1', 'look-change');
  assert.equal(page.scenario.title, '项目画面风格已有更新');
  assert.equal(page.scenario.detail.includes('Project Look'), false);
  assert.equal(page.scenario.detail.includes('stale'), false);
  assert.deepEqual(page.scenario.actions.map(item => item.label), [
    '查看影响', '继续使用当前风格', '本集改用新风格',
  ]);
  assert.ok(page.requiredGroups.flatMap(group => group.items).every(item => item.thumbnail));
  assert.equal(page.audioPolicy, '人物参考音色 · 缺少酒店经理音色');
  assert.equal(model.getEpisodeAssetsStageModel('7', '1', 'ready').mediaReadiness.summary, '本集设定已准备好');
  assert.equal('preflightPanel' in page, false);
  assert.equal('batchPreflight' in page, false);
  assert.equal('readinessSummary' in page, false);
});

test('设定 HTML 提供页内版本音色外部包决策和进入分镜状态链', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.equal(model.getEpisodeAssetsStageModel('7', '1', 'default').pageContext.backLabel, '返回剧集');
  for (const marker of [
    'data-episode-material-target', 'data-episode-version-action', 'data-episode-voice-use',
    'data-episode-model-default', 'data-episode-package-mapping', 'data-episode-missing-preflight',
    'data-episode-primary', 'beginEpisodeStoryboardEntry',
  ]) assert.match(html, new RegExp(marker));
  for (const copy of ['外部制作包素材对应关系', '参考：']) {
    assert.match(html, new RegExp(copy));
  }
  for (const legacy of ['只处理差异和阻塞', '进入分镜前检查', '确认并进入分镜']) {
    assert.doesNotMatch(html, new RegExp(legacy));
  }
  assert.match(html, /data-media-readiness=/);
});

test('AI 配置隐藏密钥且全局任务只展示可信进度与能力动作', () => {
  assert.equal(typeof model.getAiSettingsModel, 'function');
  assert.equal(typeof model.getGlobalTaskModel, 'function');
  const settings = model.getAiSettingsModel('default');
  assert.equal(settings.providers.every(item => item.secretMasked && !item.secretMasked.includes('sk-')), true);
  assert.equal(settings.connectionTest.createsGenerationCost, false);
  assert.deepEqual(settings.layers, ['全局默认', '项目覆盖', '任务快照']);
  const tasks = model.getGlobalTaskModel();
  const web = tasks.tasks.find(item => item.id === 'task-shot-03-image');
  const h3 = tasks.tasks.find(item => item.id === 'task-shot-03-video');
  assert.equal(web.progressPercent, null);
  assert.equal(web.progressSource, 'unavailable');
  assert.equal(h3.progressSource, 'provider');
  assert.deepEqual(tasks.tasks.find(item => item.id === 'task-shot-05-video').actions, ['恢复认证', '查看输入']);
});

test('AI 配置覆盖安装默认、能力摘要和业务角色，不把一次性选择写回默认', () => {
  const settings = model.getAiSettingsModel('default');
  assert.deepEqual(settings.resolutionOrder, ['one-shot', 'project', 'global', 'install']);
  assert.equal(settings.channelCards.every(item => item.taskTypes && item.availability && item.network && item.cost), true);
  assert.deepEqual(settings.businessMappingGroups.map(item => item.id), ['creation', 'media', 'post']);
  assert.deepEqual(settings.businessMappingGroups.flatMap(item => item.items).map(item => item.id), [
    'script', 'image', 'video', 'tts', 'external-ai', 'composite', 'upscale', 'audio-post',
  ]);
  const oneShot = model.getAiSettingsOneShotModel('api');
  assert.equal(oneShot.changesPersistedDefault, false);
  assert.equal(oneShot.returnTarget.routeId, 'tasks');
});

test('AI 配置环境诊断能区分新任务阻断与运行中任务影响', () => {
  const env = model.getChatGptEnvironmentModel('login-required');
  const failed = env.checks.find(item => item.status === 'failed');
  assert.ok(failed.checkedAt);
  assert.equal(failed.blocksNewTasks, true);
  assert.equal(failed.affectsRunningTasks, false);
  assert.ok(failed.diagnostic);
  assert.ok(failed.recoveryTarget);
});

test('AI 配置导入导出和 Provider 异常均有明确可恢复场景', () => {
  const registry = model.buildPrototypeRouteRegistry().find(item => item.id === 'settings-ai');
  for (const scenario of ['provider-loading', 'model-list-failed', 'provider-disabled', 'local-unavailable', 'cert-error', 'proxy-error', 'partial-capability', 'model-retired', 'save-conflict', 'save-failed', 'key-invalid', 'snapshot-mismatch']) {
    assert.ok(registry.scenarios.includes(scenario), scenario);
    assert.ok(model.getAiSettingsModel(scenario).scenario);
  }
  const imported = model.getAiSettingsImportModel('import-conflict');
  assert.equal(imported.phase, 'conflict');
  assert.equal(imported.secretsIncluded, false);
  assert.ok(imported.conflicts.every(item => item.choices.length >= 2));
  const exported = model.getAiSettingsExportModel();
  assert.equal(exported.secretsIncluded, false);
  assert.ok(exported.excluded.includes('浏览器授权'));
});

test('AI 配置原型包含默认解析、诊断、一次性配置和真实导入导出入口', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const marker of [
    'data-ai-config-import', 'data-ai-config-export', 'data-ai-provider-edit', 'data-ai-one-shot',
    'data-ai-recovery', 'data-ai-capability-probe', '任务创建后固定本次配置', '能力声明（任务按钮按此决定）',
  ]) assert.match(html, new RegExp(marker));
  assert.doesNotMatch(html, /data-one-shot-channel/);
});

test('新建项目只通过一个上下文主动作提交，并隐藏项目壳术语', () => {
  assert.equal(typeof model.getProjectCreateModel, 'function');
  const initial = model.getProjectCreateModel('default');
  const selected = model.getProjectCreateModel('source-selected');
  assert.equal(initial.fields.find(item => item.id === 'name').value, '');
  assert.equal(initial.fields.find(item => item.id === 'aspect-ratio').control, 'select');
  assert.equal(initial.fields.find(item => item.id === 'genre').control, 'text');
  assert.equal(initial.fields.some(item => item.id === 'episode-duration'), false);
  assert.equal(initial.fields.find(item => item.id === 'output-location').control, 'directory');
  assert.equal(initial.primaryAction.enabled, false);
  assert.equal(initial.primaryAction.label, '选择开始方式');
  assert.equal(selected.selectedSourceId, 'script-import');
  assert.equal(selected.primaryAction.enabled, true);
  assert.equal(selected.primaryAction.label, '创建项目并导入剧本');
  assert.equal(model.getProjectCreateModel('source-selected', {
    name: '午夜前台', selectedSourceId: 'script-import',
  }).fields.find(item => item.id === 'output-location').value, 'E:/LocalMiniDrama/午夜前台');
  assert.equal(initial.createSequence.includes('显式创建项目壳'), false);
});

test('新建项目主入口贴近个人创作者心智，其他能力进入更多方式', () => {
  const groups = model.getEpisodeCreationSourceGroups();
  assert.deepEqual(groups.primary.map(item => item.id), ['script-import', 'ai-script', 'package-import']);
  assert.deepEqual(groups.primary.map(item => item.label), ['我有剧本', '让 AI 帮我写', '我有制作包']);
  assert.deepEqual(groups.more.map(item => item.id), ['blank', 'novel-split', 'source-video']);
  assert.equal(groups.primary.find(item => item.id === 'package-import').secondaryAction.label, '创建外部 AI 协作任务');
});

test('新建项目覆盖校验、创建、冲突、取消和恢复状态', () => {
  const registry = model.buildPrototypeRouteRegistry().find(item => item.id === 'project-new');
  assert.deepEqual(registry.scenarios, [
    'default', 'source-selected', 'validation-error', 'creating', 'name-conflict',
    'path-unavailable', 'insufficient-space', 'source-cancelled', 'create-failed', 'success',
  ]);
  assert.equal(model.getProjectCreateModel('source-picker').scenarioId, 'source-selected');
  assert.equal(model.getProjectCreateModel('validation-error').fields.find(item => item.id === 'name').value, '');
  assert.equal(model.getProjectCreateModel('creating').formLocked, true);
  assert.equal(model.getProjectCreateModel('create-failed').preservesInput, true);
  assert.equal(model.getProjectCreateModel('source-cancelled').cancelAfterCreate.keepsEmptyProject, true);
  const emptyProject = model.getProjectOverviewModel('new-project');
  assert.equal(emptyProject.title, '午夜前台');
  assert.equal(emptyProject.sections.blockers.length, 0);
});

test('新项目来源流程只允许创建第 1 集，不泄漏已有项目空白集选项', () => {
  const blank = model.getEpisodeCreationFlow('blank', { creationContext: 'new-project' });
  assert.equal(blank.defaultEpisodeNumber, 1);
  assert.deepEqual(blank.targetOptions, [{ id: 'create_new', label: '创建第 1 集' }]);
  assert.equal(blank.steps.some(item => item.includes('填充空白剧集')), false);

  const packageStep = model.getEpisodePackageImportModel(1, { creationContext: 'new-project' });
  assert.deepEqual(packageStep.allowedTargetModes, ['create_new']);
  assert.deepEqual(packageStep.targets, [{ id: 'create_new', label: '创建第 1 集', allowed: true }]);
  assert.equal(packageStep.file.name, 'episode-01.json');
  assert.equal(packageStep.cancelLabel, '取消首集创建');
  assert.equal(packageStep.targets.some(item => item.label.includes('第 3 集')), false);
  assert.equal(packageStep.targets.some(item => item.code === 'TARGET_NOT_BLANK'), false);
});

test('新建项目仍复用六类剧集来源能力', () => {
  const page = model.getProjectCreateModel('default');
  assert.deepEqual(page.fields.map(item => item.id), ['name', 'aspect-ratio', 'genre', 'output-location']);
  assert.equal(page.fields.some(item => item.label.includes('时长')), false);
  assert.deepEqual(page.sources.map(item => item.id), ['blank', 'ai', 'novel', 'external_ai', 'episode_json', 'source_video']);
  assert.equal(page.cancelAfterCreate.keepsEmptyProject, true);
});

test('项目归档与单集包严格分流并以事务导入新项目', () => {
  assert.equal(typeof model.getProjectImportModel, 'function');
  const page = model.getProjectImportModel('default');
  assert.equal(page.acceptedArchive, 'local-mini-drama.project-archive@2.1');
  assert.equal(page.rejectsEpisodePackage, true);
  assert.equal(page.transactional, true);
  assert.deepEqual(page.defaultStrategies, ['import-as-new']);
  assert.equal(page.phase, 'initial');
  assert.equal(page.archive, null);
  assert.deepEqual(page.primaryAction, {
    id: 'select-archive',
    label: '选择项目归档',
    enabled: true,
  });
});

test('项目归档主动作严格跟随状态且终态不能重复导入', () => {
  const cases = [
    ['validating', '正在检查归档…', false],
    ['ready', '导入为新项目', true],
    ['ready-with-warnings', '仍然导入为新项目', true],
    ['unsupported-archive', '重新选择归档', true],
    ['importing', '正在导入 2.1 GB / 4.8 GB', false],
    ['failed', '重试导入', true],
    ['succeeded', '打开项目', true],
    ['partial-success', '打开项目', true],
  ];
  for (const [scenarioId, label, enabled] of cases) {
    const page = model.getProjectImportModel(scenarioId);
    assert.equal(page.primaryAction.label, label, scenarioId);
    assert.equal(page.primaryAction.enabled, enabled, scenarioId);
  }
  assert.notEqual(model.getProjectImportModel('succeeded').primaryAction.id, 'commit-project-import');
  assert.notEqual(model.getProjectImportModel('unsupported-archive').primaryAction.id, 'commit-project-import');
});

test('项目归档缺失媒体形成可导入警告并展示真实目标空间', () => {
  const page = model.getProjectImportModel('ready-with-warnings');
  assert.equal(page.archive.project, '凌晨两点的客房服务');
  assert.equal(page.archive.media.missing, 2);
  assert.deepEqual(page.checks.map(item => [item.id, item.status]), [
    ['archive-version', 'passed'],
    ['data-structure', 'passed'],
    ['file-integrity', 'passed'],
    ['media-availability', 'warning'],
    ['target-space', 'passed'],
    ['project-name', 'passed'],
  ]);
  assert.equal(page.canImport, true);
  assert.equal(page.target.projectName, '凌晨两点的客房服务（副本）');
  assert.equal(page.target.availableSpace, '126.4 GB');
  assert.equal(page.target.peakSpace, '9.6 GB');
  assert.equal(page.target.mediaStrategy, 'copy');
});

test('不支持归档、长任务、回滚和部分成功均提供可执行恢复合同', () => {
  const unsupported = model.getProjectImportModel('unsupported-archive');
  assert.equal(unsupported.detectedVersion, '1.4');
  assert.equal(unsupported.canImport, false);
  assert.equal(unsupported.checks.find(item => item.id === 'archive-version').status, 'blocking');

  const importing = model.getProjectImportModel('importing');
  assert.equal(importing.job.persistent, true);
  assert.equal(importing.job.visibleInTaskCenter, true);
  assert.equal(importing.job.progressBytes, '2.1 GB / 4.8 GB');

  const failed = model.getProjectImportModel('failed');
  assert.equal(failed.failure.rolledBack, true);
  assert.equal(failed.failure.safeToRetry, true);
  assert.equal(failed.failure.temporaryFiles, '已清理');

  const partial = model.getProjectImportModel('partial-success');
  assert.equal(partial.result.missingMedia, 2);
  assert.equal(partial.result.historyTasksRestored, 41);
  assert.equal(partial.result.historyTasksAutoResume, false);
  assert.ok(partial.secondaryActions.some(item => item.id === 'relocate-media'));
});

test('常规设置负责路径与默认值而高级数据工具负责修复', () => {
  assert.equal(typeof model.getGeneralSettingsModel, 'function');
  const page = model.getGeneralSettingsModel('default');
  assert.deepEqual(page.sections.map(item => item.id), ['workspace', 'output', 'creation-defaults']);
  assert.equal(page.advancedRepairTarget.routeId, 'settings-data');
  assert.equal(model.getGeneralSettingsModel('storage-offline').scenario.actions[0].id, 'open-relocation');
});

test('常规设置提供路径安全检查、备份策略和默认值作用域', () => {
  const page = model.getGeneralSettingsModel('default');
  assert.deepEqual(page.save.states, ['clean', 'dirty', 'saving', 'saved', 'failed', 'conflict']);
  assert.equal(page.paths.every(item => item.permission && item.availableSpace && item.lastCheckedAt && item.overlapCheck), true);
  assert.equal(page.backupPolicy.canDisable, false);
  assert.deepEqual(page.defaults.scope, ['新建项目', '新任务']);
  assert.equal('episodeDuration' in page.defaults, false);
  assert.equal(page.workspaceChange.requiresMigrationPreview, true);
  assert.equal(page.workspaceChange.activeTaskPolicy, 'block-dangerous-change');
});

test('常规设置覆盖离线、保存、迁移和备份异常状态', () => {
  const registry = model.buildPrototypeRouteRegistry().find(item => item.id === 'settings-general');
  for (const scenario of ['loading', 'saving', 'save-failed', 'path-not-found', 'permission-denied', 'insufficient-space', 'path-conflict', 'workspace-change-pending', 'restart-required', 'active-task-blocking', 'backup-failed', 'backup-restoring', 'read-only']) {
    assert.ok(registry.scenarios.includes(scenario), scenario);
    assert.ok(model.getGeneralSettingsModel(scenario).scenario);
  }
  const offline = model.getGeneralSettingsModel('storage-offline');
  assert.deepEqual(offline.storageImpact.affects, ['播放现有候选', '创建新的本地任务', '合片和超分']);
  assert.deepEqual(offline.storageImpact.doesNotAffect, ['已保存的剧本', '数据库中的任务记录', '已完成任务的元数据']);
  const migration = model.getGeneralSettingsModel('active-task-blocking');
  assert.equal(migration.workspaceChange.canConfirm, false);
  assert.ok(migration.workspaceChange.blockers.includes('存在运行中的任务'));
});

test('常规设置原型提供可编辑字段、目录检查、工作区向导和 dirty 保存语义', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const marker of [
    'data-general-field', 'data-general-save', 'data-general-path-check', 'data-general-workspace-change',
    'data-general-backup-now', 'data-general-open-repair', '当前状态', '只影响新建项目、新建剧集和新任务',
    '迁移范围预览', '不会自动改写媒体引用',
  ]) assert.match(html, new RegExp(marker));
  assert.doesNotMatch(html, /data-review-action="save-general"/);
});

test('个人资产库引用固定版本并保护来源许可和使用位置', () => {
  assert.equal(typeof model.getLibraryModel, 'function');
  const page = model.getLibraryModel('default');
  assert.deepEqual(page.addModes.map(item => item.id), ['pinned-reference', 'project-copy']);
  assert.equal(page.addModes.find(item => item.id === 'pinned-reference').followsLibraryUpdates, false);
  assert.equal(page.items.every(item => item.provenance && item.license && item.usageLocations), true);
  assert.equal(model.getLibraryModel('publish-conflict').scenario.actions.length > 0, true);
});

test('个人资产库搜索筛选排序返回真实结果并支持搜索空态', () => {
  const page = model.getLibraryModel('default');
  assert.deepEqual(model.filterAndSortLibraryItems(page.items, { query:'林夏', filters:{}, sortId:'recent' }).map(item => item.id), ['lib-linxia','lib-voice']);
  assert.deepEqual(model.filterAndSortLibraryItems(page.items, { query:'', filters:{ type:'音色' }, sortId:'name' }).map(item => item.id), ['lib-voice']);
  assert.deepEqual(model.filterAndSortLibraryItems(page.items, { query:'不存在', filters:{}, sortId:'recent' }), []);
});

test('个人资产库卡片优先提供预览并把路径降为详情信息', () => {
  const page = model.getLibraryModel('default');
  assert.ok(page.items.every(item => item.preview && item.preview.kind));
  assert.equal(page.items.find(item => item.type === '音色').preview.kind, 'audio');
  assert.equal(page.items.every(item => item.cardPathVisible === false), true);
  assert.ok(page.items.every(item => Number.isInteger(item.usageCount)));
});

test('个人资产库详情模型展示版本来源使用位置和文件恢复动作', () => {
  const detail = model.getLibraryDetailModel('lib-linxia', 'default');
  assert.deepEqual(detail.sections.map(item => item.id), ['preview','profile','versions','provenance','usage','file']);
  assert.equal(detail.actions.some(item => item.id === 'use-project'), true);
  assert.equal(detail.actions.some(item => item.id === 'relocate'), true);
  assert.equal(detail.versions[0].id, 'v3');
});

test('个人资产库用于项目向导先选择目标和关系并返回可追溯结果', () => {
  const wizard = model.getLibraryProjectUseModel('lib-linxia');
  assert.deepEqual(wizard.targets.map(item => item.id), ['project-7','project-9']);
  assert.equal(wizard.relations.find(item => item.id === 'reference').recommended, true);
  const result = model.confirmLibraryProjectUse(wizard, { targetId:'project-7', relation:'reference' });
  assert.equal(result.success, true);
  assert.equal(result.created.kind, 'ProjectAssetReference');
  assert.equal(result.created.followsLibraryUpdates, false);
  assert.equal(result.next.routeId, 'project-assets');
});

test('个人资产库本地导入向导覆盖预览校验导入和失败恢复', () => {
  const page = model.getLibraryModel('default');
  const preview = model.beginLibraryImport(page, { name:'保安.png', type:'人物', hash:'hash-guard-01' });
  assert.equal(preview.importFlow.phase, 'preview');
  const importing = model.confirmLibraryImport(preview, { name:'值班保安', type:'人物', license:'用户自有' });
  assert.equal(importing.importFlow.phase, 'importing');
  const completed = model.completeLibraryImport(importing, { id:'lib-guard', preview:{kind:'image',tone:'blue'}, version:'v1' });
  assert.equal(completed.importFlow.phase, 'success');
  assert.equal(completed.items.at(-1).id, 'lib-guard');
  const failed = model.failLibraryImport(importing, '文件格式不支持');
  assert.equal(failed.importFlow.phase, 'failed');
  assert.equal(failed.importFlow.safeToRetry, true);
});

test('个人资产库项目保存流程只保存选中版本并处理 hash 冲突', () => {
  const page = model.beginLibraryProjectSave(model.getLibraryModel('default'), 'project-7');
  assert.deepEqual(page.projectSaveFlow.selectable.map(item => item.id), ['character-linxia','scene-corridor','prop-keycard']);
  const conflict = model.confirmLibraryProjectSave(page, { assetId:'character-linxia', version:'v3' });
  assert.equal(conflict.projectSaveFlow.phase, 'conflict');
  const resolved = model.resolveLibraryPublishConflict(conflict, 'new-version');
  assert.equal(resolved.projectSaveFlow.phase, 'success');
  assert.equal(resolved.projectSaveFlow.savedVersion, 'v4');
});

test('个人资产库离线资产落到具体卡片且归档保留引用', () => {
  const offline = model.getLibraryModel('offline');
  const item = offline.items.find(item => item.id === 'lib-corridor');
  assert.equal(item.mediaState, 'offline');
  assert.equal(item.canUseInProject, false);
  assert.equal(item.recoveryAction, 'relocate');
  const archived = model.archiveLibraryItem(offline, 'lib-corridor');
  assert.equal(archived.items.find(item => item.id === 'lib-corridor').archived, true);
  assert.equal(archived.items.find(item => item.id === 'lib-corridor').usageLocations.length > 0, true);
});

test('个人资产库空态与加载、筛选空态和抽屉生命周期均有明确状态', () => {
  assert.equal(model.getLibraryModel('loading').scenario.kind, 'loading');
  assert.equal(model.getLibraryModel('empty').items.length, 0);
  assert.equal(model.getLibraryModel('search-empty').scenario.kind, 'search-empty');
  assert.equal(model.getLibraryModel('filter-empty').scenario.kind, 'filter-empty');
  assert.equal(model.getLibraryModel('publish-conflict').scenario.actions.length, 3);
});

test('快速创作和高级画布复用统一任务候选与领域命令', () => {
  assert.equal(typeof model.getQuickCreateModel, 'function');
  assert.equal(typeof model.getCanvasModel, 'function');
  const quick = model.getQuickCreateModel('default');
  assert.equal(quick.jobContract, 'canonical-generation-job');
  assert.deepEqual(quick.resultDestinations.map(item => item.id), ['download', 'library', 'project-asset', 'shot-candidate', 'cut-timeline']);
  assert.equal(quick.isFourStageGate, false);
  const canvas = model.getCanvasModel('default');
  assert.equal(canvas.ownsDomainData, false);
  assert.equal(canvas.commandParity, true);
  assert.equal(canvas.layoutState.scope, 'view-only');
  assert.deepEqual(canvas.context, { projectId: '7', episodeId: '1', stage: 'assets', focusId: 'character-linxia' });
});

test('自由创作先配置与预检，再创建可恢复任务并保留结果去向', () => {
  const initial = model.getQuickCreateModel('default');
  assert.equal(initial.isFourStageGate, false);
  assert.equal(initial.context.requiredBeforeSubmit, true);
  assert.deepEqual(initial.recipes.map(item => item.id), ['image', 'video']);
  assert.ok(initial.history.length >= 1);
  const image = model.getQuickCreateModel('configuring-image');
  assert.equal(image.activeRecipe.id, 'image');
  assert.equal(image.form.prompt.length > 0, true);
  assert.ok(image.form.references.every(item => item.id && item.kind));
  assert.equal(image.form.validation.canSubmit, true);
  assert.ok(image.form.estimate.cost && image.form.estimate.totalTime);
  const video = model.getQuickCreateModel('configuring-video');
  assert.equal(video.activeRecipe.id, 'video');
  assert.equal(video.form.advanced.h3.visible, false);
  assert.equal(video.form.advanced.h3.canOpen, true);
  assert.ok(video.form.fields.some(item => item.id === 'firstFrame'));
  assert.ok(video.form.fields.some(item => item.id === 'duration'));
});

test('自由创作覆盖 Provider、任务、结果归档和上下文异常状态', () => {
  for (const scenario of ['validating', 'queued', 'generating', 'provider-unavailable', 'credential-expired', 'cancelling', 'unknown', 'failed', 'succeeded-unarchived', 'archived', 'partial-success', 'offline', 'result-missing']) {
    const page = model.getQuickCreateModel(scenario);
    assert.equal(page.scenarioId, scenario);
    assert.ok(page.scenario || scenario === 'archived');
  }
  const failed = model.getQuickCreateModel('failed');
  assert.equal(failed.recovery.retryCreatesNewAttempt, true);
  assert.equal(failed.recovery.preserveOriginal, true);
  const success = model.getQuickCreateModel('succeeded-unarchived');
  assert.equal(success.result.status, 'succeeded_unarchived');
  assert.equal(success.destinations.every(item => item.enabled === true), true);
  assert.ok(success.result.preview.kind);
  const archived = model.archiveQuickCreateResult(success, 'library');
  assert.equal(archived.result.status, 'archived');
  assert.equal(archived.result.destination.id, 'library');
  const bound = model.resolveQuickCreateDestination(success, { destinationId: 'shot-candidate', projectId: '7', episodeId: '1', sceneId: 'scene-02', shotId: 'shot-03' });
  assert.equal(bound.kind, 'ShotCandidate');
  assert.equal(bound.target.shotId, 'shot-03');
  assert.equal(bound.source.resultId, success.result.id);
});

test('自由创作原型提供配置、预检、结果预览和五类归档入口', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const marker of ['data-quick-recipe', 'data-quick-preflight', 'data-quick-destination', 'data-quick-preview', 'data-quick-discard', '生成历史', '尚未归档', '批量生成暂不支持']) assert.match(html, new RegExp(marker));
  assert.doesNotMatch(html, /data-review-action="quick-image"[^>]*>[^<]*直接生成/);
});

test('高级画布提供真实关系、精确节点落点与只读影响分析', () => {
  const canvas = model.getCanvasModel('default');
  assert.deepEqual(canvas.contextLabels, { project: '凌晨两点的客房服务', episode: '第 1 集', stage: '设定', focus: '林夏 · 酒店制服' });
  assert.equal(canvas.relations.every(edge => edge.kind && edge.label && edge.direction === 'forward'), true);
  assert.equal(canvas.nodeActions.find(item => item.nodeId === 'shot-03').target.routeId, 'studio-storyboard');
  assert.equal(canvas.nodeActions.find(item => item.nodeId === 'video-a').target.routeId, 'studio-cut');
  assert.ok(canvas.impactAnalysis.direct.some(item => item.id === 'shot-03'));
  assert.ok(canvas.impactAnalysis.indirect.some(item => item.id === 'timeline-shot-03'));
  const confirming = model.getCanvasModel('batch-confirming');
  assert.equal(confirming.batchRecompile.phase, 'confirming');
  assert.equal(confirming.batchRecompile.estimatedTasks, 2);
  assert.equal(confirming.batchRecompile.estimatedCost, '¥0.64');
  const saved = model.getCanvasModel('save-succeeded');
  assert.equal(saved.layoutState.dirty, false);
  assert.ok(saved.layoutState.savedAt);
});

test('生成成片按完成度门禁禁用且镜头时间线覆盖全部镜头', () => {
  const page = model.getCutStageModel('7', '1', 'default');
  assert.equal(page.compose.gate.canCompose, false);
  assert.ok(page.compose.gate.blockers.includes('镜头 07 正在生成'));
  assert.ok(page.compose.gate.blockers.includes('镜头 08 生成失败，需要回分镜处理'));
  assert.ok(page.compose.gate.blockers.includes('镜头 09 尚未生成'));
  assert.equal(page.review.shots.length, 9);
  assert.equal(page.review.shots.filter(item => item.status === 'completed').length, 6);
  assert.equal(page.compose.result, null);

  const ready = model.getCutStageModel('7', '1', 'exported');
  assert.equal(ready.compose.gate.canCompose, true);
  assert.equal(ready.compose.result.exported, true);
  assert.ok(ready.review.shots.every(item => item.status === 'completed' && item.candidateId));
});

test('52 项产品能力全部映射到注册页面且 feature id 唯一', () => {
  const routes = new Set(model.buildPrototypeRouteRegistry().map(item => item.id));
  const coverage = model.buildFeatureCoverageIndex();
  assert.equal(coverage.length, 52);
  assert.equal(new Set(coverage.map(item => item.id)).size, 52);
  assert.equal(coverage.every(item => routes.has(item.routeId)), true);
  assert.equal(coverage.every(item => item.featureId === item.id), true);
  assert.equal(coverage.every(item => item.prototypeStatus === 'complete'), true);
  assert.equal(coverage.every(item => item.productCodeStatus === 'not-developed'), true);
});

test('分镜阶段以五区工作台同时承担时段提示词、分镜图和正式镜头视频生成', () => {
  assert.equal(typeof model.getStoryboardStageModel, 'function');
  const storyboard = model.getStoryboardStageModel('7', '1', 'default');

  assert.deepEqual(storyboard.layout, [
    'shot-inspector', 'segment-prompts', 'result-and-generation',
  ]);
  assert.equal(storyboard.videoGeneration.ownerStage, 'storyboard');
  assert.equal(storyboard.videoGeneration.requiresCostConfirmation, true);
  assert.equal(storyboard.videoGeneration.outputDuration, '7s');
  assert.match(storyboard.videoGeneration.estimatedTime, /分钟/);
  assert.equal(storyboard.h3Draft.editable, true);
  assert.equal(storyboard.inspector.characters.length, 2);
  assert.equal(storyboard.inspector.frameChaining.enabled, true);
  assert.deepEqual(storyboard.batchActions.map(item => item.id), [
    'generate-images', 'generate-videos', 'retry-failed',
  ]);
  assert.equal(storyboard.nextStage.label, '进入成片审核（4/9）');
  assert.deepEqual(storyboard.finalCutActions, []);
});

test('镜头视频生成先追加候选，用户选用后才改变本镜当前视频', () => {
  const state = {
    routeId: 'studio-storyboard',
    officialVideoTasks: 0,
    adoptedVideoCandidateId: 'video-a',
    videoCandidates: [{ id: 'video-a', status: 'ready' }],
  };
  const generated = model.transitionPrototypeState(state, {
    type: 'submit-shot-video',
    candidate: { id: 'video-b', status: 'queued' },
  });
  assert.equal(generated.officialVideoTasks, 1);
  assert.equal(generated.adoptedVideoCandidateId, 'video-a');
  assert.deepEqual(generated.videoCandidates.map(item => item.id), ['video-a', 'video-b']);

  const adopted = model.transitionPrototypeState(generated, {
    type: 'adopt-shot-video',
    candidateId: 'video-b',
  });
  assert.equal(adopted.adoptedVideoCandidateId, 'video-b');
  assert.equal(adopted.videoCandidates.length, 2);

  const opened = model.transitionPrototypeState(adopted, { type: 'open-cut-review' });
  assert.equal(opened.routeId, 'studio-cut');
});

test('短片阶段以单屏审片和整集合成为主而不是精剪工作台', () => {
  assert.equal(typeof model.getCutStageModel, 'function');
  const cut = model.getCutStageModel('7', '1', 'default');

  assert.deepEqual(cut.layout, ['review-player', 'compose-settings']);
  assert.equal(cut.videoGenerationAccess, 'secondary-repair');
  assert.deepEqual(cut.toolbar.primaryActions.map(item => item.id), [
    'select-scene', 'select-shot', 'play-all', 'compose',
  ]);
  assert.equal(cut.review.mode, 'single');
  assert.equal(cut.review.playbackState, 'paused');
  assert.equal(cut.review.currentShot.sourceLabel, '候选 A · 用于本镜');
  assert.equal(cut.compose.settings.bgmStrategy, 'episode-track');
  assert.equal(cut.compose.gate.canCompose, false);
  assert.equal(cut.timeline, undefined);
  assert.equal(cut.postChain, undefined);
  assert.equal(cut.tabs, undefined);
  assert.equal(cut.delivery, undefined);
});

test('成片页时间线覆盖完整九镜并沿用分镜页状态手语', () => {
  const cut = model.getCutStageModel('7', '1', 'default');
  assert.equal(cut.stageNavigation.find(item => item.id === 'storyboard').state, 'warning');
  assert.equal(cut.review.shots.length, 9);
  assert.equal(cut.review.completed, 6);
  assert.equal(cut.review.shots.find(item => item.id === 'shot-07').status, 'generating');
  assert.equal(cut.review.shots.find(item => item.id === 'shot-08').status, 'failed');
  assert.equal(cut.review.shots.find(item => item.id === 'shot-09').status, 'missing');
  assert.equal(cut.review.shots.every(item => 'candidateId' in item && 'tone' in item), true);
  assert.ok(cut.compose.gate.blockers.some(item => item.includes('07')));

  const stale = model.getCutStageModel('7', '1', 'stale');
  assert.equal(stale.review.shots.find(item => item.id === 'shot-05').stale, true);
  assert.equal(stale.review.completed, 5);
  assert.ok(stale.compose.gate.blockers.some(item => item.includes('旧分镜图')));
});

test('短片导航与连播模式复用分镜页镜头顺序', () => {
  const page = model.getCutStageModel('7', '1', 'default');
  const shotChanged = model.selectCutShot(page, 'shot-04');
  assert.equal(shotChanged.review.currentShot.id, 'shot-04');

  const next = model.selectCutShotByStep(page, 1);
  assert.equal(next.review.currentShot.id, 'shot-04');
  const back = model.selectCutShotByStep(next, -1);
  assert.equal(back.review.currentShot.id, 'shot-03');
  const first = model.selectCutShot(page, 'shot-01');
  assert.throws(() => model.selectCutShotByStep(first, -1), /第一镜/);
  const last = model.selectCutShot(page, 'shot-09');
  assert.throws(() => model.selectCutShotByStep(last, 1), /最后一镜/);

  const sceneChanged = model.selectCutScene(page, 'scene-01');
  assert.equal(sceneChanged.review.currentShot.id, 'shot-01');
  assert.equal(sceneChanged.review.sceneFilter, 'scene-01');

  const playAll = model.toggleCutPlayAll(page);
  assert.equal(playAll.review.mode, 'play-all');
  assert.equal(playAll.review.playbackState, 'playing');
  const stopped = model.toggleCutPlayAll(playAll);
  assert.equal(stopped.review.mode, 'single');
  assert.equal(stopped.review.playbackState, 'paused');
});

test('成片设置可调整且生成成片受完成度硬门禁约束', () => {
  const page = model.getCutStageModel('7', '1', 'default');
  assert.throws(() => model.composeEpisode(page), /门禁/);
  const updated = model.updateCutComposeSetting(page, 'bgmStrategy', 'none');
  assert.equal(updated.compose.settings.bgmStrategy, 'none');
  assert.throws(() => model.updateCutComposeSetting(page, 'bgmStrategy', 'per-segment'), /不支持/);
  assert.throws(() => model.updateCutComposeSetting(page, 'unknownKey', true), /Unknown/);

  const ready = model.getCutStageModel('7', '1', 'compose-failed');
  assert.equal(ready.compose.gate.canCompose, true);
  const composing = model.composeEpisode(ready);
  assert.equal(composing.compose.activeTask.status, 'running');
  assert.throws(() => model.composeEpisode(composing), /不能重复/);
  const cancelled = model.cancelEpisodeCompose(composing);
  assert.equal(cancelled.compose.activeTask.status, 'cancel-requested');
  const done = model.completeEpisodeCompose(composing);
  assert.equal(done.compose.result.version, 3);
  assert.equal(done.compose.history.length, 3);
  const exported = model.exportCutResult(done, 'export-mp4');
  assert.equal(exported.compose.result.exported, true);
  assert.throws(() => model.exportCutResult(done, 'export-report'), /Unknown/);
});

test('交付只输出 MP4 且 SRT 为可选项', () => {
  const cut = model.getCutStageModel('7', '1', 'exported');
  assert.deepEqual(cut.exportActions.map(item => item.id), ['export-mp4', 'export-srt']);
  assert.equal(cut.compose.settings.upscale, false);
  const enabled = model.updateCutComposeSetting(cut, 'upscale', true);
  assert.equal(enabled.compose.settings.upscale, true);
});

test('成片覆盖加载空态未完成合成中和合成失败且每种状态都有明确恢复动作', () => {
  const route = model.buildPrototypeRouteRegistry().find(item => item.id === 'studio-cut');
  for (const scenarioId of ['loading', 'empty', 'blocked', 'stale', 'composing', 'compose-failed', 'exported']) {
    assert.equal(route.scenarios.includes(scenarioId), true, `缺少 ${scenarioId} 场景`);
    const page = model.getCutStageModel('7', '1', scenarioId);
    assert.ok(page.scenario);
    assert.ok(page.scenario.actions.length > 0 || scenarioId === 'loading');
  }
  assert.equal(model.getCutStageModel('7', '1', 'empty').review.shots.length, 0);
  assert.equal(model.getCutStageModel('7', '1', 'composing').compose.activeTask.status, 'running');
  assert.equal(model.getCutStageModel('7', '1', 'exported').compose.result.exported, true);
});

test('成片失败保留设置与镜头且重试按原设置创建新任务', () => {
  const failed = model.getCutStageModel('7', '1', 'compose-failed');
  assert.equal(failed.scenario.kind, 'recoverable-error');
  assert.equal(failed.scenario.actions[0].id, 'retry-compose');
  assert.ok(failed.compose.lastError);
  assert.equal(failed.compose.settings.narrationTts, true);
  const retried = model.composeEpisode(failed);
  assert.equal(retried.compose.activeTask.status, 'running');
});

test('分镜和短片异常场景都给出可执行恢复动作', () => {
  const storyboardBlocked = model.getStoryboardStageModel('7', '1', 'provider-blocked');
  assert.equal(storyboardBlocked.scenario.kind, 'blocking');
  assert.deepEqual(storyboardBlocked.scenario.actions.map(item => item.id), [
    'split-shot', 'change-provider',
  ]);

  const cutFailed = model.getCutStageModel('7', '1', 'compose-failed');
  assert.equal(cutFailed.scenario.kind, 'recoverable-error');
  assert.equal(cutFailed.scenario.actions[0].id, 'retry-compose');
  assert.ok(cutFailed.compose.lastError);
});

test('从当前剧本重新生成分镜必须先展示来源和差异且不直接覆盖', () => {
  const storyboard = model.getStoryboardStageModel('7', '1', 'default');
  assert.equal(storyboard.reextract.source.kind, 'script-revision');
  assert.equal(storyboard.reextract.source.revision, 12);
  assert.deepEqual(storyboard.reextract.diff, {
    added: 2, changed: 3, removed: 1, unchanged: 6,
  });
  assert.equal(storyboard.reextract.applyMode, 'create-new-shot-revision');
  assert.equal(storyboard.reextract.preservesManualLocks, true);
  assert.equal(storyboard.reextract.preservesMediaHistory, true);
  assert.match(storyboard.reextract.estimatedProcessingTime, /秒|分钟/);
});

test('分镜文件导入明确本地来源格式并把完整单集包导向剧集页', () => {
  const storyboard = model.getStoryboardStageModel('7', '1', 'default');
  const sources = storyboard.storyboardImport.sources;
  assert.deepEqual(sources.filter(item => item.availability === 'v2.1').map(item => item.id), [
    'excel', 'csv', 'shot-package-json',
  ]);
  assert.deepEqual(sources.find(item => item.id === 'excel').extensions, ['.xls', '.xlsx']);
  assert.equal(sources.find(item => item.id === 'docx-text').availability, 'later');
  assert.equal(storyboard.storyboardImport.episodePackageTarget.routeId, 'project-episodes');
  assert.equal(storyboard.storyboardImport.writeMode, 'preview-then-new-revision');
  assert.deepEqual(storyboard.storyboardImport.steps, [
    '选择文件', '解析与字段映射', '结构预览', '资产匹配', '版本差异', '确认写入',
  ]);
});

test('H3 提示词一等公民提供可编辑草稿、来源失效和结构语义校验', () => {
  const current = model.getStoryboardStageModel('7', '1', 'default').h3Draft;
  assert.equal(current.actionLabel, '生成 H3 提示词');
  assert.equal(current.editable, true);
  assert.deepEqual(current.validationChecks, ['结构校验', '引用槽位', '音频语义覆盖', '提示词风格']);
  assert.ok(current.sourceLabel);
  assert.equal(current.sourceFingerprint, undefined);

  const stale = model.getStoryboardStageModel('7', '1', 'h3-stale').h3Draft;
  assert.equal(stale.status, 'stale');
  assert.equal(stale.canSubmitVideo, false);
  assert.equal(stale.actionLabel, '重新生成 H3 提示词');

  const invalid = model.getStoryboardStageModel('7', '1', 'h3-invalid').h3Draft;
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.canSubmitVideo, false);
  assert.ok(invalid.recoveryActions.length >= 2);
});

test('视频任务展示输出时长、单行预计耗时和候选完成记录', () => {
  const generation = model.getStoryboardStageModel('7', '1', 'default').videoGeneration;
  assert.equal(generation.outputDuration, '7s');
  assert.equal(generation.plannedDuration, undefined);
  assert.equal(generation.requestedDuration, undefined);
  assert.equal(generation.timing, undefined);
  assert.match(generation.estimatedTime, /分钟/);
  assert.equal(generation.estimateIsGuaranteed, undefined);
  const completed = generation.candidates.find(item => item.status === 'ready');
  assert.ok(completed.submittedAt);
  assert.ok(completed.completedAt);
});

test('分镜页以场次和镜头状态驱动逐镜工作并支持上一镜下一镜切换', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  assert.deepEqual(page.progress, {
    current: 3, total: 9, adopted: 4, pendingGeneration: 2, failed: 1,
  });
  assert.deepEqual(page.toolbar.primaryActions.map(item => item.id), [
    'select-scene', 'select-shot', 'prev-shot', 'next-shot', 'batch-generate', 'more',
  ]);
  assert.equal(page.inspector.characters.length, 2);
  assert.equal(page.inspector.scene.label, '208 客房走廊 · 常规夜景 v2');
  assert.equal(page.inspector.props.length, 1);
  assert.equal(page.inspector.frameChaining.previousShotNumber, '02');

  const sceneChanged = model.selectStoryboardScene(page, 'scene-01');
  assert.equal(sceneChanged.selectedSceneId, 'scene-01');
  assert.equal(sceneChanged.selectedShot.id, 'shot-01');

  const shotChanged = model.selectStoryboardShot(page, 'shot-04');
  assert.equal(shotChanged.selectedSceneId, 'scene-02');
  assert.equal(shotChanged.selectedShot.id, 'shot-04');
  assert.equal(shotChanged.resumePosition.shotId, 'shot-04');

  const next = model.selectStoryboardShotByStep(page, 1);
  assert.equal(next.selectedShot.id, 'shot-04');
  const back = model.selectStoryboardShotByStep(next, -1);
  assert.equal(back.selectedShot.id, 'shot-03');
  const first = model.selectStoryboardShot(page, 'shot-01');
  assert.throws(() => model.selectStoryboardShotByStep(first, -1), /第一镜/);
  const last = model.selectStoryboardShot(page, 'shot-09');
  assert.throws(() => model.selectStoryboardShotByStep(last, 1), /最后一镜/);
});

test('镜头时段编辑拆分合并和重排产生可保存草稿且保持时间连续', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const edited = model.editStoryboardSegment(page, 'segment-a', {
    visual: '林夏停在门前，先看门牌再抬起门卡。',
  });
  assert.equal(edited.selectedShot.autoSave, 'dirty');
  assert.match(edited.selectedShot.segments[0].visual, /先看门牌/);

  const split = model.splitStoryboardSegment(edited, 'segment-a', 1.2);
  assert.deepEqual(split.selectedShot.segments.slice(0, 2).map(item => [item.start, item.end]), [
    [0, 1.2], [1.2, 2],
  ]);
  assert.equal(split.selectedShot.segments.length, 4);

  const merged = model.mergeStoryboardSegment(split, split.selectedShot.segments[0].id);
  assert.deepEqual(merged.selectedShot.segments.slice(0, 2).map(item => [item.start, item.end]), [
    [0, 2], [2, 5],
  ]);
  assert.equal(merged.selectedShot.segments.length, 3);

  const moved = model.moveStoryboardSegment(merged, 'segment-c', -1);
  assert.equal(moved.selectedShot.segments[1].id, 'segment-c');
  assert.deepEqual(moved.selectedShot.segments.map(item => item.start), [0, 2, 4]);
  assert.equal(moved.selectedShot.segments.at(-1).end, 7);
});

test('改选当前分镜图只保留一个权威当前项并使下游生成输入失效', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const changed = model.adoptStoryboardImageCandidate(page, 'image-a');
  assert.equal(changed.imageGeneration.currentImageCandidateId, 'image-a');
  assert.deepEqual(changed.imageCandidates.filter(item => item.isCurrent).map(item => item.id), ['image-a']);
  assert.equal(changed.h3Draft.status, 'stale');
  assert.equal(changed.videoGeneration.gate.canSubmit, false);
  assert.ok(changed.videoGeneration.candidates.filter(item => item.status === 'ready').every(item => item.sourceState === 'previous-image'));
  assert.equal(changed.shots.find(item => item.id === 'shot-03').videoStatus, 'stale');
  assert.equal(changed.progress.adopted, 3);

  const refreshed = model.generateStoryboardH3Prompt(changed);
  assert.equal(refreshed.h3Draft.status, 'valid');
  assert.equal(refreshed.videoGeneration.gate.canSubmit, true);
});

test('视频候选先进入播放器再采用且权威状态同步到底部镜头轨道', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  assert.throws(() => model.adoptStoryboardVideoCandidate(page, 'video-b'), /先在主预览中加载/);

  const previewed = model.previewStoryboardVideoCandidate(page, 'video-b');
  assert.equal(previewed.resultPanel.player.loadState, 'ready');
  assert.equal(previewed.resultPanel.player.candidateId, 'video-b');

  const adopted = model.adoptStoryboardVideoCandidate(previewed, 'video-b');
  assert.deepEqual(adopted.videoGeneration.candidates.filter(item => item.isAdopted).map(item => item.id), ['video-b']);
  assert.equal(adopted.videoGeneration.adoptedCandidateId, 'video-b');
  assert.equal(adopted.shots.find(item => item.id === 'shot-03').videoStatus, 'adopted');

  const undone = model.undoStoryboardVideoAdoption(adopted);
  assert.equal(undone.videoGeneration.adoptedCandidateId, null);
  assert.equal(undone.shots.find(item => item.id === 'shot-03').videoStatus, 'ready');
});

test('视频联合预检在引用模型提示词或运行任务异常时统一阻止重复提交', () => {
  for (const scenario of ['blocked', 'provider-blocked', 'h3-stale', 'h3-invalid', 'video-generating']) {
    const page = model.getStoryboardStageModel('7', '1', scenario);
    assert.equal(page.videoGeneration.gate.canSubmit, false, scenario);
    assert.ok(page.videoGeneration.gate.blockers.length > 0, scenario);
  }
  const ready = model.getStoryboardStageModel('7', '1', 'default');
  assert.equal(ready.videoGeneration.gate.canSubmit, true);
  const submitted = model.submitStoryboardVideoGeneration(ready);
  assert.equal(submitted.videoGeneration.gate.canSubmit, false);
  assert.equal(submitted.videoGeneration.activeTask.status, 'running');
  assert.throws(() => model.submitStoryboardVideoGeneration(submitted), /不能重复提交/);
});

test('进入成片前展示未完成摘要但允许提前审片并继续阻断合片', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const summary = model.getStoryboardCutEntrySummary(page);
  assert.equal(summary.canOpenReview, true);
  assert.equal(summary.canStartComposite, false);
  assert.equal(summary.adopted, 4);
  assert.deepEqual(summary.groups.map(item => item.id), ['ready-not-adopted', 'missing', 'failed']);
  assert.equal(page.nextStage.label, '进入成片审核（4/9）');
});

test('分镜页覆盖加载空白保存失败和冲突且每种状态都有明确恢复动作', () => {
  const loading = model.getStoryboardStageModel('7', '1', 'loading');
  assert.equal(loading.pageState, 'loading');
  const empty = model.getStoryboardStageModel('7', '1', 'empty');
  assert.equal(empty.shotDetails.length, 0);
  assert.equal(empty.emptyState.primaryAction.id, 'create-from-script');
  const failed = model.getStoryboardStageModel('7', '1', 'save-failed');
  assert.equal(failed.selectedShot.autoSave, 'save-failed');
  assert.equal(failed.recoveryActions[0].id, 'retry-save');
  const conflict = model.getStoryboardStageModel('7', '1', 'conflict');
  assert.equal(conflict.selectedShot.autoSave, 'conflict');
  assert.deepEqual(conflict.conflictResolution.actions, ['compare', 'merge-as-new-revision', 'reload-latest']);
});

test('H3 文本编辑后必须保存校验并在通过前阻止视频任务', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const dirty = model.editStoryboardH3Draft(page, '[0.0–7.0s] 林夏走向门口。');
  assert.equal(dirty.h3Draft.status, 'dirty');
  assert.equal(dirty.videoGeneration.gate.canSubmit, false);
  const saving = model.startStoryboardH3Save(dirty);
  assert.equal(saving.h3Draft.status, 'saving');
  const valid = model.completeStoryboardH3Save(saving, { valid: true });
  assert.equal(valid.h3Draft.status, 'valid');
  assert.equal(valid.videoGeneration.gate.canSubmit, true);
  const invalid = model.completeStoryboardH3Save(saving, { valid: false, errors: ['缺少人物引用'] });
  assert.equal(invalid.h3Draft.status, 'invalid');
  assert.deepEqual(invalid.h3Draft.validationErrors, ['缺少人物引用']);
  assert.equal(invalid.videoGeneration.gate.canSubmit, false);
});

test('视频失败重试创建新任务而取消保留任务记录并阻止重复付费提交', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const retried = model.retryStoryboardVideoCandidate(page, 'video-c');
  assert.equal(retried.videoGeneration.activeTask.status, 'running');
  assert.equal(retried.videoGeneration.activeTask.retryOf, 'video-c');
  assert.equal(retried.videoGeneration.gate.canSubmit, false);
  const cancelled = model.cancelStoryboardVideoGeneration(retried);
  assert.equal(cancelled.videoGeneration.activeTask.status, 'cancel-requested');
  assert.equal(cancelled.videoGeneration.activeTask.recordPreserved, true);
});

test('更新分镜结构应用差异时创建新版本并保留人工锁定和媒体历史', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const updated = model.applyStoryboardStructureUpdate(page, {
    acceptedAddedShotIds: ['shot-10'],
    acceptedChangedShotIds: ['shot-04'],
    acceptedRemovedShotIds: ['shot-09'],
  });
  assert.equal(updated.structureRevision, 19);
  assert.equal(updated.shotDetails.some(item => item.id === 'shot-10'), true);
  assert.equal(updated.shotDetails.some(item => item.id === 'shot-09'), false);
  assert.equal(updated.shotDetails.find(item => item.id === 'shot-04').structureState, 'updated');
  assert.equal(updated.structureUpdate.preservesManualLocks, true);
  assert.equal(updated.structureUpdate.preservesMediaHistory, true);
});

test('分镜图片生成先创建可恢复任务并只追加候选而不改当前图', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const submitted = model.submitStoryboardImageGeneration(page, { channel: 'chatgpt_web' });
  assert.equal(submitted.imageGeneration.activeTask.status, 'running');
  assert.equal(submitted.imageCandidates.at(-1).status, 'running');
  assert.equal(submitted.imageGeneration.currentImageCandidateId, 'image-b');
  assert.throws(() => model.submitStoryboardImageGeneration(submitted, { channel: 'api' }), /不能重复提交/);
  const completed = model.completeStoryboardImageGeneration(submitted, {
    candidateId: submitted.imageCandidates.at(-1).id,
    source: 'ChatGPT 网页',
  });
  assert.equal(completed.imageGeneration.activeTask, null);
  assert.equal(completed.imageCandidates.at(-1).status, 'ready');
  assert.equal(completed.imageGeneration.currentImageCandidateId, 'image-b');
});

test('分镜图提示词可编辑可恢复且上传直接进入候选', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  assert.ok(page.imagePrompt.text.length > 0);
  assert.equal(page.imagePrompt.manuallyEdited, false);

  const edited = model.editStoryboardImagePrompt(page, '手动描写的图片提示词');
  assert.equal(edited.imagePrompt.text, '手动描写的图片提示词');
  assert.equal(edited.imagePrompt.manuallyEdited, true);
  assert.equal(edited.imagePrompt.autoSave, 'dirty');

  const restored = model.resetStoryboardImagePrompt(edited);
  assert.equal(restored.imagePrompt.manuallyEdited, false);
  assert.equal(restored.imagePrompt.autoSave, 'saved');
  assert.ok(restored.imagePrompt.text.length > 0);

  const uploaded = model.uploadStoryboardImage(page);
  const last = uploaded.imageCandidates.at(-1);
  assert.equal(last.status, 'ready');
  assert.equal(last.isCurrent, false);
  assert.equal(uploaded.imageGeneration.currentImageCandidateId, 'image-b');

  const preview = model.getStoryboardAssetPreview(page, 1);
  assert.equal(preview.label, '林夏 · 酒店制服 v3');
  assert.equal(preview.type, 'character');
  assert.equal(preview.typeLabel, '出场角色');
  assert.equal(preview.usage, '@图片1');
  assert.throws(() => model.getStoryboardAssetPreview(page, 99), /Unknown storyboard reference/);
});

test('镜头引用管理可移除角色道具添加新引用且场景不可移除', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const manager = model.getStoryboardReferenceManager(page);
  assert.equal(manager.groups.map(item => item.id).join(','), 'characters,scene,props');
  assert.equal(manager.groups[0].items.length, 2);
  assert.equal(manager.groups[1].items.length, 1);
  assert.equal(manager.groups[1].items[0].removable, false, '本镜场景不可移除');
  assert.equal(manager.groups[0].items[0].removable, true);
  assert.ok(manager.available.characters.length > 0, '提供可添加的角色池');
  assert.ok(manager.available.props.length > 0, '提供可添加的道具池');
  assert.equal(manager.available.scenes, undefined, '场景是结构性的，没有添加入口');

  const removed = model.removeStoryboardShotReference(page, 'character-manager');
  assert.equal(removed.selectedShot.characters.some(item => item.id === 'character-manager'), false);
  assert.equal(removed.segmentEditor.referenceChips.length, 3, 'chips 即时重排（4 引用移除 1 个）');
  assert.deepEqual(removed.segmentEditor.referenceChips.map(item => item.index), [1, 2, 3]);
  assert.equal(removed.segmentEditor.referenceChips.some(item => item.label.includes('酒店经理')), false, '被移除的引用不再出现在 chips 中');
  assert.equal(removed.h3Draft.status, 'stale', '引用变化后 H3 需要重新编译');
  assert.ok(removed.imagePrompt.text.length > 0);
  assert.throws(() => model.removeStoryboardShotReference(page, 'scene-corridor'), /场景/);
  assert.throws(() => model.removeStoryboardShotReference(page, 'character-unknown'), /Unknown storyboard reference/);

  const added = model.addStoryboardShotReference(removed, 'prop-intercom');
  assert.equal(added.selectedShot.props.some(item => item.id === 'prop-intercom'), true);
  assert.equal(added.segmentEditor.referenceChips.length, 4);
  assert.equal(added.h3Draft.status, 'stale');
  assert.throws(() => model.addStoryboardShotReference(page, 'character-linxia'), /已在/);
  assert.throws(() => model.addStoryboardShotReference(page, 'character-unknown'), /Unknown project asset/);
});

test('素材预览展示固定版本库版本时段使用和可用操作', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const preview = model.getStoryboardAssetPreview(page, 1);
  assert.equal(preview.label, '林夏 · 酒店制服 v3');
  assert.equal(preview.version, 'v3', '本集固定版本');
  assert.equal(preview.latestVersion, 'v4', '素材库已有更新版本');
  assert.equal(preview.canUpdateToLatest, true);
  assert.equal(preview.type, 'character');
  assert.equal(preview.typeLabel, '出场角色');
  assert.equal(preview.usage, '@图片1');
  assert.deepEqual(preview.usedInSegments, ['0.0–2.0s', '5.0–7.0s'], '素材出现在哪些时段');
  assert.deepEqual(preview.actions.map(item => item.id), ['update-latest', 'open-library']);
  const scenePreview = model.getStoryboardAssetPreview(page, 3);
  assert.equal(scenePreview.version, 'v2');
  assert.deepEqual(scenePreview.usedInSegments, ['0.0–2.0s']);
  assert.throws(() => model.getStoryboardAssetPreview(page, 99), /Unknown storyboard reference/);
});

test('H3 视频生成支持选择候选数量并按数量乘算费用耗时', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  assert.deepEqual(model.getStoryboardVideoBatchQuote(page, 1), { count: 1, cost: '¥1.80', time: '约 5–10 分钟' });
  const quote2 = model.getStoryboardVideoBatchQuote(page, 2);
  assert.equal(quote2.count, 2);
  assert.match(quote2.cost, /¥3\.60/);
  assert.match(quote2.time, /5–10 分钟/);
  assert.throws(() => model.getStoryboardVideoBatchQuote(page, 0), /1–3/);
  assert.throws(() => model.getStoryboardVideoBatchQuote(page, 4), /1–3/);

  const submitted = model.submitStoryboardVideoGeneration(page, { count: 3 });
  assert.equal(submitted.videoGeneration.activeTasks.length, 3);
  assert.ok(submitted.videoGeneration.activeTasks.every(item => item.status === 'running'));
  assert.equal(submitted.videoGeneration.activeTask.id, submitted.videoGeneration.activeTasks[0].id, 'activeTask 保持兼容指向第一个任务');
  assert.equal(submitted.videoGeneration.gate.canSubmit, false);
  assert.throws(() => model.submitStoryboardVideoGeneration(submitted, { count: 2 }), /不能重复提交/);
  const blocked = model.getStoryboardStageModel('7', '1', 'h3-stale');
  assert.throws(() => model.submitStoryboardVideoGeneration(blocked, { count: 2 }), /检查未通过/);

  const cancelled = model.cancelStoryboardVideoGeneration(submitted);
  assert.ok(cancelled.videoGeneration.activeTasks.every(item => item.cancelState === 'requested'), '逐任务取消');
});

test('项目卡空白区域进入概览而继续按钮恢复最近制作阶段且不保留重复详情动作', () => {
  assert.ok(model, '统一原型模型不存在');
  assert.equal(typeof model.getProjectCardNavigationTarget, 'function');
  assert.deepEqual(model.getProjectCardNavigationTarget({
    projectId: 7,
    action: 'open-card',
  }), {
    routeId: 'project-overview',
    params: { projectId: '7' },
  });
  assert.deepEqual(model.getProjectCardNavigationTarget({
    projectId: 7,
    episodeId: 1,
    action: 'continue',
    continueStage: 'storyboard',
  }), {
    routeId: 'studio-storyboard',
    params: { projectId: '7', episodeId: '1' },
  });
  assert.throws(() => model.getProjectCardNavigationTarget({
    projectId: 7,
    action: 'detail',
  }), /Unknown project card action/);
});

test('项目列表默认使用卡片视图并可切换到列表视图', () => {
  assert.equal(typeof model.normalizeProjectListViewMode, 'function');
  assert.equal(model.normalizeProjectListViewMode(), 'card');
  assert.equal(model.normalizeProjectListViewMode('list'), 'list');
  assert.equal(model.normalizeProjectListViewMode('unknown'), 'card');
  const next = model.transitionPrototypeState(
    { routeId: 'projects', projectViewMode: 'card' },
    { type: 'set-project-view', viewMode: 'list' },
  );
  assert.equal(next.projectViewMode, 'list');
});

test('项目概览只聚合下一步、阶段、Project Look 和可操作阻塞', () => {
  assert.equal(typeof model.getProjectOverviewModel, 'function');
  const overview = model.getProjectOverviewModel('7', 'default');
  assert.equal(overview.projectId, '7');
  assert.equal(overview.title, '凌晨两点的客房服务');
  assert.deepEqual(Object.keys(overview.sections), [
    'resumePosition', 'primaryAction', 'stages', 'projectLook', 'blockers',
  ]);
  assert.equal(overview.sections.stages.length, 4);
  assert.ok(overview.sections.stages.every(item => item.unit === 'episode'));
  assert.ok(overview.sections.stages.every(item => item.total === 8));
  assert.equal(overview.sections.stages.some(item => /\d+\/\d+ (项|镜)/.test(item.summary)), false);
  assert.equal(overview.sections.projectLook.version, 4);
  assert.equal(overview.sections.projectLook.action.label, '更换风格');
  assert.equal(overview.sections.projectLook.action.type, 'open-modal');
  assert.equal('manageTarget' in overview.sections.projectLook.action, false);
  assert.ok(overview.sections.projectLook.visualIntent.length > 0);
  assert.ok(overview.sections.projectLook.versionHistory.length > 0);
  assert.ok(overview.sections.blockers.length > 0);
  assert.equal('recentActivity' in overview.sections, false);
});

test('项目概览精确区分恢复位置与推荐动作并可完整写入地址', () => {
  assert.equal(typeof model.getProjectResumeNavigationTarget, 'function');
  assert.equal(typeof model.getProjectOverviewPrimaryActionTarget, 'function');
  const overview = model.getProjectOverviewModel('7', 'default');
  const position = overview.sections.resumePosition;
  assert.deepEqual(position, {
    projectId: '7',
    episodeId: '1',
    stage: 'storyboard',
    sceneId: 'scene-02',
    shotId: 'shot-03',
    workspaceTab: '',
    inspectorSection: '',
    candidateId: 'video-b',
    timelineTime: '',
    updatedAt: '刚刚',
  });
  assert.equal(overview.sections.primaryAction.kind, 'resume');
  const target = model.getProjectOverviewPrimaryActionTarget({ projectId: 7 });
  assert.deepEqual(target, {
    routeId: 'studio-storyboard',
    params: {
      projectId: '7', episodeId: '1', sceneId: 'scene-02', shotId: 'shot-03',
      candidateId: 'video-b',
    },
    scenarioId: 'default',
  });
  const hash = model.formatPrototypeLocation(target.routeId, target.params, target.scenarioId);
  assert.equal(hash, '#/projects/7/episodes/1/storyboard?scene=scene-02&shot=shot-03&candidate=video-b');
  assert.deepEqual(model.parsePrototypeLocation(hash), {
    routeId: 'studio-storyboard',
    params: target.params,
    scenarioId: 'default',
  });
});

test('只有阻断当前恢复位置的问题才覆盖项目概览主动作', () => {
  const normal = model.getProjectOverviewModel('7', 'default');
  assert.equal(normal.sections.primaryAction.kind, 'resume');
  assert.ok(normal.sections.blockers.every(item => item.blocksResume === false));
  assert.match(normal.sections.blockers[0].detail, /不影响当前第 1 集/);

  const attention = model.getProjectOverviewModel('7', 'needs-attention');
  assert.equal(attention.sections.primaryAction.kind, 'resolve-blocker');
  assert.equal(attention.sections.primaryAction.blockerId, 'asset-shot-03-missing');
  assert.equal(attention.sections.blockers[0].blocksResume, true);
  assert.deepEqual(model.getProjectOverviewPrimaryActionTarget({ projectId: 7, scenarioId: 'needs-attention' }), {
    kind: 'route',
    routeId: 'studio-assets',
    params: { projectId: '7', episodeId: '1', focusId: 'asset-shot-03-required' },
    scenarioId: 'blocked',
  });
});

test('项目概览异常与终态拥有不同且可恢复的模型语义', () => {
  const scenarioIds = model.buildPrototypeRouteRegistry().find(item => item.id === 'project-overview').scenarios;
  assert.deepEqual(scenarioIds, [
    'default', 'needs-attention', 'all-complete', 'loading', 'load-failed', 'storage-offline', 'missing',
  ]);
  const offline = model.getProjectOverviewModel('7', 'storage-offline');
  assert.equal(offline.viewState.kind, 'storage-offline');
  assert.equal(offline.viewState.readOnly, true);
  assert.equal(offline.sections.primaryAction.enabled, false);
  assert.equal(offline.viewState.actions[0].id, 'reconnect-storage');
  const failed = model.getProjectOverviewModel('7', 'load-failed');
  assert.equal(failed.viewState.contentAvailable, false);
  assert.equal(failed.viewState.actions[0].id, 'retry-overview');
  const missing = model.getProjectOverviewModel('7', 'missing');
  assert.equal(missing.viewState.kind, 'missing');
  const complete = model.getProjectOverviewModel('7', 'all-complete');
  assert.equal(complete.sections.primaryAction.kind, 'open-latest-film');
  assert.ok(complete.sections.stages.every(item => item.state.includes('已完成') || item.state.includes('已确认')));
  const empty = model.getProjectOverviewModel('new-project');
  assert.equal(empty.sections.primaryAction.kind, 'create-first-episode');
  assert.equal(empty.sections.resumePosition, null);
  assert.deepEqual(model.getProjectOverviewPrimaryActionTarget({ projectId: 'new-project' }), {
    routeId: 'project-episodes', params: { projectId: 'new-project' }, scenarioId: 'source-picker',
  });
  const firstEpisode = model.getProjectEpisodesModel('new-project', 'source-picker');
  assert.equal(firstEpisode.stats.total, 0);
  assert.deepEqual(firstEpisode.rows, []);
});

test('项目概览首屏并列下一步与待处理且项目操作首层使用轻量菜单', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /返回项目列表/);
  assert.match(html, /项目阶段概览/);
  assert.match(html, /data-overview-primary/);
  assert.match(html, /function openProjectMenuPopover/);
  assert.doesNotMatch(html, /function openProjectMenuDrawer/);
  assert.deepEqual(model.getProjectOperationsModel('7').actions.map(item => item.label), [
    '导出项目备份', '从备份恢复', '移入回收站',
  ]);
});

test('项目阶段汇总进入剧集页且不绑定任意剧集', () => {
  assert.equal(typeof model.getProjectStageNavigationTarget, 'function');
  const target = model.getProjectStageNavigationTarget({ projectId: 7, stage: 'storyboard' });
  assert.deepEqual(target, {
    routeId: 'project-episodes',
    params: { projectId: '7' },
    scenarioId: 'default',
  });
  assert.equal('episodeId' in target.params, false);
  assert.throws(
    () => model.getProjectStageNavigationTarget({ projectId: 7, stage: 'unknown' }),
    /Unknown project stage/,
  );
});

test('资产待处理项使用自己的剧集和对象定位而不是最近工作位置', () => {
  assert.equal(typeof model.getProjectOverviewBlockerTarget, 'function');
  const target = model.getProjectOverviewBlockerTarget({
    projectId: 7,
    blockerId: 'asset-scene-208-pending',
  });
  assert.deepEqual(target, {
    kind: 'route',
    routeId: 'studio-assets',
    params: {
      projectId: '7',
      episodeId: '2',
      focusId: 'scene-asset-room-208-corridor',
    },
    scenarioId: 'blocked',
  });
  const hash = model.formatPrototypeLocation(target.routeId, target.params, target.scenarioId);
  assert.equal(hash, '#/projects/7/episodes/2/assets?scenario=blocked&focus=scene-asset-room-208-corridor');
  assert.deepEqual(model.parsePrototypeLocation(hash), {
    routeId: 'studio-assets',
    params: {
      projectId: '7',
      episodeId: '2',
      focusId: 'scene-asset-room-208-corridor',
    },
    scenarioId: 'blocked',
  });
});

test('任务待处理项打开任务中心并定位自己的任务', () => {
  assert.deepEqual(model.getProjectOverviewBlockerTarget({
    projectId: 7,
    blockerId: 'task-shot-05-auth-expired',
  }), {
    kind: 'route',
    routeId: 'tasks',
    params: { projectId: '7', focusId: 'task-shot-05-video' },
    scenarioId: 'project-filtered',
  });
  assert.throws(
    () => model.getProjectOverviewBlockerTarget({ projectId: 7, blockerId: 'unknown' }),
    /Unknown project blocker/,
  );
});

test('项目设置路由只作为兼容别名重定向到项目概览', () => {
  assert.equal(typeof model.getProjectBibleModel, 'function');
  const bible = model.getProjectBibleModel('7', 'default');
  assert.deepEqual(bible.redirectTo, {
    routeId: 'project-overview',
    params: { projectId: '7' },
    scenarioId: 'default',
  });
  assert.equal(bible.legacyRoute, true);
  assert.equal('projectProfile' in bible, false);
  assert.equal('productionObjects' in bible, false);
  assert.equal('externalAiCollaboration' in bible, false);
});

test('项目概览承载项目资料和风格选择，不再渲染项目设置工作台', () => {
  const overview = model.getProjectOverviewModel('7');
  assert.deepEqual(overview.projectProfile.editableFields.map(field => field.id), [
    'name', 'cover', 'aspect-ratio', 'genre', 'description',
  ]);
  assert.equal('default-episode-duration' in overview.projectProfile, false);
  assert.equal('outputPreference' in overview.projectProfile, false);
  assert.equal(overview.projectStyleSelector.presentation, 'modal');
  assert.deepEqual(overview.projectStyleSelector.tabs.map(tab => tab.id), ['presets', 'mine', 'custom']);
  assert.equal(overview.projectStyleSelector.applyRule, '更换项目风格只影响之后的新生成和主动刷新，不自动重做已有图片或视频。');
  assert.equal(overview.assetSummary.line, '项目素材：16 个对象，2 个缺少可用形象');
  assert.equal(overview.assetSummary.target.routeId, 'project-assets');
  assert.equal(overview.externalAiPendingTask, null);
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /项目资料、画面风格与外部 AI/);
  assert.doesNotMatch(html, /默认单集时长/);
  assert.doesNotMatch(html, /输出偏好/);
  assert.doesNotMatch(html, /生产对象概览/);
  assert.match(html, /更换项目风格只影响之后的新生成和主动刷新/);
});

test('项目画面风格以中央弹窗完成选择并保留影响确认', () => {
  assert.equal(typeof model.getProjectLookEditorModel, 'function');
  const editor = model.getProjectLookEditorModel('7', { query: '悬疑', selectedPresetId: 'cinematic-suspense' });
  assert.equal(editor.presentation, 'modal');
  assert.equal(editor.searchEnabled, true);
  assert.deepEqual(editor.tabs.map(item => item.id), ['presets', 'mine', 'custom']);
  assert.deepEqual(editor.visiblePresets.map(item => item.id), ['cinematic-suspense']);
  assert.equal(editor.selectedPreset.name, '电影感悬疑');
  assert.deepEqual(editor.customFields.map(item => item.id), [
    'style-name', 'style-description', 'positive-visual-prompt', 'negative-constraints', 'reference-images',
  ]);
  assert.deepEqual(editor.impactPreview, {
    referencedResults: 10,
    needsUpdate: 6,
    unaffectedHistory: 4,
    autoRegenerate: false,
  });
  assert.equal(editor.confirmAction.label, '确认应用');
});

test('外部 AI 上下文由系统自动汇总，不再提供常驻编辑入口', () => {
  const context = model.getExternalAiContextModel('7');
  assert.equal(context.autoCompiled, true);
  assert.ok(context.includedSources.includes('当前画面风格'));
  assert.ok(context.includedSources.includes('已确认的上一集剧本'));
  assert.match(context.note, /自动汇总/);
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /编辑项目说明/);
  assert.doesNotMatch(html, /复制创作上下文</);
});

test('项目设置编辑器恢复草稿时同步恢复未保存提示与保存能力', () => {
  assert.equal(typeof model.getProjectSettingsEditorUiState, 'function');
  assert.deepEqual(model.getProjectSettingsEditorUiState(), {
    dirty: false,
    label: '尚未修改',
    saveEnabled: false,
    controlsDisabled: false,
  });
  assert.deepEqual(model.getProjectSettingsEditorUiState({ hasDraft: true }), {
    dirty: true,
    label: '有未保存修改',
    saveEnabled: true,
    controlsDisabled: false,
  });
  assert.deepEqual(model.getProjectSettingsEditorUiState({ hasDraft: true, status: 'saving' }), {
    dirty: true,
    label: '正在保存…',
    saveEnabled: false,
    controlsDisabled: true,
  });
});

test('项目资产按生产对象组织并区分版本、候选、任务和使用状态', () => {
  assert.equal(typeof model.getProjectAssetsModel, 'function');
  const assets = model.getProjectAssetsModel('7', 'default');
  assert.deepEqual(assets.tabs.map(item => item.id), ['all', 'characters', 'scenes', 'props']);
  assert.deepEqual(assets.stats.map(item => item.id), ['characters', 'scenes', 'props', 'needs-attention']);
  assert.equal(assets.items.some(item => item.type === 'sounds'), false);
  assert.ok(assets.items.length >= 4);
  const character = assets.items.find(item => item.id === 'character-linxia');
  assert.equal('dataRevision' in character, false);
  assert.equal('taskStatus' in character, false);
  assert.equal('usage' in character, false);
  assert.equal('episodes' in character, false);
  assert.equal('totalStates' in character, false);
  assert.deepEqual(character.statePreviews.map(item => item.name), ['日常', '制服', '雨夜']);
  assert.equal(character.warning, '');
  assert.ok(assets.items.every(item => item.issue === false || typeof item.warning === 'string'));
});

test('项目设定进入项目资产时按 focus 恢复对象筛选', () => {
  const assets = model.getProjectAssetsModel('7', 'default', 'characters');
  assert.equal(assets.activeTab, 'characters');
  assert.ok(assets.items.length > 0);
  assert.ok(assets.items.every(item => item.type === 'characters'));
});

test('人物资产详情直接展示全部人物状态及各自候选', () => {
  assert.equal(typeof model.getProjectAssetDetailModel, 'function');
  const detail = model.getProjectAssetDetailModel('character-linxia');
  assert.deepEqual(detail.sections, ['概览', '版本与候选', '使用位置', '生成记录', '高级']);
  assert.deepEqual(detail.characterStates.map(item => item.name), ['日常造型', '酒店制服', '雨夜湿衣', '受伤状态']);
  assert.equal(detail.characterStates.find(item => item.isDefault).id, 'state-daily');
  assert.ok(detail.characterStates.every(item => item.candidates.length >= 1));
  assert.equal(detail.candidateActionLabel, '使用此图');
  assert.equal(detail.stageConfirmation.label, '进入分镜');
  assert.equal(detail.stageConfirmation.mode, 'automatic-on-navigation');
  assert.ok(detail.usageTargets.every(item => item.params.episodeId));
});

test('人物音色属于人物详情并提供来源、候选、试听与条件 Gate', () => {
  const detail = model.getProjectAssetDetailModel('character-linxia');
  assert.equal(detail.voiceProfile.ownerKind, 'character');
  assert.equal(detail.voiceProfile.currentCandidateId, 'voice-linxia-upload-v1');
  assert.deepEqual(detail.voiceProfile.sources.map(item => item.id), [
    'upload', 'tts-preset', 'personal-library', 'extract', 'smart-design',
  ]);
  assert.equal(detail.voiceProfile.sources.find(item => item.id === 'smart-design').availability, 'future');
  assert.equal(detail.voiceProfile.gatePolicy.mode, 'conditional');
  assert.equal(detail.voiceProfile.gatePolicy.blocksWhen, 'selected-audio-strategy-requires-missing-character-voice');
  assert.ok(detail.voiceProfile.candidates.every(item => item.durationSeconds > 0));
});

test('人物详情保留现有单图与三四视图生图模式并允许逐状态选择', () => {
  const detail = model.getProjectAssetDetailModel('character-linxia');
  assert.deepEqual(detail.generationModes.map(item => item.id), ['single', 'turnaround']);
  assert.deepEqual(detail.generationModes.map(item => item.label), ['单图', '三/四视图']);
  assert.equal(detail.characterStates.find(item => item.id === 'state-daily').generationModeId, 'turnaround');
  assert.equal(detail.characterStates.find(item => item.id === 'state-hotel').generationModeId, 'single');

  const next = model.setProjectAssetCharacterGenerationMode(detail, 'state-hotel', 'turnaround');
  assert.equal(next.activeStateId, 'state-hotel');
  assert.equal(next.characterStates.find(item => item.id === 'state-hotel').generationModeId, 'turnaround');
  assert.equal(detail.characterStates.find(item => item.id === 'state-hotel').generationModeId, 'single');
  assert.throws(
    () => model.setProjectAssetCharacterGenerationMode(detail, 'state-hotel', 'panorama'),
    /Unknown character generation mode/,
  );
});

test('人物生图和上传只向当前人物状态追加候选且不自动使用', () => {
  const detail = model.getProjectAssetDetailModel('character-linxia');
  const before = detail.characterStates.find(item => item.id === 'state-rain').currentCandidateId;
  const generated = model.addProjectAssetCharacterCandidate(detail, 'state-rain', {
    id: 'candidate-rain-c',
    label: '候选 C',
    meta: 'API · 单图 · 排队中',
    tone: 'amber',
  });
  const rain = generated.characterStates.find(item => item.id === 'state-rain');
  assert.equal(rain.currentCandidateId, before);
  assert.equal(rain.candidates.at(-1).id, 'candidate-rain-c');
  assert.equal(rain.candidates.at(-1).isCurrent, false);
  assert.equal(generated.generationRecords[0].kind, '人物形象');
  assert.throws(
    () => model.addProjectAssetCharacterCandidate(detail, 'missing', { id: 'candidate-x' }),
    /Unknown character state/,
  );
});

test('所有人物卡均打开具体详情且缺少音色人物提供恢复动作', () => {
  const manager = model.getProjectAssetDetailModel('character-manager');
  assert.equal(manager.assetKind, 'character');
  assert.equal(manager.title, '酒店经理');
  assert.equal(manager.voiceProfile.currentCandidateId, null);
  assert.equal(manager.voiceProfile.candidates.length, 0);
  assert.equal(manager.primaryIssue.action, '配置人物音色');
  assert.ok(manager.characterStates.every(item => item.candidates.length >= 1));
});

test('项目资产模型提供真实筛选排序、新建、资产库和批量操作合同', () => {
  const assets = model.getProjectAssetsModel('7');
  assert.deepEqual(assets.sortOptions.map(item => item.id), ['updated-desc', 'name-asc', 'usage-desc', 'issues-first']);
  assert.deepEqual(assets.filterGroups.map(item => item.id), ['status', 'usage', 'source', 'media', 'episode']);
  assert.equal(assets.statFilters['character-states'], undefined);
  assert.deepEqual(assets.statFilters['needs-attention'], { issue: 'true' });
  assert.deepEqual(assets.primaryFilterGroups.map(item => item.id), ['status']);
  assert.deepEqual(assets.advancedFilterGroups.map(item => item.id), ['usage', 'source', 'media', 'episode']);
  assert.deepEqual(assets.createTypes.map(item => item.id), ['character', 'scene', 'prop']);
  assert.equal(assets.createTypes.find(item => item.id === 'character').fields.includes('voice'), false);
  assert.ok(assets.libraryItems.length >= 3);
  assert.deepEqual(assets.batchActions.map(item => item.id), ['generate-missing', 'set-mode', 'tags']);
  assert.equal(JSON.stringify(assets.batchActions).includes('归档'), false);
  assert.equal(JSON.stringify(assets.filterGroups).includes('已归档'), false);
  assert.equal(model.getProjectAssetBatchPreview(assets.items, ['character-linxia'], 'generate-missing').autoUseCandidate, false);
});

test('项目素材卡只显示创作必要信息，本集设定只列当前剧本引用对象', () => {
  const assets = model.getProjectAssetsModel('7');
  const linxia = assets.items.find(item => item.id === 'character-linxia');
  assert.equal('taskStatus' in linxia, false);
  assert.equal('usage' in linxia, false);
  assert.equal(linxia.warning, '');

  const setting = model.getEpisodeAssetsStageModel('7', '1');
  assert.equal(setting.featureName, '本集设定');
  assert.deepEqual(setting.tabs.map(tab => tab.label), ['角色', '场景', '道具']);
  assert.ok(setting.cards.every(card => card.referencedByEpisode === true));
  assert.ok(setting.cards.every(card => card.assetId && card.stateId && card.mediaVersionId));
  const offline = model.getEpisodeAssetsStageModel('7', '1', 'media-offline');
  assert.equal(offline.cards.find(card => card.id === 'corridor-night').issue, true);

  const drawer = model.getAssetDetailDrawerModel('character-linxia', { projectId: '7', episodeId: '1' });
  assert.deepEqual(drawer.sections.map(section => section.id), [
    'summary', 'states', 'current-and-candidates', 'description', 'generation', 'episode-use',
  ]);
  assert.equal(drawer.presentation, 'drawer');
  assert.equal(drawer.voiceSection.onlyForCharacters, true);
  assert.equal(drawer.technicalDetails.collapsed, true);
  assert.equal(drawer.deletion.archiveExposed, false);
  const sceneDrawer = model.getAssetDetailDrawerModel('scene-corridor', { projectId: '7' });
  assert.equal(sceneDrawer.voiceSection, null);
  assert.equal(sceneDrawer.sections.some(section => section.id === 'episode-use'), false);
});

test('项目资产筛选支持组合条件、搜索、问题优先和精确统计入口', () => {
  const assets = model.getProjectAssetsModel('7');
  assert.equal(assets.items.every(item => item.issue === false), true);
  const offline = model.getProjectAssetsModel('7', 'media-offline');
  const attention = model.filterAndSortProjectAssets(offline.items, {
    filters: { issue: 'true' },
    sortId: 'issues-first',
  });
  assert.deepEqual(attention.map(item => item.id), ['scene-corridor']);
  assert.throws(() => model.getProjectAssetStatSelection('character-states'), /Unknown asset stat/);
  assert.throws(() => model.getProjectAssetStatSelection('unknown'), /Unknown asset stat/);
});

test('项目素材默认界面收敛但保留高级筛选与双视图能力', () => {
  const assets = model.getProjectAssetsModel('7');
  assert.equal(assets.defaultViewMode, 'card');
  assert.equal(assets.viewModes.some(item => item.id === 'list'), true);
  assert.equal(assets.defaultToolbar.includes('batch'), false);
  assert.equal(assets.advancedFilterGroups.some(item => item.id === 'source'), true);
  assert.match(assets.projectDefaultImpactNotice, /已确认的剧集不会被自动替换/);
});

test('资产资料修订、媒体候选和当前图指针使用独立语义', () => {
  const detail = model.getProjectAssetDetailModel('character-linxia');
  assert.deepEqual(detail.mediaSemantics, {
    dataRevisionLabel: '资料修订',
    mediaCandidateLabel: '候选图',
    currentPointerLabel: '当前图',
  });
  const next = model.useProjectAssetCandidate(detail, 'state-hotel', 'candidate-hotel-b');
  assert.equal(next.dataRevision, detail.dataRevision);
  assert.equal(next.lastMediaSelection.previousCandidateId, 'candidate-hotel-a');
  assert.equal(next.lastMediaSelection.currentCandidateId, 'candidate-hotel-b');
  assert.match(next.lastMediaSelection.impact, /未来选择/);
  const undone = model.undoProjectAssetMediaSelection(next);
  assert.equal(undone.characterStates.find(item => item.id === 'state-hotel').currentCandidateId, 'candidate-hotel-a');
});

test('所有项目素材生图通道共享同一生成前检查合同并先创建可恢复任务', () => {
  const detail = model.getProjectAssetDetailModel('scene-lobby');
  const envelopes = ['API', 'ChatGPT 网页', 'ComfyUI'].map(channel => model.getProjectAssetGenerationEnvelope(detail, {
    stateId: 'lobby-state-day', viewId: 'lobby-view-wide', modeId: 'single', channel,
  }));
  for (const envelope of envelopes) {
    assert.equal(envelope.objectLabel, '酒店大堂 / 白天营业 / 大堂全景');
    assert.equal(envelope.projectStyle, '都市悬疑 · 冷暖对撞 v4');
    assert.equal(envelope.taskCount, 1);
    assert.equal(envelope.resultPolicy, '只新增候选，不自动设为当前图');
    assert.ok(envelope.promptPreview.length > 10);
    assert.ok(envelope.capabilityCheck.items.length >= 3);
  }
  assert.equal(envelopes.find(item => item.channel === 'ChatGPT 网页').environmentCheck.cost, '¥0');
  const beforeCandidates = detail.productionStates[0].views[0].candidates.length;
  const queued = model.submitProjectAssetGeneration(detail, envelopes[0], 'job-queued-01');
  assert.equal(queued.generationRecords[0].status, '排队中');
  assert.equal(queued.productionStates[0].views[0].candidates.length, beforeCandidates);
  const completed = model.completeProjectAssetGeneration(queued, 'job-queued-01', {
    id: 'lobby-day-wide-c', label: '候选 C', meta: 'API · 单图', tone: 'blue',
  });
  assert.equal(completed.generationRecords[0].status, '已完成');
  assert.equal(completed.productionStates[0].views[0].currentCandidateId, 'lobby-day-wide-a');
  assert.equal(completed.productionStates[0].views[0].candidates.at(-1).id, 'lobby-day-wide-c');
});

test('批量操作只计算用户明确选择的对象并支持部分成功', () => {
  const assets = model.getProjectAssetsModel('7');
  const preview = model.getProjectAssetBatchPreview(assets.items, ['character-linxia', 'scene-corridor', 'prop-keycard'], 'generate-missing');
  assert.equal(preview.selected, 3);
  assert.deepEqual(preview.selectedIds, ['character-linxia', 'scene-corridor', 'prop-keycard']);
  assert.equal(preview.eligible + preview.skipped + preview.blocked, 3);
  assert.equal(preview.autoUseCandidate, false);
  const offline = model.getProjectAssetsModel('7', 'media-offline');
  const offlinePreview = model.getProjectAssetBatchPreview(offline.items, ['scene-corridor', 'prop-keycard'], 'generate-missing');
  assert.equal(offlinePreview.blocked, 1);
  assert.equal(offlinePreview.partialSuccess, true);
});

test('场景空间模式保留为按需高级能力并声明真实下游用途', () => {
  const detail = model.getProjectAssetDetailModel('scene-lobby');
  for (const modeId of ['top-down', 'panorama']) {
    const mode = detail.generationModes.find(item => item.id === modeId);
    assert.equal(mode.presentation, 'advanced');
    assert.ok(mode.downstreamConsumers.includes('分镜参考绑定'));
    assert.ok(mode.downstreamConsumers.includes('H3 引用编译'));
  }
});

test('项目素材原型默认隐藏企业级控件并提供明确多选与统一生成检查', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /data-asset-more-filters/);
  assert.match(html, /data-asset-select-mode/);
  assert.match(html, /data-asset-select/);
  assert.match(html, /data-generation-envelope-confirm/);
  assert.match(html, />创建资产</);
  assert.doesNotMatch(html, />打开详情</);
  assert.doesNotMatch(html, /V2\.1 新增预设/);
});

test('统一原型显式呈现人物生图、候选、筛选、新建、资产库和批量交互入口', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const hook of [
    'data-character-generation-mode', 'data-character-image-generate', 'data-character-image-upload',
    'data-candidate-compare', 'data-asset-filter-group', 'data-asset-sort', 'data-filter-clear',
    'data-new-asset-next', 'data-library-asset', 'data-batch-action', 'data-asset-more',
  ]) assert.match(html, new RegExp(hook));
});

test('点击音色候选只更新人物当前音色并保留历史候选', () => {
  const detail = model.getProjectAssetDetailModel('character-linxia');
  const beforeImageCandidate = detail.characterStates[0].currentCandidateId;
  const next = model.useProjectAssetVoiceCandidate(detail, 'voice-linxia-preset-v2');
  assert.equal(next.voiceProfile.currentCandidateId, 'voice-linxia-preset-v2');
  assert.equal(next.voiceProfile.candidates.find(item => item.id === 'voice-linxia-preset-v2').isCurrent, true);
  assert.equal(next.voiceProfile.candidates.find(item => item.id === 'voice-linxia-upload-v1').isCurrent, false);
  assert.equal(next.characterStates[0].currentCandidateId, beforeImageCandidate);
  assert.throws(() => model.useProjectAssetVoiceCandidate(detail, 'missing'), /Unknown voice candidate/);
});

test('点击人物状态候选立即保存为当前使用图并保留候选历史', () => {
  assert.equal(typeof model.useProjectAssetCandidate, 'function');
  const detail = model.getProjectAssetDetailModel('character-linxia');
  const next = model.useProjectAssetCandidate(detail, 'state-hotel', 'candidate-hotel-b');
  const hotel = next.characterStates.find(item => item.id === 'state-hotel');
  assert.equal(next.activeStateId, 'state-hotel');
  assert.equal(hotel.currentCandidateId, 'candidate-hotel-b');
  assert.equal(hotel.candidates.find(item => item.id === 'candidate-hotel-b').isCurrent, true);
  assert.equal(hotel.candidates.find(item => item.id === 'candidate-hotel-a').isCurrent, false);
  assert.equal(hotel.candidates.length, 2);
});

test('场景详情把剧情状态与观察视图分层并继承旧版生产能力', () => {
  const detail = model.getProjectAssetDetailModel('scene-corridor');
  assert.equal(detail.assetKind, 'scene');
  assert.equal(detail.fields.location, '208 客房走廊');
  assert.deepEqual(detail.productionStates.map(item => item.name), ['常规夜景', '雨夜', '停电应急']);
  assert.ok(detail.productionStates.every(item => item.views.length >= 2));
  assert.ok(detail.productionStates.every(item => item.views.every(view => view.candidates.length >= 1)));
  assert.deepEqual(detail.capabilities, ['参考图', '从图提取描述', '提示词', '负向提示词', '单图', '四视图', '生成与上传', '资产库', '影响分镜']);
  assert.equal(detail.candidateActionLabel, '使用此图');
});

test('场景候选只更新目标剧情状态的目标观察视图', () => {
  assert.equal(typeof model.useProjectAssetViewCandidate, 'function');
  const detail = model.getProjectAssetDetailModel('scene-corridor');
  const beforeOtherView = detail.productionStates[0].views[1].currentCandidateId;
  const beforeOtherState = detail.productionStates[1].views[0].currentCandidateId;
  const next = model.useProjectAssetViewCandidate(detail, 'scene-state-night', 'scene-view-wide', 'scene-night-wide-b');
  const targetState = next.productionStates.find(item => item.id === 'scene-state-night');
  const targetView = targetState.views.find(item => item.id === 'scene-view-wide');
  assert.equal(next.activeStateId, 'scene-state-night');
  assert.equal(next.activeViewId, 'scene-view-wide');
  assert.equal(targetView.currentCandidateId, 'scene-night-wide-b');
  assert.equal(targetView.candidates.find(item => item.id === 'scene-night-wide-b').isCurrent, true);
  assert.equal(targetState.views[1].currentCandidateId, beforeOtherView);
  assert.equal(next.productionStates[1].views[0].currentCandidateId, beforeOtherState);
});

test('场景生成预设明确区分单图、四宫格、独立俯视图和全景图', () => {
  const detail = model.getProjectAssetDetailModel('scene-lobby');
  assert.deepEqual(detail.generationModes.map(item => item.id), [
    'single', 'quad-grid', 'top-down', 'panorama',
  ]);
  assert.equal(detail.generationModes.find(item => item.id === 'quad-grid').outputs.length, 4);
  assert.equal(detail.generationModes.find(item => item.id === 'top-down').implementation, 'new-v2.1');
  assert.equal(detail.generationModes.find(item => item.id === 'panorama').implementation, 'new-v2.1');

  const next = model.setProjectAssetGenerationMode(detail, 'top-down');
  assert.equal(next.activeGenerationModeId, 'top-down');
  assert.equal(detail.activeGenerationModeId, 'single');
  assert.throws(() => model.setProjectAssetGenerationMode(detail, 'unknown'), /Unknown asset generation mode/);
});

test('场景详情标签切换、资料保存和参考图管理均保留为可恢复的原型状态', () => {
  const detail = model.getProjectAssetDetailModel('scene-lobby');
  const section = model.setProjectAssetDetailSection(detail, 'candidates');
  assert.equal(section.activeSectionId, 'candidates');
  assert.equal(detail.activeSectionId, 'overview');

  const edited = model.saveProjectAssetFields(detail, {
    location: '酒店主大堂',
    atmosphere: '暖色石材、玻璃反射、前台区域保持通透',
  });
  assert.equal(edited.fields.location, '酒店主大堂');
  assert.equal(edited.fields.atmosphere, '暖色石材、玻璃反射、前台区域保持通透');
  assert.equal(detail.fields.location, '酒店大堂');

  const added = model.addProjectAssetReference(detail, {
    id: 'reference-lighting',
    name: '前台暖光参考',
    role: '光线',
    source: '本地上传',
    tone: 'amber',
  });
  assert.equal(added.referenceImages.at(-1).role, '光线');
  assert.equal(detail.referenceImages.some(item => item.id === 'reference-lighting'), false);
  const removed = model.removeProjectAssetReference(added, 'reference-lighting');
  assert.equal(removed.referenceImages.some(item => item.id === 'reference-lighting'), false);
});

test('新增视图参考只影响选定剧情状态且允许暂时没有候选图', () => {
  const detail = model.getProjectAssetDetailModel('scene-lobby');
  const beforeNightViews = detail.productionStates[1].views.length;
  const next = model.addProjectAssetViewReference(detail, 'lobby-state-day', {
    id: 'lobby-view-entrance',
    name: '入口方向',
    purpose: '进场动线',
  });
  const addedView = next.productionStates[0].views.find(item => item.id === 'lobby-view-entrance');
  assert.equal(addedView.name, '入口方向');
  assert.deepEqual(addedView.candidates, []);
  assert.equal(next.activeViewId, 'lobby-view-entrance');
  assert.equal(next.productionStates[1].views.length, beforeNightViews);
});

test('道具详情以剧情状态组织候选并保留与分镜的使用关系', () => {
  const detail = model.getProjectAssetDetailModel('prop-keycard');
  assert.equal(detail.assetKind, 'prop');
  assert.equal(detail.fields.name, '13 层门卡');
  assert.deepEqual(detail.productionStates.map(item => item.name), ['完整', '刷卡中', '损坏']);
  assert.ok(detail.productionStates.every(item => item.views.length >= 1));
  assert.deepEqual(detail.capabilities, ['参考图', '从图提取描述', '提示词', '负向提示词', '单图', '四视图', '生成与上传', '资产库', '关联分镜']);
  assert.ok(detail.usageTargets.every(item => item.params.focusId));
  assert.equal(detail.candidateActionLabel, '使用此图');
  assert.deepEqual(detail.generationModes.map(item => item.id), ['single', 'quad-grid']);

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /detail\.assetKind === 'scene' \? '四宫格' : '四视图'/);
});

test('项目中的两张场景卡都打开具体场景详情而不是通用占位', () => {
  const corridor = model.getProjectAssetDetailModel('scene-corridor');
  const lobby = model.getProjectAssetDetailModel('scene-lobby');
  assert.equal(corridor.assetKind, 'scene');
  assert.equal(lobby.assetKind, 'scene');
  assert.notEqual(corridor.fields.location, lobby.fields.location);
  assert.ok(lobby.productionStates.length >= 2);
});

test('项目资产库添加明确区分固定引用和项目副本', () => {
  const assets = model.getProjectAssetsModel('7', 'library-update');
  assert.deepEqual(assets.libraryActions, [
    { id: 'reference', label: '引用固定版本', followsUpdates: false },
    { id: 'copy', label: '复制到项目', followsUpdates: false },
  ]);
  assert.equal(assets.items.find(item => item.id === 'scene-corridor').libraryUpdate, '资产库有 v3 可用');
});

test('项目资产原型覆盖高风险异常和恢复场景', () => {
  const definition = model.buildPrototypeRouteRegistry().find(item => item.id === 'project-assets');
  for (const scenario of ['empty', 'candidate-compare', 'media-offline', 'generation-failed', 'version-conflict', 'delete-blocked', 'batch-generate', 'library-update', 'publish-blocked']) {
    assert.ok(definition.scenarios.includes(scenario), `缺少项目资产场景 ${scenario}`);
  }
  for (const scenario of ['loading', 'load-failed', 'detail-load-failed', 'damaged-candidate', 'unsupported-mode', 'reference-limit', 'upload-invalid', 'batch-partial', 'adoption-failed', 'read-only', 'low-disk']) {
    assert.ok(definition.scenarios.includes(scenario), `缺少项目素材恢复场景 ${scenario}`);
  }
  const empty = model.getProjectAssetsModel('7', 'empty');
  assert.ok(empty.stats.every(item => item.value === 0), '空项目不应保留示例资产统计');
  const blocked = model.getProjectAssetsModel('7', 'delete-blocked');
  assert.equal(blocked.blockedAction.reason, '存在 3 集和 8 个分镜引用');
  assert.equal(blocked.blockedAction.recoveryTarget, 'usage-locations');
});

test('项目画面风格从概览直接打开中央选择弹窗', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /data-project-look=/);
  assert.match(html, /openLookStyleModal/);
  assert.doesNotMatch(html, /data-manage-project-look=/);
  assert.doesNotMatch(html, /data-project-stage="assets"/);
  assert.doesNotMatch(html, />查看设定</);
  const projectBible = model.buildPrototypeRouteRegistry().find(item => item.id === 'project-bible');
  assert.deepEqual(projectBible.scenarios, ['default']);
});

test('每张项目卡的继续动作指向其真实最近剧集', () => {
  const projects = hubModel.buildProjectCards();
  assert.equal(projects.find(item => item.id === 7).continueEpisodeId, 1);
  assert.equal(projects.find(item => item.id === 9).continueEpisodeId, 4);
});

test('统一 HTML 加载三个模型并只提供一个页面根节点', () => {
  assert.ok(fs.existsSync(htmlPath), 'production-studio-v2.1-full-prototype.html 不存在');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /production-studio-v2\.1-project-hub-prototype-model\.js/);
  assert.match(html, /production-studio-v2\.1-prototype-model\.js/);
  assert.match(html, /production-studio-v2\.1-full-prototype-model\.js/);
  assert.equal((html.match(/id="prototypePage"/g) || []).length, 1);
});

test('统一壳区分产品导航与原型评审工具', () => {
  assert.ok(fs.existsSync(htmlPath), '统一 HTML 不存在');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const rail = html.match(/<nav class="rail"[\s\S]*?<\/nav>/)?.[0] || '';
  for (const label of ['项目', '资产库', '任务', '设置']) {
    assert.match(rail, new RegExp(label));
  }
  for (const label of ['快速创作', '高级画布']) {
    assert.doesNotMatch(rail, new RegExp(label));
  }
  const auxiliary = model.getAuxiliaryToolEntries({ projectId: '7', episodeId: '1' });
  assert.equal(auxiliary.moreTools[0].label, '自由创作');
  assert.equal(auxiliary.stageAdvanced[0].label, '高级画布');
  assert.match(html, /id="moreToolsButton"/);
  assert.match(html, /data-story-command="advanced-canvas"/);
  assert.match(html, /功能覆盖/);
  assert.match(html, /场景切换/);
  assert.match(html, /id="coverageButton"/);
  assert.match(html, /id="scenarioButton"/);
  assert.match(html, /prototype-tool/);
});

test('分镜页呈现 RunningHub 式五区布局且技术概念不再出现在页面上', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const render = html.match(/function renderStoryboardStage[\s\S]*?\r?\n    \}\r?\n/)?.[0] || '';
  assert.ok(render, '未找到分镜页渲染函数');
  assert.match(render, /data-story-shot-prev/);
  assert.match(render, /data-story-shot-next/);
  assert.match(render, /<h3>分镜图<\/h3>/);
  assert.match(render, /data-story-image-candidate=/);
  assert.match(render, /data-story-command="upload-image"/);
  assert.match(render, /data-asset-preview="/);
  assert.match(render, /分镜图提示词/);
  assert.match(render, /data-story-image-prompt/);
  assert.match(render, /data-story-command="generate-h3"/);
  assert.match(render, /用 H3 生成视频/);
  assert.match(render, /data-story-command="video-history"/);
  assert.match(render, /story-candidate-film/);
  assert.match(render, /shot-rail/);
  assert.doesNotMatch(render, /站位图|动作预演|辅助视图/);
  assert.doesNotMatch(render, /预计排队|预计生成处理|预计总耗时/);
  assert.doesNotMatch(render, /Reference Manifest|AV contract|fingerprint|Recipe/);
  assert.doesNotMatch(render, /data-story-left-section|data-story-inspector-tab|data-story-visual-mode|data-story-media-mode/);
});

test('统一原型明确呈现分镜结构更新、H3 草稿和视频耗时交互', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /data-story-command="reextract">更新分镜结构/);
  assert.match(html, /data-story-command="import">\$\{model\.storyboardImport\.label\}/);
  assert.match(html, /H3 提示词草稿/);
  assert.match(html, /data-story-command="generate-h3"/);
  assert.match(html, /输出时长/);
  assert.match(html, /预计耗时/);
  assert.match(html, /data-story-reextract-preview/);
  assert.match(html, /data-story-import-preview/);
});

test('任务中心和高级画布原型展示真实恢复交互而不是统一 Toast', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /data-task-tab/);
  assert.match(html, /data-task-drawer-primary/);
  assert.match(html, /data-task-query/);
  assert.match(html, /data-canvas-node/);
  assert.match(html, /data-canvas-impact/);
  assert.match(html, /data-canvas-batch/);
  assert.match(html, /canvas-arrow/);
  assert.match(html, /save-processing/);
});

test('功能覆盖抽屉由完整功能覆盖模型驱动，而不是维护第二份硬编码清单', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /当前只将项目列表计入已确认页面/);
  assert.match(html, /buildFeatureCoverageIndex\(\)/);
  assert.match(html, /data-feature-id="\$\{item\.featureId\}"/);
  assert.match(html, /data-coverage-route/);
});

test('个人版默认导航只保留项目资产库任务设置并把辅助工具下沉', () => {
  assert.deepEqual(model.getProductNavigationModel().map(item => item.id), [
    'projects', 'library', 'tasks', 'settings',
  ]);
  assert.deepEqual(model.getProjectSectionNavigation('7').map(item => item.label), [
    '概览', '剧集', '项目素材',
  ]);
  assert.deepEqual(model.getEpisodeStageNavigation('7', '1').map(item => item.label), [
    '剧本', '设定', '分镜', '短片',
  ]);
  const auxiliary = model.getAuxiliaryToolEntries({ projectId: '7', episodeId: '1' });
  assert.equal(auxiliary.moreTools.some(item => item.id === 'quick-create'), true);
  assert.equal(auxiliary.stageAdvanced.some(item => item.id === 'canvas'), true);
  assert.equal(model.buildPrototypeRouteRegistry().some(item => item.id === 'tasks'), true);
});

test('六类开始能力收敛为三个主入口且每个来源进入自己的流程', () => {
  const groups = model.getEpisodeCreationSourceGroups();
  assert.deepEqual(groups.primary.map(item => item.id), ['script-import', 'ai-script', 'package-import']);
  assert.deepEqual(groups.more.map(item => item.id), ['blank', 'novel-split', 'source-video']);
  assert.equal(groups.primary.find(item => item.id === 'package-import').secondaryAction.id, 'start-external-ai-collaboration');

  const sourceIds = [...groups.primary, ...groups.more].map(item => item.id);
  const actions = sourceIds.map(sourceId => model.getEpisodeCreationSourceTarget(sourceId, {
    projectId: '7', episodeId: '3', projectShellCreated: true,
  }).action);
  assert.equal(new Set(actions).size, sourceIds.length, '来源卡不能全部落到同一个项目创建成功状态');
});

test('导入资产冲突必须显式选择且只允许可选引用跳过', () => {
  const unresolved = model.getEpisodePackageImportModel(3, { assetDecisions: {} });
  const requiredConflict = unresolved.matches.find(item => item.id === 'scene-room-208');
  const optionalConflict = unresolved.matches.find(item => item.id === 'prop-note');
  assert.deepEqual(requiredConflict.availableDecisions.map(item => item.id), ['reuse', 'create']);
  assert.deepEqual(optionalConflict.availableDecisions.map(item => item.id), ['reuse', 'create', 'skip']);
  assert.equal(unresolved.canAdvance, false);

  const resolved = model.getEpisodePackageImportModel(3, {
    assetDecisions: { 'scene-room-208': 'reuse', 'prop-note': 'skip' },
  });
  assert.equal(resolved.canAdvance, true);
  assert.equal(resolved.matches.find(item => item.id === 'scene-room-208').decision.type, 'reuse');
  assert.equal(resolved.matches.find(item => item.id === 'scene-room-208').decision.assetVersionId, 'scene-208:v4:night');
  assert.equal(resolved.matches.find(item => item.id === 'prop-note').decision.type, 'skip');
});

test('默认生图通道按一次性项目全局安装顺序解析并冻结来源', () => {
  assert.deepEqual(model.resolveDefaultImageChannel({
    oneShot: 'api', projectDefault: 'chatgpt_web', globalDefault: 'comfyui', installDefault: 'api',
  }), { channel: 'api', source: 'one-shot' });
  assert.deepEqual(model.resolveDefaultImageChannel({
    projectDefault: 'chatgpt_web', globalDefault: 'comfyui', installDefault: 'api',
  }), { channel: 'chatgpt_web', source: 'project' });
  assert.deepEqual(model.resolveDefaultImageChannel({
    globalDefault: 'chatgpt_web', installDefault: 'api',
  }), { channel: 'chatgpt_web', source: 'global' });
});

test('ChatGPT 环境异常保留默认值并只提供本次回退', () => {
  const ready = model.getChatGptEnvironmentModel('ready');
  assert.equal(ready.canSubmit, true);
  assert.equal(ready.generationCost, 0);

  for (const scenario of ['login-required', 'bridge-offline']) {
    const environment = model.getChatGptEnvironmentModel(scenario);
    assert.equal(environment.persistedDefault, 'chatgpt_web');
    assert.equal(environment.canSubmit, false);
    assert.deepEqual(environment.oneShotFallbacks, ['api', 'comfyui']);
    assert.equal(environment.changesPersistedDefault, false);
    assert.ok(environment.checks.some(item => item.status === 'failed' && item.recoveryAction));
  }
  const global = model.getImageChannelSettingsModel('global', 'bridge-offline');
  assert.equal(global.environmentCheck.createsGenerationCost, false);
  assert.equal(global.mayPersistUnavailableDefaultAfterExplicitConfirmation, true);
});

test('全局任务页按用户状态分组并保留可信进度与技术详情', () => {
  const tasks = model.getTaskCenterModel({ projectId: '7', focusTaskId: 'task-shot-03-image' });
  assert.deepEqual(tasks.groups.map(group => group.id), ['in-progress', 'needs-action', 'completed']);
  assert.equal(tasks.filters.projectId, '7');
  assert.equal(tasks.filters.focusTaskId, 'task-shot-03-image');
  const focused = tasks.groups.flatMap(group => group.tasks).find(item => item.focused);
  assert.equal(focused.id, 'task-shot-03-image');
  assert.equal(focused.progressPercent, null);
  assert.equal(focused.progressSource, 'unavailable');
  assert.equal(focused.primaryAction.id, 'open-web-session');
  assert.equal(typeof focused.technical.attemptId, 'string');
  assert.equal(model.getTaskCenterModel({}, 'empty').groups.every(group => group.tasks.length === 0), true);
});

test('任务中心按责任人区分处理中与需要处理并保留恢复契约', () => {
  const tasks = model.getTaskCenterModel({ focusTaskId: 'task-shot-05-video' });
  const all = tasks.groups.flatMap(group => group.tasks);
  const external = all.find(item => item.id === 'external-ai-pkg-ep09');
  const auth = all.find(item => item.id === 'task-shot-05-video');
  assert.equal(external.responsibility, 'user');
  assert.equal(external.lifecycle, 'waiting_user');
  assert.equal(external.groupId, 'needs-action');
  assert.equal(auth.lifecycle, 'blocked_auth');
  assert.equal(auth.primaryAction.target.routeId, 'settings-ai');
  assert.equal(auth.primaryAction.target.scenarioId, 'chatgpt-login-required');
  assert.deepEqual(auth.context, { project: '凌晨两点的客房服务', episode: '第 1 集', stage: '分镜', object: '镜头 05' });
  assert.equal(auth.cost.billingStatus, 'unknown');
  assert.ok(auth.timestamps.lastConfirmedAt);
  assert.equal(auth.retrySemantics.newAttempt, true);
});

test('任务中心覆盖离线、批任务部分成功和聚焦恢复状态', () => {
  const offline = model.getTaskCenterModel({ focusTaskId: 'task-shot-03-video' }, 'offline');
  assert.equal(offline.connection.frontend, 'offline');
  assert.equal(offline.autoRefresh, false);
  assert.equal(offline.tasks.find(item => item.id === 'task-shot-03-video').primaryAction.disabled, true);
  const batch = model.getTaskCenterModel({}, 'partial-success');
  assert.equal(batch.batch.parentId, 'batch-episode-01-video');
  assert.equal(batch.batch.summary.partialSuccess, true);
  assert.equal(batch.batch.retryAction.id, 'retry-failed-only');
  assert.ok(batch.tasks.some(item => item.id === 'batch-episode-01-video'));
});

test('设定默认只展示本集引用卡片与必要待处理项', () => {
  const stage = model.getEpisodeAssetsStageModel('7', '1', 'default');
  assert.equal('inheritedSummary' in stage, false);
  assert.equal('fullInheritedListEntry' in stage, false);
  assert.ok(stage.cards.length === 5);
  assert.ok(stage.cards.every(card => card.referencedByEpisode === true));
  assert.ok(stage.reviewItems.every(item => [
    'new-object', 'version-difference', 'missing-media', 'missing-required-voice', 'invalid-reference', 'blocker',
  ].includes(item.kind)));
  assert.equal(stage.snapshot.hiddenFromDefaultCopy, true);
});

test('生成成片不出现合片技术术语且导出终态自洽', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const cutHtml = html.match(/function renderCutStage[\s\S]*?\r?\n    \}\r?\n/)?.[0] || '';
  assert.ok(cutHtml, '未找到短片页渲染函数');
  assert.doesNotMatch(cutHtml, /Picture Lock|picture-lock|编码校验|转场|变速|轨迹|后期链|声音来源|字幕编辑/);
  assert.match(cutHtml, /连续播放/);
  assert.match(cutHtml, /生成成片/);
  assert.match(cutHtml, /回分镜修复/);
  assert.match(cutHtml, /成片设置/);
  assert.match(cutHtml, /导出 MP4/);

  const blocked = model.getCutStageModel('7', '1', 'default');
  assert.deepEqual(blocked.toolbar.primaryActions.find(item => item.id === 'compose').label, '生成成片');
  assert.equal(blocked.compose.gate.canCompose, false);
  assert.ok(blocked.compose.gate.blockers.length > 0);

  const exported = model.getCutStageModel('7', '1', 'exported');
  assert.equal(exported.compose.gate.canCompose, true);
  assert.equal(exported.compose.result.exported, true);
  assert.ok(exported.review.shots.every(item => item.status === 'completed' && item.candidateId));
  assert.equal(exported.stageNavigation.find(item => item.id === 'storyboard').state, 'done');
});

test('动态评审缺陷回归：素材卡片可点击、画布场景齐全、素材页无剧集门禁提示', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  // D-01: 卡片绑定不限定 button，且支持键盘
  assert.match(html, /querySelectorAll\('\[data-asset-open\]'\)/);
  assert.doesNotMatch(html, /button\[data-asset-open\]/);
  // D-02: 画布 route 全部场景在模型中可用
  const canvasRoute = model.buildPrototypeRouteRegistry().find(item => item.id === 'canvas');
  for (const scenarioId of canvasRoute.scenarios) {
    assert.doesNotThrow(() => model.getCanvasModel(scenarioId), `画布场景 ${scenarioId} 不可用`);
  }
});

test('统一原型默认投影不再保留被替换的单人工作流入口', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.equal(model.getProjectSectionNavigation('7').some(item => item.label === '项目设置'), false);
  assert.equal(model.getProjectEpisodesModel('7').managementActions.some(item => item.id === 'set-duration'), false);
  assert.equal(model.getProjectEpisodesModel('7').managementActions.some(item => item.id === 'duplicate-draft'), false);
  assert.equal(model.getProjectEpisodesModel('7').statusFilters.some(item => item.id === 'archived'), false);
  assert.doesNotMatch(html, /进入分镜前检查/);
  assert.doesNotMatch(html, /归档剧集/);
  assert.match(html, /本集设定/);
  assert.match(html, /导入 \/ 协作/);
});

test('个人创作者语言回归：页面不再出现工程与门禁术语', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /遵循当前剧集 Gate/);
  assert.doesNotMatch(html, /当前 Recipe/);
  assert.doesNotMatch(html, /自由创作实验室/);
  assert.doesNotMatch(html, /给外部 AI 的项目说明已标记/);
  assert.doesNotMatch(html, /各阶段按顺序解锁/);
  assert.match(html, /四个阶段随时可以进入查看/);
  assert.match(html, /当前生成方式/);
});

test('场景参考图池支持逐张勾选且时段可引用分镜图', () => {
  const page = model.getStoryboardStageModel('7', '1', 'default');
  const pool = model.getStoryboardSceneReferencePool(page, 3);
  assert.equal(pool.typeLabel, '分镜场景');
  assert.equal(pool.usage, '@图片3');
  assert.ok(pool.images.length >= 3);
  assert.ok(pool.images.every(item => 'checked' in item));

  const firstId = pool.images[0].id;
  const toggled = model.toggleStoryboardSceneImage(page, 3, firstId);
  const pool2 = model.getStoryboardSceneReferencePool(toggled, 3);
  assert.equal(pool2.images.find(item => item.id === firstId).checked, false);
  const restored = model.toggleStoryboardSceneImage(toggled, 3, firstId);
  assert.equal(model.getStoryboardSceneReferencePool(restored, 3).images.find(item => item.id === firstId).checked, true);
  assert.throws(() => model.toggleStoryboardSceneImage(page, 3, 'unknown-image'), /Unknown scene image/);

  const segToggled = model.toggleStoryboardSegmentImageRef(page, 'segment-a');
  const segment = segToggled.selectedShot.segments.find(item => item.id === 'segment-a');
  assert.equal(segment.refsStoryboardImage, false);
  const segRestored = model.toggleStoryboardSegmentImageRef(segToggled, 'segment-a');
  assert.equal(segRestored.selectedShot.segments.find(item => item.id === 'segment-a').refsStoryboardImage, true);
});
