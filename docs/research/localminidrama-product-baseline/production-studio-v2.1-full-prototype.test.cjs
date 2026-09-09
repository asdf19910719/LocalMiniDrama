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
    'project-bible', 'project-episodes', 'project-assets',
    'studio-script', 'studio-assets', 'studio-storyboard', 'studio-cut',
    'library', 'quick-create', 'canvas', 'settings-ai', 'settings-general', 'settings-data',
  ]);
});

test('数据管理退出项目一级导航并按职责拆到项目菜单与高级数据工具', () => {
  assert.equal(typeof model.getProjectSectionNavigation, 'function');
  assert.equal(typeof model.getProjectOperationsModel, 'function');
  assert.equal(typeof model.getAdvancedDataToolsModel, 'function');

  assert.deepEqual(model.getProjectSectionNavigation('7').map(item => item.id), [
    'project-overview', 'project-bible', 'project-episodes', 'project-assets',
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
    externalSources: 1,
  });
  assert.deepEqual(page.rows.map(item => item.episodeId), ['1', '2', '3']);
  assert.deepEqual(page.creationSources.map(item => item.id), [
    'blank', 'ai', 'novel', 'external_ai', 'episode_json', 'source_video',
  ]);
  assert.equal(page.activeStageFilter, null);

  const filtered = model.getProjectEpisodesModel('7', 'filter-storyboard');
  assert.equal(filtered.activeStageFilter, 'storyboard');
  assert.deepEqual(filtered.visibleRows.map(item => item.episodeId), ['1']);
});

test('剧集继续动作恢复真实阶段而空白剧集打开同一来源选择器', () => {
  assert.equal(typeof model.getEpisodeNavigationTarget, 'function');
  assert.deepEqual(model.getEpisodeNavigationTarget({
    projectId: '7', episodeId: '1', action: 'resume',
  }), {
    routeId: 'studio-storyboard',
    params: { projectId: '7', episodeId: '1' },
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
    routeId: 'project-episodes',
    params: { projectId: '7', focusId: '3' },
    scenarioId: 'source-picker',
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
  assert.equal(conflict.unresolvedConflicts, 1);
  const resolved = model.getEpisodePackageImportModel(3, { assetConflictResolved: true });
  assert.equal(resolved.canAdvance, true);

  const commit = model.getEpisodePackageImportModel(5, { targetMode: 'create_new' });
  assert.equal(commit.transactional, true);
  assert.equal(commit.remoteGenerationCost, 0);
  assert.deepEqual(commit.createdMediaTasks, []);
});

test('剧集管理只提供可恢复归档并保留外部来源审计入口', () => {
  const page = model.getProjectEpisodesModel('7', 'default');
  assert.deepEqual(page.managementActions.map(item => item.id), [
    'rename', 'duplicate-draft', 'set-duration', 'reorder', 'archive', 'view-source',
  ]);
  assert.equal(page.managementActions.find(item => item.id === 'archive').recoverable, true);
  assert.equal(page.managementActions.some(item => item.id === 'physical-delete'), false);
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

test('剧集设定只选择本集生产版本并在进入分镜前固化快照', () => {
  assert.equal(typeof model.getEpisodeAssetsStageModel, 'function');
  const page = model.getEpisodeAssetsStageModel('7', '1', 'default');
  assert.deepEqual(page.requiredGroups.map(item => item.id), ['characters', 'scenes', 'props', 'voices']);
  assert.equal(page.snapshot.immutable, true);
  assert.equal(page.snapshot.confirmAction, 'confirm-asset-gate');
  assert.equal(page.snapshot.autoRefreshFromProject, false);
  assert.equal(page.gate.canEnterStoryboard, false);
  assert.deepEqual(page.gate.blockers.map(item => item.id), ['manager-voice']);
  assert.equal(model.getEpisodeAssetsStageModel('7', '1', 'candidate-compare').scenario.actions.length > 0, true);
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

test('项目创建先建立最小项目壳再复用六类剧集来源', () => {
  assert.equal(typeof model.getProjectCreateModel, 'function');
  const page = model.getProjectCreateModel('default');
  assert.deepEqual(page.fields.map(item => item.id), ['name', 'aspect-ratio', 'episode-duration', 'output-location']);
  assert.deepEqual(page.sources.map(item => item.id), ['blank', 'ai', 'novel', 'external_ai', 'episode_json', 'source_video']);
  assert.equal(page.cancelAfterShell.keepsEmptyProject, true);
});

test('项目归档与单集包严格分流并以事务导入新项目', () => {
  assert.equal(typeof model.getProjectImportModel, 'function');
  const page = model.getProjectImportModel('default');
  assert.equal(page.acceptedArchive, 'local-mini-drama.project-archive@2.1');
  assert.equal(page.rejectsEpisodePackage, true);
  assert.equal(page.transactional, true);
  assert.deepEqual(page.defaultStrategies, ['import-as-new']);
  assert.equal(page.manifest.media.missing, 2);
});

test('常规设置负责路径与默认值而高级数据工具负责修复', () => {
  assert.equal(typeof model.getGeneralSettingsModel, 'function');
  const page = model.getGeneralSettingsModel('default');
  assert.deepEqual(page.sections.map(item => item.id), ['workspace', 'output', 'creation-defaults']);
  assert.equal(page.advancedRepairTarget.routeId, 'settings-data');
  assert.equal(model.getGeneralSettingsModel('storage-offline').scenario.actions[0].id, 'open-relocation');
});

test('个人资产库引用固定版本并保护来源许可和使用位置', () => {
  assert.equal(typeof model.getLibraryModel, 'function');
  const page = model.getLibraryModel('default');
  assert.deepEqual(page.addModes.map(item => item.id), ['pinned-reference', 'project-copy']);
  assert.equal(page.addModes.find(item => item.id === 'pinned-reference').followsLibraryUpdates, false);
  assert.equal(page.items.every(item => item.provenance && item.license && item.usageLocations), true);
  assert.equal(model.getLibraryModel('publish-conflict').scenario.actions.length > 0, true);
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

test('短片门禁阻止未齐镜头锁画和未完成编码时导出', () => {
  const page = model.getCutStageModel('7', '1', 'default');
  assert.equal(page.readiness.completed, 6);
  assert.equal(page.gates.canPictureLock, false);
  assert.equal(page.gates.pictureLockBlockers.includes('3 个必需镜头尚未采用或豁免'), true);
  assert.equal(page.delivery.canExport, false);
  assert.equal(page.delivery.blockers.includes('编码校验仍在等待'), true);
  assert.equal(page.postArtifacts.find(item => item.id === 'base-composite').preservedOnUpscaleFailure, true);
  assert.deepEqual(page.upscaleDecision.allowed, ['skip', 'run', 'fallback-to-base']);
  assert.equal(model.getCutStageModel('7', '1', 'picture-lock').gates.canPictureLock, true);
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

test('分镜阶段同时承担镜头设计、分镜图和正式镜头视频生成', () => {
  assert.equal(typeof model.getStoryboardStageModel, 'function');
  const storyboard = model.getStoryboardStageModel('7', '1', 'default');

  assert.deepEqual(storyboard.workspaceColumns, [
    'shot-inspector', 'visual-workbench', 'prompt-and-generation',
  ]);
  assert.equal(storyboard.videoGeneration.ownerStage, 'storyboard');
  assert.equal(storyboard.videoGeneration.requiresCostConfirmation, true);
  assert.deepEqual(storyboard.batchActions.map(item => item.id), [
    'recompile', 'generate-images', 'generate-videos', 'confirm-shots',
    'share-recipe', 'export-shot-package',
  ]);
  assert.equal(storyboard.nextStage.label, '进入短片审核');
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

test('短片阶段以整集审核、时间线、后期和交付为主而不是首次生成入口', () => {
  assert.equal(typeof model.getCutStageModel, 'function');
  const cut = model.getCutStageModel('7', '1', 'default');

  assert.deepEqual(cut.tabs.map(item => item.id), ['review', 'timeline', 'delivery']);
  assert.equal(cut.primaryWorkflow, 'episode-review-and-delivery');
  assert.equal(cut.videoGenerationAccess, 'secondary-repair');
  assert.deepEqual(cut.reviewActions.map(item => item.id), [
    'play-current', 'play-all', 'open-history', 'regenerate', 'retake',
  ]);
  assert.ok(cut.timeline.clips.every(item => item.candidateId));
  assert.deepEqual(cut.postChain.map(item => item.id), [
    'base-composite', 'technical-match', 'creative-look', 'upscale', 'subtitles-watermark',
    'mix-loudness', 'encode-validate',
  ]);
});

test('短片改选默认候选不会静默替换已经固定到时间线的片段', () => {
  const state = {
    routeId: 'studio-cut',
    adoptedByShot: { 'shot-03': 'video-a' },
    timelineClips: [{ shotId: 'shot-03', candidateId: 'video-a' }],
  };
  const keepTimeline = model.transitionPrototypeState(state, {
    type: 'adopt-cut-candidate',
    shotId: 'shot-03',
    candidateId: 'video-b',
    timelineDecision: 'keep',
  });
  assert.equal(keepTimeline.adoptedByShot['shot-03'], 'video-b');
  assert.equal(keepTimeline.timelineClips[0].candidateId, 'video-a');

  const replaceTimeline = model.transitionPrototypeState(state, {
    type: 'adopt-cut-candidate',
    shotId: 'shot-03',
    candidateId: 'video-b',
    timelineDecision: 'replace',
  });
  assert.equal(replaceTimeline.adoptedByShot['shot-03'], 'video-b');
  assert.equal(replaceTimeline.timelineClips[0].candidateId, 'video-b');
});

test('分镜和短片异常场景都给出可执行恢复动作', () => {
  const storyboardBlocked = model.getStoryboardStageModel('7', '1', 'provider-blocked');
  assert.equal(storyboardBlocked.scenario.kind, 'blocking');
  assert.deepEqual(storyboardBlocked.scenario.actions.map(item => item.id), [
    'split-shot', 'change-provider',
  ]);

  const cutFailed = model.getCutStageModel('7', '1', 'delivery-failed');
  assert.equal(cutFailed.scenario.kind, 'recoverable-error');
  assert.equal(cutFailed.scenario.retryFromStep, 'mix-loudness');
  assert.equal(cutFailed.scenario.preservesIntermediateResults, true);
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

test('H3 Recipe 提供可编辑草稿、来源失效和结构语义校验', () => {
  const current = model.getStoryboardStageModel('7', '1', 'default').promptCompiler.h3Draft;
  assert.equal(current.actionLabel, '生成 H3 提示词');
  assert.equal(current.editable, true);
  assert.deepEqual(current.validationChecks, ['结构校验', '引用槽位', '音频语义覆盖', 'PromptStyleGate']);
  assert.ok(current.sourceFingerprint);

  const stale = model.getStoryboardStageModel('7', '1', 'h3-stale').promptCompiler.h3Draft;
  assert.equal(stale.status, 'stale');
  assert.equal(stale.canSubmitVideo, false);
  assert.equal(stale.actionLabel, '重新生成 H3 提示词');

  const invalid = model.getStoryboardStageModel('7', '1', 'h3-invalid').promptCompiler.h3Draft;
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.canSubmitVideo, false);
  assert.ok(invalid.recoveryActions.length >= 2);
});

test('视频任务区分输出时长、预计处理耗时和候选实际耗时', () => {
  const generation = model.getStoryboardStageModel('7', '1', 'default').videoGeneration;
  assert.equal(generation.requestedDuration, '8s');
  assert.match(generation.timing.estimatedQueueWait, /分钟/);
  assert.match(generation.timing.estimatedProcessingTime, /分钟/);
  assert.match(generation.timing.estimatedTotalTime, /分钟/);
  assert.equal(generation.timing.estimateIsGuaranteed, false);
  const completed = generation.candidates.find(item => item.status === 'ready');
  assert.ok(completed.startedAt);
  assert.ok(completed.completedAt);
  assert.match(completed.queueDuration, /秒|分钟/);
  assert.match(completed.processingDuration, /秒|分钟/);
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
    'nextAction', 'stages', 'projectLook', 'blockers',
  ]);
  assert.equal(overview.sections.stages.length, 4);
  assert.equal(overview.sections.projectLook.version, 4);
  assert.equal(overview.sections.projectLook.action.label, '查看 Look');
  assert.equal(overview.sections.projectLook.action.type, 'open-drawer');
  assert.deepEqual(overview.sections.projectLook.action.manageTarget, {
    routeId: 'project-bible',
    scenarioId: 'look',
  });
  assert.ok(overview.sections.projectLook.visualIntent.length > 0);
  assert.ok(overview.sections.projectLook.versionHistory.length > 0);
  assert.ok(overview.sections.blockers.length > 0);
  assert.equal('recentActivity' in overview.sections, false);
});

test('项目阶段汇总进入带阶段筛选的剧集页且不绑定任意剧集', () => {
  assert.equal(typeof model.getProjectStageNavigationTarget, 'function');
  const expected = {
    script: 'filter-script',
    assets: 'filter-assets',
    storyboard: 'filter-storyboard',
    cut: 'filter-cut',
  };
  for (const [stage, scenarioId] of Object.entries(expected)) {
    const target = model.getProjectStageNavigationTarget({ projectId: 7, stage });
    assert.deepEqual(target, {
      routeId: 'project-episodes',
      params: { projectId: '7' },
      scenarioId,
    });
    assert.equal('episodeId' in target.params, false);
  }
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
    kind: 'task-drawer',
    taskId: 'task-shot-05-video',
  });
  assert.throws(
    () => model.getProjectOverviewBlockerTarget({ projectId: 7, blockerId: 'unknown' }),
    /Unknown project blocker/,
  );
});

test('项目设定只编辑项目级上下文并把生产对象导向精确资产筛选', () => {
  assert.equal(typeof model.getProjectBibleModel, 'function');
  const bible = model.getProjectBibleModel('7', 'default');
  assert.equal(bible.projectId, '7');
  assert.equal(bible.viewId, 'bible-overview');
  assert.deepEqual(bible.context.editableFields.map(item => item.id), [
    'project-summary', 'genre', 'story-foundation', 'immutable-settings', 'continuity-notes',
  ]);
  assert.deepEqual(bible.productionObjects.map(item => item.id), ['characters', 'scenes', 'props']);
  assert.deepEqual(bible.productionObjects.map(item => item.target.params.focusId), [
    'characters', 'scenes', 'props',
  ]);
  assert.ok(bible.productionObjects.every(item => item.target.routeId === 'project-assets'));
  assert.ok(bible.productionObjects.every(item => !('episodeId' in item.target.params)));
  assert.deepEqual(bible.excludedCapabilities, [
    'image-candidates', 'voice-candidates', 'media-generation', 'cross-episode-media-usage',
  ]);
});

test('项目圣经的 Look 场景保持项目作用域', () => {
  const lookView = model.getProjectBibleModel('7', 'look');
  assert.equal(lookView.viewId, 'project-look');
  assert.equal(lookView.projectLook.version, 4);
  assert.equal(lookView.managementScope, 'project');
  assert.equal('episodeId' in lookView, false);
});

test('项目圣经不是通用生成提示词源且只有明确生产字段参与生成', () => {
  const bible = model.getProjectBibleModel('7', 'default');
  assert.deepEqual(bible.generationPolicy, {
    isGeneralPromptSource: false,
    isGenerationGate: false,
    directInputs: [
      'project-look',
      'character-current-production-state',
      'scene-current-production-state',
      'prop-current-production-state',
    ],
    contextOnly: [
      'project-summary',
      'world-building',
      'character-background-and-relationships',
      'cross-episode-story-continuity',
    ],
    staleRule: 'only-effective-generation-input-changes',
  });
});

test('项目设定把外部 AI 上下文作为主操作且不重复建设知识系统', () => {
  const settings = model.getProjectBibleModel('7', 'default');
  assert.equal(settings.featureName, '项目设定');
  assert.deepEqual(settings.primaryAction, {
    label: '生成外部 AI 上下文',
    routeId: 'project-episodes',
    params: { projectId: '7' },
    scenarioId: 'external-ai-context',
  });
  assert.deepEqual(settings.excludedKnowledgeSystems, [
    'structured-world-fact-database',
    'foreshadowing-tracker',
    'event-timeline',
  ]);
  assert.equal(settings.context.title, '外部 AI 创作上下文');
  assert.deepEqual(settings.context.includedSources, [
    '项目简介与题材', '故事基础设定', '不可改变的设定', '跨集连续性备注',
    '相邻剧集与最新剧本', '人物当前状态', '场景索引', '道具索引', 'Project Look 摘要',
  ]);
  assert.equal(settings.projectLook.version, 4);
  assert.equal(settings.projectLook.action.scenarioId, 'look');
});

test('项目设定提供空、加载失败与保存失败恢复状态', () => {
  const definition = model.buildPrototypeRouteRegistry().find(item => item.id === 'project-bible');
  assert.ok(definition.scenarios.includes('empty'));
  assert.ok(definition.scenarios.includes('loading'));
  assert.ok(definition.scenarios.includes('load-failed'));
  assert.ok(definition.scenarios.includes('save-failed'));

  const empty = model.getProjectBibleModel('7', 'empty');
  assert.ok(empty.productionObjects.every(item => item.count === 0));
  assert.equal(empty.context.missingFields.length, 2);
  const failed = model.getProjectBibleModel('7', 'load-failed');
  assert.equal(failed.recoveryAction, 'retry');
  const saveFailed = model.getProjectBibleModel('7', 'save-failed');
  assert.equal(saveFailed.preserveDraft, true);
});

test('项目资产按生产对象组织并区分版本、候选、任务和使用状态', () => {
  assert.equal(typeof model.getProjectAssetsModel, 'function');
  const assets = model.getProjectAssetsModel('7', 'default');
  assert.deepEqual(assets.tabs.map(item => item.id), ['all', 'characters', 'scenes', 'props']);
  assert.deepEqual(assets.stats.map(item => item.id), ['characters', 'character-states', 'scenes', 'props', 'needs-attention']);
  assert.equal(assets.items.some(item => item.type === 'sounds'), false);
  assert.ok(assets.items.length >= 4);
  const character = assets.items.find(item => item.id === 'character-linxia');
  assert.equal(character.contentStatus, '当前使用 v3');
  assert.equal(character.taskStatus, '1 个新候选');
  assert.equal(character.usage, '3 集 · 8 个分镜');
  assert.equal(character.totalStates, 4);
  assert.deepEqual(character.statePreviews.map(item => item.name), ['日常', '制服', '雨夜']);
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
  assert.deepEqual(assets.statFilters['character-states'], { type: 'characters', level: 'state' });
  assert.deepEqual(assets.statFilters['needs-attention'], { issue: 'true' });
  assert.deepEqual(assets.createTypes.map(item => item.id), ['character', 'scene', 'prop']);
  assert.equal(assets.createTypes.find(item => item.id === 'character').fields.includes('voice'), false);
  assert.ok(assets.libraryItems.length >= 3);
  assert.deepEqual(assets.batchActions.map(item => item.id), ['generate-missing', 'set-mode', 'tags', 'archive-unused']);
  assert.equal(assets.batchPreview.autoUseCandidate, false);
});

test('项目资产筛选支持组合条件、搜索、问题优先和精确统计入口', () => {
  const assets = model.getProjectAssetsModel('7');
  const attention = model.filterAndSortProjectAssets(assets.items, {
    query: '大堂',
    filters: { issue: 'true' },
    sortId: 'issues-first',
  });
  assert.deepEqual(attention.map(item => item.id), ['scene-lobby']);
  const characterStates = model.getProjectAssetStatSelection('character-states');
  assert.deepEqual(characterStates, { type: 'characters', level: 'state' });
  assert.throws(() => model.getProjectAssetStatSelection('unknown'), /Unknown asset stat/);
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
  const empty = model.getProjectAssetsModel('7', 'empty');
  assert.ok(empty.stats.every(item => item.value === 0), '空项目不应保留示例资产统计');
  const blocked = model.getProjectAssetsModel('7', 'delete-blocked');
  assert.equal(blocked.blockedAction.reason, '存在 3 集和 8 个分镜引用');
  assert.equal(blocked.blockedAction.recoveryTarget, 'usage-locations');
});

test('Project Look 从概览打开项目级抽屉且管理入口不绑定任意剧集', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /data-project-look=/);
  assert.match(html, />查看 Look</);
  assert.match(html, /data-manage-project-look=/);
  assert.doesNotMatch(html, /data-project-stage="assets"/);
  assert.doesNotMatch(html, />查看设定</);
  const projectBible = model.buildPrototypeRouteRegistry().find(item => item.id === 'project-bible');
  assert.ok(projectBible.scenarios.includes('look'));
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
  for (const label of ['项目', '资产库', '快速创作', '高级画布', '设置']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /功能覆盖/);
  assert.match(html, /场景切换/);
  assert.match(html, /id="coverageButton"/);
  assert.match(html, /id="scenarioButton"/);
  assert.match(html, /prototype-tool/);
});

test('统一原型明确呈现分镜结构更新、H3 草稿和视频耗时交互', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /data-story-command="reextract">\$\{model\.reextract\.label\}/);
  assert.match(html, /data-story-command="import">\$\{model\.storyboardImport\.label\}/);
  assert.match(html, /H3 提示词草稿/);
  assert.match(html, /data-story-command="generate-h3"/);
  assert.match(html, /输出视频时长/);
  assert.match(html, /预计排队/);
  assert.match(html, /预计生成处理/);
  assert.match(html, /预计总耗时/);
  assert.match(html, /data-story-reextract-preview/);
  assert.match(html, /data-story-import-preview/);
});

test('功能覆盖抽屉由完整功能覆盖模型驱动，而不是维护第二份硬编码清单', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /当前只将项目列表计入已确认页面/);
  assert.match(html, /buildFeatureCoverageIndex\(\)/);
  assert.match(html, /data-feature-id="\$\{item\.featureId\}"/);
  assert.match(html, /data-coverage-route/);
});
