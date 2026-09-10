(function exposeFullPrototypeModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionStudioV21FullPrototypeModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  const routes = [
    route('projects', /^#\/projects$/, [], () => '/projects', ['default', 'empty', 'loading', 'offline', 'no-results', 'task-paused', 'load-failed']),
    route('project-new', /^#\/projects\/new$/, [], () => '/projects/new', [
      'default', 'source-selected', 'validation-error', 'creating', 'name-conflict',
      'path-unavailable', 'insufficient-space', 'source-cancelled', 'create-failed', 'success',
    ]),
    route('project-import', /^#\/projects\/import$/, [], () => '/projects/import', [
      'default', 'validating', 'ready', 'ready-with-warnings', 'unsupported-archive',
      'importing', 'failed', 'succeeded', 'partial-success',
    ]),
    route('project-overview', /^#\/projects\/([^/]+)\/overview$/, ['projectId'], p => `/projects/${p.projectId}/overview`, [
      'default', 'needs-attention', 'all-complete', 'loading', 'load-failed', 'storage-offline', 'missing',
    ]),
    route('project-bible', /^#\/projects\/([^/]+)\/bible$/, ['projectId'], p => `/projects/${p.projectId}/bible`, [
      'default',
    ]),
    route('project-episodes', /^#\/projects\/([^/]+)\/episodes$/, ['projectId'], p => `/projects/${p.projectId}/episodes`, [
      'default', 'empty', 'loading', 'load-failed', 'storage-offline', 'source-picker', 'blank-manual', 'ai-script', 'ai-script-partial', 'novel-split',
      'external-ai-context', 'external-ai-waiting', 'episode-json-import', 'source-video',
      'json-target-not-blank', 'asset-match-conflict', 'import-failed', 'import-succeeded', 'gate-blocked',
      'filter-status-needs-attention', 'filter-status-in-progress', 'filter-status-completed',
    ]),
    route('project-assets', /^#\/projects\/([^/]+)\/assets$/, ['projectId'], p => `/projects/${p.projectId}/assets`, [
      'default', 'empty', 'loading', 'load-failed', 'detail-load-failed', 'candidate-compare',
      'media-offline', 'damaged-candidate', 'generation-failed', 'unsupported-mode', 'reference-limit',
      'upload-invalid', 'batch-partial', 'adoption-failed', 'read-only', 'low-disk',
      'version-conflict', 'delete-blocked', 'batch-generate', 'library-update', 'publish-blocked',
    ]),
    route('external-ai-wizard', /^#\/projects\/([^/]+)\/external-ai$/, ['projectId'], p => `/projects/${p.projectId}/external-ai`, [
      'default',
    ]),
    route('studio-script', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/script$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/script`, ['default', 'blocked', 'loading', 'saving', 'save-failed', 'conflict', 'offline', 'stale', 'diff', 'ai-processing', 'ai-partial', 'ai-failed', 'approval-processing', 'approval-succeeded']),
    route('studio-assets', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/assets$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/assets`, [
      'default', 'blocked', 'stale', 'candidate-compare', 'look-change',
      'loading', 'first-preparation', 'ready', 'checking', 'snapshot-saving',
      'snapshot-succeeded', 'check-failed', 'snapshot-failed', 'media-offline',
      'external-package', 'external-package-mismatch',
    ]),
    route('studio-storyboard', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/storyboard$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/storyboard`, ['default', 'loading', 'empty', 'blocked', 'save-failed', 'provider-blocked', 'h3-stale', 'h3-invalid', 'video-generating', 'generation-failed', 'batch-partial', 'conflict']),
    route('studio-cut', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/cut$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/cut`, ['default', 'loading', 'empty', 'blocked', 'stale', 'composing', 'compose-failed', 'exported']),
    route('library', /^#\/library$/, [], () => '/library', ['default', 'loading', 'empty', 'search-empty', 'filter-empty', 'offline', 'importing', 'import-failed', 'partial-success', 'archived', 'version-update', 'publish-conflict']),
    route('tasks', /^#\/tasks$/, [], () => '/tasks', ['default', 'project-filtered', 'login-required', 'capture-recovery', 'empty', 'filter-empty', 'loading', 'load-failed', 'queued', 'monitoring-external', 'waiting-user', 'validating', 'blocked-auth', 'failed', 'cancel-requested', 'cancelled', 'unknown', 'reconciling', 'partial-success', 'offline']),
    route('quick-create', /^#\/quick-create$/, [], () => '/quick-create', [
      'default', 'configuring-image', 'configuring-video', 'validating', 'provider-unavailable',
      'credential-expired', 'queued', 'generating', 'cancelling', 'unknown', 'failed',
      'succeeded', 'succeeded-unarchived', 'archived', 'partial-success', 'offline', 'result-missing',
    ]),
    route('canvas', /^#\/canvas$/, [], () => '/canvas', ['default', 'restore-context', 'unsaved', 'loading', 'context-restore-failed', 'empty-relationship', 'read-only', 'selection', 'multi-selection', 'batch-confirming', 'batch-processing', 'batch-partial-success', 'save-processing', 'save-succeeded', 'save-failed', 'offline', 'stale', 'missing', 'capability-blocked']),
    route('settings-ai', /^#\/settings\/ai$/, [], () => '/settings/ai', ['default', 'credential-expired', 'connection-failed', 'import-conflict', 'chatgpt-waiting', 'chatgpt-rebind', 'chatgpt-ready', 'chatgpt-login-required', 'chatgpt-bridge-offline', 'provider-loading', 'model-list-failed', 'provider-disabled', 'local-unavailable', 'cert-error', 'proxy-error', 'partial-capability', 'model-retired', 'save-conflict', 'save-failed', 'key-invalid', 'snapshot-mismatch']),
    route('settings-general', /^#\/settings\/general$/, [], () => '/settings/general', ['default', 'storage-offline', 'save-conflict', 'loading', 'saving', 'save-failed', 'path-not-found', 'permission-denied', 'insufficient-space', 'path-conflict', 'workspace-change-pending', 'restart-required', 'active-task-blocking', 'backup-failed', 'backup-restoring', 'read-only']),
    route('settings-data', /^#\/settings\/data$/, [], () => '/settings/data', [
      'default', 'integrity-checking', 'integrity-success', 'integrity-warning', 'integrity-failed', 'integrity-partial',
      'storage-offline', 'relocation-selecting', 'relocation-scanning', 'relocation-preview', 'relocation-ambiguous',
      'relocation-updating', 'relocation-update-failed', 'migration-failed', 'migration-recovering', 'migration-rolling-back',
      'migration-rollback-failed', 'migration-recovered', 'migration-rolled-back', 'cleanup-dry-run', 'cleanup-empty',
      'cleanup-blocked', 'cleanup-confirming', 'cleanup-running', 'cleanup-partial-success', 'cleanup-report-failed',
      'read-only', 'active-task-blocking',
    ]),
  ];

  function route(id, pattern, paramNames, buildPath, scenarios) {
    return { id, pattern, paramNames, buildPath, scenarios };
  }

  function buildPrototypeRouteRegistry() {
    return routes.map(({ id, paramNames, scenarios }) => ({
      id,
      paramNames: [...paramNames],
      scenarios: [...scenarios],
    }));
  }

  function buildFeatureCoverageIndex() {
    const routeById = {
      'P-01':'projects','P-02':'project-import','P-03':'project-episodes','P-04':'project-import','P-05':'project-overview',
      'E-01':'project-episodes','E-02':'project-episodes','E-03':'project-episodes','E-04':'studio-script','E-05':'project-episodes',
      'S-01':'studio-script','S-02':'project-episodes','S-03':'studio-script','S-04':'studio-script',
      'I-01':'project-episodes','I-02':'project-episodes','I-03':'project-episodes',
      'L-01':'project-bible','L-02':'project-bible',
      'A-01':'project-assets','A-02':'project-assets','A-03':'project-assets','A-04':'library','A-05':'project-assets',
      'G-01':'project-assets','G-02':'settings-ai','G-03':'settings-ai',
      'B-01':'studio-storyboard','B-02':'studio-storyboard','B-03':'studio-storyboard','B-04':'studio-storyboard',
      'H-01':'studio-storyboard','H-02':'studio-storyboard','H-03':'studio-storyboard',
      'V-01':'studio-storyboard','V-02':'settings-ai','V-03':'settings-ai',
      'AU-01':'studio-cut','AU-02':'studio-cut','AU-03':'studio-cut',
      'T-01':'studio-cut','T-02':'studio-cut','T-03':'studio-cut','T-04':'studio-cut',
      'C-01':'settings-ai','C-02':'settings-ai','C-03':'settings-ai',
      'M-01':'library','F-01':'quick-create','X-01':'canvas','J-01':'tasks','D-01':'settings-data',
    };
    return Object.entries(routeById).map(([id, routeId]) => ({
      id,
      featureId: id,
      routeId,
      scenarioId: 'default',
      prototypeStatus: 'complete',
      productCodeStatus: 'not-developed',
    }));
  }

  function parsePrototypeLocation(hash = '#/projects') {
    const normalized = String(hash || '#/projects');
    const [pathPart, query = ''] = normalized.split('?');
    const queryParams = new URLSearchParams(query);
    const requestedScenario = queryParams.get('scenario') || 'default';

    for (const definition of routes) {
      const match = pathPart.match(definition.pattern);
      if (!match) continue;
      const params = Object.fromEntries(definition.paramNames.map((name, index) => [
        name,
        decodeURIComponent(match[index + 1]),
      ]));
      for (const [queryKey, paramKey] of [
        ['focus', 'focusId'], ['project', 'projectId'], ['episode', 'episodeId'],
        ['scene', 'sceneId'], ['shot', 'shotId'], ['tab', 'workspaceTab'], ['inspector', 'inspectorSection'],
        ['time', 'timelineTime'], ['candidate', 'candidateId'],
        ['type', 'type'], ['channel', 'channel'], ['execution', 'execution'], ['q', 'query'], ['status', 'status'], ['sort', 'sort'],
      ]) {
        const value = queryParams.get(queryKey);
        if (value && params[paramKey] === undefined) params[paramKey] = value;
      }
      const scenarioId = definition.scenarios.includes(requestedScenario) ? requestedScenario : 'default';
      return { routeId: definition.id, params, scenarioId };
    }

    return {
      routeId: 'projects',
      params: {},
      scenarioId: 'default',
      notFound: true,
    };
  }

  function formatPrototypeLocation(routeId, params = {}, scenarioId = 'default') {
    const definition = routes.find(item => item.id === routeId);
    if (!definition) throw new Error(`Unknown route: ${routeId}`);
    if (!definition.scenarios.includes(scenarioId)) throw new Error(`Unknown scenario for ${routeId}: ${scenarioId}`);
    const queryParams = new URLSearchParams();
    if (scenarioId !== 'default') queryParams.set('scenario', scenarioId);
    for (const [queryKey, paramKey] of [
      ['focus', 'focusId'], ['project', 'projectId'], ['episode', 'episodeId'],
      ['scene', 'sceneId'], ['shot', 'shotId'], ['tab', 'workspaceTab'], ['inspector', 'inspectorSection'],
      ['time', 'timelineTime'], ['candidate', 'candidateId'],
      ['type', 'type'], ['channel', 'channel'], ['execution', 'execution'], ['q', 'query'], ['status', 'status'], ['sort', 'sort'],
    ]) {
      if (params[paramKey] && !definition.paramNames.includes(paramKey)) queryParams.set(queryKey, params[paramKey]);
    }
    const serializedQuery = queryParams.toString();
    const suffix = serializedQuery ? `?${serializedQuery}` : '';
    return `#${definition.buildPath(params)}${suffix}`;
  }

  function getPageModel(routeId, params = {}, scenarioId = 'default') {
    const definition = routes.find(item => item.id === routeId);
    if (!definition) throw new Error(`Unknown route: ${routeId}`);
    if (!definition.scenarios.includes(scenarioId)) throw new Error(`Unknown scenario for ${routeId}: ${scenarioId}`);
    return { routeId, params: { ...params }, scenarioId };
  }

  function getProjectCardNavigationTarget({
    projectId,
    episodeId = 1,
    action = 'open-card',
    continueStage = 'script',
  } = {}) {
    if (projectId === undefined || projectId === null || projectId === '') {
      throw new Error('projectId is required');
    }
    const projectKey = String(projectId);
    if (action === 'continue') {
      const allowedStages = ['script', 'assets', 'storyboard', 'cut'];
      if (!allowedStages.includes(continueStage)) throw new Error(`Unknown continue stage: ${continueStage}`);
      return {
        routeId: `studio-${continueStage}`,
        params: { projectId: projectKey, episodeId: String(episodeId) },
      };
    }
    if (action === 'open-card') {
      return {
        routeId: 'project-overview',
        params: { projectId: projectKey },
      };
    }
    throw new Error(`Unknown project card action: ${action}`);
  }

  function normalizeProjectListViewMode(value) {
    return value === 'list' ? 'list' : 'card';
  }

  function getProductNavigationModel() {
    return [
      { id: 'projects', label: '项目', routeId: 'projects' },
      { id: 'library', label: '资产库', routeId: 'library' },
      { id: 'tasks', label: '任务', routeId: 'tasks' },
      { id: 'settings', label: '设置', routeId: 'settings-ai' },
    ];
  }

  function getProjectSectionNavigation(projectId) {
    const projectKey = String(projectId);
    return [
      { id: 'project-overview', label: '概览', params: { projectId: projectKey } },
      { id: 'project-episodes', label: '剧集', params: { projectId: projectKey } },
      { id: 'project-assets', label: '项目素材', params: { projectId: projectKey } },
    ];
  }

  function getEpisodeStageNavigation(projectId, episodeId) {
    const params = { projectId: String(projectId), episodeId: String(episodeId) };
    return [
      { id: 'script', label: '剧本', routeId: 'studio-script', params },
      { id: 'assets', label: '设定', routeId: 'studio-assets', params },
      { id: 'storyboard', label: '分镜', routeId: 'studio-storyboard', params },
      { id: 'cut', label: '成片', routeId: 'studio-cut', params },
    ];
  }

  function getAuxiliaryToolEntries({ projectId = '7', episodeId = '1' } = {}) {
    return {
      moreTools: [{ id: 'quick-create', label: '自由创作', description: '不进入四阶段的快速图片和视频生成实验室。', routeId: 'quick-create', params: {} }],
      stageAdvanced: [{ id: 'canvas', label: '高级画布', description: '在当前剧集上下文中查看关系并进行批量编排。', routeId: 'canvas', params: { projectId: String(projectId), episodeId: String(episodeId) } }],
    };
  }

  function getProjectOperationsModel(projectId) {
    const projectKey = String(projectId);
    return {
      projectId: projectKey,
      projectTitle: getProjectOverviewModel(projectKey).title,
      actions: [
        {
          id: 'export-backup',
          label: '导出项目备份',
          description: '导出当前协议的项目归档；不会修改项目。',
          mutatesData: false,
        },
        {
          id: 'restore-backup',
          label: '从备份恢复',
          description: '先校验归档和影响范围，再以事务方式恢复。',
          mutatesData: true,
        },
        {
          id: 'delete-project',
          label: '移入回收站',
          description: '移入回收站并保留恢复窗口；不会立即物理删除文件。',
          mutatesData: true,
          recoverable: true,
        },
      ],
      advancedToolsTarget: { routeId: 'settings-data', params: {} },
    };
  }

  function getAdvancedDataToolsModel(scenarioId = 'default') {
    const target = (nextScenario = 'default') => ({ routeId: 'settings-data', params: {}, scenarioId: nextScenario });
    const action = (id, label, nextScenario = 'default') => ({ id, label, target: target(nextScenario) });
    const integrityIssues = [
      {
        id: 'media-offline', severity: 'warning', category: '媒体离线',
        title: '第 1 集 · 13 层走廊当前图无法读取',
        detail: '原位置 E:\\LocalMiniDramaMedia\\projects\\7\\episode-1\\corridor-night.png 不可访问；数据库引用没有被改写。',
        affected: '第 1 集 / 设定 / 镜头 03',
        recovery: action('open-media-relocation', '打开媒体重定位', 'relocation-selecting'),
      },
      {
        id: 'task-index-stale', severity: 'error', category: '任务索引异常',
        title: '1 个完成任务未进入本地任务索引',
        detail: '任务记录仍保留；重建只重算本地索引，不会重新提交 Provider 或删除候选。',
        affected: '任务 quick-job-01 / 结果 quick-result-20260909-01',
        recovery: action('rebuild-task-index', '重建任务索引', 'integrity-success'),
      },
    ];
    const mediaRelocation = {
      readOnlyUntilConfirmed: true,
      updateRequiresExplicitConfirmation: true,
      matchingKeys: ['相对路径', '文件名', '文件大小', 'hash', '媒体类型', '项目/剧集上下文'],
      summary: { unique: 181, manual: 3, hashMismatch: 1, notFound: 2, outOfBoundary: 1 },
      previewItems: [
        {
          id: 'corridor-night', matchState: 'unique', title: '第 1 集 · 13 层走廊当前图', mediaType: '图片',
          originalPath: 'E:\\LocalMiniDramaMedia\\projects\\7\\episode-1\\corridor-night.png',
          candidatePath: 'F:\\DramaMedia\\projects\\7\\episode-1\\corridor-night.png',
          evidence: '相对路径、文件大小和 hash 全部一致', canConfirmUpdate: true,
        },
        {
          id: 'linxia-voice', matchState: 'ambiguous', title: '林夏 · 夜班音色', mediaType: '音频',
          originalPath: 'E:\\LocalMiniDramaMedia\\voices\\linxia-night.wav',
          candidatePath: null, evidence: '找到 2 个文件名、大小相同的候选，hash 尚未确认。', canConfirmUpdate: false,
          candidates: [
            { path: 'F:\\DramaMedia\\voices\\linxia-night.wav', size: '12.4 MB', hash: '待确认' },
            { path: 'F:\\Archive\\voices\\linxia-night.wav', size: '12.4 MB', hash: '待确认' },
          ],
        },
        {
          id: 'hotel-lobby-video', matchState: 'hash-mismatch', title: '酒店大堂全景参考视频', mediaType: '视频',
          originalPath: 'E:\\LocalMiniDramaMedia\\references\\hotel-lobby.mp4', candidatePath: 'F:\\DramaMedia\\references\\hotel-lobby.mp4',
          evidence: '文件存在但 hash 不一致；默认不更新，避免替换为不同内容。', canConfirmUpdate: false,
        },
        {
          id: 'prop-keycard', matchState: 'not-found', title: '道具 · 房卡参考图', mediaType: '图片',
          originalPath: 'E:\\LocalMiniDramaMedia\\props\\keycard.png', candidatePath: null,
          evidence: '新目录中没有可信候选；继续保留离线状态。', canConfirmUpdate: false,
        },
        {
          id: 'external-preview', matchState: 'out-of-boundary', title: '外部导入预览文件', mediaType: '图片',
          originalPath: 'C:\\Users\\Public\\Downloads\\preview.png', candidatePath: 'C:\\Users\\Public\\Downloads\\preview.png',
          evidence: '文件不在受控媒体目录内；必须调整路径配置，当前阻断更新。', canConfirmUpdate: false,
        },
      ],
    };
    const migrationRecords = [
      {
        id: 'migration-v21-20260908', title: 'V2.1 工作区迁移', status: 'completed',
        startedAt: '2026-09-08 22:14', endedAt: '2026-09-08 22:19', sourcePath: 'E:\\LocalMiniDrama', targetPath: 'F:\\DramaWorkspace',
        databaseState: '已迁移并对账', mediaState: '224 / 224 已校验', completedFiles: 224, failedFiles: 0,
        currentTransactionStep: '完成', rollbackState: '保留恢复点', backup: 'backup-v21-20260908.zip',
        actions: [action('open-journal', '查看 journal'), action('view-backup', '查看备份'), action('export-migration-report', '导出迁移报告')],
      },
      {
        id: 'migration-v21-20260910', title: '工作区恢复演练', status: 'failed',
        startedAt: '2026-09-10 09:24', endedAt: null, sourcePath: 'F:\\DramaWorkspace', targetPath: 'G:\\DramaWorkspace',
        databaseState: '事务未提交', mediaState: '217 / 224 已复制', completedFiles: 217, failedFiles: 7,
        currentTransactionStep: '复制媒体 / 第 218 个文件', rollbackState: 'available', backup: 'backup-before-recovery-20260910.zip',
        actions: [
          action('open-journal', '查看 journal'), action('view-backup', '查看备份'),
          action('continue-migration', '继续恢复', 'migration-recovering'), action('rollback-migration', '回滚到迁移前', 'migration-rolling-back'),
          action('open-manual-recovery', '查看人工恢复说明'), action('export-migration-report', '导出迁移报告'),
        ],
      },
    ];
    const cleanup = {
      requiresDryRun: true,
      confirmationPhrase: '永久清理',
      requiresSecondConfirmation: true,
      preventsSilentDeletion: true,
      preview: {
        generatedAt: '今天 15:06', candidateCount: 7, releasableSpace: '640 MB',
        candidates: [
          { id: 'tmp-render-01', path: 'F:\\DramaWorkspace\\tmp\\render-01.mp4', type: '临时视频', size: '420 MB', references: '无', backup: false, controlledDirectory: true, taskUse: '无', reason: '已完成任务的可再生临时输出' },
          { id: 'tmp-thumb-02', path: 'F:\\DramaWorkspace\\tmp\\thumb-02.png', type: '缩略图缓存', size: '220 MB', references: '无', backup: false, controlledDirectory: true, taskUse: '无', reason: '无引用缓存文件' },
        ],
        blocked: [
          { id: 'blocked-reference', path: 'F:\\DramaWorkspace\\media\\shot-03.mp4', type: '视频', size: '82 MB', reason: '仍有引用', affected: '第 1 集 / 镜头 03 / 成片时间线' },
          { id: 'blocked-task', path: 'F:\\DramaWorkspace\\tmp\\h3-job-17.mp4', type: '临时视频', size: '96 MB', reason: '活动任务占用', affected: '任务 h3-job-17 正在运行' },
          { id: 'blocked-boundary', path: 'C:\\Users\\Public\\Downloads\\preview.png', type: '图片', size: '1.2 MB', reason: '路径越界', affected: '不属于受控目录' },
          { id: 'blocked-backup', path: 'F:\\DramaWorkspace\\backups\\backup-v21-20260908.zip', type: '备份', size: '1.7 GB', reason: '首次迁移备份', affected: '需要在项目恢复流程外另行确认' },
        ],
      },
      report: { id: 'cleanup-report-20260910-01', preserved: true, fields: ['已删除数量', '未删除数量', '失败原因', '剩余文件', '释放空间', '报告位置'], path: 'F:\\DramaWorkspace\\reports\\cleanup-20260910-1506.json' },
    };
    const scenarios = {
      default: null,
      'integrity-checking': { kind: 'running', title: '正在进行只读完整性检查', detail: '正在核对数据库、媒体、引用、任务索引和受控目录；不会写入或删除文件。', actions: [] },
      'integrity-success': { kind: 'success', title: '完整性检查已通过', detail: '186 项已核对，没有发现需要写入修复的问题；检查报告已保留。', actions: [action('open-integrity-report', '查看检查报告')] },
      'integrity-warning': { kind: 'warning', title: '发现 2 个需要处理的数据问题', detail: '一个媒体文件离线，一个任务索引等待修复；每项均可单独处理。', actions: [integrityIssues[0].recovery, integrityIssues[1].recovery] },
      'integrity-failed': { kind: 'recoverable-error', title: '完整性检查没有完成', detail: '没有写入或删除任何数据；请检查媒体根目录或稍后再次执行。', actions: [action('retry-integrity-check', '重新检查', 'integrity-checking')] },
      'integrity-partial': { kind: 'warning', title: '完整性检查部分完成', detail: '数据库和引用已核对，离线媒体目录未能读取；结果保留，待恢复目录后可继续。', actions: [action('open-media-relocation', '打开媒体重定位', 'relocation-selecting'), action('retry-integrity-check', '继续检查', 'integrity-checking')] },
      'storage-offline': { kind: 'blocking', title: '媒体根目录当前不可访问', detail: '项目数据库保持只读安全；重新连接磁盘后可执行媒体重定位。', actions: [action('open-media-relocation', '打开媒体重定位', 'relocation-selecting')] },
      'relocation-selecting': { kind: 'info', title: '选择新的媒体根目录', detail: '选择目录不会立刻改写路径；下一步先扫描匹配结果。', actions: [] },
      'relocation-scanning': { kind: 'running', title: '正在扫描媒体匹配', detail: '正在比较相对路径、文件名、大小、hash、媒体类型和项目上下文；当前没有写入。', actions: [] },
      'relocation-preview': { kind: 'info', title: '媒体匹配预览已生成', detail: '唯一匹配可确认；多重匹配、hash 不一致、未找到和路径越界均需保留或人工处理。', actions: [action('review-relocation-items', '查看逐项匹配')] },
      'relocation-ambiguous': { kind: 'warning', title: '3 个媒体需要人工选择', detail: '系统不会猜测多重匹配；未选择项继续保持离线状态。', actions: [action('review-relocation-items', '逐项选择匹配')] },
      'relocation-updating': { kind: 'running', title: '正在确认更新媒体路径', detail: '只更新你在预览中确认的唯一匹配；不会移动、复制或删除文件。', actions: [] },
      'relocation-update-failed': { kind: 'recoverable-error', title: '媒体路径更新失败', detail: '未提交的路径保持原值，已确认结果仍保留在预览中，可修复后重试。', actions: [action('review-relocation-items', '返回匹配预览', 'relocation-preview')] },
      'migration-failed': { kind: 'recoverable-error', title: '上次迁移未完成', detail: '迁移 journal、备份和完成进度均已保留；可继续恢复或回滚到迁移前。', actions: migrationRecords[1].actions.slice(2, 4) },
      'migration-recovering': { kind: 'running', title: '正在继续迁移恢复', detail: '从 journal 的安全检查点继续；数据库和媒体分别核对，期间不会创建新任务。', actions: [] },
      'migration-rolling-back': { kind: 'running', title: '正在回滚到迁移前', detail: '正在按 journal 撤销已迁移步骤；完成前保留备份和人工恢复说明。', actions: [] },
      'migration-rollback-failed': { kind: 'recoverable-error', title: '迁移回滚没有完成', detail: '已完成和未完成步骤都写入 journal；请查看备份或按人工恢复说明继续。', actions: [action('open-journal', '查看 journal'), action('open-manual-recovery', '查看人工恢复说明')] },
      'migration-recovered': { kind: 'success', title: '迁移恢复已完成', detail: '数据库、媒体和任务索引已重新对账；恢复报告已保留。', actions: [action('export-migration-report', '导出迁移报告')] },
      'migration-rolled-back': { kind: 'success', title: '已回滚到迁移前状态', detail: '原工作区继续可用；迁移报告和备份仍保留供追溯。', actions: [action('export-migration-report', '导出回滚报告')] },
      'cleanup-dry-run': { kind: 'info', title: '可清理项预览已生成', detail: '预览没有删除文件；有引用、活动任务、路径越界和首次迁移备份均已排除。', actions: [action('open-cleanup-preview', '查看清单')] },
      'cleanup-empty': { kind: 'success', title: '当前没有可安全清理的文件', detail: '没有删除任何内容；受引用、活动任务和备份保护的文件不会出现在可清理项中。', actions: [action('open-cleanup-preview', '查看排除原因')] },
      'cleanup-blocked': { kind: 'warning', title: '物理清理已阻断', detail: '所选文件仍被引用、任务占用、路径越界或属于首次迁移备份；没有删除任何内容。', actions: [action('open-cleanup-preview', '查看阻断文件')] },
      'cleanup-confirming': { kind: 'warning', title: '请确认永久清理', detail: '将再次显示文件数量和预计释放空间；清理不可恢复，完成后保留报告。', actions: [] },
      'cleanup-running': { kind: 'running', title: '正在执行物理清理', detail: '只处理 dry-run 中已确认且仍符合安全条件的文件；每项结果写入清理报告。', actions: [] },
      'cleanup-partial-success': { kind: 'warning', title: '物理清理部分完成', detail: '已删除与未删除文件均已记录；未删除项保留在受控目录中，可查看原因和报告。', actions: [action('open-cleanup-report', '查看清理报告')] },
      'cleanup-report-failed': { kind: 'recoverable-error', title: '清理报告没有生成', detail: '清理结果仍保存在 journal；未删除文件和失败原因可先查看，随后可重试生成报告。', actions: [action('retry-cleanup-report', '重新生成报告')] },
      'read-only': { kind: 'blocking', title: '当前工作区以只读方式打开', detail: '可以检查、预览和导出报告；路径更新、迁移恢复和物理清理均已禁用。', actions: [{ id: 'open-general-settings', label: '查看工作区状态', target: { routeId: 'settings-general', params: {}, scenarioId: 'default' } }] },
      'active-task-blocking': { kind: 'blocking', title: '存在运行中的本地任务', detail: '迁移和物理清理会影响任务文件，当前被阻断；请等待任务完成或从任务中心处理。', actions: [{ id: 'open-task-center', label: '打开任务中心', target: { routeId: 'tasks', params: {}, scenarioId: 'default' } }] },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown advanced data tools scenario: ${scenarioId}`);
    return {
      scenarioId,
      featureName: '高级数据工具',
      description: '仅在排查本地文件、迁移或空间问题时使用，不参与日常创作。',
      returnTarget: { routeId: 'projects', label: '返回项目列表' },
      scenario: scenarios[scenarioId],
      integrity: {
        readOnly: true,
        scope: ['SQLite 结构与外键', '媒体存在性、大小与 hash', '对象引用与项目/剧集关系', '任务索引', '受控目录边界', '孤儿与重复文件'],
        summary: { normal: 182, warning: 1, error: 1, checkedAt: '今天 15:04' },
        issues: integrityIssues,
        report: { id: 'integrity-report-20260910-01', preserved: true, path: 'F:\\DramaWorkspace\\reports\\integrity-20260910-1504.json' },
      },
      mediaRelocation,
      migration: { records: migrationRecords, journalPreserved: true, reportsExportable: true },
      cleanup,
      tools: [
        { id: 'integrity-check', label: '完整性检查', description: '只读核对数据库、媒体路径、引用和任务索引。', action: '开始检查', mutatesData: false },
        { id: 'media-relocation', label: '媒体重定位', description: '扫描新的媒体根目录；确认匹配结果后才更新路径。', action: '选择新位置', mutatesData: true, requiresPreview: true },
        { id: 'migration-journal', label: '迁移与恢复记录', description: '查看迁移 journal、备份、校验结果及人工恢复说明。', action: '查看记录', mutatesData: false },
        { id: 'physical-cleanup', label: '物理清理', description: '只处理无引用且位于受控目录内的可清理文件。', action: '预览可清理项', mutatesData: true, requiresDryRun: true },
      ],
    };
  }

  function getMediaRelocationConfirmationSummary(relocation, selectedItemIds = []) {
    const selected = new Set(selectedItemIds instanceof Set ? [...selectedItemIds] : [...selectedItemIds]);
    const unique = Number(relocation?.summary?.unique || 0);
    const manual = (relocation?.previewItems || []).filter(item => item.matchState === 'ambiguous' && selected.has(item.id)).length;
    const blocked = Number(relocation?.summary?.hashMismatch || 0) + Number(relocation?.summary?.notFound || 0) + Number(relocation?.summary?.outOfBoundary || 0);
    return { unique, manual, total: unique + manual, blocked };
  }

  function getProjectStageNavigationTarget({ projectId, stage } = {}) {
    if (projectId === undefined || projectId === null || projectId === '') {
      throw new Error('projectId is required');
    }
    const allowedStages = ['script', 'assets', 'storyboard', 'cut'];
    if (!allowedStages.includes(stage)) throw new Error(`Unknown project stage: ${stage}`);
    return {
      routeId: 'project-episodes',
      params: { projectId: String(projectId) },
      scenarioId: 'default',
    };
  }

  function toStageAccess({ canNavigate = true, canGenerateMedia = false, reason = '' } = {}) {
    return {
      navigationAccess: canNavigate ? 'available' : 'unavailable',
      mediaGenerationAccess: canGenerateMedia ? 'available' : 'blocked',
      reason,
    };
  }

  function withEpisodeStageAccess(stages) {
    const scriptApproved = stages.script?.status === 'approved';
    const assetsReady = ['ready', 'ready_for_review', 'snapshot-succeeded'].includes(stages.assets?.status);
    return Object.fromEntries(Object.entries(stages).map(([stageId, stage]) => [stageId, {
      ...stage,
      navigationAccess: stage.access === 'locked' ? 'unavailable' : 'available',
      mediaGenerationAccess: stageId === 'storyboard' && scriptApproved && assetsReady ? 'available' : 'blocked',
    }]));
  }

  function buildProjectEpisodeRows(projectId, { importSucceeded = false } = {}) {
    const projectKey = String(projectId);
    const rows = [
      {
        episodeId: '1', number: 1, title: '无人楼层', estimatedDuration: '约 92 秒', isBlank: false,
        workStatus: 'needs-attention', updatedAt: '2026-09-09T10:42:00+08:00',
        recentStage: 'storyboard', recentPosition: '场次 02 · 分镜 03', nextAction: '继续分镜 03', blockers: 1, hardBlockers: 0,
        resumeLocator: { sceneId: 'scene-02', shotId: 'shot-03', candidateId: 'video-03-b' },
        importSource: {
          kind: 'external-ai-result', schemaVersion: '2.1', filename: 'episode-01.json',
          sha256: '9c3dbe81…4f02', reportId: 'import-report-ep01', packageId: 'pkg_ep01_20260908',
        },
        stages: {
          script: { status: 'approved', label: '已确认', access: 'available' },
          assets: { status: 'ready_for_review', label: '待处理 1', access: 'available', severity: 'soft', reason: '有 1 个音色建议，不阻断继续分镜' },
          storyboard: { status: 'in_progress', label: '7/10 镜', access: 'available' },
          cut: { status: 'not_started', label: '待分镜完成', access: 'locked', requiredStage: 'storyboard', reason: '请先完成并选用全部必需镜头视频' },
        },
      },
      {
        episodeId: '2', number: 2, title: '门后的铃声', estimatedDuration: '约 85 秒', isBlank: false,
        workStatus: 'in-progress', updatedAt: '2026-09-09T11:18:00+08:00',
        recentStage: 'script', recentPosition: '剧本草稿', nextAction: '继续剧本', blockers: 0, hardBlockers: 0,
        resumeLocator: { sceneId: 'scene-01', inspectorSection: 'script-outline' },
        importSource: null,
        stages: {
          script: { status: 'draft', label: '草稿', access: 'available' },
          assets: { status: 'not_started', label: '待剧本确认', access: 'available', reason: '剧本确认后即可准备设定' },
          storyboard: { status: 'not_started', label: '未开始', access: 'available', reason: '可查看结构；生成媒体前需确认剧本和设定' },
          cut: { status: 'not_started', label: '待分镜完成', access: 'locked', requiredStage: 'storyboard', reason: '请先完成分镜与必需镜头视频' },
        },
      },
      {
        episodeId: '3', number: 3, title: '未命名', estimatedDuration: null, isBlank: true,
        workStatus: 'blank', updatedAt: '2026-09-07T16:05:00+08:00',
        recentStage: null, recentPosition: null, nextAction: '开始创作', blockers: 0, hardBlockers: 0,
        resumeLocator: null,
        importSource: null,
        stages: {
          script: { status: 'not_started', label: '开始创作', access: 'available' },
          assets: { status: 'not_started', label: '待剧本确认', access: 'available', reason: '剧本确认后即可准备设定' },
          storyboard: { status: 'not_started', label: '未开始', access: 'available', reason: '可查看结构；生成媒体前需确认剧本和设定' },
          cut: { status: 'not_started', label: '待分镜完成', access: 'locked', requiredStage: 'storyboard', reason: '请先完成分镜与必需镜头视频' },
        },
      },
    ].map(item => ({ ...item, projectId: projectKey }));
    if (importSucceeded) {
      const importedEpisodeId = importSucceeded === true ? '3' : String(importSucceeded);
      const importedEpisodeNumber = Number(importedEpisodeId);
      const existingIndex = rows.findIndex(item => item.episodeId === importedEpisodeId);
      const baseRow = existingIndex >= 0 ? rows[existingIndex] : {
        projectId: projectKey, episodeId: importedEpisodeId, number: importedEpisodeNumber,
        blockers: 0, hardBlockers: 0,
      };
      const importedRow = {
        ...baseRow,
        title: '208 房没有住客', estimatedDuration: '约 92 秒', isBlank: false,
        workStatus: 'in-progress', updatedAt: '2026-09-09T14:31:00+08:00',
        recentStage: 'script', recentPosition: '导入的剧本草稿', nextAction: '检查剧本', highlighted: true,
        resumeLocator: { sceneId: 'scene-01', inspectorSection: 'import-summary' },
        importSource: {
          kind: 'external-ai-result', schemaVersion: '2.1', filename: `外部AI结果-第${importedEpisodeNumber}集.json`,
          sha256: 'a18f90ce…2b77', reportId: `import-report-ep${String(importedEpisodeNumber).padStart(2, '0')}`, packageId: `pkg_ep${String(importedEpisodeNumber).padStart(2, '0')}_20260909`,
        },
        stages: {
          script: { status: 'draft', label: '待检查', access: 'available' },
          assets: { status: 'imported_draft', label: '待检查', access: 'available' },
          storyboard: { status: 'imported_draft', label: '已导入草稿', access: 'available', reason: '可查看结构；生成媒体前仍需确认剧本和设定' },
          cut: { status: 'not_started', label: '未解锁', access: 'locked', requiredStage: 'storyboard', reason: '请先完成分镜与必需镜头视频' },
        },
      };
      if (existingIndex >= 0) rows[existingIndex] = importedRow;
      else rows.push(importedRow);
    }
    return rows.map(item => ({ ...item, stages: withEpisodeStageAccess(item.stages) }));
  }

  function getEpisodeCreationEntryModel(projectId) {
    const projectKey = String(projectId);
    return {
      projectId: projectKey,
      primary: {
        id: 'new-episode', label: '新建剧集', description: '创建空白草稿并直接进入剧本页，之后再选择粘贴、AI 或手写。',
        target: { routeId: 'studio-script', params: { projectId: projectKey, episodeId: 'new' }, scenarioId: 'blocked' },
      },
      secondary: {
        label: '导入 / 协作',
        items: [
          { id: 'package-import', label: '导入制作包', description: '五步预览 LocalMiniDrama 或外部制作包，只写入结构化草稿。', flowId: 'episode_json' },
          { id: 'external-ai', label: '外部 AI 制作', description: '生成任务包，等待外部 AI 完成后把结果 JSON 回流为草稿。', routeId: 'external-ai-wizard', params: { projectId: projectKey } },
          { id: 'novel-split', label: '小说 / 长文本拆集', description: '预览章节与拆集建议后批量创建剧本草稿。', flowId: 'novel' },
          { id: 'source-video', label: '从已有视频开始剪辑', description: '登记来源视频并进入成片时间线，不触发生成。', flowId: 'source_video' },
        ],
      },
    };
  }

  function getExternalAiWizardModel(projectId, state = {}) {
    const projectKey = String(projectId);
    const stepLabels = {
      'target': '选择目标',
      'compiled-context': '自动汇总上下文',
      'task-note': '补充本次要求',
      'package-preview': '预览并创建任务包',
      'waiting-result': '等待外部结果',
      'result-file': '选择结果 JSON',
      'import-preview': '预览导入',
      'imported-draft': '已导入草稿',
    };
    const stepOrder = Object.keys(stepLabels);
    const step = stepOrder.includes(state.step) ? state.step : 'target';
    const targetSelector = getEpisodeTargetSelectorModel(projectKey, 'external_ai');
    const context = getExternalAiContextModel(projectKey);
    const task = getExternalAiCollaborationTaskModel(projectKey, state.taskStatus || 'waiting', {
      targetMode: state.targetMode || 'create_new',
      targetEpisodeId: state.targetEpisodeId || '',
    });
    return {
      projectId: projectKey,
      featureName: '外部 AI 制作',
      presentation: 'page',
      resumable: true,
      stepOrder,
      stepLabels,
      currentStep: step,
      target: {
        selector: targetSelector,
        selectedMode: state.targetMode || 'create_new',
        selectedEpisodeId: state.targetEpisodeId || '',
        protection: '非空剧集永不可写入；只能创建下一集或填充空白剧集。',
      },
      context: {
        title: context.title,
        summary: context.summary,
        includedSources: context.includedSources,
        note: context.note,
        compiled: true,
        readOnly: true,
        editableFields: [
          { id: 'task-note', label: '给外部 AI 的补充说明', value: state.taskNote || '', placeholder: '本次任务的特别要求、本集必须保持或不能改变的设定。' },
        ],
      },
      package: {
        packageId: task.packageId,
        packageName: task.packageName,
        assetsDigest: task.assetsDigest,
        schemaVersion: task.schemaVersion,
        downloadFormats: ['任务包.zip', '单文件任务.json'],
        outputActions: [
          { id: 'download-package', label: '下载任务包' },
          { id: 'copy-prompt', label: '复制任务说明' },
          { id: 'copy-context', label: '复制完整上下文' },
          { id: 'open-task-directory', label: '打开任务目录' },
        ],
      },
      waitingTask: task,
      resultFile: {
        acceptedSchema: task.schemaVersion,
        requiredChecks: [
          { id: 'schema', label: 'Schema 协议版本' },
          { id: 'package_id', label: '任务包 ID 匹配' },
          { id: 'project_id', label: '目标项目匹配' },
          { id: 'episode_id', label: '目标剧集匹配' },
          { id: 'assets_digest', label: '素材快照摘要匹配' },
          { id: 'context_revision', label: '上下文版本匹配' },
          { id: 'asset-mapping', label: '人物、场景、道具映射完整' },
          { id: 'nonempty-target', label: '目标仍为空白剧集' },
        ],
      },
      importPreview: {
        usesUnifiedFiveStepWizard: true,
        steps: ['剧本场次', '素材映射', '分镜与时段', '写入摘要'],
      },
      importResult: {
        writesApprovedScript: false,
        createsMediaTasks: false,
        writesDraftOnly: true,
        opensRoute: { routeId: 'studio-script', params: { projectId: projectKey, episodeId: task.target.episodeId || String(task.target.episodeNumber) }, scenarioId: 'blocked' },
      },
    };
  }

  function buildEpisodeCreationSources() {
    return [
      { id: 'blank', title: '空白手工', description: '创建空白剧集并进入剧本编辑，不调用 AI。', destination: 'studio-script' },
      { id: 'ai', title: '想法 / 剧本 AI', description: '输入想法或初稿，生成可审阅的剧本草稿。', destination: 'script-review' },
      { id: 'novel', title: '小说 / 长文本', description: '预览分章、集数和编号冲突后批量创建草稿。', destination: 'episode-list' },
      { id: 'external_ai', title: '外部 AI 协作', description: '生成上下文和任务包，等待同一任务的结果 JSON 回流。', destination: 'waiting-external' },
      { id: 'episode_json', title: '直接 V2.1 JSON', description: '进入五步预览，只导入结构化草稿。', destination: 'import-wizard' },
      { id: 'source_video', title: '已有视频', description: '登记来源媒体并进入短片时间线，不触发生成。', destination: 'studio-cut' },
    ];
  }

  function getEpisodeCreationSourceGroups() {
    return {
      primary: [
        { id: 'script-import', icon: '文', label: '我有剧本', description: '粘贴文本或导入文件，预览后创建可编辑草稿。' },
        { id: 'ai-script', icon: 'AI', label: '让 AI 帮我写', description: '从故事想法生成可审阅、可修改的剧本草稿。' },
        {
          id: 'package-import', icon: '包', label: '我有制作包', description: '导入 LocalMiniDrama 或外部 AI 返回的制作包。',
          secondaryAction: { id: 'start-external-ai-collaboration', label: '创建外部 AI 协作任务' },
        },
      ],
      more: [
        { id: 'blank', icon: '空', label: '空白创建', description: '创建新的空白剧集，或填充已有空白集。' },
        { id: 'novel-split', icon: '章', label: '小说智能拆集', description: '预览拆集结果后批量建立草稿。' },
        { id: 'source-video', icon: '影', label: '从已有视频开始剪辑', description: '登记来源视频并进入成片时间线。' },
      ],
    };
  }

  function getEpisodeTargetSelectorModel(projectId, sourceId, {
    focusEpisodeId = '', creationContext = 'existing-project',
  } = {}) {
    const projectKey = String(projectId);
    if (creationContext === 'new-project' || projectKey === 'new-project') {
      return {
        projectId: projectKey,
        sourceId,
        creationContext: 'new-project',
        nextEpisodeNumber: 1,
        targets: [{ id: 'create_new:1', mode: 'create_new', episodeNumber: 1, label: '创建第 1 集', allowed: true }],
        selectedTargetId: 'create_new:1',
        nonEmptyTargetsExcluded: true,
      };
    }
    const rows = buildProjectEpisodeRows(projectKey);
    const nextEpisodeNumber = 9;
    const blankRows = rows.filter(item => item.isBlank);
    const targets = [
      { id: `create_new:${nextEpisodeNumber}`, mode: 'create_new', episodeNumber: nextEpisodeNumber, label: `创建第 ${nextEpisodeNumber} 集`, allowed: true },
      ...blankRows.map(item => ({
        id: `fill_blank:${item.episodeId}`,
        mode: 'fill_blank',
        episodeId: item.episodeId,
        episodeNumber: item.number,
        label: `填充空白第 ${item.number} 集`,
        allowed: true,
      })),
    ];
    const focusedTarget = targets.find(item => item.mode === 'fill_blank' && item.episodeId === String(focusEpisodeId));
    return {
      projectId: projectKey,
      sourceId,
      creationContext,
      nextEpisodeNumber,
      targets,
      selectedTargetId: focusedTarget?.id || targets[0].id,
      nonEmptyTargetsExcluded: true,
    };
  }

  function getEpisodeCreationSourceTarget(sourceId, {
    projectId = '7', episodeId = 'new', projectShellCreated = false,
  } = {}) {
    if (!projectShellCreated) return { action: 'create-project-shell', sourceId };
    const targets = {
      'script-import': { action: 'open-script-import', routeId: 'studio-script' },
      'package-import': { action: 'open-package-import', routeId: 'project-episodes' },
      blank: { action: 'open-blank-script', routeId: 'studio-script' },
      'ai-script': { action: 'open-ai-script', routeId: 'project-episodes' },
      'novel-split': { action: 'open-novel-split', routeId: 'project-episodes' },
      'source-video': { action: 'open-source-video', routeId: 'studio-cut' },
    };
    const target = targets[sourceId];
    if (!target) throw new Error(`Unknown episode creation source target: ${sourceId}`);
    return {
      ...target,
      sourceId,
      params: { projectId: String(projectId), episodeId: String(episodeId) },
    };
  }

  function getEpisodeCreationFlow(sourceId, { creationContext = 'existing-project' } = {}) {
    const common = { sourceId, createsPaidMediaTasks: false, requiresEpisodeTarget: true };
    const flows = {
      blank: {
        ...common,
        title: '空白手工',
        steps: ['选择创建新剧集或填充空白剧集', '填写集号和可选标题', '创建空白草稿', '进入剧本'],
        destination: 'studio-script',
      },
      ai: {
        ...common,
        title: '想法 / 剧本 AI',
        steps: ['输入想法或粘贴初稿', '确认模型、费用与生成范围', '生成剧本草稿', '人工审阅并保存'],
        resultPolicy: 'draft-only-no-auto-parse-or-approve',
        estimatedCost: '约 ¥0.12–0.35',
      },
      novel: {
        ...common,
        title: '小说 / 长文本',
        steps: ['选择文件或粘贴文本', '预览章节与拆集建议', '处理集号冲突', '批量创建剧本草稿'],
        resultPolicy: 'draft-episodes-only',
      },
      external_ai: {
        ...common,
        title: '外部 AI 协作',
        steps: ['生成创作上下文', '创建本集任务包', '前往外部 AI 协作', '选择结果 JSON', '五步预览并导入'],
        package: {
          packageId: 'pkg_ep03_20260909',
          assetsDigest: '4f92c881…0a7d',
          downloadFormats: ['任务包.zip', '单文件任务.json'],
          sameProtocol: true,
          copyActions: ['复制任务说明', '复制创作上下文'],
        },
        resultImport: {
          reusesPackageAttempt: true,
          targetModes: ['create_new', 'fill_blank'],
          usesUnifiedFiveStepWizard: true,
        },
      },
      episode_json: {
        ...common,
        title: '直接 V2.1 JSON',
        steps: ['目标与文件', '剧本与场次', '资产匹配', '分镜与时段', '确认写入'],
        acceptedSchemas: ['local-mini-drama.episode-package@2.1', 'local-mini-drama.external-ai-result@2.1'],
        targetModes: ['create_new', 'fill_blank'],
      },
      source_video: {
        ...common,
        title: '已有视频',
        steps: ['选择本地视频', '读取媒体信息', '创建新剧集或填充空白剧集', '登记来源媒体', '进入短片时间线'],
        preservesOriginalMedia: true,
        destination: 'studio-cut',
      },
    };
    const flow = flows[sourceId];
    if (!flow) throw new Error(`Unknown episode creation source: ${sourceId}`);
    const result = JSON.parse(JSON.stringify(flow));
    if (creationContext === 'new-project') {
      result.creationContext = creationContext;
      result.defaultEpisodeNumber = 1;
      result.targetOptions = [{ id: 'create_new', label: '创建第 1 集' }];
      if (sourceId === 'blank') result.steps[0] = '确认第 1 集标题';
    }
    return result;
  }

  function getExternalAiCollaborationTaskModel(projectId, status = 'waiting', {
    targetMode = 'create_new', targetEpisodeId = '',
  } = {}) {
    const targetSelector = getEpisodeTargetSelectorModel(projectId, 'external_ai');
    const target = targetMode === 'fill_blank'
      ? targetSelector.targets.find(item => item.mode === 'fill_blank' && (!targetEpisodeId || item.episodeId === String(targetEpisodeId)))
      : targetSelector.targets.find(item => item.mode === 'create_new');
    if (!target) throw new Error('External AI target is unavailable');
    const packageSuffix = String(target.episodeNumber).padStart(2, '0');
    const statusMap = {
      waiting: { label: '等待外部 AI 结果', lifecycle: 'waiting_external' },
      validating: { label: '正在校验返回结果', lifecycle: 'validating_result' },
      mismatch: { label: '返回结果与任务不匹配', lifecycle: 'blocked' },
      cancelled: { label: '协作任务已取消', lifecycle: 'cancelled' },
    };
    if (!statusMap[status]) throw new Error(`Unknown external AI task status: ${status}`);
    return {
      taskId: `external-ai-pkg-ep${packageSuffix}`,
      projectId: String(projectId),
      status,
      creatorStatus: statusMap[status].label,
      lifecycle: statusMap[status].lifecycle,
      target,
      packageId: `pkg_ep${packageSuffix}_20260909`,
      packageName: `外部AI任务-第${target.episodeNumber}集.zip`,
      createdAt: '2026-09-09T14:26:00+08:00',
      contextRevision: 'project-context-r18',
      assetSnapshotVersion: 'project-assets-v12',
      assetsDigest: '4f92c881…0a7d',
      schemaVersion: 'local-mini-drama.external-ai-result@2.1',
      persisted: true,
      visibleInTaskCenter: true,
      resultMatch: {
        required: [
          { id: 'package_id', label: '任务包', status: status === 'mismatch' ? 'mismatch' : 'matched' },
          { id: 'assets_digest', label: '素材快照', status: 'matched' },
          { id: 'schema', label: '协议版本', status: 'matched' },
          { id: 'project', label: '目标项目', status: 'matched' },
          { id: 'episode', label: '目标剧集', status: 'matched' },
          { id: 'context_revision', label: '上下文版本', status: 'matched' },
        ],
      },
      actions: [
        { id: 'select-result', label: '选择结果' },
        { id: 'download-package', label: '重新下载' },
        { id: 'copy-prompt', label: '复制任务说明' },
        { id: 'cancel-attempt', label: '取消任务' },
      ],
    };
  }

  function getEpisodePackageImportModel(step = 1, {
    targetMode = 'create_new',
    assetConflictResolved = false,
    assetDecisions = {},
    protocol = 'episode-package',
    creationContext = 'existing-project',
  } = {}) {
    const stepNames = ['目标与文件', '剧本与场次', '资产匹配', '分镜与时段', '确认写入'];
    if (!Number.isInteger(step) || step < 1 || step > stepNames.length) {
      throw new Error(`Unknown episode package import step: ${step}`);
    }
    const targetEpisodeNumber = creationContext === 'new-project' ? 1 : targetMode === 'fill_blank' ? 3 : 9;
    const base = {
      step,
      stepTitle: stepNames[step - 1],
      stepNames,
      protocol,
      targetMode: creationContext === 'new-project' ? 'create_new' : targetMode,
      targetEpisodeNumber,
      creationContext,
      allowedTargetModes: creationContext === 'new-project' ? ['create_new'] : ['create_new', 'fill_blank'],
      cancelLabel: creationContext === 'new-project' ? '取消首集创建' : '返回来源',
      disallowedTargetModes: ['merge', 'overwrite', 'append'],
      file: {
        name: protocol === 'external-ai-result'
          ? `外部AI结果-第${creationContext === 'new-project' ? '1' : '3'}集.json`
          : `episode-${creationContext === 'new-project' ? '01' : '03'}.json`,
        schema: protocol === 'external-ai-result' ? 'local-mini-drama.external-ai-result' : 'local-mini-drama.episode-package',
        version: '2.1',
        sha256: 'a18f90ce…2b77',
        status: 'validated',
      },
      canAdvance: true,
    };
    if (step === 1) return {
      ...base,
      targets: creationContext === 'new-project'
        ? [{ id: 'create_new', label: '创建第 1 集', allowed: true }]
        : [
          { id: 'create_new', label: '创建第 9 集', allowed: true },
          { id: 'fill_blank', label: '填充空白第 3 集', allowed: true },
          { id: 'episode-1', label: '第 1 集 · 非空', allowed: false, code: 'TARGET_NOT_BLANK' },
        ],
    };
    if (step === 2) return {
      ...base,
      episodeSummary: {
        number: targetEpisodeNumber,
        title: '208 房没有住客',
        synopsisLength: 286,
        scriptLength: 1842,
        synopsisPreview: '林夏在空置的 208 房外听见客房服务铃声，监控却显示走廊始终无人。',
      },
      scriptPreview: {
        paragraphs: [
          '内景 · 13 层走廊 · 深夜。应急灯反复闪烁，林夏停在 208 房门前。',
          '门内传来餐车轮子滚动的声音。她低头看向手里的万能门卡。',
          '林夏：前台记录显示，这间房已经空了三个月。',
        ],
        canOpenFullScript: true,
      },
      storyScenes: ['酒店外景', '酒店走廊', '208 门口', '前台'],
      contentIssues: [
        { id: 'long-dialogue', severity: 'warning', label: '第 3 场有一段对白较长，可在导入后调整' },
      ],
      projectLookOverridable: false,
    };
    if (step === 3) {
      const normalizedDecisions = assetConflictResolved
        ? { 'scene-room-208': 'create', 'prop-note': 'create', ...assetDecisions }
        : { ...assetDecisions };
      const decisionOptions = {
        required: [
          { id: 'reuse', label: '复用现有素材' },
          { id: 'create', label: '新建项目素材' },
        ],
        optional: [
          { id: 'reuse', label: '复用现有素材' },
          { id: 'create', label: '新建项目素材' },
          { id: 'skip', label: '本次不导入' },
        ],
      };
      const choose = (id, options) => {
        const value = normalizedDecisions[id];
        if (typeof value !== 'string') return null;
        if (value.startsWith('reuse:')) return {
          type: 'reuse',
          assetVersionId: value.slice('reuse:'.length),
          mediaVersionId: 'media-current',
        };
        if (options.some(item => item.id === value)) return value === 'reuse'
          ? { type: 'reuse', assetVersionId: 'scene-208:v4:night', mediaVersionId: 'media-v7' }
          : { type: value };
        return null;
      };
      const matches = [
        { id: 'character-linxia', type: '人物状态', source: '林夏 / 夜班状态', result: 'source_key 精确匹配', decision: { type: 'reuse', assetVersionId: 'character-linxia:v6:night-shift', mediaVersionId: 'media-v12' }, requiresDecision: false },
        { id: 'character-stranger', type: '人物', source: '陌生住客', result: '项目中不存在', decision: { type: 'create' }, requiresDecision: false },
        { id: 'scene-room-208', type: '场景资产', source: '208 房门口', result: '仅名称相似', required: true, requiresDecision: true, availableDecisions: decisionOptions.required, reuseOptions: [{ assetVersionId: 'scene-208:v4:night', label: '208 房 · 夜间 v4', mediaVersionId: 'media-v7' }, { assetVersionId: 'scene-208:v3:normal', label: '208 房 · 常态 v3', mediaVersionId: 'media-v5' }], decision: choose('scene-room-208', decisionOptions.required) },
        { id: 'prop-note', type: '道具', source: '匿名便签', result: '本集未引用，可选导入', required: false, requiresDecision: true, availableDecisions: decisionOptions.optional, decision: choose('prop-note', decisionOptions.optional) },
      ];
      const unresolvedConflicts = matches.filter(item => item.requiresDecision && !item.decision).length;
      return {
        ...base,
        unresolvedConflicts,
        canAdvance: unresolvedConflicts === 0,
        matches,
      };
    }
    if (step === 4) return {
      ...base,
      structure: { storySceneCount: 4, shotCount: 10, segmentCount: 14, plannedDuration: '92s' },
      validation: [
        { id: 'scene-ownership', level: 'passed', label: '结构检查', detail: '分镜均归属明确场次' },
        { id: 'timeline-continuity', level: 'passed', label: '结构检查', detail: '时段连续闭合' },
        { id: 'references', level: 'passed', label: '引用检查', detail: '引用均可解析' },
        { id: 'provider-duration', level: 'info', label: '生成前校验', detail: '请求时长、引用数量和格式在提交具体 Provider 前校验' },
      ],
    };
    return {
      ...base,
      transactional: true,
      remoteGenerationCost: 0,
      createdMediaTasks: [],
      summary: { characters: 2, scenes: 4, props: 3, shots: 10, segments: 14 },
      writeSummary: { createdCharacters: 1, reusedAssets: 1, createdAssets: 5, skippedObjects: 1, externalMedia: 0 },
      successActions: ['view-report', 'open-script', 'open-assets', 'open-storyboard'],
    };
  }

  function getEpisodeNavigationTarget({ projectId, episodeId, action = 'resume', stage } = {}) {
    const projectKey = String(projectId);
    const episodeKey = String(episodeId);
    const row = buildProjectEpisodeRows(projectKey).find(item => item.episodeId === episodeKey);
    if (!row) throw new Error(`Unknown episode: ${episodeKey}`);
    if (action === 'resume') {
      if (row.isBlank) return {
        routeId: 'studio-script',
        params: { projectId: projectKey, episodeId: episodeKey },
        scenarioId: 'blocked',
      };
      return {
        routeId: `studio-${row.recentStage}`,
        params: { projectId: projectKey, episodeId: episodeKey, ...(row.resumeLocator || {}) },
        scenarioId: 'default',
      };
    }
    if (action === 'stage') {
      if (!['script', 'assets', 'storyboard', 'cut'].includes(stage)) throw new Error(`Unknown episode stage: ${stage}`);
      const stageState = row.stages[stage];
      if (stageState.access === 'locked') return {
        blocked: true,
        routeId: 'project-episodes',
        params: { projectId: projectKey, focusId: episodeKey, workspaceTab: stageState.requiredStage || 'script' },
        scenarioId: 'gate-blocked',
        reason: stageState.reason,
      };
      return {
        routeId: `studio-${stage}`,
        params: { projectId: projectKey, episodeId: episodeKey },
        scenarioId: 'default',
      };
    }
    throw new Error(`Unknown episode navigation action: ${action}`);
  }

  function getProjectEpisodesModel(projectId, scenarioId = 'default', { resultEpisodeId = '3' } = {}) {
    const projectKey = String(projectId);
    const overview = getProjectOverviewModel(projectKey, 'default');
    const rows = projectKey === 'new-project' ? [] : buildProjectEpisodeRows(projectKey, { importSucceeded: scenarioId === 'import-succeeded' ? resultEpisodeId : false });
    const activeStatusFilter = scenarioId.startsWith('filter-status-') ? scenarioId.slice('filter-status-'.length) : null;
    const routeScenarios = buildPrototypeRouteRegistry().find(item => item.id === 'project-episodes').scenarios;
    if (!routeScenarios.includes(scenarioId)) throw new Error(`Unknown project episodes scenario: ${scenarioId}`);
    const scenarios = {
      default: null,
      empty: { kind: 'info', title: '还没有剧集', detail: '点击“新建剧集”创建第 1 集；项目本身不会因此自动调用 AI。', actions: [{ id: 'create-episode', label: '新建剧集' }] },
      loading: { kind: 'loading', title: '正在读取剧集', detail: '项目和当前筛选条件保持不变。', actions: [] },
      'load-failed': { kind: 'recoverable-error', title: '剧集加载失败', detail: '项目数据未改变，可重新读取本页。', actions: [{ id: 'retry-load', label: '重新加载' }] },
      'storage-offline': { kind: 'blocking', title: '部分来源媒体已离线', detail: '剧集结构仍可查看；使用来源视频前需要重新定位文件。', actions: [{ id: 'relocate-media', label: '重新定位媒体' }] },
      'source-picker': { kind: 'info', title: '新建或导入剧集', detail: '普通写作点击“新建剧集”；制作包和协作流程在“导入 / 协作”中。', actions: [{ id: 'open-sources', label: '打开导入 / 协作' }] },
      'blank-manual': { kind: 'success', title: '空白剧集已创建', detail: '未调用 AI，可直接编辑剧本。', actions: [{ id: 'open-script', label: '进入剧本' }] },
      'ai-script': { kind: 'info', title: 'AI 剧本草稿准备中', detail: '完成后仍需人工审阅，不自动解析资产或确认剧本。', actions: [{ id: 'open-task', label: '查看任务' }] },
      'ai-script-partial': { kind: 'warning', title: '3 集草稿已完成 2 集', detail: '成功草稿已经保留；失败的第 11 集可以单独重试。', actions: [{ id: 'retry-failed-draft', label: '重试第 11 集' }, { id: 'open-created-drafts', label: '查看已完成草稿' }] },
      'novel-split': { kind: 'info', title: '小说拆集预览', detail: '确认章节、目标集数和编号冲突后才批量创建草稿。', actions: [{ id: 'review-split', label: '查看拆集结果' }] },
      'external-ai-context': { kind: 'info', title: '外部 AI 创作上下文已准备', detail: '可复制上下文或继续创建本集任务包。', actions: [{ id: 'create-package', label: '创建任务包' }] },
      'external-ai-waiting': { kind: 'warning', title: '等待外部 AI 结果', detail: '目标：创建第 9 集 · 任务包 pkg_ep09_20260909 · 创建于今天 14:26。可安全离开并从任务中心恢复。', actions: [{ id: 'select-result', label: '选择结果 JSON' }, { id: 'download-package', label: '重新下载任务包' }, { id: 'copy-prompt', label: '复制任务说明' }, { id: 'cancel-attempt', label: '取消任务' }] },
      'episode-json-import': { kind: 'info', title: '单集制作包导入', detail: '先选文件与目标，再进行五步预览；当前没有写入。', actions: [{ id: 'start-import', label: '选择文件' }] },
      'source-video': { kind: 'info', title: '从已有视频开始剪辑', detail: '只登记来源媒体并进入成片时间线，不创建远端生成任务。', actions: [{ id: 'select-video', label: '选择视频文件' }] },
      'json-target-not-blank': { kind: 'blocking', title: '不能导入到非空剧集', detail: '目标已有剧本、分镜或媒体，未写入任何数据。', actions: [{ id: 'choose-blank', label: '选择空白剧集' }, { id: 'create-new', label: '创建新剧集' }, { id: 'cancel', label: '取消' }] },
      'asset-match-conflict': { kind: 'blocking', title: '还有 1 个资产匹配冲突', detail: '同名不是同一资产；必须明确复用、新建或取消。', actions: [{ id: 'resolve-match', label: '处理冲突' }, { id: 'back-file', label: '返回选择文件' }] },
      'import-failed': { kind: 'recoverable-error', title: '导入事务已回滚', detail: '项目没有部份写入；文件、目标和匹配决策均已保留。', actions: [{ id: 'retry-import', label: '按原预览重试' }, { id: 'choose-file', label: '重新选择文件' }] },
      'import-succeeded': { kind: 'success', title: `第 ${resultEpisodeId} 集已导入为结构化草稿`, detail: '没有自动确认阶段，也没有创建图片、视频或音频任务。', resultEpisodeId: String(resultEpisodeId), actions: [{ id: 'view-report', label: '查看报告', episodeId: String(resultEpisodeId) }, { id: 'open-script', label: '检查剧本', episodeId: String(resultEpisodeId) }, { id: 'open-assets', label: '检查设定', episodeId: String(resultEpisodeId) }, { id: 'open-storyboard', label: '查看导入分镜', episodeId: String(resultEpisodeId) }] },
      'gate-blocked': { kind: 'blocking', title: '该阶段尚未解锁', detail: '请先完成当前剧集的前置步骤；不会跳转到其他剧集。', actions: [{ id: 'open-required-stage', label: '处理前置步骤' }] },
      'filter-status-needs-attention': null,
      'filter-status-in-progress': null,
      'filter-status-completed': null,
    };
    let visibleRows = scenarioId === 'empty' ? [] : rows;
    if (activeStatusFilter) visibleRows = rows.filter(item => item.workStatus === activeStatusFilter);
    const emptyState = scenarioId === 'empty'
      ? { kind: 'project-empty', title: '还没有剧集', detail: '点击“新建剧集”创建第 1 集。', action: { id: 'create-episode', label: '新建剧集' } }
      : visibleRows.length === 0
        ? { kind: 'filter-empty', title: '当前条件下没有剧集', detail: '清除筛选或切换条件后继续。', action: { id: 'clear-filters', label: '清除筛选' } }
        : null;
    const stats = (scenarioId === 'empty' || projectKey === 'new-project')
      ? { total: 0, active: 0, needsAttention: 0, completed: 0 }
      : { total: 8, active: 2, needsAttention: 1, completed: 2 };
    return {
      projectId: projectKey,
      scenarioId,
      title: overview.title,
      description: overview.description,
      metadata: [...overview.metadata],
      header: { mode: 'compact', descriptionLines: 1, backLabel: '返回项目列表' },
      stats,
      search: { debounceMs: 280, fields: ['number', 'title', 'recentPosition'] },
      defaultSort: 'number-asc',
      statusFilters: [
        { id: 'all', label: '全部' },
        { id: 'needs-attention', label: '需要处理' },
        { id: 'in-progress', label: '制作中' },
        { id: 'completed', label: '已完成' },
      ],
      activeStatusFilter,
      rows,
      visibleRows,
      emptyState,
      externalCollaborationTasks: scenarioId === 'external-ai-waiting' ? [getExternalAiCollaborationTaskModel(projectKey, 'waiting')] : [],
      creationEntry: getEpisodeCreationEntryModel(projectKey),
      creationSources: buildEpisodeCreationSources(),
      managementActions: [
        { id: 'rename', label: '重命名' },
        { id: 'reorder', label: '调整集序' },
        { id: 'view-source', label: '查看导入来源' },
        { id: 'delete', label: '删除剧集', recoverable: true },
      ],
      scenario: scenarios[scenarioId],
    };
  }

  function getEpisodeSourceAuditModel(projectId, episodeId, sectionId = 'raw') {
    const episodeKey = String(episodeId);
    let row = buildProjectEpisodeRows(projectId).find(item => item.episodeId === episodeKey);
    if ((!row || !row.importSource) && ['3', '9'].includes(episodeKey)) {
      row = buildProjectEpisodeRows(projectId, { importSucceeded: episodeKey }).find(item => item.episodeId === episodeKey);
    }
    if (!row) throw new Error(`Unknown episode: ${episodeId}`);
    if (!row.importSource) throw new Error(`Episode has no import source: ${episodeId}`);
    const source = row.importSource;
    const sections = [
      {
        id: 'raw',
        label: '原始 JSON',
        description: '导入时收到的不可变原文，用于复核外部 AI 实际返回了什么。',
        entries: [
          { label: 'schema', value: 'local-mini-drama.external-ai-result@2.1' },
          { label: 'source_key', value: `episode-${String(row.number).padStart(2, '0')}-external-ai` },
          { label: '内容摘要', value: '1 集、4 个叙事场次、10 个分镜、14 个时段' },
        ],
      },
      {
        id: 'normalized',
        label: '规范化结果',
        description: '按确定性适配规则转换为内部 Episode Package 2.1 后的只读快照。',
        entries: [
          { label: '适配器', value: 'external-ai-result@2.1 → episode-package@2.1' },
          { label: '目标', value: `${row.number === 3 ? '填充空白' : '创建'}第 ${row.number} 集结构化草稿` },
          { label: '保留对象', value: '剧本、场次、人物状态、场景、道具、分镜和时段' },
        ],
      },
      {
        id: 'matches',
        label: '资产匹配决策',
        description: '记录导入时已经确认的复用、新建和独立资产决策，不随资产改名而重算。',
        entries: [
          { label: '林夏 / 夜班状态', value: '按 source_key 复用现有人物状态' },
          { label: '陌生住客', value: '新建人物资产' },
          { label: '208 房门口', value: '名称相似但不自动合并；新建独立场景' },
        ],
      },
      {
        id: 'report',
        label: '导入报告',
        description: '展示校验、事务写入量、警告和最终结果；报告本身不可编辑。',
        entries: [
          { label: '报告编号', value: source.reportId },
          { label: '校验结果', value: 'Schema、引用、时码与目标空白检查全部通过' },
          { label: '事务结果', value: '结构化草稿写入成功；媒体任务 0；远端费用 ¥0' },
        ],
      },
    ];
    const activeSection = sections.find(item => item.id === sectionId);
    if (!activeSection) throw new Error(`Unknown episode source audit section: ${sectionId}`);
    return {
      projectId: String(projectId),
      episodeId: row.episodeId,
      episodeNumber: row.number,
      filename: source.filename,
      schemaVersion: source.schemaVersion,
      packageId: source.packageId,
      sha256: source.sha256,
      reportId: source.reportId,
      readOnly: true,
      immutable: true,
      sections,
      activeSection,
    };
  }

  function getProjectOverviewModel(projectId, scenarioId = 'default') {
    const projectKey = String(projectId);
    const projects = {
      'new-project': {
        title: '午夜前台',
        description: '项目已保存，尚未创建第 1 集。',
        metadata: ['9:16', '0 集', '刚刚创建'],
        sections: {
          resumePosition: null,
          primaryAction: {
            kind: 'create-first-episode', label: '创建第 1 集', detail: '选择剧本、AI、制作包或其他开始方式', enabled: true,
            target: { routeId: 'project-episodes', params: { projectId: 'new-project' }, scenarioId: 'source-picker' },
          },
          stages: [
            { id: 'script', label: '剧本', state: '未开始', summary: '0 集', tone: 'muted', unit: 'episode', total: 0 },
            { id: 'assets', label: '设定', state: '未开始', summary: '0 集', tone: 'muted', unit: 'episode', total: 0 },
            { id: 'storyboard', label: '分镜', state: '未开始', summary: '0 集', tone: 'muted', unit: 'episode', total: 0 },
            { id: 'cut', label: '成片', state: '未开始', summary: '0 集', tone: 'muted', unit: 'episode', total: 0 },
          ],
          projectLook: {
            name: '尚未设置画面风格', version: 0, status: '可稍后设置', aspectRatio: '9:16', usage: '0 个分镜引用',
            source: '项目默认', visualIntent: [], impact: '尚无生产对象', versionHistory: [],
            action: { label: '设置画面风格', type: 'open-modal' },
          },
          blockers: [],
        },
      },
      '7': {
        title: '凌晨两点的客房服务',
        description: '一名夜班前台在不存在住客的楼层不断收到客房服务请求。',
        metadata: ['都市悬疑', '16:9', '8 集', '最近编辑：刚刚'],
        sections: {
          resumePosition: {
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
          },
          primaryAction: {
            kind: 'resume', label: '继续分镜 03', detail: '第 1 集《无人楼层》· 场次 02 · 分镜 03', enabled: true,
          },
          stages: [
            { id: 'script', label: '剧本', state: '3 集已确认', summary: '2 集制作中 · 3 集未开始', tone: 'ok', unit: 'episode', total: 8 },
            { id: 'assets', label: '设定', state: '1 集需处理', summary: '1 集就绪 · 6 集未开始', tone: 'warn', unit: 'episode', total: 8 },
            { id: 'storyboard', label: '分镜', state: '1 集制作中', summary: '7 集未开始', tone: 'active', unit: 'episode', total: 8 },
            { id: 'cut', label: '成片', state: '尚无成片', summary: '8 集未开始', tone: 'muted', unit: 'episode', total: 8 },
          ],
          projectLook: {
            name: '都市悬疑 · 冷暖对撞',
            version: 4,
            status: '当前风格版本',
            aspectRatio: '16:9',
            usage: '10 个分镜引用',
            source: '自定义 · 基于电影写实预设',
            visualIntent: ['电影写实', '冷灰主色', '暖色局部光', '35–65mm 克制镜头'],
            impact: '角色 4 · 场景资产 5 · 分镜 10',
            versionHistory: [
              { version: 4, status: '当前', note: '提高走廊冷光对比，保持人物肤色中性' },
              { version: 3, status: '历史', note: '降低整体饱和度' },
            ],
            action: {
              label: '更换风格',
              type: 'open-modal',
            },
          },
          blockers: [
            {
              id: 'asset-scene-208-pending',
              type: '设定',
              title: '208 客房走廊待确认',
              detail: '影响第 2 集分镜确认，不影响当前第 1 集',
              action: '检查设定',
              blocksResume: false,
              target: {
                kind: 'route',
                routeId: 'studio-assets',
                params: { episodeId: '2', focusId: 'scene-asset-room-208-corridor' },
                scenarioId: 'blocked',
              },
            },
            {
              id: 'task-shot-05-auth-expired',
              type: '任务',
              title: '分镜 05 视频认证已过期',
              detail: '恢复后继续原任务，不影响编辑分镜 03',
              action: '查看任务',
              blocksResume: false,
              target: { kind: 'route', routeId: 'tasks', params: { focusId: 'task-shot-05-video' }, scenarioId: 'project-filtered' },
            },
          ],
        },
      },
      '9': {
        title: '雾港来信',
        description: '港口小城的失踪案牵出一批从未寄出的信。',
        metadata: ['年代悬疑', '16:9', '12 集', '最近编辑：昨天 21:42'],
        sections: {
          resumePosition: {
            projectId: '9', episodeId: '4', stage: 'assets', sceneId: 'scene-warehouse', shotId: '',
            workspaceTab: 'exceptions', inspectorSection: 'scene-assets', candidateId: '', timelineTime: '', updatedAt: '昨天 21:42',
          },
          primaryAction: { kind: 'resume', label: '继续设定', detail: '第 4 集《码头仓库》· 场景素材例外', enabled: true },
          stages: [
            { id: 'script', label: '剧本', state: '4 集已确认', summary: '2 集制作中 · 6 集未开始', tone: 'ok', unit: 'episode', total: 12 },
            { id: 'assets', label: '设定', state: '1 集制作中', summary: '3 集就绪 · 8 集未开始', tone: 'active', unit: 'episode', total: 12 },
            { id: 'storyboard', label: '分镜', state: '2 集制作中', summary: '1 集待确认 · 9 集未开始', tone: 'active', unit: 'episode', total: 12 },
            { id: 'cut', label: '成片', state: '1 集已完成', summary: '1 集制作中 · 10 集未开始', tone: 'ok', unit: 'episode', total: 12 },
          ],
          projectLook: {
            name: '潮湿胶片 · 低饱和',
            version: 2,
            status: '当前风格版本',
            aspectRatio: '16:9',
            usage: '0 个分镜引用',
            source: '自定义',
            visualIntent: ['年代胶片', '低饱和蓝绿', '潮湿空气感', '柔和颗粒'],
            impact: '角色 3 · 场景资产 4 · 分镜 0',
            versionHistory: [
              { version: 2, status: '当前', note: '增加潮湿空气感和胶片颗粒' },
              { version: 1, status: '历史', note: '建立年代港口基础风格' },
            ],
            action: {
              label: '更换风格',
              type: 'open-modal',
            },
          },
          blockers: [],
        },
      },
    };
    const project = projects[projectKey];
    if (!project) throw new Error(`Unknown project: ${projectKey}`);
    const isEmptyProject = projectKey === 'new-project';
    const result = {
      projectId: projectKey,
      scenarioId,
      title: project.title,
      description: project.description,
      metadata: [...project.metadata],
      sections: JSON.parse(JSON.stringify(project.sections)),
      viewState: { kind: 'normal', contentAvailable: true, readOnly: false, actions: [] },
      projectProfile: {
        name: project.title,
        cover: { id: 'project-cover', label: isEmptyProject ? '尚未设置封面' : '当前项目封面', tone: 'blue' },
        aspectRatio: isEmptyProject ? '9:16' : '16:9',
        genre: isEmptyProject ? '' : '都市悬疑',
        description: project.description,
        editableFields: [
          { id: 'name', label: '项目名称', value: project.title },
          { id: 'cover', label: '项目封面', value: isEmptyProject ? '' : 'cover-project-7.jpg' },
          { id: 'aspect-ratio', label: '画幅', value: isEmptyProject ? '9:16' : '16:9' },
          { id: 'genre', label: '题材', value: isEmptyProject ? '' : '都市悬疑' },
          { id: 'description', label: '项目简介', value: project.description },
        ],
        pathNote: '项目本地路径属于数据与存储管理，请在项目操作或高级数据工具中处理。',
      },
      projectStyleSelector: {
        presentation: 'modal',
        tabs: [
          { id: 'presets', label: '预设风格' },
          { id: 'mine', label: '我的风格' },
          { id: 'custom', label: '自定义风格' },
        ],
        currentStyle: isEmptyProject
          ? { name: '尚未设置画面风格', version: 0, description: '可在生成前任意时刻设置', updatedAt: '', tone: 'muted' }
          : { name: '都市悬疑 · 冷暖对撞', version: 4, description: '电影写实基底，冷灰主色配暖色局部光', updatedAt: '今天 09:18', tone: 'blue' },
        selectedStyle: null,
        search: { enabled: true, placeholder: '搜索风格名称或分类' },
        customFields: [
          { id: 'style-name', label: '风格名称' },
          { id: 'style-description', label: '风格描述' },
          { id: 'positive-visual-prompt', label: '正向视觉提示' },
          { id: 'negative-constraints', label: '负向约束' },
          { id: 'reference-images', label: '参考图片' },
        ],
        applyRule: '更换项目风格只影响之后的新生成和主动刷新，不自动重做已有图片或视频。',
        confirmAction: { id: 'apply-style', label: '确认应用' },
      },
      assetSummary: isEmptyProject
        ? { total: 0, missingUsable: 0, line: '项目素材：0 个对象', target: { routeId: 'project-assets', params: { projectId: projectKey } } }
        : { total: 16, missingUsable: 2, line: '项目素材：16 个对象，2 个缺少可用形象', target: { routeId: 'project-assets', params: { projectId: projectKey } } },
      externalAiPendingTask: null,
    };

    if (scenarioId === 'needs-attention') {
      const blocker = {
        id: 'asset-shot-03-missing', type: '素材', title: '分镜 03 缺少必需人物形象',
        detail: '当前恢复位置依赖此素材；处理后才能继续生成', action: '立即处理', blocksResume: true,
        target: {
          kind: 'route', routeId: 'studio-assets', params: { episodeId: '1', focusId: 'asset-shot-03-required' }, scenarioId: 'blocked',
        },
      };
      result.sections.blockers.unshift(blocker);
      result.sections.primaryAction = {
        kind: 'resolve-blocker', blockerId: blocker.id, label: '先补齐分镜 03 素材',
        detail: '完成后恢复到第 1 集 · 场次 02 · 分镜 03', enabled: true,
      };
      result.viewState.kind = 'needs-attention';
    } else if (scenarioId === 'all-complete') {
      result.sections.resumePosition = {
        projectId: projectKey, episodeId: '8', stage: 'cut', sceneId: '', shotId: '', workspaceTab: 'delivery',
        inspectorSection: '', candidateId: '', timelineTime: '00:00.0', updatedAt: '刚刚',
      };
      result.sections.primaryAction = {
        kind: 'open-latest-film', label: '查看或导出最新成片', detail: '第 8 集《天亮之前》· 成片已就绪', enabled: true,
        target: { routeId: 'studio-cut', params: { projectId: projectKey, episodeId: '8', workspaceTab: 'delivery' }, scenarioId: 'exported' },
      };
      result.sections.stages = result.sections.stages.map(item => ({
        ...item,
        state: item.id === 'script' ? `${item.total} 集已确认` : `${item.total} 集已完成`,
        summary: '全部完成',
        tone: 'ok',
      }));
      result.sections.blockers = [];
      result.viewState.kind = 'all-complete';
    } else if (scenarioId === 'storage-offline') {
      result.sections.primaryAction.enabled = false;
      result.viewState = {
        kind: 'storage-offline', contentAvailable: true, readOnly: true,
        title: '项目媒体目录不可访问，已用只读方式打开',
        detail: '你仍可查看概览、任务和历史；重新连接前不能生成、保存或恢复项目。',
        actions: [
          { id: 'reconnect-storage', label: '重新连接磁盘' },
          { id: 'view-project-tasks', label: '查看项目任务' },
        ],
      };
    } else if (scenarioId === 'load-failed') {
      result.viewState = {
        kind: 'load-failed', contentAvailable: false, readOnly: true,
        title: '项目概览加载失败', detail: '项目索引仍在；当前没有覆盖或修改任何项目数据。',
        actions: [
          { id: 'retry-overview', label: '重新加载' },
          { id: 'open-data-tools', label: '高级数据工具' },
        ],
      };
    } else if (scenarioId === 'missing') {
      result.viewState = {
        kind: 'missing', contentAvailable: false, readOnly: true,
        title: '找不到这个项目', detail: '项目可能已移入回收站、目录已移动，或本地索引已失效。',
        actions: [
          { id: 'back-projects', label: '返回项目列表' },
          { id: 'open-data-tools', label: '检查本地数据' },
        ],
      };
    } else if (scenarioId === 'loading') {
      result.viewState = { kind: 'loading', contentAvailable: false, readOnly: true, actions: [] };
    }
    return result;
  }

  function getProjectResumeNavigationTarget(position = {}) {
    const allowedStages = ['script', 'assets', 'storyboard', 'cut'];
    if (!position.projectId || !position.episodeId || !allowedStages.includes(position.stage)) {
      throw new Error('Invalid project resume position');
    }
    const params = {
      projectId: String(position.projectId),
      episodeId: String(position.episodeId),
    };
    for (const key of ['sceneId', 'shotId', 'workspaceTab', 'inspectorSection', 'timelineTime', 'candidateId']) {
      if (position[key]) params[key] = String(position[key]);
    }
    return { routeId: `studio-${position.stage}`, params, scenarioId: 'default' };
  }

  function getProjectOverviewPrimaryActionTarget({ projectId, scenarioId = 'default' } = {}) {
    const overview = getProjectOverviewModel(projectId, scenarioId);
    const action = overview.sections.primaryAction;
    if (!action.enabled) throw new Error('Project overview primary action is disabled');
    if (action.kind === 'resume') return getProjectResumeNavigationTarget(overview.sections.resumePosition);
    if (action.kind === 'resolve-blocker') return getProjectOverviewBlockerTarget({ projectId, blockerId: action.blockerId, scenarioId });
    if (action.target) return JSON.parse(JSON.stringify(action.target));
    throw new Error(`Unknown project overview primary action: ${action.kind}`);
  }

  function getProjectOverviewBlockerTarget({ projectId, blockerId, scenarioId = 'default' } = {}) {
    const overview = getProjectOverviewModel(projectId, scenarioId);
    const blocker = overview.sections.blockers.find(item => item.id === blockerId);
    if (!blocker) throw new Error(`Unknown project blocker: ${blockerId}`);
    if (blocker.target.kind === 'route') {
      return {
        kind: 'route',
        routeId: blocker.target.routeId,
        params: { projectId: overview.projectId, ...blocker.target.params },
        scenarioId: blocker.target.scenarioId,
      };
    }
    return { ...blocker.target };
  }

  function getProjectLookEditorModel(projectId, { query = '', selectedPresetId = 'cinematic-suspense' } = {}) {
    const presets = [
      { id: 'live-action', name: '真人写实', category: '真人', description: '自然肤质、真实镜头和克制调色', tone: 'teal' },
      { id: 'cinematic-suspense', name: '电影感悬疑', category: '真人', description: '冷色低照度、局部暖光和缓慢运镜', tone: 'blue' },
      { id: 'stylized-3d', name: '风格化 3D', category: '3D', description: '立体角色、柔和材质和电影级灯光', tone: 'purple' },
      { id: 'graphic-2d', name: '平面漫画', category: '2D', description: '明确线稿、块面色彩和分镜漫画感', tone: 'amber' },
    ];
    const mine = [
      { id: 'my-noir-night', name: '私藏 · 高对比夜戏', category: '我的风格', description: '基于电影感悬疑调整的自定义风格', tone: 'blue' },
    ];
    const normalizedQuery = String(query).trim().toLowerCase();
    const visiblePresets = presets.filter(item => `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(normalizedQuery));
    const visibleMine = mine.filter(item => `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(normalizedQuery));
    const selectedPreset = presets.find(item => item.id === selectedPresetId) || mine.find(item => item.id === selectedPresetId) || presets[1];
    return {
      projectId: String(projectId),
      presentation: 'modal',
      searchEnabled: true,
      query: String(query),
      tabs: [
        { id: 'presets', label: '预设风格' },
        { id: 'mine', label: '我的风格' },
        { id: 'custom', label: '自定义风格' },
      ],
      presets,
      mine,
      visiblePresets,
      visibleMine,
      selectedPreset,
      customFields: [
        { id: 'style-name', label: '风格名称' },
        { id: 'style-description', label: '风格描述' },
        { id: 'positive-visual-prompt', label: '正向视觉提示' },
        { id: 'negative-constraints', label: '负向约束' },
        { id: 'reference-images', label: '参考图片' },
      ],
      applyRule: '更换项目风格只影响之后的新生成和主动刷新，不自动重做已有图片或视频。',
      impactPreview: {
        referencedResults: 10,
        needsUpdate: 6,
        unaffectedHistory: 4,
        autoRegenerate: false,
      },
      confirmAction: { id: 'apply-style', label: '确认应用' },
    };
  }

  function getProjectSettingsEditorUiState({ hasDraft = false, status = 'idle' } = {}) {
    const saving = status === 'saving';
    return {
      dirty: Boolean(hasDraft),
      label: saving ? '正在保存…' : hasDraft ? '有未保存修改' : '尚未修改',
      saveEnabled: Boolean(hasDraft) && !saving,
      controlsDisabled: saving,
    };
  }

  function getProjectBibleModel(projectId, scenarioId = 'default') {
    return {
      projectId: String(projectId),
      scenarioId,
      legacyRoute: true,
      featureName: '项目设置（已合并到项目概览）',
      redirectTo: { routeId: 'project-overview', params: { projectId: String(projectId) }, scenarioId: 'default' },
    };
  }

  function getExternalAiContextModel(projectId) {
    const overview = getProjectOverviewModel(projectId, 'default');
    return {
      projectId: overview.projectId,
      title: '外部 AI 创作上下文',
      autoCompiled: true,
      summary: overview.description,
      includedSources: [
        '项目简介与题材',
        '当前画面风格',
        '已确认的上一集剧本',
        '人物当前状态',
        '场景索引',
        '道具索引',
        '跨集连续性备注',
      ],
      note: '上下文由系统自动汇总；你只需在创建任务时补充本次要求。',
    };
  }

  function getProjectAssetsModel(projectId, scenarioId = 'default', focusId = '') {
    const projectKey = String(projectId);
    const allowedTabs = ['all', 'characters', 'scenes', 'props'];
    const activeTab = allowedTabs.includes(focusId) ? focusId : 'all';
    const baseItems = [
      { id: 'character-linxia', type: 'characters', name: '林夏', subtitle: '主角 · 4 个状态', description: '夜班前台，冷静敏锐', usageCount: 8, issue: false, warning: '', mediaState: 'current', updatedOrder: 5, imageTone: 'purple', statePreviews: [{ name: '日常', tone: 'purple' }, { name: '制服', tone: 'blue' }, { name: '雨夜', tone: 'teal' }] },
      { id: 'character-manager', type: 'characters', name: '酒店经理', subtitle: '配角 · 2 个状态', description: '谨慎、圆滑，负责酒店夜间值守', usageCount: 4, issue: false, warning: '', mediaState: 'current', updatedOrder: 3, imageTone: 'amber', statePreviews: [{ name: '正装', tone: 'amber' }, { name: '慌乱', tone: 'red' }] },
      { id: 'scene-corridor', type: 'scenes', name: '208 客房走廊', subtitle: '夜景 · 3 个剧情状态', description: '狭长走廊、冷白灯和 208 门口', usageCount: 6, issue: scenarioId === 'media-offline', warning: scenarioId === 'media-offline' ? '主图文件离线' : '', mediaState: scenarioId === 'media-offline' ? 'offline' : 'current', updatedOrder: 2, imageTone: 'blue', statePreviews: [{ name: '常规', tone: 'blue' }, { name: '雨夜', tone: 'teal' }, { name: '停电', tone: 'amber' }], libraryUpdate: scenarioId === 'library-update' ? '资产库有 v3 可用' : '' },
      { id: 'scene-lobby', type: 'scenes', name: '酒店大堂', subtitle: '主场景 · 2 个剧情状态', description: '暖色石材、玻璃反射和前台区域', usageCount: 11, issue: scenarioId === 'generation-failed', warning: scenarioId === 'generation-failed' ? '生成失败，原输入可重试' : '', mediaState: 'current', updatedOrder: 4, imageTone: 'teal', statePreviews: [{ name: '白天', tone: 'teal' }, { name: '深夜', tone: 'blue' }] },
      { id: 'prop-keycard', type: 'props', name: '13 层门卡', subtitle: '关键道具 · 3 个剧情状态', description: '黑色 RFID 门卡，进入 13 层的线索', usageCount: 7, issue: false, warning: '', mediaState: 'current', updatedOrder: 1, imageTone: 'red', statePreviews: [{ name: '完整', tone: 'red' }, { name: '刷卡', tone: 'amber' }, { name: '损坏', tone: 'purple' }] },
    ];
    const items = scenarioId === 'empty' ? [] : baseItems.filter(item => activeTab === 'all' || item.type === activeTab);
    const statValue = value => scenarioId === 'empty' ? 0 : value;
    return {
      projectId: projectKey,
      scenarioId,
      title: '凌晨两点的客房服务',
      featureName: '项目素材',
      projectDefaultImpactNotice: '在这里修改的是项目默认素材。只影响未来选择；已确认的剧集不会被自动替换或重新生成。',
      activeTab,
      tabs: [
        { id: 'all', label: '全部' },
        { id: 'characters', label: '人物' },
        { id: 'scenes', label: '场景' },
        { id: 'props', label: '道具' },
      ],
      stats: [
        { id: 'characters', label: '人物', value: statValue(baseItems.filter(item => item.type === 'characters').length) },
        { id: 'scenes', label: '场景', value: statValue(baseItems.filter(item => item.type === 'scenes').length) },
        { id: 'props', label: '道具', value: statValue(baseItems.filter(item => item.type === 'props').length) },
        { id: 'needs-attention', label: '需要处理', value: statValue(baseItems.filter(item => item.issue).length) },
      ],
      filters: ['状态', '使用情况', '来源', '媒体情况', '所在剧集'],
      filterGroups: [
        { id: 'status', label: '状态', options: [{ id: 'attention', label: '需要处理' }, { id: 'candidate', label: '有新候选' }, { id: 'failed', label: '生成失败' }] },
        { id: 'usage', label: '使用情况', options: [{ id: 'used', label: '已使用' }, { id: 'unused', label: '未使用' }] },
        { id: 'source', label: '来源', options: [{ id: 'script', label: '剧本提取' }, { id: 'manual', label: '手工创建' }, { id: 'external', label: '外部 AI 导入' }, { id: 'library', label: '个人资产库' }] },
        { id: 'media', label: '媒体情况', options: [{ id: 'current', label: '有当前版本' }, { id: 'candidate-only', label: '只有候选' }, { id: 'offline', label: '文件离线' }] },
        { id: 'episode', label: '所在剧集', options: [{ id: '1', label: '第 1 集' }, { id: '2', label: '第 2 集' }, { id: '3', label: '第 3 集' }, { id: '4', label: '第 4 集' }] },
      ],
      primaryFilterGroups: [
        { id: 'status', label: '状态', options: [{ id: 'attention', label: '需要处理' }, { id: 'candidate', label: '有新候选' }] },
      ],
      advancedFilterGroups: [
        { id: 'usage', label: '使用情况', options: [{ id: 'used', label: '已使用' }, { id: 'unused', label: '未使用' }] },
        { id: 'source', label: '来源', options: [{ id: 'script', label: '剧本提取' }, { id: 'manual', label: '手工创建' }, { id: 'external', label: '外部 AI 导入' }, { id: 'library', label: '个人资产库' }] },
        { id: 'media', label: '媒体情况', options: [{ id: 'current', label: '有当前图' }, { id: 'candidate-only', label: '只有候选' }, { id: 'offline', label: '文件离线' }] },
        { id: 'episode', label: '所在剧集', options: [{ id: '1', label: '第 1 集' }, { id: '2', label: '第 2 集' }, { id: '3', label: '第 3 集' }, { id: '4', label: '第 4 集' }] },
      ],
      defaultToolbar: ['search', 'type', 'status', 'more-filters', 'sort'],
      defaultViewMode: 'card',
      viewModes: [{ id: 'card', label: '卡片' }, { id: 'list', label: '列表' }],
      sortOptions: [
        { id: 'updated-desc', label: '最近更新' },
        { id: 'name-asc', label: '名称' },
        { id: 'usage-desc', label: '使用最多' },
        { id: 'issues-first', label: '问题优先' },
      ],
      statFilters: {
        characters: { type: 'characters' },
        scenes: { type: 'scenes' },
        props: { type: 'props' },
        'needs-attention': { issue: 'true' },
      },
      createTypes: [
        { id: 'character', label: '人物', fields: ['name', 'role', 'description'] },
        { id: 'scene', label: '场景', fields: ['name', 'location', 'time', 'atmosphere'] },
        { id: 'prop', label: '道具', fields: ['name', 'propType', 'storyPurpose'] },
      ],
      libraryItems: [
        { id: 'library-character-01', type: '人物', name: '值班保安', version: 'v4', license: '用户自有', tone: 'blue', exists: false },
        { id: 'library-scene-03', type: '场景', name: '酒店地下停车场', version: 'v2', license: '用户自有', tone: 'teal', exists: false },
        { id: 'library-prop-02', type: '道具', name: '对讲机', version: 'v3', license: '用户自有', tone: 'amber', exists: true },
      ],
      batchActions: [
        { id: 'generate-missing', label: '生成缺失候选' },
        { id: 'set-mode', label: '设置默认生成模式' },
        { id: 'tags', label: '添加或移除标签' },
      ],
      items,
      libraryActions: [
        { id: 'reference', label: '引用固定版本', followsUpdates: false },
        { id: 'copy', label: '复制到项目', followsUpdates: false },
      ],
      blockedAction: scenarioId === 'delete-blocked' ? {
        reason: '存在 3 集和 8 个分镜引用',
        recoveryTarget: 'usage-locations',
      } : null,
    };
  }

  function getAssetDetailDrawerModel(assetId, { projectId = '', episodeId = '' } = {}) {
    const projectCard = getProjectAssetsModel(projectId || '7', 'default').items.find(item => item.id === assetId) || null;
    let episodeCard = null;
    if (episodeId) {
      const stage = getEpisodeAssetsStageModel(projectId || '7', String(episodeId), 'default');
      episodeCard = stage.cards.find(item => item.assetId === assetId) || null;
    }
    const isCharacter = projectCard ? projectCard.type === 'characters' : /character|voice/.test(String(assetId));
    const sections = [
      { id: 'summary', label: '对象摘要', fields: projectCard ? { type: projectCard.type, name: projectCard.name, subtitle: projectCard.subtitle, description: projectCard.description } : { name: String(assetId) } },
      { id: 'states', label: '状态切换', states: projectCard ? projectCard.statePreviews : [] },
      { id: 'current-and-candidates', label: '当前形象与候选', currentSelected: true, candidateActions: ['select', 'remove', 'view'] },
      { id: 'description', label: '简短资料', fields: ['外观描述', '服饰或环境', '关键识别特征', '负向约束'] },
      { id: 'generation', label: '生成 / 上传', presentation: 'modal', advancedCollapsed: true, actions: ['generate', 'upload', 'use-project-current', 'use-other-state'] },
      { id: 'episode-use', label: '使用于本集', visible: Boolean(episodeId), episodeSelection: episodeCard ? { mediaVersionId: episodeCard.mediaVersionId, status: episodeCard.status } : null },
    ].filter(section => section.id !== 'episode-use' || section.visible);
    return {
      assetId: String(assetId),
      projectId: projectId ? String(projectId) : '7',
      episodeId: episodeId ? String(episodeId) : null,
      presentation: 'drawer',
      width: '560-720px',
      sections,
      voiceSection: isCharacter ? { id: 'voice', label: '音色', onlyForCharacters: true, requiredWhenPolicyDemands: true } : null,
      technicalDetails: {
        collapsed: true,
        includes: ['hash', 'revision', '完整 Prompt', 'Provider 参数', '任务日志', '跨项目使用统计'],
      },
      deletion: {
        label: '删除',
        recoverable: true,
        archiveExposed: false,
        referencedImpact: '删除前会列出受影响的剧集、分镜和媒体；可选择替代素材或移入回收站。',
      },
    };
  }

  function getProjectAssetStatSelection(statId) {
    const selections = {
      characters: { type: 'characters' },
      scenes: { type: 'scenes' },
      props: { type: 'props' },
      'needs-attention': { issue: 'true' },
    };
    if (!selections[statId]) throw new Error(`Unknown asset stat: ${statId}`);
    return { ...selections[statId] };
  }

  function filterAndSortProjectAssets(items, state = {}) {
    const query = String(state.query || '').trim().toLocaleLowerCase('zh-CN');
    const filters = state.filters || {};
    const sourceLabels = { script: '剧本提取', manual: '手工创建', external: '外部 AI 导入', library: '个人资产库' };
    const result = items.filter(item => {
      const searchable = [item.name, item.subtitle, item.description, item.source].join(' ').toLocaleLowerCase('zh-CN');
      if (query && !searchable.includes(query)) return false;
      if (filters.type && item.type !== filters.type) return false;
      if (filters.issue === 'true' && !item.issue) return false;
      if (filters.status === 'attention' && !item.issue) return false;
      if (filters.status === 'candidate' && !item.taskStatus.includes('候选')) return false;
      if (filters.status === 'failed' && !item.taskStatus.includes('失败')) return false;

      if (filters.usage === 'used' && !(item.usageCount > 0)) return false;
      if (filters.usage === 'unused' && item.usageCount > 0) return false;
      if (filters.source && item.source !== sourceLabels[filters.source]) return false;
      if (filters.media && item.mediaState !== filters.media) return false;
      if (filters.episode && !item.episodes?.includes(filters.episode)) return false;
      return true;
    });
    const sorted = [...result];
    if (state.sortId === 'name-asc') sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    else if (state.sortId === 'usage-desc') sorted.sort((a, b) => b.usageCount - a.usageCount);
    else if (state.sortId === 'issues-first') sorted.sort((a, b) => Number(b.issue) - Number(a.issue) || b.updatedOrder - a.updatedOrder);
    else sorted.sort((a, b) => b.updatedOrder - a.updatedOrder);
    return sorted;
  }

  function getProjectAssetDetailModel(assetId) {
    const sections = ['概览', '版本与候选', '使用位置', '生成记录', '高级'];
    const sectionIds = ['overview', 'candidates', 'usage', 'records', 'advanced'];
    const stageConfirmation = {
      owner: 'studio-assets',
      label: '进入分镜',
      mode: 'automatic-on-navigation',
      result: '跳转时自动校验并保存本集所用资产版本快照',
    };
    const commonDetailFields = {
      mediaSemantics: {
        dataRevisionLabel: '资料修订',
        mediaCandidateLabel: '候选图',
        currentPointerLabel: '当前图',
      },
      snapshotImpact: '切换项目当前图只影响未来选择；已确认的剧集快照不会自动变化。',
    };
    const sceneCapabilities = ['参考图', '从图提取描述', '提示词', '负向提示词', '单图', '四视图', '生成与上传', '资产库', '影响分镜'];
    const propCapabilities = ['参考图', '从图提取描述', '提示词', '负向提示词', '单图', '四视图', '生成与上传', '资产库', '关联分镜'];
    const sceneGenerationModes = [
      { id: 'single', label: '单图', implementation: 'existing', description: '生成一个主要观察视角', outputs: ['主视角'] },
      { id: 'quad-grid', label: '四宫格', implementation: 'existing', description: '同图生成四个互补视角', outputs: ['主视角', '反向视角', '俯视角', '补充视角'] },
      { id: 'top-down', label: '独立俯视图', implementation: 'new-v2.1', presentation: 'advanced', description: '单独生成空间布局和人物走位参考', outputs: ['俯视布局'], downstreamConsumers: ['分镜参考绑定', 'H3 引用编译', '人物走位检查'] },
      { id: 'panorama', label: '全景图', implementation: 'new-v2.1', presentation: 'advanced', description: '建立完整空间关系和连续镜头参考', outputs: ['空间全景'], downstreamConsumers: ['分镜参考绑定', 'H3 引用编译', '连续镜头检查'] },
    ];
    const characterGenerationModes = [
      { id: 'single', label: '单图', implementation: 'existing', description: '生成一张完整人物形象图，适合具体服装或剧情状态', outputs: ['人物单图'] },
      { id: 'turnaround', label: '三/四视图', implementation: 'existing', description: '生成同一人物的正面、侧面、背面等转面设定', outputs: ['正面', '侧面', '背面', '补充视图'] },
    ];
    const propGenerationModes = [
      { id: 'single', label: '单图', implementation: 'existing', description: '生成一张纯色背景道具图', outputs: ['道具单图'] },
      { id: 'quad-grid', label: '四视图', implementation: 'existing', description: '生成正面、侧面、背面与顶部参考', outputs: ['正面', '侧面', '背面', '顶部'] },
    ];
    const sceneReferences = [
      { id: 'reference-layout', name: '大堂空间布局', role: '空间布局', source: '本地上传', tone: 'teal' },
      { id: 'reference-material', name: '暖色石材材质', role: '材质', source: '资产库固定版本', tone: 'amber' },
    ];
    const sceneGenerationRecords = [
      { id: 'job-scene-031', status: '已完成', provider: 'API', model: 'Flux Scene', mode: '单图', createdAt: '今天 14:32', promptSnapshot: '现代商务酒店大堂，暖色石材与玻璃反射' },
      { id: 'job-scene-028', status: '已完成', provider: 'ComfyUI', model: 'Scene Quad', mode: '四宫格', createdAt: '昨天 21:08', promptSnapshot: '同一酒店空间的主、反、俯视与补充视角' },
      { id: 'job-scene-024', status: '失败', provider: 'ChatGPT 网页', model: '网页生成', mode: '单图', createdAt: '9 月 7 日 18:44', promptSnapshot: '酒店前台区域对话构图' },
    ];

    if (assetId === 'scene-corridor') {
      return {
        ...commonDetailFields,
        assetId,
        assetKind: 'scene',
        title: '208 客房走廊',
        type: '场景',
        sections,
        sectionIds,
        activeSectionId: 'overview',
        candidateActionLabel: '使用此图',
        activeStateId: 'scene-state-night',
        activeViewId: 'scene-view-wide',
        dataRevision: '资料 r2',
        fields: { location: '208 客房走廊', time: '深夜', weather: '室内', condition: '常规', atmosphere: '冷白灯、狭长透视、安静压迫' },
        generationModes: JSON.parse(JSON.stringify(sceneGenerationModes)),
        activeGenerationModeId: 'single',
        referenceImages: JSON.parse(JSON.stringify(sceneReferences)),
        generationRecords: JSON.parse(JSON.stringify(sceneGenerationRecords)),
        advancedSettings: { prompt: '狭长酒店走廊，冷白灯，尽头消失点，电影写实', negativePrompt: '空间畸变，门牌错乱，多余门窗', projectLook: '都市悬疑 · 冷暖对撞 v4', provenance: '剧本提取 · scene-corridor', fingerprint: 'sha256:32ec…91af' },
        capabilities: sceneCapabilities,
        stageConfirmation,
        productionStates: [
          {
            id: 'scene-state-night', name: '常规夜景', isDefault: true, status: '使用中', usage: '2 集 · 4 个分镜', tone: 'blue', attributes: ['深夜', '室内', '正常照明'],
            views: [
              { id: 'scene-view-wide', name: '走廊全景', purpose: '建立空间', currentCandidateId: 'scene-night-wide-a', candidates: [
                { id: 'scene-night-wide-a', label: '候选 A', meta: 'API · 单图 · 1536×1024', tone: 'blue', isCurrent: true },
                { id: 'scene-night-wide-b', label: '候选 B', meta: 'ChatGPT 网页 · 单图 · 1536×1024', tone: 'teal', isCurrent: false },
              ] },
              { id: 'scene-view-door', name: '208 门口视角', purpose: '人物表演', currentCandidateId: 'scene-night-door-a', candidates: [
                { id: 'scene-night-door-a', label: '候选 A', meta: '本地上传 · 参考图', tone: 'purple', isCurrent: true },
              ] },
            ],
          },
          {
            id: 'scene-state-rain', name: '雨夜', isDefault: false, status: '使用中', usage: '1 集 · 1 个分镜', tone: 'teal', attributes: ['深夜', '暴雨', '地面积水反光'],
            views: [
              { id: 'scene-view-wide', name: '走廊全景', purpose: '建立空间', currentCandidateId: 'scene-rain-wide-a', candidates: [
                { id: 'scene-rain-wide-a', label: '候选 A', meta: 'ComfyUI · 四视图拆分', tone: 'teal', isCurrent: true },
              ] },
              { id: 'scene-view-door', name: '208 门口视角', purpose: '人物表演', currentCandidateId: 'scene-rain-door-a', candidates: [
                { id: 'scene-rain-door-a', label: '候选 A', meta: 'API · 单图 · 1536×1024', tone: 'blue', isCurrent: true },
              ] },
            ],
          },
          {
            id: 'scene-state-outage', name: '停电应急', isDefault: false, status: '有新候选', usage: '1 集 · 1 个分镜', tone: 'amber', attributes: ['深夜', '停电', '红色应急灯'],
            views: [
              { id: 'scene-view-wide', name: '走廊全景', purpose: '建立空间', currentCandidateId: 'scene-outage-wide-a', candidates: [
                { id: 'scene-outage-wide-a', label: '候选 A', meta: 'API · 单图 · 1536×1024', tone: 'amber', isCurrent: true },
                { id: 'scene-outage-wide-b', label: '候选 B', meta: 'ComfyUI · 单图 · 1536×1024', tone: 'red', isCurrent: false },
              ] },
              { id: 'scene-view-door', name: '208 门口视角', purpose: '人物表演', currentCandidateId: 'scene-outage-door-a', candidates: [
                { id: 'scene-outage-door-a', label: '候选 A', meta: 'ChatGPT 网页 · 单图', tone: 'red', isCurrent: true },
              ] },
            ],
          },
        ],
        usageTargets: [
          { label: '第 1 集 · 场次 02 · 分镜 03', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '1', focusId: 'shot-03' } },
          { label: '第 2 集 · 场次 01 · 分镜 01', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '2', focusId: 'shot-01' } },
        ],
      };
    }

    if (assetId === 'scene-lobby') {
      return {
        ...commonDetailFields,
        assetId,
        assetKind: 'scene',
        title: '酒店大堂',
        type: '场景',
        sections,
        sectionIds,
        activeSectionId: 'overview',
        candidateActionLabel: '使用此图',
        activeStateId: 'lobby-state-day',
        activeViewId: 'lobby-view-wide',
        dataRevision: '资料 r3',
        fields: { location: '酒店大堂', time: '白天/深夜', weather: '室内', condition: '营业中', atmosphere: '现代商务酒店、暖色石材与玻璃反射' },
        generationModes: JSON.parse(JSON.stringify(sceneGenerationModes)),
        activeGenerationModeId: 'single',
        referenceImages: JSON.parse(JSON.stringify(sceneReferences)),
        generationRecords: JSON.parse(JSON.stringify(sceneGenerationRecords)),
        advancedSettings: { prompt: '现代商务酒店大堂，暖色石材，玻璃反射，空间关系清晰', negativePrompt: '空间畸变，家具重复，标识乱码', projectLook: '都市悬疑 · 冷暖对撞 v4', provenance: '手工创建 · scene-lobby', fingerprint: 'sha256:781d…3b52' },
        capabilities: sceneCapabilities,
        stageConfirmation,
        productionStates: [
          { id: 'lobby-state-day', name: '白天营业', isDefault: true, status: '使用中', usage: '3 集 · 7 个分镜', tone: 'teal', attributes: ['白天', '营业中', '暖色自然光'], views: [
            { id: 'lobby-view-wide', name: '大堂全景', purpose: '建立空间', currentCandidateId: 'lobby-day-wide-a', candidates: [
              { id: 'lobby-day-wide-a', label: '候选 A', meta: 'API · 四视图拆分', tone: 'teal', isCurrent: true },
              { id: 'lobby-day-wide-b', label: '候选 B', meta: 'ChatGPT 网页 · 单图', tone: 'amber', isCurrent: false },
            ] },
            { id: 'lobby-view-desk', name: '前台视角', purpose: '对话表演', currentCandidateId: 'lobby-day-desk-a', candidates: [
              { id: 'lobby-day-desk-a', label: '候选 A', meta: '本地上传 · 参考图', tone: 'amber', isCurrent: true },
            ] },
          ] },
          { id: 'lobby-state-night', name: '深夜值守', isDefault: false, status: '有新候选', usage: '2 集 · 4 个分镜', tone: 'blue', attributes: ['深夜', '低客流', '局部照明'], views: [
            { id: 'lobby-view-wide', name: '大堂全景', purpose: '建立空间', currentCandidateId: 'lobby-night-wide-a', candidates: [
              { id: 'lobby-night-wide-a', label: '候选 A', meta: 'ComfyUI · 单图', tone: 'blue', isCurrent: true },
            ] },
            { id: 'lobby-view-desk', name: '前台视角', purpose: '对话表演', currentCandidateId: 'lobby-night-desk-a', candidates: [
              { id: 'lobby-night-desk-a', label: '候选 A', meta: 'API · 单图', tone: 'purple', isCurrent: true },
            ] },
          ] },
        ],
        usageTargets: [
          { label: '第 1 集 · 场次 01 · 分镜 01', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '1', focusId: 'shot-01' } },
          { label: '第 3 集 · 场次 03 · 分镜 06', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '3', focusId: 'shot-06' } },
        ],
      };
    }

    if (assetId === 'prop-keycard') {
      return {
        ...commonDetailFields,
        assetId,
        assetKind: 'prop',
        title: '13 层门卡',
        type: '道具',
        sections,
        sectionIds,
        activeSectionId: 'overview',
        candidateActionLabel: '使用此图',
        activeStateId: 'prop-state-intact',
        activeViewId: 'prop-view-front',
        dataRevision: '资料 r2',
        fields: { name: '13 层门卡', propType: '关键道具', storyPurpose: '进入 13 层客房区域的线索', form: '黑色 RFID 门卡', material: '磨砂塑料', color: '黑色与银色字样' },
        proposedFields: ['实际尺寸/比例', '默认持有人'],
        generationModes: JSON.parse(JSON.stringify(propGenerationModes)),
        activeGenerationModeId: 'single',
        referenceImages: [{ id: 'prop-reference-shape', name: '门卡形制参考', role: '材质', source: '本地上传', tone: 'red' }],
        generationRecords: [{ id: 'job-prop-014', status: '已完成', provider: 'API', model: 'Flux Object', mode: '单图', createdAt: '昨天 16:24', promptSnapshot: '黑色磨砂 RFID 门卡，银色楼层标记，纯色背景' }],
        advancedSettings: { prompt: '黑色磨砂 RFID 门卡，银色楼层标记，纯色无缝背景', negativePrompt: '手持，多余物品，文字乱码，透视变形', projectLook: '都市悬疑 · 冷暖对撞 v4', provenance: '外部 AI 导入 · prop-keycard', fingerprint: 'sha256:59ae…0cf1' },
        capabilities: propCapabilities,
        stageConfirmation,
        productionStates: [
          { id: 'prop-state-intact', name: '完整', isDefault: true, status: '使用中', usage: '3 集 · 5 个分镜', tone: 'red', attributes: ['未损坏', '未刷卡', '林夏持有'], views: [
            { id: 'prop-view-front', name: '正面', purpose: '身份识别', currentCandidateId: 'prop-intact-front-a', candidates: [
              { id: 'prop-intact-front-a', label: '候选 A', meta: 'API · 单图 · 1:1', tone: 'red', isCurrent: true },
              { id: 'prop-intact-front-b', label: '候选 B', meta: 'ChatGPT 网页 · 单图 · 1:1', tone: 'amber', isCurrent: false },
            ] },
            { id: 'prop-view-side', name: '侧面', purpose: '厚度参考', currentCandidateId: 'prop-intact-side-a', candidates: [
              { id: 'prop-intact-side-a', label: '候选 A', meta: '四视图拆分 · 1:1', tone: 'purple', isCurrent: true },
            ] },
          ] },
          { id: 'prop-state-tapping', name: '刷卡中', isDefault: false, status: '使用中', usage: '1 集 · 1 个分镜', tone: 'amber', attributes: ['贴近读卡器', '绿灯亮起', '林夏持有'], views: [
            { id: 'prop-view-front', name: '正面', purpose: '动作参考', currentCandidateId: 'prop-tapping-front-a', candidates: [
              { id: 'prop-tapping-front-a', label: '候选 A', meta: '本地上传 · 动作参考', tone: 'amber', isCurrent: true },
            ] },
          ] },
          { id: 'prop-state-damaged', name: '损坏', isDefault: false, status: '有新候选', usage: '1 集 · 1 个分镜', tone: 'purple', attributes: ['右上角断裂', '芯片外露', '无人持有'], views: [
            { id: 'prop-view-front', name: '正面', purpose: '状态识别', currentCandidateId: 'prop-damaged-front-a', candidates: [
              { id: 'prop-damaged-front-a', label: '候选 A', meta: 'ComfyUI · 单图 · 1:1', tone: 'purple', isCurrent: true },
              { id: 'prop-damaged-front-b', label: '候选 B', meta: 'API · 单图 · 1:1', tone: 'red', isCurrent: false },
            ] },
            { id: 'prop-view-detail', name: '断裂特写', purpose: '线索特写', currentCandidateId: 'prop-damaged-detail-a', candidates: [
              { id: 'prop-damaged-detail-a', label: '候选 A', meta: 'ChatGPT 网页 · 特写', tone: 'blue', isCurrent: true },
            ] },
          ] },
        ],
        usageTargets: [
          { label: '第 1 集 · 场次 02 · 分镜 04', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '1', focusId: 'shot-04' } },
          { label: '第 2 集 · 场次 01 · 分镜 02', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '2', focusId: 'shot-02' } },
        ],
      };
    }

    if (assetId === 'character-manager') {
      const template = getProjectAssetDetailModel('character-linxia');
      return {
        ...template,
        assetId,
        title: '酒店经理',
        dataRevision: '资料 r2',
        identityImage: { label: '基础身份图', version: 'v2', tone: 'amber' },
        fields: { name: '酒店经理', role: '配角', description: '谨慎、圆滑，负责酒店夜间值守', appearance: '四十岁左右，深色西装，佩戴酒店胸牌' },
        primaryIssue: { label: '本集需要人物音色', action: '配置人物音色' },
        voiceProfile: {
          ...template.voiceProfile,
          displayName: '尚未配置音色',
          currentCandidateId: null,
          candidates: [],
          license: '尚未设置',
        },
        generationRecords: [
          { id: 'job-manager-image-02', kind: '人物形象', status: '已完成', source: '外部 AI 回流', createdAt: '昨天 19:20' },
        ],
        characterStates: [
          { id: 'manager-state-suit', name: '正装', isDefault: true, status: '使用中', usage: '2 集 · 3 个分镜', tone: 'amber', generationModeId: 'turnaround', currentCandidateId: 'manager-suit-a', candidates: [
            { id: 'manager-suit-a', label: '候选 A', meta: '外部 AI · 三/四视图', tone: 'amber', isCurrent: true },
            { id: 'manager-suit-b', label: '候选 B', meta: 'API · 单图', tone: 'blue', isCurrent: false },
          ] },
          { id: 'manager-state-panic', name: '慌乱', isDefault: false, status: '有新候选', usage: '1 集 · 1 个分镜', tone: 'red', generationModeId: 'single', currentCandidateId: 'manager-panic-a', candidates: [
            { id: 'manager-panic-a', label: '候选 A', meta: 'ChatGPT 网页 · 单图', tone: 'red', isCurrent: true },
          ] },
        ],
      };
    }

    if (assetId !== 'character-linxia') throw new Error(`Unknown project asset: ${assetId}`);
    return {
      ...commonDetailFields,
      assetId,
      assetKind: 'character',
      title: '林夏',
      type: '人物',
      sections,
      sectionIds,
      activeSectionId: 'overview',
      candidateActionLabel: '使用此图',
      activeStateId: 'state-daily',
      dataRevision: '资料 r3',
      identityImage: { label: '基础身份图', version: 'v3', tone: 'purple' },
      activeCandidateMedia: 'image',
      fields: { name: '林夏', role: '主角', description: '夜班前台，冷静敏锐，逐步发现酒店异常', appearance: '二十六岁，黑色中长发，清瘦，神情略显疲惫' },
      generationModes: JSON.parse(JSON.stringify(characterGenerationModes)),
      referenceImages: [
        { id: 'character-reference-face', name: '林夏身份锚点', role: '脸部身份', source: '基础身份图 v3', tone: 'purple' },
        { id: 'character-reference-uniform', name: '酒店制服参考', role: '服装', source: '本地上传', tone: 'blue' },
      ],
      advancedSettings: { prompt: '年轻女性，黑色中长发，清瘦，神情冷静略显疲惫', negativePrompt: '多人，脸部变形，服装不一致，文字水印', projectLook: '都市悬疑 · 冷暖对撞 v4', provenance: '剧本提取 · character-linxia', fingerprint: 'sha256:8fa1…2c77' },
      voiceProfile: {
        ownerKind: 'character',
        displayName: '林夏 · 冷静清晰',
        currentCandidateId: 'voice-linxia-upload-v1',
        voiceStyle: '冷静、清晰、略带疲惫感',
        language: '普通话',
        accent: '轻微南方口音',
        ageImpression: '25–30 岁',
        capabilities: ['Seedance 2.0 参考', 'H3 音频参考', '后期 TTS'],
        license: '用户自有录音 · 仅当前项目',
        sources: [
          { id: 'upload', label: '本地上传', availability: 'existing', description: '上传 WAV、MP3、M4A 或 OGG 参考音频' },
          { id: 'tts-preset', label: 'TTS 预设', availability: 'v2.1', description: '选择 AI 配置中已连接 Provider 的音色' },
          { id: 'personal-library', label: '个人素材库', availability: 'v2.1', description: '引用固定版本，不随库更新自动漂移' },
          { id: 'extract', label: '从音频提取', availability: 'new-v2.1', description: 'Provider 支持时，从已有音视频建立候选' },
          { id: 'smart-design', label: '智能设计', availability: 'future', description: '后续增强；生成前必须展示 Provider 和费用' },
        ],
        candidates: [
          { id: 'voice-linxia-upload-v1', label: '夜班前台参考', source: '本地上传', format: 'WAV', durationSeconds: 18, status: '可用', isCurrent: true },
          { id: 'voice-linxia-preset-v2', label: '沉静女声 02', source: 'MiniMax TTS 预设', format: 'Provider voice id', durationSeconds: 12, status: '可用', isCurrent: false },
        ],
        gatePolicy: {
          mode: 'conditional',
          blocksWhen: 'selected-audio-strategy-requires-missing-character-voice',
          otherwise: 'warning-only',
        },
      },
      generationRecords: [
        { id: 'job-character-image-07', kind: '人物形象', status: '已完成', source: 'ChatGPT 网页', createdAt: '今天 13:10' },
        { id: 'job-character-voice-03', kind: '人物音色', status: '已完成', source: '本地上传', createdAt: '昨天 22:46' },
      ],
      stageConfirmation,
      characterStates: [
        {
          id: 'state-daily', name: '日常造型', isDefault: true, status: '使用中', usage: '2 集 · 5 个分镜', tone: 'purple', generationModeId: 'turnaround', currentCandidateId: 'candidate-daily-a',
          candidates: [
            { id: 'candidate-daily-a', label: '候选 A', meta: 'ChatGPT 网页 · 1536×1024', tone: 'purple', isCurrent: true },
            { id: 'candidate-daily-b', label: '候选 B', meta: 'ComfyUI · 1536×1024', tone: 'blue', isCurrent: false },
          ],
        },
        {
          id: 'state-hotel', name: '酒店制服', isDefault: false, status: '使用中', usage: '1 集 · 2 个分镜', tone: 'blue', generationModeId: 'single', currentCandidateId: 'candidate-hotel-a',
          candidates: [
            { id: 'candidate-hotel-a', label: '候选 A', meta: 'API · 1536×1024', tone: 'blue', isCurrent: true },
            { id: 'candidate-hotel-b', label: '候选 B', meta: 'ChatGPT 网页 · 1536×1024', tone: 'teal', isCurrent: false },
          ],
        },
        {
          id: 'state-rain', name: '雨夜湿衣', isDefault: false, status: '有新候选', usage: '1 集 · 1 个分镜', tone: 'teal', generationModeId: 'single', currentCandidateId: 'candidate-rain-a',
          candidates: [
            { id: 'candidate-rain-a', label: '候选 A', meta: 'ComfyUI · 1536×1024', tone: 'teal', isCurrent: true },
            { id: 'candidate-rain-b', label: '候选 B', meta: 'API · 1536×1024', tone: 'purple', isCurrent: false },
          ],
        },
        {
          id: 'state-injured', name: '受伤状态', isDefault: false, status: '缺少侧视图', usage: '1 集 · 1 个分镜', tone: 'amber', generationModeId: 'turnaround', currentCandidateId: 'candidate-injured-a',
          candidates: [
            { id: 'candidate-injured-a', label: '候选 A', meta: '本地上传 · 1536×1024', tone: 'amber', isCurrent: true },
          ],
        },
      ],
      usageTargets: [
        { label: '第 1 集 · 分镜 03', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '1', focusId: 'shot-03' } },
        { label: '第 2 集 · 分镜 01', routeId: 'studio-storyboard', params: { projectId: '7', episodeId: '2', focusId: 'shot-01' } },
      ],
    };
  }

  function useProjectAssetCandidate(detail, stateId, candidateId) {
    const targetState = detail.characterStates.find(item => item.id === stateId);
    if (!targetState) throw new Error(`Unknown character state: ${stateId}`);
    if (!targetState.candidates.some(item => item.id === candidateId)) throw new Error(`Unknown asset candidate: ${candidateId}`);
    return {
      ...detail,
      activeStateId: stateId,
      lastMediaSelection: {
        kind: 'character',
        stateId,
        previousCandidateId: targetState.currentCandidateId,
        currentCandidateId: candidateId,
        impact: '只影响未来选择；已确认的剧集快照不会自动变化。',
      },
      characterStates: detail.characterStates.map(state => state.id !== stateId ? state : {
        ...state,
        status: '使用中',
        currentCandidateId: candidateId,
        candidates: state.candidates.map(candidate => ({ ...candidate, isCurrent: candidate.id === candidateId })),
      }),
    };
  }

  function useProjectAssetVoiceCandidate(detail, candidateId) {
    if (!detail.voiceProfile?.candidates.some(item => item.id === candidateId)) {
      throw new Error(`Unknown voice candidate: ${candidateId}`);
    }
    return {
      ...detail,
      voiceProfile: {
        ...detail.voiceProfile,
        currentCandidateId: candidateId,
        candidates: detail.voiceProfile.candidates.map(candidate => ({
          ...candidate,
          isCurrent: candidate.id === candidateId,
        })),
      },
    };
  }

  function setProjectAssetCharacterGenerationMode(detail, stateId, modeId) {
    const targetState = detail.characterStates?.find(item => item.id === stateId);
    if (!targetState) throw new Error(`Unknown character state: ${stateId}`);
    if (!detail.generationModes?.some(item => item.id === modeId)) {
      throw new Error(`Unknown character generation mode: ${modeId}`);
    }
    return {
      ...detail,
      activeStateId: stateId,
      characterStates: detail.characterStates.map(state => state.id === stateId ? { ...state, generationModeId: modeId } : state),
    };
  }

  function addProjectAssetCharacterCandidate(detail, stateId, candidate) {
    const targetState = detail.characterStates?.find(item => item.id === stateId);
    if (!targetState) throw new Error(`Unknown character state: ${stateId}`);
    if (!candidate?.id || targetState.candidates.some(item => item.id === candidate.id)) {
      throw new Error(`Invalid or duplicate asset candidate: ${candidate?.id || ''}`);
    }
    const mode = detail.generationModes?.find(item => item.id === targetState.generationModeId);
    return {
      ...detail,
      activeStateId: stateId,
      activeSectionId: 'candidates',
      activeCandidateMedia: 'image',
      generationRecords: [
        { id: `job-${candidate.id}`, kind: '人物形象', status: candidate.status || '排队中', source: candidate.source || 'API', createdAt: '刚刚', mode: mode?.label || '单图' },
        ...(detail.generationRecords || []),
      ],
      characterStates: detail.characterStates.map(state => state.id === stateId ? {
        ...state,
        status: '有新候选',
        candidates: [...state.candidates, { ...candidate, isCurrent: false }],
      } : state),
    };
  }

  function useProjectAssetViewCandidate(detail, stateId, viewId, candidateId) {
    const targetState = detail.productionStates.find(item => item.id === stateId);
    if (!targetState) throw new Error(`Unknown production state: ${stateId}`);
    const targetView = targetState.views.find(item => item.id === viewId);
    if (!targetView) throw new Error(`Unknown asset view: ${viewId}`);
    if (!targetView.candidates.some(item => item.id === candidateId)) throw new Error(`Unknown asset candidate: ${candidateId}`);
    return {
      ...detail,
      activeStateId: stateId,
      activeViewId: viewId,
      lastMediaSelection: {
        kind: 'view',
        stateId,
        viewId,
        previousCandidateId: targetView.currentCandidateId,
        currentCandidateId: candidateId,
        impact: '只影响未来选择；已确认的剧集快照不会自动变化。',
      },
      productionStates: detail.productionStates.map(state => state.id !== stateId ? state : {
        ...state,
        status: '使用中',
        views: state.views.map(view => view.id !== viewId ? view : {
          ...view,
          currentCandidateId: candidateId,
          candidates: view.candidates.map(candidate => ({ ...candidate, isCurrent: candidate.id === candidateId })),
        }),
      }),
    };
  }

  function setProjectAssetDetailSection(detail, sectionId) {
    const allowed = detail.sectionIds || ['overview', 'candidates', 'usage', 'records', 'advanced'];
    if (!allowed.includes(sectionId)) throw new Error(`Unknown asset detail section: ${sectionId}`);
    return { ...detail, activeSectionId: sectionId };
  }

  function setProjectAssetGenerationMode(detail, modeId) {
    if (!detail.generationModes?.some(item => item.id === modeId)) {
      throw new Error(`Unknown asset generation mode: ${modeId}`);
    }
    return { ...detail, activeGenerationModeId: modeId };
  }

  function saveProjectAssetFields(detail, fields) {
    return { ...detail, fields: { ...detail.fields, ...fields } };
  }

  function addProjectAssetReference(detail, reference) {
    if (!reference?.id || detail.referenceImages?.some(item => item.id === reference.id)) {
      throw new Error(`Invalid or duplicate asset reference: ${reference?.id || ''}`);
    }
    return { ...detail, referenceImages: [...(detail.referenceImages || []), { ...reference }] };
  }

  function removeProjectAssetReference(detail, referenceId) {
    if (!detail.referenceImages?.some(item => item.id === referenceId)) {
      throw new Error(`Unknown asset reference: ${referenceId}`);
    }
    return { ...detail, referenceImages: detail.referenceImages.filter(item => item.id !== referenceId) };
  }

  function addProjectAssetViewReference(detail, stateId, view) {
    const state = detail.productionStates?.find(item => item.id === stateId);
    if (!state) throw new Error(`Unknown production state: ${stateId}`);
    if (!view?.id || state.views.some(item => item.id === view.id)) throw new Error(`Invalid or duplicate asset view: ${view?.id || ''}`);
    const nextView = { ...view, currentCandidateId: null, candidates: [] };
    return {
      ...detail,
      activeStateId: stateId,
      activeViewId: nextView.id,
      productionStates: detail.productionStates.map(item => item.id !== stateId ? item : {
        ...item,
        views: [...item.views, nextView],
      }),
    };
  }

  function undoProjectAssetMediaSelection(detail) {
    const selection = detail.lastMediaSelection;
    if (!selection?.previousCandidateId) throw new Error('No asset media selection to undo');
    const restored = selection.kind === 'character'
      ? useProjectAssetCandidate(detail, selection.stateId, selection.previousCandidateId)
      : useProjectAssetViewCandidate(detail, selection.stateId, selection.viewId, selection.previousCandidateId);
    return { ...restored, lastMediaSelection: null };
  }

  function getProjectAssetGenerationEnvelope(detail, options = {}) {
    const channel = options.channel || detail.activeGenerationChannel || 'ChatGPT 网页';
    const modeId = options.modeId || detail.activeGenerationModeId || 'single';
    const mode = detail.generationModes?.find(item => item.id === modeId);
    if (!mode) throw new Error(`Unknown asset generation mode: ${modeId}`);
    let state;
    let view;
    if (detail.assetKind === 'character') {
      state = detail.characterStates?.find(item => item.id === (options.stateId || detail.activeStateId));
      if (!state) throw new Error(`Unknown character state: ${options.stateId || detail.activeStateId}`);
    } else {
      state = detail.productionStates?.find(item => item.id === (options.stateId || detail.activeStateId));
      if (!state) throw new Error(`Unknown production state: ${options.stateId || detail.activeStateId}`);
      view = state.views.find(item => item.id === (options.viewId || detail.activeViewId));
      if (!view) throw new Error(`Unknown asset view: ${options.viewId || detail.activeViewId}`);
    }
    const references = (detail.referenceImages || []).map(item => ({
      id: item.id,
      label: item.name,
      purpose: item.role,
      source: item.source,
    }));
    const costByChannel = { API: '按 Provider 报价', 'ChatGPT 网页': '¥0', ComfyUI: '本地运行 · ¥0' };
    return {
      assetKind: detail.assetKind,
      stateId: state.id,
      viewId: view?.id || null,
      objectLabel: [detail.title, state.name, view?.name].filter(Boolean).join(' / '),
      modeId,
      modeLabel: mode.label,
      channel,
      projectStyle: detail.advancedSettings?.projectLook || '继承项目画面风格',
      references,
      promptPreview: detail.advancedSettings?.prompt || `${detail.title} ${state.name}`,
      outputCount: mode.outputs?.length || 1,
      estimatedCost: costByChannel[channel] || '提交前计算',
      taskCount: 1,
      resultPolicy: '只新增候选，不自动设为当前图',
      environmentCheck: channel === 'ChatGPT 网页'
        ? { required: true, status: '环境可用', checks: ['浏览器', '桥接', '登录', '结果捕获'], cost: '¥0' }
        : { required: false, status: '按通道能力检查', checks: [], cost: costByChannel[channel] },
      capabilityCheck: {
        status: '通过',
        items: [
          `模式：${mode.label}`,
          `参考图：${references.length} / 最大 4`,
          '格式与尺寸：支持',
          '引用用途与权重：已保留',
          '静默降级：不允许',
        ],
      },
    };
  }

  function submitProjectAssetGeneration(detail, envelope, jobId) {
    if (!envelope?.stateId || !jobId) throw new Error('Invalid asset generation submission');
    const record = {
      id: jobId,
      kind: detail.assetKind === 'character' ? '人物形象' : detail.assetKind === 'scene' ? '场景图片' : '道具图片',
      status: '排队中',
      source: envelope.channel,
      provider: envelope.channel,
      model: `${envelope.modeLabel}生成模型`,
      mode: envelope.modeLabel,
      createdAt: '刚刚',
      promptSnapshot: envelope.promptPreview,
      envelope: { ...envelope },
    };
    return { ...detail, activeSectionId: 'records', generationRecords: [record, ...(detail.generationRecords || [])] };
  }

  function completeProjectAssetGeneration(detail, jobId, candidate) {
    const record = detail.generationRecords?.find(item => item.id === jobId);
    if (!record?.envelope) throw new Error(`Unknown asset generation job: ${jobId}`);
    if (!candidate?.id) throw new Error('Invalid generated candidate');
    const records = detail.generationRecords.map(item => item.id === jobId ? { ...item, status: '已完成' } : item);
    if (detail.assetKind === 'character') {
      return {
        ...detail,
        generationRecords: records,
        characterStates: detail.characterStates.map(state => state.id !== record.envelope.stateId ? state : {
          ...state,
          status: '有新候选',
          candidates: [...state.candidates, { ...candidate, isCurrent: false }],
        }),
      };
    }
    return {
      ...detail,
      generationRecords: records,
      productionStates: detail.productionStates.map(state => state.id !== record.envelope.stateId ? state : {
        ...state,
        status: '有新候选',
        views: state.views.map(view => view.id !== record.envelope.viewId ? view : {
          ...view,
          candidates: [...view.candidates, { ...candidate, isCurrent: false }],
        }),
      }),
    };
  }

  function getProjectAssetBatchPreview(items, selectedIds, actionId) {
    const selectedSet = new Set(selectedIds || []);
    const selectedItems = (items || []).filter(item => selectedSet.has(item.id));
    if (!actionId) throw new Error('Batch action is required');
    let eligible = 0;
    let blocked = 0;
    for (const item of selectedItems) {
      if (item.mediaState === 'offline') blocked += 1;
      else eligible += 1;
    }
    const skipped = selectedItems.length - eligible - blocked;
    return {
      actionId,
      selected: selectedItems.length,
      selectedIds: selectedItems.map(item => item.id),
      eligible,
      skipped,
      blocked,
      tasks: actionId === 'generate-missing' ? eligible : 0,
      provider: '按对象当前通道',
      model: '按对象配置',
      estimatedCost: '提交前按通道汇总',
      concurrency: 2,
      autoUseCandidate: false,
      partialSuccess: eligible > 0 && (skipped > 0 || blocked > 0),
    };
  }

  function cloneScriptPage(page) {
    return JSON.parse(JSON.stringify(page));
  }

  function syncScriptPageDerived(page) {
    page.scenes = page.scenes.map((scene, index) => ({ ...scene, number:String(index + 1).padStart(2, '0') }));
    page.episodeSummary = {
      totalWords:page.scenes.reduce((total, scene) => total + scene.wordCount, 0),
      estimatedDuration:page.scenes.length ? '约 8 分 30 秒' : '0 分钟',
    };
    page.editor.saveState = page.editor.persistence.state;
    if (page.editor.isEmpty) {
      page.primaryAction = { id:'check-and-confirm', label:'检查并确认', enabled:false, reason:'剧本为空，至少需要一个包含正文的场次' };
    } else if (page.editor.persistence.state === 'save_failed' || page.editor.persistence.state === 'offline') {
      page.primaryAction = { id:'retry-save', label:'重试保存', enabled:true, reason:'' };
    } else if (page.editor.persistence.state === 'conflict') {
      page.primaryAction = { id:'resolve-conflict', label:'解决版本冲突', enabled:true, reason:'' };
    } else if (page.editor.persistence.state === 'dirty') {
      page.primaryAction = { id:'wait-for-save', label:'等待保存', enabled:false, reason:'请先保存当前修改' };
    } else if (page.editor.persistence.state === 'saving') {
      page.primaryAction = { id:'saving', label:'保存中…', enabled:false, reason:'保存完成后才能确认' };
    } else if (page.approval.state === 'approving') {
      page.primaryAction = { id:'approval-processing', label:'确认中…', enabled:false, reason:'正在创建新的已确认版本' };
    } else if (page.approval.state === 'approved') {
      page.primaryAction = { id:'enter-assets', label:'进入设定', enabled:true, reason:'' };
    } else if (page.approval.check.completed) {
      page.primaryAction = { id:'confirm-new-version', label: page.currentRevision.approvedRevisionId ? '确认修改' : '确认剧本', enabled:true, reason:'' };
    } else {
      page.primaryAction = { id:'check-and-confirm', label:'检查并确认', enabled:true, reason:'' };
    }
    return page;
  }

  function getScriptStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default:null,
      blocked:{ kind:'blocking', title:'剧本为空，不能确认', detail:'先新增场次、输入剧本或使用 AI 生成可审阅草稿。', actions:[{id:'edit-script',label:'新增第一个场次'},{id:'open-ai',label:'用 AI 生成草稿'}] },
      loading:{ kind:'running', title:'正在载入剧本', detail:'编辑器保持只读；载入完成前不会覆盖浏览器恢复内容。', actions:[{id:'cancel-loading',label:'返回剧集'}] },
      saving:{ kind:'running', title:'正在保存当前草稿', detail:'内容仍可阅读；保存完成前不能确认剧本。', actions:[{id:'wait-save',label:'等待保存'}] },
      'save-failed':{ kind:'recoverable-error', title:'保存失败，内容已保留在本机', detail:'服务端草稿未更新；恢复副本与当前输入均未丢失。', actions:[{id:'retry-save',label:'重试保存'},{id:'copy-recovery',label:'复制恢复内容'}] },
      conflict:{ kind:'blocking', title:'另一窗口已经保存了更新版本', detail:'比较本机内容与服务端内容后创建新草稿；不会使用最后写入覆盖。', actions:[{id:'resolve-conflict',label:'比较并解决'},{id:'copy-recovery',label:'复制本机内容'}] },
      offline:{ kind:'recoverable-error', title:'本地服务暂时不可用', detail:'内容已保留在浏览器恢复副本；恢复连接前不能确认。', actions:[{id:'retry-save',label:'重新连接并保存'},{id:'copy-recovery',label:'复制恢复内容'}] },
      stale:{ kind:'warning', title:'已确认后又产生了新草稿', detail:'设定和分镜仍基于上一版已确认剧本；新草稿保存后可检查并确认。', actions:[{id:'compare-approved',label:'与已确认版本比较'},{id:'keep-draft',label:'继续编辑'}] },
      diff:{ kind:'info', title:'正在比较已确认版本与当前草稿', detail:'按场次查看新增、删除与修改；历史版本保持只读。', actions:[{id:'back-editor',label:'返回编辑'}] },
      'ai-processing':{ kind:'running', title:'AI 改写候选生成中', detail:'当前草稿没有改变；任务完成后先展示候选差异。', actions:[{id:'open-task',label:'查看任务'},{id:'cancel-ai',label:'取消任务'}] },
      'ai-partial':{ kind:'warning', title:'AI 生成部分完成', detail:'2 个场次已产生候选，1 个场次失败；可应用成功项并单独重试失败项。', actions:[{id:'review-ai',label:'查看候选'},{id:'retry-failed',label:'重试失败项'}] },
      'ai-failed':{ kind:'recoverable-error', title:'AI 候选生成失败', detail:'当前草稿没有改变；可按相同设置重试。', actions:[{id:'retry-ai',label:'按原输入重试'},{id:'back-editor',label:'返回编辑'}] },
      'approval-processing':{ kind:'running', title:'正在确认新剧本版本', detail:'只创建新的已确认版本和下游待评估标记，不触发媒体生成。', actions:[{id:'wait-approval',label:'查看处理状态'}] },
      'approval-succeeded':{ kind:'success', title:'剧本新版本已确认', detail:'设定和分镜已标记为需要评估；已有图片和视频均保留。', actions:[{id:'enter-assets',label:'进入设定'}] },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown script scenario: ${scenarioId}`);
    const scenes = [
      {id:'scene-01',number:'01',heading:'内景 · 酒店前台 · 深夜',status:'已保存',wordCount:326,content:'酒店前台只剩林夏值夜。墙上的时钟刚刚指向凌晨两点。',metadata:{interiorExterior:'内景',location:'酒店前台',timeOfDay:'深夜'}},
      {id:'scene-02',number:'02',heading:'内景 · 13 层走廊 · 深夜',status:'已保存',wordCount:418,content:'林夏握紧门卡，走廊尽头再次响起服务铃。\n\n林夏：208 房明明没有登记住客。',metadata:{interiorExterior:'内景',location:'13 层走廊',timeOfDay:'深夜'}},
      {id:'scene-03',number:'03',heading:'内景 · 208 门口 · 深夜',status:'已保存',wordCount:287,content:'林夏停在 208 门口。门缝下没有灯光，服务铃却从房内再次响起。',metadata:{interiorExterior:'内景',location:'208 门口',timeOfDay:'深夜'}},
      {id:'scene-04',number:'04',heading:'内景 · 酒店前台 · 稍后',status:'已保存',wordCount:241,content:'林夏回到前台，发现值班记录里多出了一行并不存在的入住信息。',metadata:{interiorExterior:'内景',location:'酒店前台',timeOfDay:'稍后'}},
    ];
    const page = {
      projectId:String(projectId),episodeId:String(episodeId),scenarioId,scenario:scenarios[scenarioId],
      featureName:'剧本',title:'第 1 集 · 无人楼层',subtitle:'基于已确认版本编辑新草稿',
      header:{backLabel:'返回剧集',backRouteId:'project-episodes',breadcrumb:'凌晨两点的客房服务 / 第 1 集',title:'剧本',statusText:'基于已确认版本编辑新草稿'},
      stageNavigation:[
        {id:'script',label:'剧本',routeId:'studio-script',state:'current',access:'edit'},
        {id:'assets',label:'设定',routeId:'studio-assets',state:'stale',access:'view-only',hint:'仍基于上一版已确认剧本'},
        {id:'storyboard',label:'分镜',routeId:'studio-storyboard',state:'stale',access:'view-only',hint:'可浏览，不能提交收费生成'},
        {id:'cut',label:'成片',routeId:'studio-cut',state:'available',access:'view-only'},
      ],
      scenes,
      selectedSceneId:'scene-02',
      editor:{selectedSceneId:'scene-02',content:'林夏握紧门卡，走廊尽头再次响起服务铃。\n\n林夏：208 房明明没有登记住客。',dirty:false,isEmpty:false,textSelection:null,persistence:{state:'saved',label:'已保存于 14:32',hasRecoveryCopy:false},baseVersionLabel:'基于已确认版本'},
      autosave:{delayMs:800,shortcut:'Ctrl/Cmd+S',browserRecoveryCopy:true,userMessage:'更改会自动保存'},
      currentRevision:{id:'script-r12',status:'草稿',savedAt:'14:32',approvedRevisionId:'script-r11',sourceLabel:'基于已确认版本'},
      revisions:[
        {id:'script-r12',key:'current',label:'当前草稿',status:'draft',updatedAt:'今天 14:32',source:'手工编辑',differenceCount:6},
        {id:'script-r11',key:'approved',label:'已确认版本',status:'approved',updatedAt:'今天 13:18',source:'上次确认',differenceCount:0},
        {id:'script-r10',key:'external',label:'外部 AI 导入',status:'history',updatedAt:'昨天 22:07',source:'外部 AI 回流',differenceCount:9},
      ],
      versionComparison:{
        leftLabel:'已确认版本',rightLabel:'当前草稿',open:scenarioId==='diff',
        canCompare:false,
        rows:[
          {sceneLabel:'场次 02 · 13 层走廊',kind:'修改',before:'林夏走进走廊，灯光闪烁。',after:'林夏握紧门卡，走廊尽头再次响起服务铃。'},
          {sceneLabel:'场次 03 · 208 门口',kind:'新增',before:'',after:'门牌上的 208 忽然变成了 1308。'},
          {sceneLabel:'场次 04 · 酒店前台',kind:'删除',before:'经理挂断电话后独自离开。',after:''},
        ],
      },
      emptyStart:{
        title:'从哪里开始？',
        detail:'三种方式都会进入同一份可编辑草稿；场次结构在保存后即可查看和调整。',
        actions:[
          {id:'paste-import',label:'粘贴或导入剧本'},
          {id:'ai-draft',label:'AI 生成剧本'},
          {id:'manual-write',label:'直接开始写'},
        ],
      },
      aiAssistant:{
        presentation:'menu',
        action:{id:'ai-draft',label:'AI 生成剧本'},
        selectionActions:['rewrite-selection','expand-selection','condense-selection'],
      },
      revisionHistory:{presentation:'drawer',actionLabel:'历史版本'},
      aiActions:[
        {id:'continue',label:'根据创意继续写',priority:'primary'},
        {id:'rewrite-selection',label:'改写选中内容',priority:'primary',requiresSelection:true},
        {id:'expand-selection',label:'扩写选中内容',requiresSelection:true},
        {id:'condense-selection',label:'缩写选中内容',requiresSelection:true},
        {id:'multi-episode',label:'生成多集草稿',priority:'secondary'},
        {id:'copy-project',label:'从其他项目复制',priority:'secondary'},
      ],
      aiWorkflow:{state:scenarioId==='ai-processing'?'processing':scenarioId==='ai-failed'?'failed':'idle',mode:null,scope:null,candidateText:null,diff:null,provider:'文本模型',estimatedCost:'约 ¥0.08'},
      assetExtraction:{
        sourceRevision:'script-r12',label:'预计素材变化',state:'ready',diff:{added:2,changed:3,removed:1,locked:2},preservesManualLocks:true,autoWrite:false,
        items:[
          {id:'asset-add-bell',kind:'新增',label:'服务铃',detail:'新道具候选',decision:'use'},
          {id:'asset-change-linxia',kind:'修改',label:'林夏 · 雨夜状态',detail:'外观说明变化',decision:'use'},
          {id:'asset-remove-guest',kind:'删除候选',label:'神秘住客',detail:'仍被历史版本引用',decision:'pending'},
          {id:'asset-lock-lobby',kind:'人工锁定',label:'酒店大堂',detail:'人工字段不会被覆盖',decision:'keep-locked'},
        ],
      },
      approval:{
        action:'approve-script',state:scenarioId==='approval-processing'?'approving':scenarioId==='approval-succeeded'?'approved':'draft',createsRevisionOnly:true,autoRefreshDownstream:false,autoDeleteMedia:false,autoRegenerateMedia:false,
        check:{completed:false,blocking:0,warnings:2,sceneCount:4,wordCount:1272,estimatedDuration:'约 8 分 30 秒'},
        downstreamImpact:{characterChanges:2,sceneChanges:1,staleShots:6,preservedVideos:4},
        downstreamEffect:'2 个角色设定可能变化；1 个场景需要重新确认；6 个分镜仍基于上一版剧本；已生成的 4 段视频不会被自动删除',
      },
      conflict:{localContent:'林夏：这一层从来没有登记过。',serverContent:'林夏：208 房没有登记住客。',autoOverwrite:false},
      sceneUndo:{available:false,scene:null,index:-1},
    };

    page.versionComparison.canCompare = Boolean(page.currentRevision.approvedRevisionId) && scenarioId !== 'blocked';
    if (scenarioId === 'blocked') {
      page.versionComparison.canCompare = false;
      page.aiAssistant.presentation = 'prominent';
      page.revisionHistory = { presentation:'hidden', actionLabel:'历史版本' };
      page.scenes = [];
      page.selectedSceneId = null;
      page.editor = { ...page.editor, selectedSceneId:null, content:'', dirty:false, isEmpty:true, persistence:{state:'saved',label:'空白草稿',hasRecoveryCopy:false} };
      page.approval.check = { ...page.approval.check, completed:false, blocking:1, sceneCount:0, wordCount:0, estimatedDuration:'0 分钟' };
      page.assetExtraction.diff = {added:0,changed:0,removed:0,locked:0};
      page.assetExtraction.items = [];
    } else if (scenarioId === 'loading') {
      page.editor.persistence = {state:'loading',label:'正在载入…',hasRecoveryCopy:false};
    } else if (scenarioId === 'saving') {
      page.editor.persistence = {state:'saving',label:'保存中…',hasRecoveryCopy:false};
    } else if (scenarioId === 'save-failed') {
      page.editor.persistence = {state:'save_failed',label:'保存失败，内容已保留在本机',hasRecoveryCopy:true};
      page.editor.dirty = true;
      page.scenes[1].status = '未保存';
    } else if (scenarioId === 'offline') {
      page.editor.persistence = {state:'offline',label:'本地服务不可用，内容已保留',hasRecoveryCopy:true};
      page.editor.dirty = true;
    } else if (scenarioId === 'conflict') {
      page.editor.persistence = {state:'conflict',label:'检测到版本冲突',hasRecoveryCopy:true};
    } else if (scenarioId === 'stale') {
      page.editor.baseVersionLabel = '下游仍基于上一版已确认剧本';
    }
    return syncScriptPageDerived(page);
  }

  function editScriptDraft(page, sceneId, content) {
    const next = cloneScriptPage(page);
    next.editor.selectedSceneId = sceneId;
    next.selectedSceneId = sceneId;
    next.editor.content = content;
    next.editor.dirty = true;
    next.editor.isEmpty = !content.trim();
    next.editor.persistence = {state:'dirty',label:'有未保存修改',hasRecoveryCopy:true};
    next.approval.state = 'draft';
    next.approval.check.completed = false;
    next.scenes = next.scenes.map(scene => scene.id === sceneId ? { ...scene, content, status:'有修改', wordCount:Math.max(1, content.replace(/\s/g, '').length) } : scene);
    return syncScriptPageDerived(next);
  }

  function startScriptDraftSave(page) {
    const next = cloneScriptPage(page);
    next.editor.persistence = {state:'saving',label:'保存中…',hasRecoveryCopy:true};
    return syncScriptPageDerived(next);
  }

  function completeScriptDraftSave(page, savedAt = '刚刚') {
    const next = cloneScriptPage(page);
    next.editor.dirty = false;
    next.editor.persistence = {state:'saved',label:`已保存于 ${savedAt}`,hasRecoveryCopy:false};
    next.currentRevision.savedAt = savedAt;
    next.scenes = next.scenes.map(scene => scene.id === next.editor.selectedSceneId ? { ...scene, status:'已保存' } : scene);
    return syncScriptPageDerived(next);
  }

  function checkScriptDraftForApproval(page) {
    const next = cloneScriptPage(page);
    if (next.editor.persistence.state !== 'saved' || next.editor.isEmpty) return syncScriptPageDerived(next);
    next.approval.state = 'checked';
    next.approval.check.completed = true;
    next.approval.check.sceneCount = next.scenes.length;
    next.approval.check.wordCount = next.scenes.reduce((total, scene) => total + scene.wordCount, 0);
    return syncScriptPageDerived(next);
  }

  function approveScriptDraft(page) {
    const next = cloneScriptPage(page);
    if (!next.approval.check.completed || next.editor.persistence.state !== 'saved') throw new Error('Script approval requires a saved checked draft');
    next.approval.state = 'approved';
    next.currentRevision.status = '已确认';
    next.revisions = next.revisions.map(item => item.key === 'current' ? { ...item, label:'当前已确认版本',status:'approved',source:'本次确认',differenceCount:0 } : item.key === 'approved' ? { ...item,status:'history',label:'上一版已确认' } : item);
    return syncScriptPageDerived(next);
  }

  function startScriptApproval(page) {
    const next = cloneScriptPage(page);
    if (!next.approval.check.completed || next.editor.persistence.state !== 'saved') return syncScriptPageDerived(next);
    next.approval.state = 'approving';
    return syncScriptPageDerived(next);
  }

  function startScriptAiCandidate(page, options) {
    const next = cloneScriptPage(page);
    next.aiWorkflow = { ...next.aiWorkflow, state:'processing', mode:options.mode, scope:options.scope, candidateText:null, diff:null };
    return next;
  }

  function completeScriptAiCandidate(page, result) {
    const next = cloneScriptPage(page);
    next.aiWorkflow = { ...next.aiWorkflow, state:'candidate_ready', candidateText:result.candidateText, diff:{added:1,removed:1,changed:1,before:next.editor.content,after:result.candidateText} };
    return next;
  }

  function applyScriptAiCandidate(page) {
    if (page.aiWorkflow.state !== 'candidate_ready') return cloneScriptPage(page);
    const next = editScriptDraft(page, page.editor.selectedSceneId, page.aiWorkflow.candidateText);
    next.aiWorkflow = { ...next.aiWorkflow, state:'applied' };
    return next;
  }

  function createScriptDraftFromHistory(page, revisionKey) {
    const source = page.revisions.find(item => item.key === revisionKey);
    if (!source) throw new Error(`Unknown script history revision: ${revisionKey}`);
    const next = cloneScriptPage(page);
    next.currentRevision = {id:`script-draft-${Date.now()}`,status:'草稿',savedAt:'刚刚',approvedRevisionId:page.currentRevision.approvedRevisionId,sourceLabel:`由${source.label}复制`};
    next.revisions.unshift({id:next.currentRevision.id,key:'current-copy',label:'当前草稿',status:'draft',updatedAt:'刚刚',source:next.currentRevision.sourceLabel,differenceCount:0});
    next.approval.state = 'draft';
    next.approval.check.completed = false;
    return syncScriptPageDerived(next);
  }

  function decideScriptAssetChange(page, itemId, decision) {
    const next = cloneScriptPage(page);
    next.assetExtraction.items = next.assetExtraction.items.map(item => item.id === itemId ? { ...item, decision } : item);
    return next;
  }

  function renameScriptScene(page, sceneId, heading) {
    const next = cloneScriptPage(page);
    next.scenes = next.scenes.map(scene => scene.id === sceneId ? { ...scene, heading, status:'有修改' } : scene);
    next.editor.persistence = {state:'dirty',label:'有未保存修改',hasRecoveryCopy:true};
    next.approval.check.completed = false;
    return syncScriptPageDerived(next);
  }

  function duplicateScriptScene(page, sceneId) {
    const next = cloneScriptPage(page);
    const index = next.scenes.findIndex(scene => scene.id === sceneId);
    if (index < 0) return next;
    const source = next.scenes[index];
    const copy = { ...source,id:`${source.id}-copy-${next.scenes.length + 1}`,heading:`${source.heading} · 副本`,status:'有修改' };
    next.scenes.splice(index + 1, 0, copy);
    next.editor.persistence = {state:'dirty',label:'有未保存修改',hasRecoveryCopy:true};
    next.approval.check.completed = false;
    return syncScriptPageDerived(next);
  }

  function moveScriptScene(page, sceneId, offset) {
    const next = cloneScriptPage(page);
    const index = next.scenes.findIndex(scene => scene.id === sceneId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= next.scenes.length) return next;
    const [scene] = next.scenes.splice(index, 1);
    next.scenes.splice(target, 0, scene);
    next.editor.persistence = {state:'dirty',label:'有未保存修改',hasRecoveryCopy:true};
    next.approval.check.completed = false;
    return syncScriptPageDerived(next);
  }

  function deleteScriptScene(page, sceneId) {
    const next = cloneScriptPage(page);
    const index = next.scenes.findIndex(scene => scene.id === sceneId);
    if (index < 0) return next;
    const [scene] = next.scenes.splice(index, 1);
    next.sceneUndo = {available:true,scene,index};
    next.editor.persistence = {state:'dirty',label:'有未保存修改',hasRecoveryCopy:true};
    next.approval.check.completed = false;
    if (next.editor.selectedSceneId === sceneId) {
      next.editor.selectedSceneId = next.scenes[0]?.id || null;
      next.selectedSceneId = next.editor.selectedSceneId;
    }
    return syncScriptPageDerived(next);
  }

  function undoDeleteScriptScene(page) {
    const next = cloneScriptPage(page);
    if (!next.sceneUndo.available || !next.sceneUndo.scene) return next;
    next.scenes.splice(next.sceneUndo.index, 0, next.sceneUndo.scene);
    next.sceneUndo = {available:false,scene:null,index:-1};
    return syncScriptPageDerived(next);
  }

  function selectScriptScene(page, sceneId) {
    const next = cloneScriptPage(page);
    const scene = next.scenes.find(item => item.id === sceneId);
    if (!scene) return next;
    next.selectedSceneId = sceneId;
    next.editor.selectedSceneId = sceneId;
    next.editor.content = scene.content || '';
    next.editor.isEmpty = !next.editor.content.trim();
    return syncScriptPageDerived(next);
  }

  function addScriptScene(page) {
    const next = cloneScriptPage(page);
    const id = `scene-${String(next.scenes.length + 1).padStart(2, '0')}-${Date.now()}`;
    next.scenes.push({id,number:String(next.scenes.length + 1).padStart(2, '0'),heading:'内景 · 新场景 · 时间待定',status:'有修改',wordCount:0,content:'',metadata:{interiorExterior:'内景',location:'新场景',timeOfDay:'时间待定'}});
    next.selectedSceneId = id;
    next.editor.selectedSceneId = id;
    next.editor.content = '';
    next.editor.isEmpty = false;
    next.editor.dirty = true;
    next.editor.persistence = {state:'dirty',label:'有未保存修改',hasRecoveryCopy:true};
    next.approval.check.completed = false;
    return syncScriptPageDerived(next);
  }

  function getEpisodeAssetVersionComparisonModel(targetId) {
    if (targetId !== 'linxia-hotel') throw new Error(`Unknown episode asset comparison target: ${targetId}`);
    return {
      targetId,
      title: '林夏 · 酒店制服',
      versions: [
        { role:'episode-current', label:'本集使用图', version:'v2', thumbnail:{tone:'blue',label:'林夏酒店制服 v2'}, source:'设定快照', updatedAt:'9 月 7 日 21:14' },
        { role:'project-latest', label:'项目最新图', version:'v3', thumbnail:{tone:'purple',label:'林夏酒店制服 v3'}, source:'ChatGPT 网页候选', updatedAt:'今天 10:26' },
      ],
      difference:'新版调整了制服领口、胸牌位置和冷色轮廓光；人物身份与发型保持一致。',
      affectedLocations:['场次 01 · 分镜 02','场次 02 · 分镜 03'],
      actions:[
        {id:'keep-episode-current',label:'继续使用 v2',changesProjectDefault:false},
        {id:'use-project-latest',label:'本集改用 v3',changesProjectDefault:false},
        {id:'open-project-asset',label:'打开完整项目素材',changesProjectDefault:false},
      ],
    };
  }

  function getEpisodeVoiceResolutionModel(targetId) {
    if (targetId !== 'manager-voice') throw new Error(`Unknown episode voice target: ${targetId}`);
    return {
      targetId,
      title:'酒店经理 · 本集声音',
      audioPolicy:'人物参考音色',
      requiredByPolicy:true,
      blockerReason:'本集对白策略要求人物参考音色，但酒店经理还没有本集可用音色。',
      candidates:[
        {id:'voice-manager-02',label:'沉稳男声 02',source:'预设音色',duration:'试听 8 秒',previewAction:'试听'},
        {id:'voice-manager-library',label:'夜班经理',source:'个人素材库固定版本',duration:'试听 11 秒',previewAction:'试听'},
      ],
      sources:[
        {id:'preset',label:'选择预设音色'},
        {id:'library',label:'从个人素材库选择'},
        {id:'upload',label:'本地上传'},
        {id:'extract',label:'从许可音视频提取',requiresProviderCapability:true},
      ],
      actions:[
        {id:'use-voice',label:'用于本集',changesProjectDefault:false},
        {id:'use-model-default',label:'改用模型默认声音',changesAudioPolicy:true},
      ],
    };
  }

  function resolveEpisodeMediaReadiness(page) {
    const scriptApproved = !['2', '3'].includes(String(page.episodeId));
    const blockers = page.gate.blockers;
    if (!scriptApproved) return 'script-unapproved';
    if (page.scenarioId === 'snapshot-failed') return 'snapshot-failed';
    if (page.scenarioId === 'checking' || page.scenarioId === 'loading' || page.scenarioId === 'snapshot-saving') return 'checking';
    if (blockers.length > 0) return 'needs-attention';
    return 'ready';
  }

  function syncEpisodeAssetsDerived(page) {
    const next = JSON.parse(JSON.stringify(page));
    const items = next.requiredGroups.flatMap(group => group.items);
    for (const group of next.requiredGroups) {
      group.ready = group.items.filter(item => !['阻塞','文件离线','不匹配'].includes(item.status)).length;
    }
    const status = resolveEpisodeMediaReadiness(next);
    const pendingCount = next.gate.blockers.length + next.gate.warnings.length;
    next.mediaReadiness = {
      status,
      checkedAt: '刚刚',
      blockers: next.gate.blockers,
      warnings: next.gate.warnings,
      scriptApproved: status !== 'script-unapproved',
      summary: status === 'script-unapproved'
        ? '确认剧本后才能生成本集媒体'
        : status === 'checking'
          ? '正在准备素材…'
          : status === 'snapshot-failed'
            ? '素材准备未完成：重试'
            : next.gate.blockers.length > 0
              ? `有 ${pendingCount} 项可稍后处理`
              : '本集设定已准备好',
    };
    next.storyboardEntry = {
      allowed: true,
      target: { routeId: 'studio-storyboard', params: { projectId: next.projectId, episodeId: next.episodeId }, scenarioId: 'default' },
      savesSnapshotOnClick: true,
      pendingCount,
    };
    next.primaryAction = { id:'enter-storyboard', label:'进入分镜', enabled:true, allowed:true, readiness:status, pendingCount };
    const storyboard = next.stageNavigation.find(item => item.id === 'storyboard');
    storyboard.state = 'available';
    storyboard.reason = '';
    return next;
  }

  function applyEpisodeAssetDecision(page, decision = {}) {
    const next = JSON.parse(JSON.stringify(page));
    const item = next.requiredGroups.flatMap(group => group.items).find(candidate => candidate.id === decision.targetId);
    if (!item) throw new Error(`Unknown episode asset decision target: ${decision.targetId}`);
    if (decision.type === 'use-project-latest') {
      item.episodeSelection = item.projectCurrent;
      item.status = '已就绪';
      item.selectionLabel = '本集使用项目最新图';
      next.reviewItems = next.reviewItems.filter(review => review.targetId !== item.id);
      next.gate.warnings = next.gate.warnings.filter(warning => warning.id !== 'linxia-version');
    } else if (decision.type === 'keep-episode-current') {
      item.status = '已就绪';
      item.selectionLabel = '继续使用本集原图';
      next.reviewItems = next.reviewItems.filter(review => review.targetId !== item.id);
      next.gate.warnings = next.gate.warnings.filter(warning => warning.id !== 'linxia-version');
    } else if (decision.type === 'use-voice' || decision.type === 'use-model-default') {
      item.episodeSelection = decision.type === 'use-model-default' ? '模型默认声音' : '沉稳男声 02';
      item.status = '已就绪';
      item.selectionLabel = decision.type === 'use-model-default' ? '本集不再要求人物音色' : '已选择本集音色';
      next.audioPolicy = decision.type === 'use-model-default' ? '模型默认声音' : '人物参考音色';
      next.reviewItems = next.reviewItems.filter(review => review.targetId !== item.id);
      next.gate.blockers = next.gate.blockers.filter(blocker => blocker.id !== item.id);
    } else {
      throw new Error(`Unknown episode asset decision: ${decision.type}`);
    }
    return syncEpisodeAssetsDerived(next);
  }

  function getEpisodeAssetsStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default:null,
      blocked:{kind:'blocking',title:'本集还缺少 1 项必需素材',detail:'酒店经理的对白策略要求人物音色，但当前没有可用候选。',actions:[{id:'open-manager',label:'配置人物音色'},{id:'change-audio',label:'改用模型默认声音'}]},
      stale:{kind:'warning',title:'项目素材已有新版本',detail:'林夏酒店制服有项目新图；本集仍使用原图，可继续使用或逐项更新。',actions:[{id:'compare-snapshot',label:'比较图片'},{id:'keep-snapshot',label:'继续使用原图'}]},
      'candidate-compare':{kind:'info',title:'比较林夏 · 酒店制服',detail:'选择只修改本集使用图，不会改变项目默认。',actions:[{id:'compare-snapshot',label:'打开比较'},{id:'open-project-asset',label:'打开完整项目素材'}]},
      'look-change':{kind:'warning',title:'项目画面风格已有更新',detail:'本集继续使用原风格。改用新风格可能影响 3 项尚未固定的素材。',actions:[{id:'review-look',label:'查看影响'},{id:'keep-look',label:'继续使用当前风格'},{id:'refresh-look',label:'本集改用新风格'}]},
      loading:{kind:'loading',title:'正在检查本集所需素材',detail:'正在解析剧本引用并读取项目当前素材。',actions:[]},
      'first-preparation':{kind:'info',title:'首次准备设定',detail:'当前还没有可信素材快照，因此先展示本集所需的全部素材。',actions:[]},
      ready:{kind:'success',title:'设定已准备好',detail:'进入分镜时会固定当前选择；项目素材后续变化不会自动替换本集。',actions:[]},
      checking:{kind:'running',title:'正在进行进入分镜前检查',detail:'正在检查引用、媒体文件、条件音色和当前选择。',actions:[]},
      'snapshot-saving':{kind:'running',title:'正在准备分镜',detail:'正在保存本集精确素材快照，请勿重复提交。',actions:[]},
      'snapshot-succeeded':{kind:'success',title:'设定快照已保存',detail:'当前选择已经固定，可以安全进入分镜。',actions:[{id:'open-storyboard',label:'打开分镜'}]},
      'check-failed':{kind:'recoverable-error',title:'检查没有完成',detail:'没有保存或改变本集选择；修复读取问题后可以再次检查。',actions:[{id:'retry-check',label:'再次检查'}]},
      'snapshot-failed':{kind:'recoverable-error',title:'设定快照保存失败',detail:'全部选择仍然保留，没有写入部分快照。',actions:[{id:'retry-snapshot',label:'重试准备分镜'}]},
      'media-offline':{kind:'blocking',title:'1 个设定文件离线',detail:'13 层走廊当前使用图无法读取，需要重新定位或更换本集使用图。',actions:[{id:'relocate-media',label:'重新定位媒体'},{id:'replace-media',label:'选择其他图片'}]},
      'external-package':{kind:'info',title:'已接入外部 AI 制作包',detail:'请确认外部候选、项目当前图和本集选择；只处理仍缺少的素材。',actions:[]},
      'external-package-mismatch':{kind:'blocking',title:'外部制作包还有 1 项映射不匹配',detail:'缺失引用不会自动猜测或写入；请先检查映射。',actions:[{id:'review-package-mismatch',label:'检查外部包映射'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown episode assets scenario: ${scenarioId}`);
    const readySelection = ['ready','checking','snapshot-saving','snapshot-succeeded','snapshot-failed'].includes(scenarioId);
    const offline = scenarioId === 'media-offline';
    const packageMismatch = scenarioId === 'external-package-mismatch';
    const requiredGroups = [
      {id:'characters',label:'人物与状态',items:[
        {id:'linxia-hotel',label:'林夏 · 酒店制服',projectCurrent:'v3',episodeSelection:'v2',status:'有更新',thumbnail:{tone:'blue',label:'林夏酒店制服'}},
        {id:'manager-suit',label:'酒店经理 · 正装',projectCurrent:'v2',episodeSelection:'v2',status:'已就绪',thumbnail:{tone:'amber',label:'酒店经理正装'}},
      ]},
      {id:'scenes',label:'场景与剧情状态',items:[
        {id:'corridor-night',label:'13 层走廊 · 停电应急',projectCurrent:'v4',episodeSelection:'v4',status:offline?'文件离线':'已就绪',thumbnail:{tone:'red',label:'13 层走廊停电'}},
        {id:'room-door',label:'208 门口 · 深夜',projectCurrent:'v2',episodeSelection:'v2',status:'已就绪',thumbnail:{tone:'purple',label:'208 门口深夜'}},
      ]},
      {id:'props',label:'道具与状态',items:[
        {id:'keycard',label:'13 层门卡 · 完整',projectCurrent:'v2',episodeSelection:'v2',status:'已就绪',thumbnail:{tone:'teal',label:'13 层门卡'}},
      ]},
      {id:'voices',label:'条件音色',items:[
        {id:'linxia-voice',label:'林夏 · 冷静清晰',projectCurrent:'v1',episodeSelection:'v1',status:'已就绪',thumbnail:{tone:'blue',label:'林夏音色'}},
        {id:'manager-voice',label:'酒店经理音色',projectCurrent:'缺失',episodeSelection:readySelection?'沉稳男声 02':'未选择',status:readySelection?'已就绪':'阻塞',thumbnail:{tone:'amber',label:'酒店经理音色'}},
      ]},
    ];
    const blockers = [];
    if (!readySelection) blockers.push({id:'manager-voice',label:'酒店经理缺少条件音色'});
    if (offline) blockers.push({id:'corridor-night',label:'13 层走廊使用图文件离线'});
    if (packageMismatch) blockers.push({id:'external-package-map',label:'外部制作包引用不匹配'});
    const reviewItems = [
      {kind:'version-difference',targetId:'linxia-hotel',label:'林夏 · 酒店制服有项目新图',detail:'本集使用图与项目最新图不同',action:'比较图片',thumbnail:{tone:'blue',label:'林夏酒店制服'}},
      ...(!readySelection?[{kind:'missing-required-voice',targetId:'manager-voice',label:'酒店经理缺少本集所需音色',detail:'当前声音策略要求人物参考音色',action:'配置音色',thumbnail:{tone:'amber',label:'酒店经理音色'}}]:[]),
    ];
    const page = {
      projectId:String(projectId),episodeId:String(episodeId),scenarioId,scenario:scenarios[scenarioId],
      featureName:'本集设定',title:'本集设定',subtitle:'只展示本集剧本实际引用的人物、场景和道具',
      pageContext:{breadcrumb:['凌晨两点的客房服务','第 1 集'],backLabel:'返回剧集',backTarget:{routeId:'project-episodes',params:{projectId:String(projectId)}}},
      lifecycleMode:scenarioId==='first-preparation'?'first-preparation':scenarioId.startsWith('external-package')?'external-package':'delta-check',
      showAllRequired:scenarioId==='first-preparation',
      stageNavigation:[
        {id:'script',label:'剧本',routeId:'studio-script',state:'done'},
        {id:'assets',label:'设定',routeId:'studio-assets',state:'current'},
        {id:'storyboard',label:'分镜',routeId:'studio-storyboard',state:'blocked',reason:'酒店经理缺少条件音色'},
        {id:'cut',label:'成片',routeId:'studio-cut',state:'blocked',reason:'请先完成分镜'},
      ],
      source:{scriptRevision:'script-r11',projectLookRevision:'look-v4'},
      tabs:[
        {id:'characters',label:'角色'},
        {id:'scenes',label:'场景'},
        {id:'props',label:'道具'},
      ],
      cards:[],
      requiredGroups,
      reviewItems,
      snapshot:{id:'asset-snapshot-draft-13',immutable:true,autoRefreshFromProject:false,entryAction:'enter-storyboard',hiddenFromDefaultCopy:true,captures:['asset/version id','media hash','voice revision','Look revision','selection reason'],transactional:true},
      gate:{blockers,warnings:[{id:'linxia-version',label:'林夏有项目新图可选'}]},
      audioPolicy:readySelection?'人物参考音色 · 已选择':'人物参考音色 · 缺少酒店经理音色',
      missingMaterialsAction:{id:'prepare-missing',label:'准备缺失素材'},
      missingMaterialsPreflight:{items:[{id:'manager-voice',label:'酒店经理音色',channel:'MiniMax TTS',model:'speech-02-hd',reference:'无',count:1,execution:'远端'}],taskCount:1,estimatedCost:'¥0.08',estimatedTime:'约 20–40 秒'},
      externalPackage:scenarioId.startsWith('external-package')?{
        packageId:'pkg_ep01_20260908',summary:{provided:6,reused:3,created:2,skipped:1,missing:1},columns:['外部包候选','项目当前图','本集选择'],
        mappings:[
          {id:'linxia-hotel',label:'林夏 · 酒店制服',externalCandidate:'外部候选 A',projectCurrent:'项目最新图 v3',episodeSelection:'本集使用图 v2',decision:'继续本集原图',status:'待比较'},
          {id:'corridor-night',label:'13 层走廊 · 停电',externalCandidate:'无',projectCurrent:'项目最新图 v4',episodeSelection:'本集使用图 v4',decision:'复用项目素材',status:'已匹配'},
          {id:'manager-voice',label:'酒店经理音色',externalCandidate:'无',projectCurrent:'无',episodeSelection:'未选择',decision:'准备缺失素材',status:packageMismatch?'不匹配':'缺失'},
        ],
      }:null,
    };
    page.cards = [
      ...requiredGroups.find(group => group.id === 'characters').items.map(item => ({ ...item, type: 'characters', assetId: item.id, stateId: item.id, mediaVersionId: item.episodeSelection, name: item.label, referencedByEpisode: true, issue: ['阻塞','文件离线'].includes(item.status) })),
      ...requiredGroups.find(group => group.id === 'scenes').items.map(item => ({ ...item, type: 'scenes', assetId: item.id, stateId: item.id, mediaVersionId: item.episodeSelection, name: item.label, referencedByEpisode: true, issue: ['阻塞','文件离线'].includes(item.status) })),
      ...requiredGroups.find(group => group.id === 'props').items.map(item => ({ ...item, type: 'props', assetId: item.id, stateId: item.id, mediaVersionId: item.episodeSelection, name: item.label, referencedByEpisode: true, issue: ['阻塞','文件离线'].includes(item.status) })),
    ];
    const synced = syncEpisodeAssetsDerived(page);
    if (scenarioId === 'loading') {
      synced.primaryAction={id:'checking',label:'正在检查…',enabled:false};
    } else if (scenarioId === 'checking') {
      synced.primaryAction={id:'checking',label:'正在检查…',enabled:false};
    } else if (scenarioId === 'snapshot-saving') {
      synced.primaryAction={id:'snapshot-saving',label:'正在准备分镜…',enabled:false};
    } else if (scenarioId === 'snapshot-succeeded') {
      synced.primaryAction={id:'open-storyboard',label:'打开分镜',enabled:true,target:{routeId:'studio-storyboard',params:{projectId:String(projectId),episodeId:String(episodeId)},scenarioId:'default'}};
    } else if (scenarioId === 'check-failed') {
      synced.mediaReadiness.status='checking';
      synced.mediaReadiness.summary='检查没有完成，可再次检查';
      synced.primaryAction={id:'retry-check',label:'再次检查',enabled:true};
    } else if (scenarioId === 'media-offline') {
      synced.primaryAction={id:'relocate-media',label:'重新定位离线素材',enabled:true,focusId:'corridor-night'};
    } else if (scenarioId === 'external-package-mismatch') {
      synced.primaryAction={id:'review-package-mismatch',label:'检查外部包映射',enabled:true,focusId:'external-package-map'};
    }
    return synced;
  }

  function getAiSettingsModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'credential-expired':{kind:'blocking',title:'MiniMax 凭据已过期',detail:'新任务被阻止，已运行任务保持原 runtime owner。',actions:[{id:'replace-key',label:'更换密钥'},{id:'test-connection',label:'重新测试'}]},
      'connection-failed':{kind:'recoverable-error',title:'连接测试失败',detail:'DNS 解析失败；没有提交生成请求，也没有产生费用。',actions:[{id:'retry-test',label:'重试连接'},{id:'open-network',label:'查看网络诊断'}]},
      'import-conflict':{kind:'blocking',title:'导入配置与本机存在 2 项冲突',detail:'密钥不会随配置文件导入；请逐项选择保留本机或采用映射。',actions:[{id:'resolve-import',label:'逐项处理'},{id:'cancel-import',label:'取消导入'}]},
      'chatgpt-waiting':{kind:'running',title:'ChatGPT 网页任务等待外部完成',detail:'session 与 attempt 已保存；没有可信百分比，可安全离开。',actions:[{id:'open-session',label:'打开会话'},{id:'select-result',label:'选择结果'}]},
      'chatgpt-rebind':{kind:'warning',title:'原网页会话不可访问',detail:'可将新标签页绑定到同一 attempt；输入 fingerprint 不匹配时必须阻断。',actions:[{id:'rebind-tab',label:'重新绑定标签页'},{id:'view-fingerprint',label:'查看输入指纹'}]},
      'chatgpt-ready':null,
      'chatgpt-login-required':{kind:'warning',title:'ChatGPT 登录已失效',detail:'默认通道仍是 ChatGPT 网页；重新登录后可继续，不会自动改写默认值。',actions:[{id:'login-chatgpt',label:'打开并登录'}]},
      'chatgpt-bridge-offline':{kind:'warning',title:'网页桥接未连接',detail:'默认通道仍是 ChatGPT 网页；可以修复桥接或仅本次改用其他通道。',actions:[{id:'repair-bridge',label:'修复桥接'}]},
      'provider-loading':{kind:'running',title:'正在读取 Provider 能力',detail:'正在读取地址、模型列表和能力声明；尚未保存修改。',actions:[{id:'wait-provider',label:'等待读取'}]},
      'model-list-failed':{kind:'recoverable-error',title:'模型列表读取失败',detail:'连接已建立但模型列表不可用；可重试或手动输入已知模型。',actions:[{id:'retry-model-list',label:'重试读取'},{id:'manual-model',label:'手动填写模型'}]},
      'provider-disabled':{kind:'blocking',title:'Provider 已停用',detail:'停用只影响新任务；已有任务继续使用创建时的任务快照。',actions:[{id:'enable-provider',label:'重新启用'},{id:'view-running',label:'查看运行中任务'}]},
      'local-unavailable':{kind:'recoverable-error',title:'本地 Provider 不可用',detail:'ComfyUI 地址无法访问；不会把项目默认静默改到其他通道。',actions:[{id:'retry-local',label:'重试连接'},{id:'switch-one-shot',label:'仅本次换通道'}]},
      'cert-error':{kind:'recoverable-error',title:'证书校验失败',detail:'TLS 证书不受信任；默认值保持不变，需修复证书或明确允许本地例外。',actions:[{id:'open-cert-diagnostic',label:'查看诊断'}]},
      'proxy-error':{kind:'recoverable-error',title:'代理连接失败',detail:'请求未到达 Provider；检查代理地址、超时和系统网络设置。',actions:[{id:'open-proxy-diagnostic',label:'查看网络诊断'}]},
      'partial-capability':{kind:'warning',title:'Provider 仅支持部分能力',detail:'当前模型支持图片但不支持批量和取消；任务按钮将按能力禁用。',actions:[{id:'view-capability',label:'查看能力'}]},
      'model-retired':{kind:'warning',title:'默认模型已下线',detail:'运行中任务仍使用原快照；新任务需选择替代模型。',actions:[{id:'choose-model',label:'选择替代模型'}]},
      'save-conflict':{kind:'blocking',title:'保存配置发生冲突',detail:'另一个窗口已修改相同 Provider；请比较后选择保留本机或采用最新版本。',actions:[{id:'resolve-save-conflict',label:'比较并处理'}]},
      'save-failed':{kind:'recoverable-error',title:'配置保存失败',detail:'本次输入仍保留在抽屉中；未写入不完整配置。',actions:[{id:'retry-save',label:'重试保存'}]},
      'key-invalid':{kind:'blocking',title:'密钥格式不正确',detail:'密钥只在本机安全存储，当前值未保存；请检查前缀和长度。',actions:[{id:'replace-key',label:'修改密钥'}]},
      'snapshot-mismatch':{kind:'warning',title:'任务配置快照与当前默认不同',detail:'这是预期的历史差异；不会覆盖任务快照，重试时可选择沿用原快照或新建任务。',actions:[{id:'use-snapshot',label:'沿用任务快照'},{id:'use-current',label:'使用当前配置'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown AI settings scenario: ${scenarioId}`);
    return {
      scenarioId,scenario:scenarios[scenarioId],featureName:'AI 配置',layers:['全局默认','项目覆盖','任务快照'],
      providers:[
        {id:'minimax',name:'MiniMax / H3',status:'已连接',secretMasked:'••••••••4K9P',roles:['视频','TTS'],models:['H3 Story Video','speech-02-hd'],capabilities:['进度','取消','重试','多参考']},
        {id:'openai-compatible',name:'OpenAI Compatible',status:'已连接',secretMasked:'••••••••91AX',roles:['文本','图片'],models:['drama-script-v2','flux-image'],capabilities:['取消','重试']},
        {id:'chatgpt-web',name:'ChatGPT 网页',status:'需要浏览器会话',secretMasked:'浏览器授权，不保存密钥',roles:['图片'],models:['网页生图'],capabilities:['waiting_external','重新绑定']},
        {id:'comfyui',name:'ComfyUI 本地',status:'在线',secretMasked:'本地连接，无密钥',roles:['图片','超分'],models:['SDXL Canonical','SeedVR'],capabilities:['进度','取消','暂停','恢复']},
      ],
      mappings:[{role:'剧本生成',provider:'OpenAI Compatible',model:'drama-script-v2'},{role:'镜头视频',provider:'MiniMax',model:'H3 Story Video'},{role:'后期超分',provider:'ComfyUI',model:'SeedVR'}],
      connectionTest:{createsGenerationCost:false,checks:['地址可达','认证有效','模型可列举','能力探测']},
      configTransfer:{exportsSecrets:false,conflictPolicy:'per-item-explicit-choice'},
      resolutionOrder:['one-shot','project','global','install'],
      channelCards:[
        {id:'chatgpt_web',label:'ChatGPT 网页',taskTypes:['图片'],availability:'需浏览器会话',network:'网页桥接',cost:'¥0',trustedProgress:false,cancelPause:'不支持取消/暂停',userPresence:'需要用户在场'},
        {id:'api',label:'API',taskTypes:['剧本','图片','视频','TTS'],availability:'可用',network:'云端 API',cost:'按 Provider 计费',trustedProgress:'按 Provider',cancelPause:'按能力支持',userPresence:'无需在场'},
        {id:'comfyui',label:'ComfyUI 本地',taskTypes:['图片','超分','音频后期'],availability:'在线',network:'本机 / 局域网',cost:'本地资源',trustedProgress:true,cancelPause:'支持暂停/恢复',userPresence:'无需在场'},
      ],
      businessMappingGroups:[
        {id:'creation',label:'创作',items:[{id:'script',label:'剧本生成',provider:'OpenAI Compatible',model:'drama-script-v2'}]},
        {id:'media',label:'图片、视频、声音与协作',items:[{id:'image',label:'分镜 / 资产生图',provider:'ChatGPT 网页',model:'网页生图'},{id:'video',label:'镜头视频',provider:'MiniMax',model:'H3 Story Video'},{id:'tts',label:'对白与旁白 TTS',provider:'MiniMax',model:'speech-02-hd'},{id:'external-ai',label:'外部 AI 协作',provider:'用户选择',model:'V2.1 制作包'}]},
        {id:'post',label:'后期处理',items:[{id:'composite',label:'基础合片与编码',provider:'本地 Runtime',model:'Local Composite'},{id:'upscale',label:'整片超分',provider:'ComfyUI',model:'SeedVR'},{id:'audio-post',label:'混音与音频后期',provider:'ComfyUI',model:'Audio Post'}]},
      ],
      securityPolicy:{secretStorage:'仅本机安全存储',exportedSecrets:false,browserAuthExported:false,taskSnapshotSecrets:false},
      diagnostics:{lastCheckedAt:'今天 14:32',zeroCost:true,offlineSupport:['ComfyUI 本地'],failureRecovery:'失败和冲突进入抽屉或诊断页，不使用 Toast 作为唯一反馈'},
    };
  }

  function getAiSettingsOneShotModel(channel = 'api') {
    const labels={api:'API',comfyui:'ComfyUI',chatgpt_web:'ChatGPT 网页'};
    return {channel,label:labels[channel]||channel,changesPersistedDefault:false,scope:'仅本次任务',prefilled:true,rerunsCapabilityCheck:true,returnTarget:{routeId:'tasks',params:{},scenarioId:'default'},preserves:['项目默认','全局默认','安装默认']};
  }

  function getAiSettingsImportModel(scenarioId = 'default') {
    if (scenarioId === 'import-conflict') return {phase:'conflict',fileName:'ai-config-2026-09-09.json',version:'2.1',secretsIncluded:false,conflicts:[{id:'image-default',label:'图片默认通道',local:'ChatGPT 网页',incoming:'API',choices:['保留本机','采用导入映射','跳过']},{id:'h3-model',label:'H3 模型',local:'H3 Story Video',incoming:'H3 Story Video v2',choices:['保留本机','采用导入映射']}],confirmRequiresExplicitChoices:true};
    return {phase:'ready',fileName:'待选择配置文件',version:'—',secretsIncluded:false,conflicts:[],excluded:['密钥','浏览器授权','运行中任务快照']};
  }

  function getAiSettingsExportModel() {
    return {fileName:'localminidrama-ai-config-v2.1.json',version:'2.1',secretsIncluded:false,excluded:['密钥','浏览器授权','任务快照中的认证信息'],includes:['Provider 地址（脱敏）','模型与能力映射','全局默认与项目覆盖','超时和并发策略']};
  }

  function resolveDefaultImageChannel({ oneShot, projectDefault, globalDefault, installDefault = 'api' } = {}) {
    const valid = new Set(['chatgpt_web', 'api', 'comfyui']);
    for (const [source, value] of [
      ['one-shot', oneShot], ['project', projectDefault], ['global', globalDefault], ['install', installDefault],
    ]) {
      if (valid.has(value)) return { channel: value, source };
    }
    return { channel: 'api', source: 'install' };
  }

  function getChatGptEnvironmentModel(scenarioId = 'ready') {
    const scenarios = {
      ready: { readiness: 'ready', failedCheck: null },
      'login-required': { readiness: 'needs_action', failedCheck: 'login-session' },
      'bridge-offline': { readiness: 'unavailable', failedCheck: 'workbench-bridge' },
    };
    const scenario = scenarios[scenarioId];
    if (!scenario) throw new Error(`Unknown ChatGPT environment scenario: ${scenarioId}`);
    const definitions = [
      { id: 'channel-enabled', label: '网页生图通道已启用', recoveryAction: '启用通道' },
      { id: 'browser-profile', label: '浏览器与 Profile 可访问', recoveryAction: '选择浏览器 Profile' },
      { id: 'workbench-bridge', label: '网页桥接可连接', recoveryAction: '启动或修复浏览器桥接' },
      { id: 'login-session', label: 'ChatGPT 登录会话有效', recoveryAction: '打开 ChatGPT 并重新登录' },
      { id: 'result-capture', label: '结果捕获通道可用', recoveryAction: '重新绑定结果标签页' },
    ];
    const checks = definitions.map(item => ({
      ...item,
      status: item.id === scenario.failedCheck ? 'failed' : 'passed',
      recoveryAction: item.id === scenario.failedCheck ? item.recoveryAction : null,
      checkedAt:'今天 14:32',
      blocksNewTasks:item.id === scenario.failedCheck,
      affectsRunningTasks:false,
      diagnostic:item.id === scenario.failedCheck ? `${item.label}未通过；默认值保留，已创建任务继续沿用其快照。` : '检查通过',
      recoveryTarget:item.id === scenario.failedCheck ? {routeId:'settings-ai',params:{},scenarioId:scenarioId==='login-required'?'chatgpt-login-required':'chatgpt-bridge-offline'} : null,
    }));
    return {
      channel: 'chatgpt_web',
      readiness: scenario.readiness,
      persistedDefault: 'chatgpt_web',
      checks,
      canSubmit: scenario.readiness === 'ready',
      oneShotFallbacks: ['api', 'comfyui'],
      changesPersistedDefault: false,
      generationCost: 0,
    };
  }

  function getImageChannelSettingsModel(scope = 'global', scenarioId = 'ready') {
    if (!['global', 'project'].includes(scope)) throw new Error(`Unknown image channel settings scope: ${scope}`);
    return {
      scope,
      persistedDefault: 'chatgpt_web',
      availableChannels: [
        { id: 'chatgpt_web', label: 'ChatGPT 网页', mayBeDefault: true, taskTypes:['图片'], availability:'需浏览器会话', network:'网页桥接', cost:'¥0' },
        { id: 'api', label: 'API', mayBeDefault: true, taskTypes:['剧本','图片','视频','TTS'], availability:'可用', network:'云端 API', cost:'按 Provider 计费' },
        { id: 'comfyui', label: 'ComfyUI', mayBeDefault: true, taskTypes:['图片','超分','音频后期'], availability:'在线', network:'本机 / 局域网', cost:'本地资源' },
      ],
      environment: getChatGptEnvironmentModel(scenarioId),
      environmentCheck: { createsGenerationCost: false },
      mayPersistUnavailableDefaultAfterExplicitConfirmation: true,
      resolutionOrder: ['one-shot', 'project', 'global', 'install'],
    };
  }

  function createTaskRecord(input) {
    const record = {
      context: { project: input.projectName || '凌晨两点的客房服务', episode: `第 ${input.episodeId || '1'} 集`, stage: input.stage || '分镜', object: input.object || input.title },
      taskType: input.taskType || input.type,
      execution: input.execution || (input.channel === 'h3' ? 'provider' : input.channel === 'external' ? 'external-manual' : input.channel === 'chatgpt_web' ? 'web' : 'api'),
      provider: input.provider || (input.channel === 'h3' ? 'MiniMax H3' : input.channel === 'chatgpt_web' ? 'ChatGPT 网页' : input.channel === 'external' ? '外部 AI' : 'Image API'),
      model: input.model || (input.channel === 'h3' ? 'H3' : input.channel === 'chatgpt_web' ? 'ChatGPT' : '—'),
      cost: input.cost || { estimate: input.channel === 'chatgpt_web' ? '¥0' : '¥0.32', actual: null, billingStatus: 'unknown' },
      timestamps: input.timestamps || { submittedAt: '今天 14:26', startedAt: input.lifecycle === 'queued' ? null : '今天 14:27', lastConfirmedAt: '今天 14:32', completedAt: input.lifecycle === 'completed' ? '今天 14:33' : null, queueDuration: input.lifecycle === 'queued' ? '等待中' : '18 秒', executionDuration: input.lifecycle === 'completed' ? '24 秒' : '3 分 12 秒', totalDuration: input.lifecycle === 'completed' ? '42 秒' : '—' },
      retrySemantics: { frozenSnapshot: true, newAttempt: true, preservesCandidates: true, changedSettingsReturnsToOrigin: true },
      error: input.error || null,
      ...input,
    };
    record.actions = record.actions || [record.primaryAction?.label].filter(Boolean);
    return record;
  }

  function getGlobalTaskModel(focusTaskId = '') {
    const tasks = [
      createTaskRecord({ id:'task-shot-03-image',projectId:'7',episodeId:'1',type:'image',taskType:'图片',channel:'chatgpt_web',title:'凌晨两点的客房服务 / 第 1 集 / 分镜 / 镜头 03',status:'等待用户处理',creatorStatus:'等待网页结果',lifecycle:'waiting_user',responsibility:'user',progressPercent:null,progressSource:'unavailable',elapsed:'1分08秒',estimate:'通常需要 1–3 分钟',object:'镜头 03',primaryAction:{id:'open-web-session',label:'打开网页会话',target:{routeId:'settings-ai',params:{},scenarioId:'chatgpt-waiting'}},technical:{attemptId:'attempt-7',fingerprint:'sha256:3e8d…',providerStatus:'submitted',runtimeOwner:'chatgpt_web'}}),
      createTaskRecord({ id:'task-shot-03-video',projectId:'7',episodeId:'1',type:'video',taskType:'视频',channel:'h3',title:'凌晨两点的客房服务 / 第 1 集 / 分镜 / 镜头 03',status:'运行中 64%',creatorStatus:'生成中 64%',lifecycle:'running',responsibility:'system',progressPercent:64,progressSource:'provider',elapsed:'3分12秒',estimate:'预计剩余 2–5 分钟',object:'镜头 03',primaryAction:{id:'open-video-task',label:'查看任务',target:{routeId:'studio-storyboard',params:{projectId:'7',episodeId:'1',shotId:'shot-03'}}},technical:{attemptId:'attempt-9',fingerprint:'sha256:8b4a…',providerStatus:'running',runtimeOwner:'minimax-h3'}}),
      createTaskRecord({ id:'task-shot-05-video',projectId:'7',episodeId:'1',type:'video',taskType:'视频',channel:'h3',title:'凌晨两点的客房服务 / 第 1 集 / 分镜 / 镜头 05',status:'需要重新登录',creatorStatus:'认证已过期',lifecycle:'blocked_auth',responsibility:'auth',progressPercent:null,progressSource:'unavailable',elapsed:'等待 2分14秒',estimate:'恢复认证后继续原任务',object:'镜头 05',actions:['恢复认证','查看输入'],primaryAction:{id:'restore-auth',label:'恢复认证',target:{routeId:'settings-ai',params:{},scenarioId:'chatgpt-login-required'}},cost:{estimate:'¥0.32',actual:null,billingStatus:'unknown'},error:{source:'MiniMax H3',code:'AUTH_EXPIRED',userMessage:'Provider 登录已过期，任务尚未确认是否计费',charged:'unknown'},technical:{attemptId:'attempt-12',fingerprint:'sha256:c019…',providerStatus:'blocked',runtimeOwner:'minimax-h3'}}),
      createTaskRecord({ id:'external-ai-pkg-ep09',projectId:'7',episodeId:'9',type:'external-ai',taskType:'外部协作',channel:'external',title:'外部 AI 协作 · 创建第 9 集',status:'需要选择结果',creatorStatus:'等待外部 AI 结果',lifecycle:'waiting_user',responsibility:'user',progressPercent:null,progressSource:'unavailable',elapsed:'2小时',estimate:'等待用户选择返回 JSON',stage:'外部协作',object:'任务包 pkg_ep09',primaryAction:{id:'select-result',label:'选择结果',target:{routeId:'project-episodes',params:{projectId:'7',episodeId:'9'},scenarioId:'episode-json-import'}},technical:{attemptId:'pkg_ep09_20260909',fingerprint:'assets_digest 4f92c881…0a7d',providerStatus:'waiting_external',runtimeOwner:'user-mediated-external-ai'}}),
    ];
    return {featureName:'全局任务',focusTaskId,tabs:['进行中','需要处理','历史'],tasks,capabilityRule:'actions-from-provider-capability-only'};
  }

  function getTaskCenterModel(filters = {}, scenarioId = 'default') {
    const normalizedFilters = { projectId: filters.projectId ? String(filters.projectId) : null, episodeId: filters.episodeId ? String(filters.episodeId) : null, type: filters.type || null, channel: filters.channel || null, status: filters.status || null, execution: filters.execution || null, query: filters.query || null, focusTaskId: filters.focusTaskId || null, tab: filters.tab || null };
    const baseTasks = getGlobalTaskModel().tasks.map(item => ({ ...item, groupId: item.lifecycle === 'running' ? 'in-progress' : item.lifecycle === 'completed' ? 'history' : 'needs-action' }));
    baseTasks.push(createTaskRecord({ id:'task-shot-01-image',projectId:'9',episodeId:'4',type:'image',taskType:'图片',channel:'api',groupId:'history',title:'雾港来信 / 第 4 集 / 分镜 / 镜头 01',creatorStatus:'已完成',lifecycle:'completed',responsibility:'system',progressPercent:100,progressSource:'provider',elapsed:'42秒',estimate:'已完成',object:'镜头 01',primaryAction:{id:'open-result',label:'查看候选',target:{routeId:'studio-storyboard',params:{projectId:'9',episodeId:'4',shotId:'shot-01'}}},technical:{attemptId:'attempt-3',fingerprint:'sha256:01ef…',providerStatus:'completed',runtimeOwner:'image-api'}}));
    const parentTask = createTaskRecord({ id:'batch-episode-01-video',projectId:'7',episodeId:'1',type:'batch',taskType:'批量视频',channel:'h3',groupId:'needs-action',title:'凌晨两点的客房服务 / 第 1 集 / 批量视频生成',creatorStatus:'部分成功',lifecycle:'partial_success',responsibility:'user',object:'12 个镜头',primaryAction:{id:'retry-failed-only',label:'仅重试失败项',target:{routeId:'studio-storyboard',params:{projectId:'7',episodeId:'1'}}},cost:{estimate:'¥3.84',actual:'¥2.24',billingStatus:'partially-charged'},technical:{attemptId:'batch-attempt-4',fingerprint:'sha256:batch…',providerStatus:'partial_success',runtimeOwner:'minimax-h3'}});
    let tasks = scenarioId === 'partial-success' ? [parentTask, ...baseTasks] : baseTasks;
    if (scenarioId === 'empty' || scenarioId === 'filter-empty' || scenarioId === 'loading' || scenarioId === 'load-failed') tasks = [];
    if (scenarioId === 'queued') tasks = [createTaskRecord({ ...baseTasks[1], lifecycle:'queued', groupId:'in-progress', creatorStatus:'排队中', status:'排队中', primaryAction:{id:'open-task',label:'查看任务',target:{routeId:'tasks',params:{focusTaskId:'task-shot-03-video'}}} })];
    if (scenarioId === 'monitoring-external') tasks = [createTaskRecord({ ...baseTasks[0], lifecycle:'monitoring_external', groupId:'in-progress', responsibility:'system', creatorStatus:'系统正在观察网页结果', status:'监控外部结果' })];
    if (scenarioId === 'waiting-user') tasks = [baseTasks[3]];
    if (scenarioId === 'blocked-auth') tasks = [baseTasks[2]];
    if (scenarioId === 'failed') tasks = [createTaskRecord({ ...baseTasks[1], lifecycle:'failed', groupId:'needs-action', responsibility:'user', creatorStatus:'生成失败', status:'生成失败', error:{source:'MiniMax H3',code:'TIMEOUT',userMessage:'Provider 超时，未确认计费',charged:'not-charged'} })];
    if (scenarioId === 'cancel-requested') tasks = [createTaskRecord({ ...baseTasks[1], lifecycle:'cancel_requested', groupId:'in-progress', responsibility:'system', creatorStatus:'正在请求取消', status:'取消请求中' })];
    if (scenarioId === 'cancelled') tasks = [createTaskRecord({ ...baseTasks[1], lifecycle:'cancelled', groupId:'history', responsibility:'system', creatorStatus:'已取消', status:'已取消' })];
    if (scenarioId === 'unknown' || scenarioId === 'reconciling') tasks = [createTaskRecord({ ...baseTasks[1], lifecycle:scenarioId, groupId:'needs-action', responsibility:'unknown', creatorStatus:scenarioId === 'unknown' ? '状态未知' : '正在核对状态', status:scenarioId === 'unknown' ? '需要核对' : '核对中', primaryAction:{id:'reconcile',label:'核对状态',target:{routeId:'tasks',params:{focusTaskId:'task-shot-03-video'},scenarioId:'reconciling'}} })];
    const visible = tasks.filter(item => (!normalizedFilters.projectId || item.projectId === normalizedFilters.projectId) && (!normalizedFilters.episodeId || item.episodeId === normalizedFilters.episodeId) && (!normalizedFilters.type || item.type === normalizedFilters.type) && (!normalizedFilters.channel || item.channel === normalizedFilters.channel) && (!normalizedFilters.execution || item.execution === normalizedFilters.execution) && (!normalizedFilters.query || `${item.title} ${item.context.object}`.includes(normalizedFilters.query))).map(item => ({ ...item, focused: item.id === normalizedFilters.focusTaskId }));
    const connection = scenarioId === 'offline' ? { frontend:'offline', executor:'unknown', lastConfirmedAt:'今天 14:32' } : { frontend:'online', executor:'online', lastConfirmedAt:'刚刚' };
    if (scenarioId === 'offline') visible.forEach(item => { item.primaryAction = { ...item.primaryAction, disabled: item.execution !== 'local' }; });
    return { featureName:'任务', scenarioId, filters:normalizedFilters, activeTab:normalizedFilters.tab || (normalizedFilters.focusTaskId ? (visible.find(item => item.focused)?.groupId === 'needs-action' ? 'needs-action' : 'in-progress') : 'in-progress'), tasks:visible, groups:[{id:'in-progress',label:'进行中',tasks:visible.filter(item => item.groupId === 'in-progress')},{id:'needs-action',label:'需要处理',tasks:visible.filter(item => item.groupId === 'needs-action')},{id:'completed',label:'历史',tasks:visible.filter(item => item.groupId === 'history' || item.groupId === 'completed')}], statusSummary:{inProgress:visible.filter(item => item.groupId === 'in-progress').length,needsAction:visible.filter(item => item.groupId === 'needs-action').length,history:visible.filter(item => item.groupId === 'history' || item.groupId === 'completed').length}, connection, autoRefresh:scenarioId !== 'offline', batch:scenarioId === 'partial-success' ? {parentId:'batch-episode-01-video',summary:{partialSuccess:true,success:7,running:2,failed:2,unknown:1},retryAction:{id:'retry-failed-only',label:'仅重试失败项'}} : null, capabilityRule:'actions-from-provider-capability-only', technicalDetailsCollapsed:true };
  }

  function getProjectCreateModel(scenarioId = 'default', options = {}) {
    const aliases = { 'source-picker': 'source-selected', 'shell-created': 'success' };
    const normalizedScenarioId = aliases[scenarioId] || scenarioId;
    const scenarios = {
      default:null,
      'source-selected':null,
      'validation-error':{kind:'blocking',title:'请检查项目信息',detail:'项目名称不能为空，画幅、时长和保存位置必须有效；尚未创建项目。',actions:[{id:'focus-invalid',label:'返回修改'}]},
      creating:{kind:'info',title:'正在创建项目',detail:'正在检查名称、目录权限和可用空间；请勿重复提交。',actions:[]},
      'name-conflict':{kind:'blocking',title:'项目名称已存在',detail:'不会覆盖同名项目，建议使用“午夜前台 2”或返回修改。',actions:[{id:'use-suggested-name',label:'使用建议名称'}]},
      'path-unavailable':{kind:'recoverable-error',title:'保存位置不可用',detail:'目录不可写或当前离线；已保留项目信息和开始方式。',actions:[{id:'choose-location',label:'重新选择位置'},{id:'retry-create',label:'重试'}]},
      'insufficient-space':{kind:'blocking',title:'可用空间不足',detail:'导入制作包需要约 4.8 GB；请选择其他位置后再创建。',actions:[{id:'choose-location',label:'更改保存位置'}]},
      'source-cancelled':{kind:'info',title:'项目已保存',detail:'第 1 集尚未创建，可以继续选择开始方式或先进入空项目。',actions:[{id:'continue-source',label:'继续创建第 1 集'},{id:'open-project',label:'进入项目'}]},
      'create-failed':{kind:'recoverable-error',title:'项目创建失败',detail:'没有留下部分写入；已保留所有输入和开始方式。',actions:[{id:'retry-create',label:'重试创建'},{id:'choose-location',label:'检查保存位置'}]},
      success:{kind:'success',title:'项目已创建',detail:'正在打开第 1 集的开始流程。',actions:[]},
    };
    if (!(normalizedScenarioId in scenarios)) throw new Error(`Unknown project create scenario: ${scenarioId}`);
    const scenarioDefaults = normalizedScenarioId === 'default'
      ? { name: '', selectedSourceId: '' }
      : normalizedScenarioId === 'validation-error'
        ? { name: '', selectedSourceId: 'script-import' }
        : { name: '午夜前台', selectedSourceId: 'script-import' };
    const state = { ...scenarioDefaults, ...options };
    const actionLabels = {
      'script-import':'创建项目并导入剧本',
      'ai-script':'创建项目并生成剧本',
      'package-import':'创建项目并导入制作包',
      blank:'创建空白项目',
      'novel-split':'创建项目并拆分小说',
      'source-video':'创建项目并导入视频',
    };
    const formLocked = normalizedScenarioId === 'creating' || normalizedScenarioId === 'success';
    const hasRequiredInput = Boolean(String(state.name || '').trim() && state.selectedSourceId);
    const safeDirectoryName = String(state.name || '').replace(/[<>:"/\\|?*]/g, '').trim() || '新项目';
    return {
      scenarioId:normalizedScenarioId,
      scenario:scenarios[normalizedScenarioId],
      featureName:'新建项目',
      subtitle:'设置项目信息，并选择第一集从哪里开始。',
      fields:[
        {id:'name',label:'项目名称',control:'text',value:state.name || '',placeholder:'输入项目名称',required:true},
        {id:'aspect-ratio',label:'画幅',control:'select',value:state.aspectRatio || '9:16',options:['9:16','16:9','1:1']},
        {id:'genre',label:'题材',control:'text',value:state.genre || '',placeholder:'例如：都市悬疑',required:false},
        {id:'output-location',label:'保存到',control:'directory',value:state.outputLocation || `E:/LocalMiniDrama/${safeDirectoryName}`,editable:false,preflight:['可写权限','名称冲突','可用空间']},
      ],
      sources:buildEpisodeCreationSources(),
      selectedSourceId:state.selectedSourceId || '',
      primaryAction:{id:'create-project',label:state.selectedSourceId ? actionLabels[state.selectedSourceId] : '选择开始方式',enabled:hasRequiredInput && !formLocked},
      formLocked,
      preservesInput:['validation-error','name-conflict','path-unavailable','insufficient-space','create-failed'].includes(normalizedScenarioId),
      createSequence:['填写项目信息','选择第一集开始方式','校验名称与保存位置','创建项目并打开对应流程'],
      cancelAfterCreate:{keepsEmptyProject:true,recoveryActions:['继续创建第 1 集','进入空项目','从项目菜单移入回收站']},
    };
  }

  function getProjectImportModel(scenarioId = 'default') {
    const archiveWithWarnings = {
      project: '凌晨两点的客房服务',
      version: '2.1',
      episodes: 8,
      media: { total: 23, available: 21, missing: 2 },
      tasks: 41,
      requiredSpace: '4.8 GB',
      sourcePath: 'E:/Backups/midnight-service-v2.1.zip',
    };
    const cleanArchive = {
      ...archiveWithWarnings,
      media: { total: 23, available: 23, missing: 0 },
    };
    const target = {
      projectName: '凌晨两点的客房服务（副本）',
      workspacePath: 'E:/LocalMiniDrama/projects',
      finalPath: 'E:/LocalMiniDrama/projects/凌晨两点的客房服务（副本）',
      availableSpace: '126.4 GB',
      requiredSpace: '4.8 GB',
      peakSpace: '9.6 GB',
      mediaStrategy: 'copy',
    };
    const checks = missing => [
      { id: 'archive-version', label: '归档格式与版本', status: 'passed', detail: '项目归档 2.1' },
      { id: 'data-structure', label: '内容完整', status: 'passed', detail: '项目、剧集和资产结构完整' },
      { id: 'file-integrity', label: '文件完整性', status: 'passed', detail: '归档内 23 个文件已全部校验，无损坏' },
      { id: 'media-availability', label: '媒体可用性', status: missing ? 'warning' : 'passed', detail: missing ? `缺失 ${missing} 个，可在导入后重新定位` : '全部媒体可用' },
      { id: 'target-space', label: '目标磁盘空间', status: 'passed', detail: '导入需要临时空间 9.6 GB，当前可用 126.4 GB' },
      { id: 'project-name', label: '项目名称', status: 'passed', detail: '已自动使用不冲突的副本名称' },
    ];
    const definitions = {
      default: {
        phase: 'initial',
        archive: null,
        checks: [],
        canImport: false,
        primaryAction: { id: 'select-archive', label: '选择项目归档', enabled: true },
        secondaryActions: [],
        scenario: null,
      },
      validating: {
        phase: 'validating',
        archive: archiveWithWarnings,
        checks: [
          { id: 'archive-version', label: '归档格式与版本', status: 'checking', detail: '正在读取 Manifest' },
          { id: 'data-structure', label: '内容完整', status: 'waiting', detail: '等待版本检查' },
          { id: 'file-integrity', label: '文件完整性', status: 'waiting', detail: '等待结构检查' },
        ],
        canImport: false,
        validationProgress: { percent: 46, step: '正在核对媒体文件 Hash' },
        primaryAction: { id: 'validation-running', label: '正在检查归档…', enabled: false },
        secondaryActions: [{ id: 'choose-file', label: '更换归档' }],
        scenario: { kind: 'running', title: '正在检查项目归档', detail: '正在读取结构、核对文件并计算导入所需空间。', actions: [] },
      },
      ready: {
        phase: 'ready', archive: cleanArchive, checks: checks(0), target, canImport: true,
        primaryAction: { id: 'commit-project-import', label: '导入为新项目', enabled: true },
        secondaryActions: [{ id: 'choose-file', label: '更换归档' }], scenario: null,
      },
      'ready-with-warnings': {
        phase: 'ready-with-warnings', archive: archiveWithWarnings, checks: checks(2), target, canImport: true,
        primaryAction: { id: 'commit-project-import', label: '仍然导入为新项目', enabled: true },
        secondaryActions: [{ id: 'view-missing-media', label: '查看缺失文件' }, { id: 'choose-file', label: '更换归档' }],
        scenario: { kind: 'warning', title: '可以导入，但有 2 个媒体暂时离线', detail: '相关镜头和任务记录会保留；导入后重新定位媒体即可继续使用。', actions: [] },
      },
      'unsupported-archive': {
        phase: 'unsupported', archive: { ...archiveWithWarnings, version: '1.4' }, detectedVersion: '1.4', checks: [
          { id: 'archive-version', label: '归档格式与版本', status: 'blocking', detail: '检测到 1.4，仅支持 2.1' },
          { id: 'data-structure', label: '内容完整', status: 'waiting', detail: '版本不支持，未继续检查' },
        ], canImport: false,
        primaryAction: { id: 'choose-file', label: '重新选择归档', enabled: true },
        secondaryActions: [{ id: 'view-guide', label: '查看旧版本处理说明' }],
        scenario: { kind: 'blocking', title: '不支持此项目归档版本', detail: '检测到 1.4；当前只接受 local-mini-drama.project-archive@2.1，不会猜测升级或部分写入。', actions: [] },
      },
      importing: {
        phase: 'importing', archive: archiveWithWarnings, checks: checks(2), target, canImport: false,
        job: { id: 'project-import-job-031', persistent: true, visibleInTaskCenter: true, progress: 44, progressBytes: '2.1 GB / 4.8 GB', step: '正在复制媒体 14 / 23' },
        primaryAction: { id: 'import-running', label: '正在导入 2.1 GB / 4.8 GB', enabled: false },
        secondaryActions: [{ id: 'open-import-task', label: '在任务中心查看' }],
        scenario: { kind: 'running', title: '项目正在导入', detail: '这是可恢复的本地任务；离开页面不会中止导入。', actions: [] },
      },
      failed: {
        phase: 'rolled-back', archive: archiveWithWarnings, checks: checks(2), target, canImport: false,
        failure: { step: '复制媒体', reason: '目标磁盘写入失败', rolledBack: true, safeToRetry: true, temporaryFiles: '已清理', reportPath: 'E:/LocalMiniDrama/reports/import-031.json' },
        primaryAction: { id: 'retry-import', label: '重试导入', enabled: true },
        secondaryActions: [{ id: 'choose-file', label: '重新选择归档' }, { id: 'open-report', label: '查看导入报告' }],
        scenario: { kind: 'recoverable-error', title: '导入已完整回滚', detail: '复制媒体时磁盘写入失败；现有项目未受影响，可以释放空间后安全重试。', actions: [] },
      },
      succeeded: {
        phase: 'success', archive: cleanArchive, checks: checks(0), target, canImport: false,
        result: { projectId: 'imported-031', projectName: target.projectName, projectPath: target.finalPath, missingMedia: 0, historyTasksRestored: 41, historyTasksAutoResume: false },
        primaryAction: { id: 'open-project', label: '打开项目', enabled: true },
        secondaryActions: [{ id: 'open-report', label: '查看导入报告' }],
        scenario: { kind: 'success', title: '项目归档已导入', detail: '已创建新的本地项目；41 条历史任务仅用于查看，不会重新调用 Provider。', actions: [] },
      },
      'partial-success': {
        phase: 'partial-success', archive: archiveWithWarnings, checks: checks(2), target, canImport: false,
        result: { projectId: 'imported-031', projectName: target.projectName, projectPath: target.finalPath, missingMedia: 2, historyTasksRestored: 41, historyTasksAutoResume: false },
        primaryAction: { id: 'open-project', label: '打开项目', enabled: true },
        secondaryActions: [{ id: 'relocate-media', label: '重新定位媒体' }, { id: 'open-report', label: '查看导入报告' }],
        scenario: { kind: 'warning', title: '项目已导入，2 个媒体待重定位', detail: '项目、引用和历史任务记录已经恢复；离线媒体不会自动重新生成。', actions: [] },
      },
    };
    if (!(scenarioId in definitions)) throw new Error(`Unknown project import scenario: ${scenarioId}`);
    return {
      scenarioId,
      featureName: '导入项目归档',
      acceptedArchive: 'local-mini-drama.project-archive@2.1',
      rejectsEpisodePackage: true,
      transactional: true,
      defaultStrategies: ['import-as-new'],
      replacementPolicy: 'only-through-explicit-restore-flow',
      reportPreservedOnFailure: true,
      ...definitions[scenarioId],
    };
  }

  function getGeneralSettingsModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'storage-offline':{kind:'blocking',title:'媒体根目录不可访问',detail:'不会自动改写路径；请重新连接磁盘或进入高级数据工具执行重定位。',actions:[{id:'open-relocation',label:'打开媒体重定位'},{id:'retry-storage',label:'重新检测'}]},
      'save-conflict':{kind:'recoverable-error',title:'设置已在另一窗口更新',detail:'你的未保存值已保留，可比较后重新提交。',actions:[{id:'compare-settings',label:'比较差异'},{id:'reload-settings',label:'载入最新'}]},
      loading:{kind:'loading',title:'正在读取本地设置',detail:'正在检查目录、空间和备份状态。',actions:[]},
      saving:{kind:'running',title:'正在保存设置',detail:'正在安全写入配置；当前输入已保留。',actions:[]},
      'save-failed':{kind:'recoverable-error',title:'设置保存失败',detail:'当前输入仍保留；旧配置继续生效，可以安全重试。',actions:[{id:'retry-save',label:'重试保存'}]},
      'path-not-found':{kind:'blocking',title:'目录不存在',detail:'未自动替换旧路径；请选择已存在的目录或进入高级数据工具。',actions:[{id:'choose-path',label:'重新选择目录'},{id:'open-repair',label:'打开修复工具'}]},
      'permission-denied':{kind:'blocking',title:'目录不可写',detail:'当前路径没有写入权限；旧路径保持不变。',actions:[{id:'choose-path',label:'选择其他目录'},{id:'open-repair',label:'查看修复工具'}]},
      'insufficient-space':{kind:'blocking',title:'可用空间不足',detail:'所选目录无法承载预计媒体和临时文件；不会保存新路径。',actions:[{id:'choose-path',label:'选择其他目录'}]},
      'path-conflict':{kind:'blocking',title:'目录相互重叠',detail:'媒体、输出和临时目录不能互相包含；请调整其中一个路径。',actions:[{id:'review-paths',label:'检查目录关系'}]},
      'workspace-change-pending':{kind:'running',title:'工作区迁移准备中',detail:'正在生成数据库、媒体、任务和备份迁移范围预览。',actions:[{id:'view-migration',label:'查看迁移范围'}]},
      'restart-required':{kind:'warning',title:'保存后需要重新打开工作区',detail:'迁移已完成；重新打开后才会使用新数据库和媒体根目录。',actions:[{id:'reopen-workspace',label:'重新打开工作区'}]},
      'active-task-blocking':{kind:'blocking',title:'存在运行中的任务',detail:'为避免任务写入旧路径，暂不能确认工作区迁移。',actions:[{id:'open-task',label:'查看运行中任务'},{id:'wait-tasks',label:'等待任务完成'}]},
      'backup-failed':{kind:'recoverable-error',title:'备份失败',detail:'旧备份仍保留；请检查备份目录空间和权限后重试。',actions:[{id:'retry-backup',label:'重试备份'},{id:'open-repair',label:'查看数据工具'}]},
      'backup-restoring':{kind:'running',title:'正在恢复备份',detail:'恢复期间不要移动工作区目录；完成后会显示对账结果。',actions:[]},
      'read-only':{kind:'blocking',title:'当前为只读模式',detail:'可以查看和导出；保存路径、默认值和生成任务暂不可用。',actions:[{id:'open-repair',label:'查看只读原因'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown general settings scenario: ${scenarioId}`);
    const pathBase=[
      {id:'workspace',label:'工作区位置',value:'E:/LocalMiniDrama',permission:'可写',availableSpace:'86.4 GB',lastCheckedAt:'今天 14:32',overlapCheck:'无重叠',occupancy:'2.8 GB',activeTasks:0},
      {id:'media',label:'媒体根目录',value:'E:/LocalMiniDrama/media',permission:'可写',availableSpace:'86.4 GB',lastCheckedAt:'今天 14:32',overlapCheck:'无重叠',occupancy:'18.2 GB',activeTasks:0},
      {id:'output',label:'成片输出目录',value:'E:/LocalMiniDrama/exports',permission:'可写',availableSpace:'86.4 GB',lastCheckedAt:'今天 14:32',overlapCheck:'无重叠',occupancy:'6.4 GB',activeTasks:0},
      {id:'temp',label:'临时文件目录',value:'E:/LocalMiniDrama/temp',permission:'可写',availableSpace:'86.4 GB',lastCheckedAt:'今天 14:32',overlapCheck:'无重叠',occupancy:'1.1 GB',safeToClean:'640 MB',activeTasks:0},
    ];
    const paths=pathBase.map(item=>({...item, ...(scenarioId==='storage-offline'&&item.id==='media'?{permission:'不可访问',availableSpace:'未知',lastCheckedAt:'今天 14:35',activeTasks:2}:{}), ...(scenarioId==='path-not-found'&&item.id==='media'?{permission:'目录不存在'}:{}), ...(scenarioId==='permission-denied'&&item.id==='output'?{permission:'不可写'}:{}), ...(scenarioId==='insufficient-space'&&item.id==='temp'?{availableSpace:'420 MB'}:{}), ...(scenarioId==='path-conflict'&&item.id==='temp'?{overlapCheck:'与媒体根目录重叠'}:{})}));
    const saveState=scenarioId==='saving'?'saving':scenarioId==='save-failed'?'failed':scenarioId==='save-conflict'?'conflict':'clean';
    const workspaceChange={current:'E:/LocalMiniDrama',newPath:'尚未选择',state:scenarioId==='workspace-change-pending'?'validating':'idle',requiresMigrationPreview:true,canConfirm:scenarioId!=='active-task-blocking',activeTaskPolicy:'block-dangerous-change',blockers:scenarioId==='active-task-blocking'?['存在运行中的任务']:[],steps:['选择目录','检查数据库和项目结构','检查权限与空间','检查活动任务','预览迁移范围','确认迁移并重新打开工作区'],options:{copyDatabase:true,copyMedia:true,keepOriginal:true,restartRequired:true},rollback:'迁移前创建备份与回滚点'};
    const storageImpact=scenarioId==='storage-offline'?{affects:['播放现有候选','创建新的本地任务','合片和超分'],doesNotAffect:['已保存的剧本','数据库中的任务记录','已完成任务的元数据']}:null;
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'常规设置',sections:[{id:'workspace',label:'工作区与数据库',fields:['工作区位置','自动备份保留天数']},{id:'output',label:'媒体与交付输出',fields:['媒体根目录','成片输出目录','临时文件目录']},{id:'creation-defaults',label:'创作默认值',fields:['默认画幅','默认语言']}],paths,backupPolicy:{retentionDays:14,minDays:1,maxDays:90,estimatedUsage:'约 2.4 GB / 14 天',directory:'E:/LocalMiniDrama/backups',canDisable:false,immediateAction:'立即创建备份'},defaults:{aspectRatio:'16:9',language:'简体中文',scope:['新建项目','新任务'],existingUnaffected:true,freezePoint:'任务创建时'},save:{state:saveState,states:['clean','dirty','saving','saved','failed','conflict'],lastSavedAt:scenarioId==='default'?'今天 14:28':null,buttonLabel:saveState==='dirty'?'保存修改':saveState==='saving'?'正在保存…':saveState==='saved'?'已保存':'保存设置',preserveDraftOnFailure:true},workspaceChange,storageImpact,advancedRepairTarget:{routeId:'settings-data',params:{}},savePolicy:'optimistic-revision-with-draft-preservation'};
  }

  function getLibraryModel(scenarioId = 'default') {
    const baseItems = [
      { id:'lib-linxia', type:'人物', name:'林夏身份锚点', version:'v3', provenance:'项目“凌晨两点”沉淀', sourceKind:'project', license:'用户自有 · 本地项目可用', path:'E:/Library/characters/linxia-v3.png', usageLocations:['凌晨两点 · 第1集','门后铃声 · 第2集'], usageCount:2, updatedOrder:3, preview:{kind:'image',tone:'blue',label:'林夏'}, mediaState:'online', archived:false, cardPathVisible:false, canUseInProject:true, versions:[{id:'v3',label:'v3 · 当前',change:'酒店制服身份锚点',current:true},{id:'v2',label:'v2',change:'初始人物立绘',current:false}] },
      { id:'lib-corridor', type:'场景', name:'酒店走廊雨夜', version:'v4', provenance:'本地上传 + ComfyUI 候选', sourceKind:'local', license:'用户自有 · 可复用', path:'E:/Library/scenes/corridor-v4.png', usageLocations:['凌晨两点 · 2个分镜'], usageCount:2, updatedOrder:2, preview:{kind:'image',tone:'teal',label:'走廊'}, mediaState:'online', archived:false, cardPathVisible:false, canUseInProject:true, versions:[{id:'v4',label:'v4 · 当前',change:'雨夜灯光修订',current:true},{id:'v3',label:'v3',change:'白天版本',current:false}] },
      { id:'lib-voice', type:'音色', name:'冷静女声 02', version:'v2', provenance:'MiniMax TTS 预设', sourceKind:'provider', license:'Provider 许可 · 需保留来源', path:'provider://minimax/voice-02', usageLocations:['林夏 · 2个项目'], usageCount:2, updatedOrder:1, preview:{kind:'audio',tone:'purple',label:'▶ 试听 11 秒'}, mediaState:'online', archived:false, cardPathVisible:false, canUseInProject:true, versions:[{id:'v2',label:'v2 · 当前',change:'语速与音色微调',current:true},{id:'v1',label:'v1',change:'初始预设',current:false}] },
    ];
    const scenarios = {
      default:null,
      loading:{kind:'loading',title:'正在加载个人资产库',detail:'正在读取资产预览、版本和使用位置。',actions:[]},
      empty:{kind:'info',title:'个人资产库为空',detail:'可以从已有项目保存人物、场景、道具或音色，也可以从本地文件导入。',actions:[{id:'import-library',label:'导入本地素材'},{id:'open-projects',label:'从项目保存'}]},
      'search-empty':{kind:'search-empty',title:'没有找到匹配素材',detail:'可以清除搜索词，或改用人物、场景、道具、音色筛选。',actions:[{id:'clear-search',label:'清除搜索'}]},
      'filter-empty':{kind:'filter-empty',title:'当前筛选没有结果',detail:'尝试清除类型、来源或在线状态条件。',actions:[{id:'clear-filter',label:'清除筛选'}]},
      offline:{kind:'blocking',title:'2 个库媒体文件离线',detail:'具体卡片会标记文件不可访问；元数据、来源和使用位置仍可见。',actions:[{id:'relocate-library',label:'重新定位'},{id:'filter-online',label:'只看在线'}]},
      importing:{kind:'running',title:'正在导入素材',detail:'文件校验和入库任务可从任务中心继续查看。',actions:[{id:'open-task',label:'查看任务'}]},
      'import-failed':{kind:'recoverable-error',title:'素材导入失败',detail:'未写入不完整资产；可修正文件后安全重试。',actions:[{id:'retry-import',label:'重新导入'}]},
      'partial-success':{kind:'success',title:'部分素材已保存',detail:'成功项已进入个人资产库，失败项保留原因并可单独重试。',actions:[{id:'open-imported',label:'查看已保存素材'},{id:'retry-failed',label:'重试失败项'}]},
      archived:{kind:'info',title:'已归档素材',detail:'归档不会破坏已有项目引用，可恢复到个人资产库。',actions:[{id:'restore-archived',label:'恢复素材'}]},
      'version-update':{kind:'info',title:'有固定引用可比较的新版本',detail:'项目不会自动漂移；打开详情比较后再决定是否更新项目。',actions:[{id:'compare-version',label:'比较版本'}]},
      'publish-conflict':{kind:'blocking',title:'发现相同来源文件',detail:'请比较现有版本和待保存版本，再选择保存为新版本或创建独立资产。',actions:[{id:'use-existing',label:'使用已有版本'},{id:'publish-version',label:'保存为新版本'},{id:'copy-independent',label:'创建独立资产'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown library scenario: ${scenarioId}`);
    const items = scenarioId === 'empty' ? [] : baseItems.map(item => ({...item, versions:item.versions.map(version => ({...version}))}));
    if (scenarioId === 'offline') {
      items.find(item => item.id === 'lib-corridor').mediaState = 'offline';
      items.find(item => item.id === 'lib-corridor').canUseInProject = false;
      items.find(item => item.id === 'lib-corridor').recoveryAction = 'relocate';
      items.find(item => item.id === 'lib-voice').mediaState = 'offline';
      items.find(item => item.id === 'lib-voice').canUseInProject = false;
      items.find(item => item.id === 'lib-voice').recoveryAction = 'relocate';
    }
    if (scenarioId === 'archived') items.find(item => item.id === 'lib-corridor').archived = true;
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'个人资产库',description:'跨项目复用人物、场景、道具和音色，并保留来源与版本。',filters:['类型','在线状态','来源','排序'],addModes:[{id:'pinned-reference',label:'使用这个版本',description:'项目固定当前版本；库更新时只提醒。',followsLibraryUpdates:false},{id:'project-copy',label:'复制到项目',description:'创建可独立修改的副本；保留来源记录。',followsLibraryUpdates:false}],items,deletePolicy:'referenced-assets-archive-only',emptyActions:[{id:'import',label:'导入本地素材'},{id:'project-save',label:'从项目保存'}]};
  }

  function filterAndSortLibraryItems(items, state = {}) {
    const query = String(state.query || '').trim().toLowerCase();
    const filters = state.filters || {};
    const filtered = items.filter(item => {
      if (query && ![item.name,item.provenance,item.license,...(item.usageLocations || [])].join(' ').toLowerCase().includes(query)) return false;
      if (filters.type && item.type !== filters.type) return false;
      if (filters.status === 'online' && item.mediaState !== 'online') return false;
      if (filters.status === 'offline' && item.mediaState !== 'offline') return false;
      if (filters.source && item.sourceKind !== filters.source) return false;
      if (filters.archived === 'true' && !item.archived) return false;
      if (filters.archived !== 'true' && item.archived) return false;
      return true;
    });
    return filtered.sort((a,b) => state.sortId === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : (b.updatedOrder || 0) - (a.updatedOrder || 0));
  }

  function getLibraryDetailModel(assetId, scenarioId = 'default') {
    const page = getLibraryModel(scenarioId);
    const item = page.items.find(candidate => candidate.id === assetId);
    if (!item) throw new Error(`Unknown library asset: ${assetId}`);
    return { assetId:item.id, item, sections:[{id:'preview',label:'预览'},{id:'profile',label:'基本资料'},{id:'versions',label:'版本历史'},{id:'provenance',label:'来源与许可'},{id:'usage',label:'使用位置'},{id:'file',label:'文件状态'}], versions:item.versions, actions:[{id:'use-project',label:'用于项目',disabled:item.canUseInProject === false},{id:'save-version',label:'保存新版本'},{id:'usage',label:'打开使用位置'},{id:'relocate',label:'重新定位',disabled:item.mediaState !== 'offline'},{id:'archive',label:'归档'}] };
  }

  function getLibraryProjectUseModel(assetId) {
    const page = getLibraryModel('default');
    const item = page.items.find(candidate => candidate.id === assetId);
    if (!item) throw new Error(`Unknown library asset: ${assetId}`);
    return {assetId, item, targets:[{id:'project-7',label:'凌晨两点'},{id:'project-9',label:'门后铃声'}], relations:[{id:'reference',label:'使用这个版本',description:'项目固定当前版本；库更新时只提醒。',recommended:true},{id:'copy',label:'复制到项目',description:'创建可独立修改的项目副本，保留来源记录。',recommended:false}], duplicateNotice:'提交前检查同来源资产和名称冲突，不会静默覆盖。'};
  }

  function confirmLibraryProjectUse(wizard, selection) {
    if (!selection || !wizard.targets.some(item => item.id === selection.targetId) || !wizard.relations.some(item => item.id === selection.relation)) throw new Error('必须选择目标项目和使用方式');
    return {success:true,created:{kind:selection.relation === 'reference' ? 'ProjectAssetReference' : 'ProjectAssetCopy',assetId:wizard.assetId,targetId:selection.targetId,version:wizard.item.version,followsLibraryUpdates:false,sourceAssetId:wizard.assetId},next:{routeId:'project-assets',params:{projectId:selection.targetId.replace('project-',''),focusId:wizard.assetId}}};
  }

  function beginLibraryImport(page, file) {
    return {...page, importFlow:{phase:'preview',file:{...file},checks:[{id:'format',status:'passed'},{id:'hash',status:'passed'},{id:'license',status:'pending'}],safeToRetry:false}};
  }
  function confirmLibraryImport(page, fields) {
    return {...page, importFlow:{...(page.importFlow || {}),phase:'importing',fields:{...fields},job:{persistent:true,visibleInTaskCenter:true,progress:12}}};
  }
  function completeLibraryImport(page, result) {
    const item = {id:result.id,type:page.importFlow.fields.type,name:page.importFlow.fields.name,version:result.version || 'v1',provenance:'本地文件导入',sourceKind:'local',license:page.importFlow.fields.license,path:page.importFlow.file.name,usageLocations:[],usageCount:0,updatedOrder:99,preview:result.preview || {kind:'image',tone:'blue',label:page.importFlow.fields.name},mediaState:'online',archived:false,cardPathVisible:false,canUseInProject:true,versions:[{id:result.version || 'v1',label:`${result.version || 'v1'} · 当前`,change:'首次导入',current:true}]};
    return {...page,items:[...page.items,item],importFlow:{...(page.importFlow || {}),phase:'success',result:{createdAssetId:item.id}}};
  }
  function failLibraryImport(page, reason) { return {...page,importFlow:{...(page.importFlow || {}),phase:'failed',reason,safeToRetry:true}}; }
  function beginLibraryProjectSave(page, projectId) {
    return {...page,projectSaveFlow:{phase:'select',projectId,selectable:[{id:'character-linxia',label:'林夏身份锚点',version:'v3'},{id:'scene-corridor',label:'酒店走廊雨夜',version:'v4'},{id:'prop-keycard',label:'门卡',version:'v2'}]}};
  }
  function confirmLibraryProjectSave(page, selection) {
    if (!selection || !page.projectSaveFlow.selectable.some(item => item.id === selection.assetId)) throw new Error('必须选择项目资产');
    return {...page,projectSaveFlow:{...page.projectSaveFlow,phase:'conflict',selected:selection,comparison:{existing:'lib-linxia · v3',incoming:`${selection.assetId} · ${selection.version}`,hash:'相同 source hash'}}};
  }
  function resolveLibraryPublishConflict(page, decision) {
    if (!['existing','new-version','independent'].includes(decision)) throw new Error('Unknown publish conflict decision');
    return {...page,projectSaveFlow:{...page.projectSaveFlow,phase:'success',decision,savedVersion:decision === 'new-version' ? 'v4' : page.projectSaveFlow.selected.version}};
  }
  function archiveLibraryItem(page, assetId) {
    return {...page,items:page.items.map(item => item.id === assetId ? {...item,archived:true,canUseInProject:false} : item)};
  }

  function validateQuickCreateConfig(config = {}) {
    const blockers = [];
    if (!String(config.prompt || '').trim()) blockers.push('请输入 Prompt');
    if (!config.provider || !config.model) blockers.push('请选择可用的 Provider 和模型');
    if (config.recipeId === 'video' && (!config.duration || Number(config.duration) <= 0)) blockers.push('请设置视频时长');
    if (Array.isArray(config.references) && config.references.length > Number(config.maxReferences || 6)) blockers.push(`参考素材不能超过 ${config.maxReferences || 6} 个`);
    return { canSubmit: blockers.length === 0, blockers };
  }

  function getQuickCreateModel(scenarioId = 'default', options = {}) {
    const scenarios = {
      default:null,
      'configuring-image':{kind:'info',title:'配置图片生成',detail:'填写输入并完成预检后才会创建任务。',actions:[{id:'validate',label:'预检并查看费用'}]},
      'configuring-video':{kind:'info',title:'配置视频生成',detail:'普通 Prompt 默认可用；H3 结构编辑位于高级设置。',actions:[{id:'validate',label:'预检并查看费用'}]},
      validating:{kind:'running',title:'正在检查生成配置',detail:'正在检查 Provider 能力、引用文件、费用和输出参数；尚未创建任务。',actions:[]},
      'provider-unavailable':{kind:'blocking',title:'当前 Provider 不可用',detail:'不会提交任务；可切换兼容 Provider 或稍后重试。',actions:[{id:'change-provider',label:'更换 Provider'},{id:'retry-check',label:'重新检查'}]},
      'credential-expired':{kind:'blocking',title:'Provider 认证已过期',detail:'不会重复提交；恢复认证后可使用同一输入快照继续。',actions:[{id:'restore-credential',label:'恢复认证'},{id:'change-provider',label:'本次改用其他通道'}]},
      queued:{kind:'running',title:'任务已排队',detail:'canonical Generation Job 已创建；关闭页面不会停止任务。',actions:[{id:'open-task',label:'查看任务'},{id:'cancel-task',label:'取消任务'}]},
      generating:{kind:'running',title:'候选正在生成',detail:'任务已进入 Provider 执行；关闭页面不会停止任务。',actions:[{id:'open-task',label:'查看任务'},{id:'cancel-task',label:'取消任务'}]},
      cancelling:{kind:'running',title:'正在请求取消',detail:'Provider 尚未确认取消；结果会转为已取消或状态未知。',actions:[]},
      unknown:{kind:'warning',title:'任务状态待核对',detail:'暂不重复提交；正在保留原任务和计费未知状态。',actions:[{id:'reconcile',label:'核对任务状态'}]},
      failed:{kind:'recoverable-error',title:'生成失败',detail:'Recipe、引用、费用快照和诊断均已保留。',actions:[{id:'retry-snapshot',label:'按原输入重试'},{id:'change-provider',label:'更换 Provider'}]},
      succeeded:{kind:'success',title:'候选已生成，尚未归档',detail:'请先预览结果，再选择保存去向；关闭前会再次确认。',actions:[{id:'choose-destination',label:'选择去向'},{id:'preview-result',label:'预览结果'}]},
      'succeeded-unarchived':{kind:'success',title:'候选已生成，尚未归档',detail:'请先预览结果，再选择保存去向；关闭前会再次确认。',actions:[{id:'choose-destination',label:'选择去向'},{id:'preview-result',label:'预览结果'}]},
      archived:{kind:'success',title:'结果已归档',detail:'结果已进入选定事实源，可从归档位置查看或撤销本次归档。',actions:[{id:'open-destination',label:'打开归档位置'}]},
      'partial-success':{kind:'warning',title:'批量结果部分成功',detail:'成功项可单独归档；失败项保留原输入并可仅重试失败项。',actions:[{id:'retry-failed-only',label:'仅重试失败项'},{id:'choose-destination',label:'选择成功项去向'}]},
      offline:{kind:'warning',title:'当前离线',detail:'本地任务记录与输入快照仍可查看；恢复连接前不能提交或归档。',actions:[{id:'retry-connection',label:'重新连接'}]},
      'result-missing':{kind:'recoverable-error',title:'结果文件暂时不可用',detail:'任务记录和来源仍保留；可重新下载或按原输入创建新 attempt。',actions:[{id:'redownload',label:'重新获取结果'},{id:'retry-snapshot',label:'按原输入重试'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown quick create scenario: ${scenarioId}`);
    const recipeId = options.recipeId || (scenarioId === 'configuring-video' ? 'video' : 'image');
    const recipeDefinitions = [
      {id:'image',label:'快速图片',description:'试验一张图片或补充素材，不进入项目阶段。',inputs:['Prompt','参考图','画幅','分辨率','Provider / 模型'],fields:[{id:'prompt',label:'Prompt',required:true},{id:'references',label:'参考图',control:'references'},{id:'aspectRatio',label:'画幅',control:'select'},{id:'resolution',label:'分辨率',control:'select'},{id:'provider',label:'Provider / 模型',control:'select'},{id:'count',label:'生成数量',control:'number'}]},
      {id:'video',label:'快速视频',description:'快速试验一段视频；首帧、尾帧和参考媒体只在提交前绑定。',inputs:['Prompt','首帧 / 尾帧','参考视频 / 音频','时长','Provider / 模型'],fields:[{id:'prompt',label:'Prompt',required:true},{id:'firstFrame',label:'首帧',control:'reference'},{id:'lastFrame',label:'尾帧',control:'reference'},{id:'referenceMedia',label:'参考视频 / 音频',control:'references'},{id:'duration',label:'输出时长',control:'duration'},{id:'aspectRatio',label:'画幅',control:'select'},{id:'resolution',label:'分辨率',control:'select'},{id:'provider',label:'Provider / 模型',control:'select'}]},
    ];
    const activeRecipe = recipeDefinitions.find(item => item.id === recipeId) || recipeDefinitions[0];
    const defaultForm = recipeId === 'video'
      ? {recipeId:'video',prompt:'酒店走廊的灯光逐渐熄灭，镜头缓慢推近 208 房门。',references:[{id:'ref-corridor',kind:'image',label:'酒店走廊雨夜'}],firstFrame:'当前场景主图',lastFrame:'未设置',referenceMedia:[],duration:5,aspectRatio:'9:16',resolution:'1080p',provider:'h3',model:'MiniMax H3',count:1,advanced:{h3:{visible:false,canOpen:true,status:'ready',text:''}}}
      : {recipeId:'image',prompt:'林夏穿酒店制服站在夜班前台，冷白灯光，电影感。',references:[{id:'ref-linxia',kind:'image',label:'林夏身份锚点'}],aspectRatio:'9:16',resolution:'1024×1792',provider:'chatgpt_web',model:'ChatGPT 图片',count:1,advanced:{h3:{visible:false,canOpen:false,status:'not-applicable',text:''}}};
    const validation = validateQuickCreateConfig(defaultForm);
    const form = { ...defaultForm, fields:activeRecipe.fields, validation, estimate:{cost:recipeId === 'video' ? '¥0.32' : '¥0',queueTime:recipeId === 'video' ? '约 1–3 分钟' : '通常即时',processingTime:recipeId === 'video' ? '约 2–5 分钟' : '约 10–30 秒',totalTime:recipeId === 'video' ? '约 3–8 分钟' : '约 10–30 秒'}, providerStatus:['provider-unavailable','credential-expired','offline'].includes(scenarioId) ? 'unavailable' : 'ready' };
    const resultStatus = scenarioId === 'archived' ? 'archived' : ['succeeded','succeeded-unarchived','partial-success'].includes(scenarioId) ? 'succeeded_unarchived' : null;
    const result = resultStatus ? {id:'quick-result-20260909-01',kind:recipeId === 'video' ? 'video' : 'image',status:resultStatus,preview:{kind:recipeId === 'video' ? 'video-thumbnail' : 'image-thumbnail',label:recipeId === 'video' ? '走廊推镜 · 5 秒' : '林夏 · 夜班前台'},jobId:'quick-job-01',attemptId:'quick-attempt-01',submittedAt:'今天 14:26',completedAt:'今天 14:33',actualCost:recipeId === 'video' ? '¥0.32' : '¥0',destination:scenarioId === 'archived' ? {id:'library',label:'个人资产库'} : null} : null;
    const destinationDefinitions = [
      {id:'download',label:'下载',requires:[],description:'选择格式和输出目录，可保留生成元数据。'},
      {id:'library',label:'加入个人资产库',requires:['assetType','name'],description:'填写素材类型、名称、版本和许可后入库。'},
      {id:'project-asset',label:'绑定项目资产',requires:['projectId','assetType','objectId'],description:'先选项目，再选择人物、场景或道具对象；处理版本冲突。'},
      {id:'shot-candidate',label:'加入分镜候选',requires:['projectId','episodeId','sceneId','shotId'],description:'先选项目、剧集、场次和镜头，不写入默认镜头。'},
      {id:'cut-timeline',label:'加入短片时间线',requires:['projectId','episodeId'],description:'先选项目和剧集，检查锁定状态与时间线冲突。'},
    ];
    const destinations = destinationDefinitions.map(item => ({...item,enabled:!!result && !['offline','result-missing'].includes(scenarioId),state:result ? (resultStatus === 'archived' && result.destination?.id === item.id ? 'archived' : 'ready') : 'pending'}));
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'自由创作实验室',description:'不进入项目也能快速生成，但复用统一 Provider、任务、媒体和候选事实源。生成结果最终用于项目时，请在生成前或保存时选择项目和剧集。',jobContract:'canonical-generation-job',context:{projectId:options.projectId || null,episodeId:options.episodeId || null,projectLabel:options.projectId ? '凌晨两点的客房服务' : '未选择项目',episodeLabel:options.episodeId ? `第 ${options.episodeId} 集` : '未选择剧集',requiredBeforeSubmit:true},recipes:recipeDefinitions,generationEnvelope:['Provider/模型','引用','输出参数','预计费用','预计处理时间','失败恢复'],activeRecipe,form,destinations,resultDestinations:destinationDefinitions,isFourStageGate:false,closePolicy:'unarchived-result-requires-save-or-discard',result,recovery:{retryCreatesNewAttempt:true,preserveOriginal:true,closeRequiresSaveOrDiscard:true},history:[{id:'quick-job-history-01',label:'林夏 · 夜班前台',kind:'image',status:'已归档',destination:'个人资产库',completedAt:'今天 13:58'},{id:'quick-job-history-02',label:'走廊推镜',kind:'video',status:'失败后保留',destination:'未归档',completedAt:'昨天 22:10'}],batch:{enabled:false,reason:'自由创作首发不支持批量生成'},advanced:{h3:{defaultCollapsed:true,providerNeutral:true},technicalDetailsCollapsed:true}};
  }

  function archiveQuickCreateResult(page, destinationId) {
    if (!page || !page.result || !['succeeded_unarchived'].includes(page.result.status)) throw new Error('只有未归档成功结果可以归档');
    const destination = (page.destinations || []).find(item => item.id === destinationId);
    if (!destination) throw new Error('未知结果去向');
    return {...page,result:{...page.result,status:'archived',destination:{id:destination.id,label:destination.label}}};
  }

  function resolveQuickCreateDestination(page, selection = {}) {
    if (!page?.result || !['succeeded_unarchived','archived'].includes(page.result.status)) throw new Error('当前没有可归档结果');
    const destination = (page.destinations || []).find(item => item.id === selection.destinationId);
    if (!destination) throw new Error('未知结果去向');
    const missing = (destination.requires || []).filter(key => !selection[key]);
    if (missing.length) throw new Error(`缺少目标信息：${missing.join('、')}`);
    const kindMap = {download:'DownloadArtifact',library:'LibraryAsset', 'project-asset':'ProjectAssetBinding','shot-candidate':'ShotCandidate','cut-timeline':'TimelineItem'};
    return {kind:kindMap[destination.id],target:{...selection},source:{resultId:page.result.id,jobId:page.result.jobId,attemptId:page.result.attemptId},preservesSource:true};
  }

  function getCanvasModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'selection':{kind:'info',title:'已选中 1 个对象',detail:'可查看影响路径或加入批量重编译；标准页与画布共享同一命令。',actions:[{id:'impact-path',label:'查看影响路径'},{id:'add-batch',label:'加入批量重编译'}]},
      'multi-selection':{kind:'info',title:'已选中 2 个对象',detail:'框选可跨类型多选；批量动作会逐项独立成功或失败。',actions:[{id:'batch-recompile',label:'批量重编译'},{id:'clear-selection',label:'取消多选'}]},
      'restore-context':{kind:'info',title:'已恢复上次高级视图上下文',detail:'项目、剧集、阶段、选中对象和视口均已恢复。',actions:[{id:'focus-selection',label:'聚焦选中对象'},{id:'reset-view',label:'重置视图'}]},
      unsaved:{kind:'blocking',title:'画布布局尚未保存',detail:'布局是视图状态；对象修改已经通过共享命令保存。',actions:[{id:'save-layout',label:'保存布局'},{id:'discard-layout',label:'放弃布局'},{id:'cancel-navigation',label:'留在画布'}]},
      loading:{kind:'running',title:'正在加载关系图',detail:'读取项目、剧集和引用关系；不会创建任务。',actions:[]},
      'context-restore-failed':{kind:'recoverable-error',title:'上下文恢复失败',detail:'无法恢复上次视口，业务对象未受影响。',actions:[{id:'reset-view',label:'使用默认视图'}]},
      'empty-relationship':{kind:'info',title:'当前没有可展示的关系',detail:'请从项目素材或分镜页面带入上下文。',actions:[{id:'return-standard',label:'返回标准页面'}]},
      'read-only':{kind:'warning',title:'当前画布只读',detail:'可以查看关系和影响路径，业务修改请返回标准页面。',actions:[{id:'return-standard',label:'返回标准页面'}]},
      'batch-confirming':{kind:'warning',title:'确认批量重编译范围',detail:'将先展示影响对象、费用和耗时，确认后才创建任务。',actions:[{id:'confirm-batch',label:'确认并创建任务'},{id:'cancel-batch',label:'取消'}]},
      'batch-processing':{kind:'running',title:'批量重编译已入队',detail:'任务已进入全局任务中心，关闭页面不会丢失。',actions:[{id:'open-task-center',label:'查看任务中心'}]},
      'batch-partial-success':{kind:'warning',title:'批量重编译部分成功',detail:'成功项保留，失败项可单独重试。',actions:[{id:'retry-failed-only',label:'仅重试失败项'}]},
      'save-processing':{kind:'running',title:'正在保存布局',detail:'只写入视图布局，不修改生产对象。',actions:[]},
      'save-succeeded':{kind:'success',title:'布局已保存',detail:'已保存 layout-r8；刷新后会恢复本次视口。',actions:[]},
      'save-failed':{kind:'recoverable-error',title:'布局保存失败',detail:'本地仍保留未保存布局；业务对象不受影响。',actions:[{id:'save-layout',label:'重试保存'},{id:'discard-layout',label:'放弃布局'}]},
      offline:{kind:'warning',title:'当前离线',detail:'保留最后一次关系快照；批量操作和保存布局暂不可用。',actions:[{id:'retry-context',label:'重新连接'}]},
      stale:{kind:'warning',title:'存在失效引用',detail:'部分关系基于旧版本，影响路径可查看但批量重编译需先回标准页面确认。',actions:[{id:'return-standard',label:'查看失效对象'}]},
      missing:{kind:'recoverable-error',title:'节点对象不可用',detail:'对象已归档或媒体离线；关系保留用于追溯。',actions:[{id:'return-standard',label:'处理对象'}]},
      'capability-blocked':{kind:'blocking',title:'当前通道不支持批量重编译',detail:'不会提交任务；请切换到支持该能力的 Provider。',actions:[{id:'open-ai-settings',label:'打开 AI 配置'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown canvas scenario: ${scenarioId}`);
    const isSaved = scenarioId === 'save-succeeded';
    const nodes = [{id:'character-linxia',type:'人物状态',label:'林夏 · 酒店制服',status:scenarioId==='stale'?'需要更新':'使用中'},{id:'scene-corridor',type:'场景状态',label:'13 层走廊 · 停电',status:'有更新'},{id:'shot-03',type:'分镜',label:'镜头 03',status:'待重新编译'},{id:'video-a',type:'视频候选',label:'video-a',status:'已采用'}];
    const relations = [{from:'character-linxia',to:'shot-03',kind:'reference',label:'引用',direction:'forward',status:scenarioId==='stale'?'stale':'current'},{from:'scene-corridor',to:'shot-03',kind:'reference',label:'引用',direction:'forward',status:'current'},{from:'shot-03',to:'video-a',kind:'generation',label:'生成',direction:'forward',status:'current'}];
    const target = (routeId, params, scenario) => ({routeId, params, scenarioId:scenario});
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'高级画布',description:'标准页面的高级关系与批量编排视图，不拥有第二套业务数据。',context:{projectId:'7',episodeId:'1',stage:'assets',focusId:'character-linxia'},contextLabels:{project:'凌晨两点的客房服务',episode:'第 1 集',stage:'设定',focus:'林夏 · 酒店制服'},contextSource:'项目素材页 · 高级入口',viewport:{restored:scenarioId !== 'context-restore-failed',zoom:'100%',selectedIds:scenarioId==='multi-selection'?['character-linxia','shot-03']:['character-linxia']},ownsDomainData:false,commandParity:true,layoutState:{scope:'view-only',revision:isSaved?'layout-r8':'layout-r7',dirty:scenarioId==='unsaved'||scenarioId==='save-failed',savedAt:isSaved?'今天 14:35':null},nodes,edges:[['character-linxia','shot-03'],['scene-corridor','shot-03'],['shot-03','video-a']],relations,nodeActions:[{nodeId:'character-linxia',target:target('project-assets',{projectId:'7',focusId:'character-linxia'})},{nodeId:'scene-corridor',target:target('project-assets',{projectId:'7',focusId:'scene-corridor'})},{nodeId:'shot-03',target:target('studio-storyboard',{projectId:'7',episodeId:'1',shotId:'shot-03'})},{nodeId:'video-a',target:target('studio-cut',{projectId:'7',episodeId:'1',candidateId:'video-a'})}],impactAnalysis:{focusId:'character-linxia',direct:[{id:'shot-03',label:'第 1 集 / 镜头 03',detail:'Prompt/H3 需要重新编译'}],indirect:[{id:'timeline-shot-03',label:'时间线中的镜头 03',detail:'尚未锁定的交付版本会受影响'}],excluded:[{id:'locked-other-episodes',label:'已锁定的其他集',detail:'不会改变'}]},batchRecompile:{phase:scenarioId==='batch-confirming'?'confirming':scenarioId==='batch-processing'?'processing':scenarioId==='batch-partial-success'?'partial-success':'idle',selectedIds:['shot-03','scene-corridor'],estimatedTasks:2,estimatedCost:'¥0.64',estimatedDuration:'约 6–10 分钟',includesAdopted:false,createsNewRevision:true},sharedCommands:['useAssetVersion','submitGeneration','adoptCandidate','recompileShot','archiveObject'],advancedActions:['框选','分组','批量重编译','影响路径','Fit selection'],excludedProducts:['完整 2D 画板','完整 3D 导演台','视频重绘']};
  }

  function cloneStoryboardPage(page) {
    return JSON.parse(JSON.stringify(page));
  }

  function normalizeStoryboardSegments(segments) {
    return (segments || []).map((segment, index) => {
      if (Number.isFinite(segment.start) && Number.isFinite(segment.end)) return { ...segment };
      const match = String(segment.timecode || '').match(/([\d.]+)[–-]([\d.]+)s/);
      const start = match ? Number(match[1]) : index;
      const end = match ? Number(match[2]) : start + 1;
      return { ...segment, start, end, timecode: `${start.toFixed(1)}–${end.toFixed(1)}s` };
    });
  }

  function createStoryboardShotDetails(page) {
    const selected = { ...page.selectedShot, sceneId: 'scene-02', imageStatus: 'current', videoStatus: 'adopted' };
    selected.segments = normalizeStoryboardSegments(selected.segments);
    const summaries = [
      ['shot-01', '01', 'scene-01', 6, 'current', 'adopted'],
      ['shot-02', '02', 'scene-01', 5, 'current', 'ready'],
      ['shot-03', '03', 'scene-02', 7, 'current', 'adopted'],
      ['shot-04', '04', 'scene-02', 8, 'stale', 'missing'],
      ['shot-05', '05', 'scene-02', 5, 'optional', 'failed'],
      ['shot-06', '06', 'scene-03', 8, 'current', 'adopted'],
      ['shot-07', '07', 'scene-03', 7, 'current', 'adopted'],
      ['shot-08', '08', 'scene-04', 10, 'current', 'ready'],
      ['shot-09', '09', 'scene-04', 12, 'current', 'missing'],
    ];
    return summaries.map(([id, number, sceneId, durationSeconds, imageStatus, videoStatus]) => {
      if (id === 'shot-03') return selected;
      return {
        id, number, sceneId, revision: 18, durationSeconds, imageStatus, videoStatus,
        autoSave: 'saved', characters: [], scene: null, props: [],
        segments: [{
          id: `${id}-segment-a`, start: 0, end: durationSeconds,
          timecode: `0.0–${durationSeconds.toFixed(1)}s`,
          visual: `镜头 ${number} 的画面与动作描述。`, dialogue: '', assets: [],
        }],
      };
    });
  }

  function getStoryboardVideoGate(page) {
    const blockers = [];
    const selected = page.selectedShot || {};
    const references = [...(selected.characters || []), selected.scene, ...(selected.props || [])].filter(Boolean);
    if (references.some(item => item.status === 'missing')) blockers.push('必需引用素材尚未就绪');
    if (page.scenarioId === 'provider-blocked') blockers.push('当前模型不支持镜头结构');
    if (page.scenarioId === 'prompt-gate-failed') blockers.push('生成描述存在冲突');
    if (['h3-stale', 'h3-invalid'].includes(page.scenarioId) || ['stale', 'dirty', 'saving', 'invalid'].includes(page.h3Draft?.status)) blockers.push('生成描述需要更新并重新校验');
    const activeTask = page.videoGeneration?.activeTask || (page.videoGeneration?.candidates || []).find(item => item.status === 'running');
    if (activeTask) blockers.push('当前镜头已有生成任务进行中，不能重复提交');
    return {
      canSubmit: blockers.length === 0,
      blockers,
      checks: [
        { id: 'references', label: '引用素材', passed: !blockers.includes('必需引用素材尚未就绪') },
        { id: 'provider', label: '模型能力', passed: !blockers.includes('当前模型不支持镜头结构') },
        { id: 'prompt', label: '生成描述', passed: !blockers.includes('生成描述存在冲突') && !blockers.includes('生成描述需要更新并重新校验') },
        { id: 'duplicate', label: '重复任务', passed: !blockers.includes('当前镜头已有生成任务进行中，不能重复提交') },
      ],
    };
  }

  function syncStoryboardDerived(page, options = {}) {
    page.layout = ['shot-inspector', 'segment-prompts', 'result-and-generation'];
    page.scenes = page.scenes || [
      { id: 'scene-01', label: '场次 01 · 酒店大堂', shotIds: ['shot-01', 'shot-02'] },
      { id: 'scene-02', label: '场次 02 · 无人楼层', shotIds: ['shot-03', 'shot-04', 'shot-05'] },
      { id: 'scene-03', label: '场次 03 · 208 门口', shotIds: ['shot-06', 'shot-07'] },
      { id: 'scene-04', label: '场次 04 · 酒店前台', shotIds: ['shot-08', 'shot-09'] },
    ];
    page.shotDetails = page.shotDetails || createStoryboardShotDetails(page);
    if (page.shotDetails.length === 0) {
      page.selectedShotId = null;
      page.selectedSceneId = null;
      page.selectedShot = null;
      page.shots = [];
      page.progress = { current: 0, total: 0, adopted: 0, pendingGeneration: 0, failed: 0 };
      page.subtitle = '尚无镜头 · 可从已确认剧本创建或导入分镜结构';
      page.toolbar = {
        primaryActions: [
          { id: 'select-scene', label: '选择场次' }, { id: 'select-shot', label: '尚无镜头' },
          { id: 'prev-shot', label: '上一镜' }, { id: 'next-shot', label: '下一镜' },
          { id: 'batch-generate', label: '批量生成' }, { id: 'more', label: '更多' },
        ],
        moreActions: ['update-structure', 'import-storyboard', 'export-storyboard', 'advanced-canvas'],
      };
      page.inspector = page.inspector || { characters: [], scene: null, props: [], frameChaining: { enabled: false, previousShotNumber: null, status: 'none' } };
      page.segmentEditor = { referenceChips: [], segmentCount: 0 };
      page.resultPanel = page.resultPanel || { previewVideoCandidateId: null, player: { candidateId: null, loadState: 'empty', playbackState: 'idle' } };
      page.videoGeneration.gate = { canSubmit: false, blockers: ['尚无可生成的镜头'], checks: [] };
      page.nextStage = { label: '进入成片审核（0/0）', routeId: 'studio-cut', requires: 'review-is-always-browsable', canOpenReview: true, canStartComposite: false };
      return page;
    }
    page.selectedShotId = page.selectedShotId || 'shot-03';
    const selected = page.shotDetails.find(item => item.id === page.selectedShotId) || page.shotDetails[0];
    page.selectedShotId = selected.id;
    page.selectedSceneId = selected.sceneId;
    page.selectedShot = options.reselectShot === false ? page.selectedShot : cloneStoryboardPage(selected);
    page.resumePosition = { sceneId: page.selectedSceneId, shotId: page.selectedShotId };
    page.shots = page.shotDetails.map(item => ({
      id: item.id, number: item.number, duration: item.durationSeconds,
      imageStatus: item.imageStatus, videoStatus: item.videoStatus,
      tone: item.id === page.selectedShotId ? 'selected' : item.videoStatus === 'failed' ? 'danger' : item.imageStatus === 'stale' || item.videoStatus === 'missing' ? 'warn' : 'ok',
    }));
    page.progress = {
      current: page.shotDetails.findIndex(item => item.id === page.selectedShotId) + 1,
      total: page.shotDetails.length,
      adopted: page.shotDetails.filter(item => item.videoStatus === 'adopted').length,
      pendingGeneration: page.shotDetails.filter(item => item.videoStatus === 'missing').length,
      failed: page.shotDetails.filter(item => item.videoStatus === 'failed').length,
    };
    const selectedScene = page.scenes.find(item => item.id === page.selectedSceneId);
    page.sceneSummary.selected = selectedScene?.label || page.sceneSummary.selected;
    page.sceneSummary.sceneCount = page.scenes.length;
    page.sceneSummary.shotCount = page.shotDetails.length;
    page.subtitle = `镜头 ${page.progress.current}/${page.progress.total} · ${page.progress.adopted} 镜已采用 · ${page.progress.pendingGeneration} 镜待生成 · ${page.progress.failed} 镜失败`;
    page.toolbar = {
      primaryActions: [
        { id: 'select-scene', label: '选择场次' },
        { id: 'select-shot', label: `镜头 ${page.selectedShot.number}` },
        { id: 'prev-shot', label: '上一镜' },
        { id: 'next-shot', label: '下一镜' },
        { id: 'batch-generate', label: '批量生成' },
        { id: 'more', label: '更多' },
      ],
      moreActions: ['update-structure', 'import-storyboard', 'export-storyboard', 'advanced-canvas'],
    };
    const references = [...(selected.characters || []), selected.scene, ...(selected.props || [])].filter(Boolean);
    const referenceChips = references.map((item, index) => ({
      index: index + 1, label: item.label, status: item.status || 'ready',
      type: item === selected.scene ? 'scene' : (selected.props || []).includes(item) ? 'prop' : 'character',
    }));
    page.inspector = {
      characters: cloneStoryboardPage(selected.characters || []),
      scene: selected.scene ? cloneStoryboardPage(selected.scene) : null,
      props: cloneStoryboardPage(selected.props || []),
      referenceChips,
      frameChaining: buildStoryboardFrameChaining(page, selected),
    };
    page.segmentEditor = {
      referenceChips,
      segmentCount: (selected.segments || []).length,
    };
    page.imageGeneration = page.imageGeneration || { channel: 'chatgpt_web', activeTask: null, currentImageCandidateId: page.imageCandidates?.find(item => item.isCurrent)?.id || null };
    page.imageCandidates = (page.imageCandidates || []).map(item => ({ status: 'ready', ...item }));
    page.imagePrompt = page.imagePrompt || deriveStoryboardImagePrompt(selected);
    page.resultPanel = page.resultPanel || {
      previewVideoCandidateId: null,
      player: { candidateId: null, loadState: 'empty', playbackState: 'idle' },
    };
    page.h3Draft = page.h3Draft || {
      status: ['h3-stale', 'h3-invalid'].includes(page.scenarioId) ? undefined : 'ai-generated',
      statusLabel: ['h3-stale', 'h3-invalid'].includes(page.scenarioId) ? undefined : 'AI 生成',
      actionLabel: ['h3-stale', 'h3-invalid'].includes(page.scenarioId) ? '重新生成 H3 提示词' : '生成 H3 提示词',
      editable: true,
      canSubmitVideo: !['h3-stale', 'h3-invalid'].includes(page.scenarioId),
      sourceLabel: `镜头 ${selected.number} · 当前分镜图与 ${referenceChips.length} 个引用`,
      generatedAt: '2026-09-09 14:32',
      generatedBy: 'H3 Prompt Compiler',
      text: (selected.segments || []).map(segment => `[${segment.timecode}] ${segment.visual}`).join('\n'),
      validationChecks: ['结构校验', '引用槽位', '音频语义覆盖', '提示词风格'],
      validationErrors: [],
      recoveryActions: page.scenarioId === 'h3-invalid' ? ['编辑缺失槽位', '重新生成并保留旧草稿'] : [],
    };
    if (page.scenarioId === 'h3-stale') { page.h3Draft.status = 'stale'; page.h3Draft.statusLabel = '来源已变化'; page.h3Draft.canSubmitVideo = false; }
    if (page.scenarioId === 'h3-invalid') { page.h3Draft.status = 'invalid'; page.h3Draft.statusLabel = '结构校验失败'; page.h3Draft.canSubmitVideo = false; }
    page.videoGeneration.candidates = page.videoGeneration.candidates.map(item => ({
      sourceImageId: item.sourceImageId || page.imageGeneration.currentImageCandidateId,
      sourceState: item.sourceState || 'current',
      resolution: item.resolution || page.videoGeneration.resolution,
      duration: item.duration || page.videoGeneration.outputDuration,
      ...item,
    }));
    if (page.scenarioId === 'video-generating' && !page.videoGeneration.activeTask) {
      page.videoGeneration.activeTask = { id: 'task-video-c', status: 'running', candidateId: 'video-c', progress: 64, cancelState: 'available' };
    }
    page.videoGeneration.gate = getStoryboardVideoGate(page);
    page.nextStage = {
      label: `进入成片审核（${page.progress.adopted}/${page.progress.total}）`,
      routeId: 'studio-cut', requires: 'review-is-always-browsable',
      canOpenReview: true, canStartComposite: page.progress.adopted === page.progress.total,
    };
    return page;
  }

  function buildStoryboardFrameChaining(page, selected) {
    const index = page.shotDetails.findIndex(item => item.id === selected.id);
    const previous = index > 0 ? page.shotDetails[index - 1] : null;
    const linked = selected.videoStatus === 'adopted' && ['adopted', 'ready'].includes(previous?.videoStatus || '');
    return {
      enabled: Boolean(previous),
      previousShotNumber: previous ? previous.number : null,
      previousLabel: previous ? `镜头 ${previous.number} 尾帧` : null,
      currentLabel: '本镜首帧',
      status: linked ? 'linked' : previous ? (previous.videoStatus === 'adopted' ? 'available' : 'waiting') : 'none',
    };
  }

  function deriveStoryboardImagePrompt(selected) {
    const visuals = (selected.segments || []).map(item => item.visual).filter(Boolean).join(' ');
    return {
      text: `${visuals}；电影感构图，冷暖对撞，16:9。`,
      sourceLabel: '由时段画面描述与引用素材自动拼装；手工保存后不会被自动覆盖',
      autoSave: 'saved',
      manuallyEdited: false,
    };
  }

  function editStoryboardImagePrompt(page, text) {
    const next = cloneStoryboardPage(page);
    next.imagePrompt.text = String(text || '');
    next.imagePrompt.manuallyEdited = true;
    next.imagePrompt.autoSave = 'dirty';
    return syncStoryboardDerived(next);
  }

  function resetStoryboardImagePrompt(page) {
    const next = cloneStoryboardPage(page);
    next.imagePrompt = deriveStoryboardImagePrompt(next.selectedShot);
    return syncStoryboardDerived(next);
  }

  function uploadStoryboardImage(page) {
    const next = cloneStoryboardPage(page);
    const candidateId = `image-${next.imageCandidates.length + 1}`;
    next.imageCandidates.push({
      id: candidateId, label: `候选 ${next.imageCandidates.length + 1}`,
      meta: '本地上传 · 16:9', isCurrent: false, tone: 'teal', status: 'ready',
    });
    return syncStoryboardDerived(next);
  }

  const storyboardAssetCatalog = {
    'character-linxia': { name: '林夏', type: 'characters', version: 'v3', latestVersion: 'v4', matchTokens: ['林夏'] },
    'character-manager': { name: '酒店经理', type: 'characters', version: 'v1', latestVersion: 'v1', matchTokens: ['经理'] },
    'character-stranger': { name: '陌生住客', type: 'characters', version: 'v1', latestVersion: 'v1', matchTokens: ['住客'] },
    'scene-corridor': { name: '208 客房走廊', type: 'scenes', version: 'v2', latestVersion: 'v2', matchTokens: ['208 走廊'] },
    'scene-lobby': { name: '酒店大堂', type: 'scenes', version: 'v3', latestVersion: 'v3', matchTokens: ['大堂'] },
    'prop-keycard': { name: '13 层门卡', type: 'props', version: 'v1', latestVersion: 'v2', matchTokens: ['门卡'] },
    'prop-intercom': { name: '对讲机', type: 'props', version: 'v3', latestVersion: 'v3', matchTokens: ['对讲机'] },
  };

  function getStoryboardAssetCatalog() {
    return Object.entries(storyboardAssetCatalog).map(([id, entry]) => ({ id, ...entry }));
  }

  function findStoryboardReference(page, referenceId) {
    const selected = page.selectedShot || {};
    const locations = [
      { list: selected.characters || [], type: 'character', removable: true },
      { list: selected.scene ? [selected.scene] : [], type: 'scene', removable: false },
      { list: selected.props || [], type: 'prop', removable: true },
    ];
    for (const location of locations) {
      const item = location.list.find(entry => entry.id === referenceId);
      if (item) return { item, type: location.type, removable: location.removable };
    }
    throw new Error(`Unknown storyboard reference: ${referenceId}`);
  }

  function getStoryboardReferenceManager(page) {
    const selected = page.selectedShot || {};
    const toEntry = (item, type, removable) => ({
      id: item.id,
      label: item.label,
      type,
      status: item.status || 'ready',
      removable,
    });
    const used = new Set([
      ...(selected.characters || []).map(item => item.id),
      selected.scene?.id,
      ...(selected.props || []).map(item => item.id),
    ].filter(Boolean));
    const available = type => getStoryboardAssetCatalog()
      .filter(item => item.type === type && !used.has(item.id))
      .map(item => ({ id: item.id, label: item.name, type, status: 'ready' }));
    return {
      groups: [
        { id: 'characters', label: '出场角色', items: (selected.characters || []).map(item => toEntry(item, 'character', true)) },
        { id: 'scene', label: '分镜场景', items: selected.scene ? [toEntry(selected.scene, 'scene', false)] : [] },
        { id: 'props', label: '场景道具', items: (selected.props || []).map(item => toEntry(item, 'prop', true)) },
      ],
      available: { characters: available('characters'), props: available('props') },
    };
  }

  function markStoryboardReferencesChanged(next) {
    next.h3Draft.status = 'stale';
    next.h3Draft.statusLabel = '引用已变化';
    next.h3Draft.canSubmitVideo = false;
    if (!next.imagePrompt?.manuallyEdited) {
      next.imagePrompt = deriveStoryboardImagePrompt(next.selectedShot);
    }
  }

  function syncSelectedShotIntoDetails(next) {
    const index = next.shotDetails?.findIndex(item => item.id === next.selectedShotId);
    if (Number.isInteger(index) && index >= 0) next.shotDetails[index] = next.selectedShot;
  }

  function removeStoryboardShotReference(page, referenceId) {
    const next = cloneStoryboardPage(page);
    const reference = findStoryboardReference(next, referenceId);
    if (!reference.removable) throw new Error('本镜场景是结构性的，不可移除，只能整体更换');
    if (reference.type === 'character') {
      next.selectedShot.characters = next.selectedShot.characters.filter(item => item.id !== referenceId);
    } else {
      next.selectedShot.props = next.selectedShot.props.filter(item => item.id !== referenceId);
    }
    markStoryboardReferencesChanged(next);
    syncSelectedShotIntoDetails(next);
    return syncStoryboardDerived(next, { reselectShot: false });
  }

  function addStoryboardShotReference(page, assetId) {
    const next = cloneStoryboardPage(page);
    const asset = storyboardAssetCatalog[assetId];
    if (!asset) throw new Error(`Unknown project asset: ${assetId}`);
    const selected = next.selectedShot;
    const listName = asset.type === 'characters' ? 'characters' : asset.type === 'props' ? 'props' : 'scene';
    const existing = listName === 'scene' ? (selected.scene ? [selected.scene] : []) : (selected[listName] || []);
    if (existing.some(item => item.id === assetId)) throw new Error(`引用已在镜头中：${asset.name}`);
    const entry = {
      id: assetId,
      label: `${asset.name} · 当前图`,
      status: 'ready',
    };
    if (listName === 'scene') {
      selected.scene = entry;
    } else {
      selected[listName] = [...(selected[listName] || []), entry];
    }
    markStoryboardReferencesChanged(next);
    syncSelectedShotIntoDetails(next);
    return syncStoryboardDerived(next, { reselectShot: false });
  }

  function getStoryboardAssetPreview(page, referenceIndex) {
    const chips = page.segmentEditor.referenceChips || [];
    const chip = chips[Number(referenceIndex) - 1];
    if (!chip) throw new Error(`Unknown storyboard reference: ${referenceIndex}`);
    const typeLabels = { character: '出场角色', scene: '分镜场景', prop: '场景道具' };
    const reference = findStoryboardReference(page, resolveStoryboardReferenceId(page, chip));
    const catalogEntry = storyboardAssetCatalog[reference.item.id] || { version: 'v1', latestVersion: 'v1', matchTokens: [] };
    const usedInSegments = (page.selectedShot?.segments || [])
      .filter(segment => (segment.assets || []).some(name => catalogEntry.matchTokens.some(token => name.includes(token) || token.includes(name))))
      .map(segment => segment.timecode);
    return {
      index: chip.index,
      label: chip.label,
      type: chip.type,
      typeLabel: typeLabels[chip.type] || '引用素材',
      status: chip.status,
      statusLabel: chip.status === 'missing' ? '缺失 · 生成前必须处理' : '已固定本集版本',
      usage: `@图片${chip.index}`,
      version: catalogEntry.version,
      latestVersion: catalogEntry.latestVersion,
      canUpdateToLatest: catalogEntry.version !== catalogEntry.latestVersion,
      usedInSegments,
      actions: [
        { id: 'update-latest', label: '换绑到最新版', enabled: catalogEntry.version !== catalogEntry.latestVersion },
        { id: 'open-library', label: '在素材库中查看' },
      ],
    };
  }

  function resolveStoryboardReferenceId(page, chip) {
    const selected = page.selectedShot || {};
    const lists = [...(selected.characters || []), selected.scene, ...(selected.props || [])].filter(Boolean);
    const index = Number(chip.index) - 1;
    return lists[index]?.id || null;
  }

  function selectStoryboardScene(page, sceneId) {
    const next = cloneStoryboardPage(page);
    const scene = next.scenes.find(item => item.id === sceneId);
    if (!scene) throw new Error(`Unknown storyboard scene: ${sceneId}`);
    next.selectedShotId = scene.shotIds[0];
    return syncStoryboardDerived(next);
  }

  function selectStoryboardShot(page, shotId) {
    const next = cloneStoryboardPage(page);
    if (!next.shotDetails.some(item => item.id === shotId)) throw new Error(`Unknown storyboard shot: ${shotId}`);
    next.selectedShotId = shotId;
    return syncStoryboardDerived(next);
  }

  function selectStoryboardShotByStep(page, direction) {
    const next = cloneStoryboardPage(page);
    const index = next.shotDetails.findIndex(item => item.id === next.selectedShotId);
    const target = index + Number(direction);
    if (target < 0) throw new Error('已经是第一镜');
    if (target >= next.shotDetails.length) throw new Error('已经是最后一镜');
    next.selectedShotId = next.shotDetails[target].id;
    return syncStoryboardDerived(next);
  }

  function mutateSelectedStoryboardShot(page, mutator) {
    const next = cloneStoryboardPage(page);
    const shot = next.shotDetails.find(item => item.id === next.selectedShotId);
    if (!shot) throw new Error('Selected storyboard shot is missing');
    shot.segments = normalizeStoryboardSegments(shot.segments);
    mutator(shot, next);
    return syncStoryboardDerived(next);
  }

  function editStoryboardSegment(page, segmentId, fields) {
    return mutateSelectedStoryboardShot(page, shot => {
      const segment = shot.segments.find(item => item.id === segmentId);
      if (!segment) throw new Error(`Unknown storyboard segment: ${segmentId}`);
      Object.assign(segment, fields || {});
      shot.autoSave = 'dirty';
    });
  }

  function splitStoryboardSegment(page, segmentId, atSeconds) {
    return mutateSelectedStoryboardShot(page, shot => {
      const index = shot.segments.findIndex(item => item.id === segmentId);
      const segment = shot.segments[index];
      if (!segment || !(atSeconds > segment.start && atSeconds < segment.end)) throw new Error('Split point must be inside the segment');
      const left = { ...segment, end: atSeconds, timecode: `${segment.start.toFixed(1)}–${atSeconds.toFixed(1)}s` };
      const right = { ...segment, id: `${segment.id}-split`, start: atSeconds, timecode: `${atSeconds.toFixed(1)}–${segment.end.toFixed(1)}s` };
      shot.segments.splice(index, 1, left, right);
      shot.autoSave = 'dirty';
    });
  }

  function mergeStoryboardSegment(page, segmentId) {
    return mutateSelectedStoryboardShot(page, shot => {
      const index = shot.segments.findIndex(item => item.id === segmentId);
      if (index < 0 || index === shot.segments.length - 1) throw new Error('A following segment is required');
      const current = shot.segments[index];
      const following = shot.segments[index + 1];
      shot.segments.splice(index, 2, {
        ...current, end: following.end, timecode: `${current.start.toFixed(1)}–${following.end.toFixed(1)}s`,
        visual: [current.visual, following.visual].filter(Boolean).join(' '),
        dialogue: [current.dialogue, following.dialogue].filter(Boolean).join(' '),
        assets: [...new Set([...(current.assets || []), ...(following.assets || [])])],
      });
      shot.autoSave = 'dirty';
    });
  }

  function moveStoryboardSegment(page, segmentId, direction) {
    return mutateSelectedStoryboardShot(page, shot => {
      const index = shot.segments.findIndex(item => item.id === segmentId);
      const target = index + Number(direction);
      if (index < 0 || target < 0 || target >= shot.segments.length) throw new Error('Segment cannot move in that direction');
      const durations = new Map(shot.segments.map(item => [item.id, item.end - item.start]));
      [shot.segments[index], shot.segments[target]] = [shot.segments[target], shot.segments[index]];
      let cursor = 0;
      shot.segments.forEach(segment => {
        const duration = durations.get(segment.id);
        segment.start = cursor; segment.end = cursor + duration;
        segment.timecode = `${segment.start.toFixed(1)}–${segment.end.toFixed(1)}s`;
        cursor = segment.end;
      });
      shot.autoSave = 'dirty';
    });
  }

  function adoptStoryboardImageCandidate(page, candidateId) {
    const next = cloneStoryboardPage(page);
    const candidate = next.imageCandidates.find(item => item.id === candidateId);
    if (!candidate) throw new Error(`Unknown storyboard image candidate: ${candidateId}`);
    next.imageGeneration.previousImageCandidateId = next.imageGeneration.currentImageCandidateId;
    next.imageGeneration.currentImageCandidateId = candidateId;
    next.imageCandidates.forEach(item => { item.isCurrent = item.id === candidateId; item.meta = item.meta.replace(/ · 当前/g, ''); });
    next.h3Draft.status = 'stale';
    next.h3Draft.statusLabel = '分镜图已变化';
    next.h3Draft.canSubmitVideo = false;
    next.videoGeneration.candidates.forEach(item => {
      if (item.status === 'ready') item.sourceState = 'previous-image';
    });
    const shot = next.shotDetails.find(item => item.id === next.selectedShotId);
    if (shot) {
      shot.imageStatus = 'current';
      if (shot.videoStatus === 'adopted') shot.videoStatus = 'stale';
    }
    return syncStoryboardDerived(next);
  }

  function generateStoryboardH3Prompt(page) {
    const next = cloneStoryboardPage(page);
    next.h3Draft.status = 'valid';
    next.h3Draft.statusLabel = '检查通过';
    next.h3Draft.actionLabel = '重新生成 H3 提示词';
    next.h3Draft.canSubmitVideo = true;
    next.h3Draft.validationErrors = [];
    next.h3Draft.sourceLabel = `镜头 ${next.selectedShot.number} · 当前分镜图与 ${next.segmentEditor.referenceChips.length} 个引用`;
    next.h3Draft.generatedAt = '刚刚';
    next.h3Draft.text = (next.selectedShot.segments || []).map(segment => `[${segment.timecode}] ${segment.visual}`).join('\n');
    return syncStoryboardDerived(next);
  }

  function previewStoryboardVideoCandidate(page, candidateId) {
    const next = cloneStoryboardPage(page);
    const candidate = next.videoGeneration.candidates.find(item => item.id === candidateId);
    if (!candidate) throw new Error(`Unknown storyboard video candidate: ${candidateId}`);
    next.resultPanel.previewVideoCandidateId = candidateId;
    next.resultPanel.player = {
      candidateId, loadState: candidate.status === 'ready' ? 'ready' : candidate.status === 'failed' ? 'error' : 'loading',
      playbackState: 'paused',
    };
    return syncStoryboardDerived(next);
  }

  function adoptStoryboardVideoCandidate(page, candidateId) {
    const next = cloneStoryboardPage(page);
    const candidate = next.videoGeneration.candidates.find(item => item.id === candidateId);
    if (!candidate || candidate.status !== 'ready') throw new Error('Only a ready video candidate can be adopted');
    if (next.resultPanel?.player?.candidateId !== candidateId || next.resultPanel.player.loadState !== 'ready') throw new Error('请先在主预览中加载视频候选');
    next.videoGeneration.candidates.forEach(item => { item.isAdopted = item.id === candidateId; item.meta = item.meta.replace(/ · 当前用于本镜/g, ''); });
    next.videoGeneration.adoptedCandidateId = candidateId;
    const shot = next.shotDetails.find(item => item.id === next.selectedShotId);
    if (shot) shot.videoStatus = 'adopted';
    return syncStoryboardDerived(next);
  }

  function undoStoryboardVideoAdoption(page) {
    const next = cloneStoryboardPage(page);
    next.videoGeneration.candidates.forEach(item => { item.isAdopted = false; });
    next.videoGeneration.adoptedCandidateId = null;
    const shot = next.shotDetails.find(item => item.id === next.selectedShotId);
    if (shot) shot.videoStatus = 'ready';
    return syncStoryboardDerived(next);
  }

  function parseStoryboardCost(cost) {
    const match = String(cost || '').match(/¥\s*([\d.]+)/);
    return match ? Number(match[1]) : 0;
  }

  function getStoryboardVideoBatchQuote(page, count) {
    const size = count === undefined || count === null ? 1 : Number(count);
    if (!Number.isInteger(size) || size < 1 || size > 3) throw new Error('生成数量必须是 1–3 之间的整数');
    const generation = page.videoGeneration;
    const unitCost = parseStoryboardCost(generation?.estimatedCost);
    const formatCost = value => `¥${Number.isInteger(value) ? value : value.toFixed(2)}`;
    return {
      count: size,
      cost: formatCost(unitCost * size),
      time: size === 1 ? (generation?.estimatedTime || '约 5–10 分钟') : `${generation?.estimatedTime || '约 5–10 分钟'}（并行提交 ${size} 个任务）`,
    };
  }

  function submitStoryboardVideoGeneration(page, options) {
    const next = cloneStoryboardPage(page);
    if (next.videoGeneration.activeTask || (next.videoGeneration.activeTasks || []).some(item => item.status === 'running') || next.videoGeneration.gate?.blockers?.some(item => item.includes('重复提交'))) throw new Error('当前镜头已有生成任务，不能重复提交');
    if (!next.videoGeneration.gate?.canSubmit) throw new Error('视频生成前检查未通过');
    const quote = getStoryboardVideoBatchQuote(next, options?.count || 1);
    next.videoGeneration.activeTasks = Array.from({ length: quote.count }, (_, index) => ({
      id: `task-${next.selectedShotId}-${index + 1}`,
      status: 'running',
      candidateId: `video-${Date.now()}-${index + 1}`,
      progress: 0,
      cancelState: 'available',
    }));
    next.videoGeneration.activeTask = next.videoGeneration.activeTasks[0];
    return syncStoryboardDerived(next);
  }

  function submitStoryboardImageGeneration(page, options) {
    const next = cloneStoryboardPage(page);
    if (next.imageGeneration?.activeTask) throw new Error('当前镜头已有图片任务，不能重复提交');
    const candidateId = `image-${next.imageCandidates.length + 1}`;
    next.imageGeneration.activeTask = { id: `task-${candidateId}`, status: 'running', candidateId, channel: options?.channel || 'default', progress: null };
    next.imageCandidates.push({ id: candidateId, label: `候选 ${next.imageCandidates.length + 1}`, meta: `${options?.channel === 'chatgpt_web' ? 'ChatGPT 网页' : options?.channel || '默认通道'} · 生成中`, isCurrent: false, tone: 'blue', status: 'running' });
    return syncStoryboardDerived(next);
  }

  function completeStoryboardImageGeneration(page, result) {
    const next = cloneStoryboardPage(page);
    const task = next.imageGeneration?.activeTask;
    if (!task) throw new Error('No active storyboard image task');
    const candidate = next.imageCandidates.find(item => item.id === (result?.candidateId || task.candidateId));
    if (!candidate) throw new Error('Storyboard image candidate is missing');
    candidate.status = 'ready';
    candidate.meta = `${result?.source || '生成通道'} · 16:9 · 刚刚完成`;
    next.imageGeneration.activeTask = null;
    return syncStoryboardDerived(next);
  }

  function editStoryboardH3Draft(page, text) {
    const next = cloneStoryboardPage(page);
    next.h3Draft.text = String(text || '');
    next.h3Draft.status = 'dirty';
    next.h3Draft.statusLabel = '有未保存修改';
    next.h3Draft.canSubmitVideo = false;
    return syncStoryboardDerived(next);
  }

  function startStoryboardH3Save(page) {
    const next = cloneStoryboardPage(page);
    if (next.h3Draft.status !== 'dirty') throw new Error('H3 draft has no unsaved changes');
    next.h3Draft.status = 'saving';
    next.h3Draft.statusLabel = '保存并校验中';
    next.h3Draft.canSubmitVideo = false;
    return syncStoryboardDerived(next);
  }

  function completeStoryboardH3Save(page, result) {
    const next = cloneStoryboardPage(page);
    next.h3Draft.status = result?.valid ? 'valid' : 'invalid';
    next.h3Draft.statusLabel = result?.valid ? '检查通过' : '检查未通过';
    next.h3Draft.canSubmitVideo = Boolean(result?.valid);
    next.h3Draft.validationErrors = result?.valid ? [] : [...(result?.errors || ['结构校验失败'])];
    return syncStoryboardDerived(next);
  }

  function retryStoryboardVideoCandidate(page, candidateId) {
    const next = cloneStoryboardPage(page);
    const candidate = next.videoGeneration.candidates.find(item => item.id === candidateId);
    if (!candidate || candidate.status !== 'failed') throw new Error('Only a failed video candidate can be retried');
    if (next.videoGeneration.activeTask) throw new Error('当前镜头已有生成任务，不能重复提交');
    next.videoGeneration.activeTask = { id: `retry-${candidateId}`, status: 'running', retryOf: candidateId, candidateId: `${candidateId}-retry`, progress: 0, cancelState: 'available' };
    return syncStoryboardDerived(next);
  }

  function cancelStoryboardVideoGeneration(page) {
    const next = cloneStoryboardPage(page);
    const tasks = next.videoGeneration.activeTasks?.length
      ? next.videoGeneration.activeTasks
      : next.videoGeneration.activeTask ? [next.videoGeneration.activeTask] : [];
    if (!tasks.length) throw new Error('No active storyboard video task');
    tasks.forEach(task => {
      task.status = 'cancel-requested';
      task.cancelState = 'requested';
      task.recordPreserved = true;
    });
    return syncStoryboardDerived(next);
  }

  function applyStoryboardStructureUpdate(page, decision) {
    const next = cloneStoryboardPage(page);
    const removed = new Set(decision?.acceptedRemovedShotIds || []);
    next.shotDetails = next.shotDetails.filter(item => !removed.has(item.id));
    next.scenes.forEach(scene => { scene.shotIds = scene.shotIds.filter(id => !removed.has(id)); });
    (decision?.acceptedChangedShotIds || []).forEach(id => {
      const shot = next.shotDetails.find(item => item.id === id);
      if (shot) { shot.structureState = 'updated'; shot.autoSave = 'saved'; }
    });
    (decision?.acceptedAddedShotIds || []).forEach(id => {
      const number = String(Number(String(id).replace('shot-', '')) || next.shotDetails.length + 1).padStart(2, '0');
      const shot = {
        id, number, sceneId: 'scene-04', revision: 19, durationSeconds: 6,
        imageStatus: 'missing', videoStatus: 'missing', autoSave: 'saved', structureState: 'added',
        characters: [], scene: null, props: [],
        segments: [{ id: `${id}-segment-a`, start: 0, end: 6, timecode: '0.0–6.0s', visual: '新增镜头，等待检查描述与引用。', dialogue: '', assets: [] }],
      };
      next.shotDetails.push(shot);
      const scene = next.scenes.find(item => item.id === 'scene-04');
      if (scene) scene.shotIds.push(id);
    });
    next.structureRevision = Number(next.structureRevision || 18) + 1;
    next.structureUpdate = {
      applied: true, createsNewRevision: true,
      preservesManualLocks: true, preservesMediaHistory: true,
      decision: cloneStoryboardPage(decision || {}),
    };
    if (!next.shotDetails.some(item => item.id === next.selectedShotId)) next.selectedShotId = next.shotDetails[0]?.id || null;
    return syncStoryboardDerived(next);
  }

  function getStoryboardCutEntrySummary(page) {
    const details = page.shotDetails || [];
    const group = (id, label, statuses) => ({ id, label, shots: details.filter(item => statuses.includes(item.videoStatus)).map(item => item.id) });
    const adopted = details.filter(item => item.videoStatus === 'adopted').length;
    return {
      canOpenReview: true, canStartComposite: adopted === details.length,
      adopted, total: details.length,
      groups: [
        group('ready-not-adopted', '有候选未采用或需确认旧结果', ['ready', 'stale']),
        group('missing', '尚未生成', ['missing']),
        group('failed', '生成失败', ['failed']),
      ],
    };
  }

  function getStoryboardMediaGenerationGuard(projectId, episodeId, shotId, readiness) {
    const enabled = readiness === 'ready';
    return {
      enabled,
      recoveryTarget: enabled ? null : {
        routeId: 'studio-assets',
        params: { projectId: String(projectId), episodeId: String(episodeId), shotId: String(shotId) },
      },
    };
  }

  function getStoryboardStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default: null,
      loading: { kind: 'loading', title: '正在载入分镜', detail: '正在恢复场次、镜头、候选与上次工作位置。', actions: [] },
      empty: { kind: 'info', title: '本集还没有分镜', detail: '可从已确认剧本创建镜头，或导入分镜结构。', actions: [{ id: 'create-from-script', label: '从剧本创建' }, { id: 'import-storyboard', label: '导入分镜' }] },
      blocked: {
        kind: 'blocking',
        title: '2 个必需资产尚未就绪',
        detail: '酒店经理缺少当前人物图，13 层门卡的“刷卡中”状态没有可用候选。',
        actions: [{ id: 'open-assets', label: '返回设定处理' }],
      },
      'save-failed': {
        kind: 'recoverable-error', title: '镜头修改保存失败', detail: '本机恢复副本仍在，可重试保存或下载草稿。', actions: [{ id: 'retry-save', label: '重试保存' }, { id: 'download-draft', label: '下载草稿' }],
      },
      'provider-blocked': {
        kind: 'blocking',
        title: '目标模型不支持当前结构',
        detail: '当前镜头包含 3 个时段和 2 个场景，所选模型只接受单时段、单场景输入。',
        actions: [{ id: 'split-shot', label: '按建议拆分分镜' }, { id: 'change-provider', label: '更换模型' }],
      },
      'h3-stale': {
        kind: 'blocking',
        title: 'H3 提示词来源已变化',
        detail: '分镜图、人物状态或声音事件已更新；旧草稿保留，但不能用于新的正式视频任务。',
        actions: [{ id: 'compare-h3-source', label: '查看来源变化' }, { id: 'regenerate-h3', label: '重新生成 H3 提示词' }],
      },
      'h3-invalid': {
        kind: 'blocking',
        title: 'H3 提示词校验失败',
        detail: '当前草稿缺少一个引用槽位，且旁白语义未覆盖。人工文本不会被自动删除。',
        actions: [{ id: 'edit-h3', label: '编辑 H3 草稿' }, { id: 'regenerate-h3', label: '重新生成' }],
      },
      'video-generating': {
        kind: 'running',
        title: '镜头 03 正在生成视频',
        detail: 'MiniMax H3 · 64% · 可安全离开本页，完成后进入候选历史。',
        actions: [{ id: 'open-task', label: '查看任务' }, { id: 'cancel-task', label: '取消任务' }],
      },
      'generation-failed': {
        kind: 'recoverable-error',
        title: '镜头视频生成失败',
        detail: '远端任务返回引用下载超时；原提示词、引用和费用快照均已保留。',
        actions: [{ id: 'retry-snapshot', label: '按原输入重试' }, { id: 'open-diagnostic', label: '查看诊断' }],
      },
      'batch-partial': {
        kind: 'recoverable-error',
        title: '批量生成部分完成',
        detail: '6 个镜头成功，1 个失败，2 个因已有最新候选而跳过；成功结果不会回滚。',
        actions: [{ id: 'retry-failed', label: '只重试失败项' }, { id: 'open-batch-result', label: '查看批量结果' }],
      },
      conflict: {
        kind: 'recoverable-error',
        title: '镜头草稿发生版本冲突',
        detail: '另一个窗口已保存新版本；你的草稿仍保留，可比较后合并。',
        actions: [{ id: 'compare-revisions', label: '比较并合并' }, { id: 'reload-shot', label: '载入最新版' }],
      },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown storyboard scenario: ${scenarioId}`);
    const page = {
      projectId: String(projectId),
      episodeId: String(episodeId),
      scenarioId,
      scenario: scenarios[scenarioId],
      featureName: '分镜',
      title: '第 1 集 · 凌晨两点的来客',
      subtitle: '时段提示词、分镜图与镜头视频生成',
      stageNavigation: [
        { id: 'script', label: '剧本', routeId: 'studio-script', state: 'done' },
        { id: 'assets', label: '设定', routeId: 'studio-assets', state: 'done' },
        { id: 'storyboard', label: '分镜', routeId: 'studio-storyboard', state: 'current' },
        { id: 'cut', label: '成片', routeId: 'studio-cut', state: 'available' },
      ],
      layout: ['shot-inspector', 'segment-prompts', 'result-and-generation'],
      sceneSummary: { selected: '场次 02 · 无人楼层', sceneCount: 4, shotCount: 9, totalDuration: '01:08' },
      reextract: {
        label: '更新分镜结构',
        source: { kind: 'script-revision', revision: 12, label: '剧本 r12 · 已确认' },
        provider: '文字结构模型 · drama-structure-v2',
        estimatedCost: '约 ¥0.18',
        estimatedProcessingTime: '约 40–90 秒',
        diff: { added: 2, changed: 3, removed: 1, unchanged: 6 },
        applyMode: 'create-new-shot-revision',
        preservesManualLocks: true,
        preservesMediaHistory: true,
        steps: ['确认剧本来源', '生成新结构', '查看差异', '处理冲突', '创建新分镜版本'],
      },
      storyboardImport: {
        label: '导入分镜文件',
        sources: [
          { id: 'excel', label: 'Excel 分镜表', extensions: ['.xls', '.xlsx'], availability: 'v2.1', mode: 'column-mapping' },
          { id: 'csv', label: 'CSV 分镜表', extensions: ['.csv'], availability: 'v2.1', mode: 'column-mapping' },
          { id: 'shot-package-json', label: 'Shot Package 2.1', extensions: ['.json'], availability: 'v2.1', mode: 'schema-validation' },
          { id: 'docx-text', label: 'DOCX / 普通文本', extensions: ['.docx', '.txt'], availability: 'later', mode: 'ai-assisted-parsing' },
        ],
        steps: ['选择文件', '解析与字段映射', '结构预览', '资产匹配', '版本差异', '确认写入'],
        writeMode: 'preview-then-new-revision',
        neverOverwritesCurrent: true,
        episodePackageTarget: { routeId: 'project-episodes', label: '完整单集制作包请前往剧集页导入' },
      },
      shots: [
        { id: 'shot-01', number: '01', duration: 6, imageStatus: 'current', videoStatus: 'adopted', tone: 'ok' },
        { id: 'shot-02', number: '02', duration: 5, imageStatus: 'current', videoStatus: 'ready', tone: 'ok' },
        { id: 'shot-03', number: '03', duration: 7, imageStatus: 'current', videoStatus: scenarioId === 'video-generating' ? 'generating' : '2 个候选', tone: 'selected' },
        { id: 'shot-04', number: '04', duration: 8, imageStatus: 'stale', videoStatus: 'missing', tone: 'warn' },
        { id: 'shot-05', number: '05', duration: 5, imageStatus: 'optional', videoStatus: 'failed', tone: 'danger' },
      ],
      selectedShot: {
        id: 'shot-03',
        number: '03',
        durationSeconds: 7,
        autoSave: scenarioId === 'conflict' ? 'conflict' : 'saved',
        characters: [
          { id: 'character-linxia', label: '林夏 · 酒店制服 v3', status: 'ready' },
          { id: 'character-manager', label: '酒店经理 · 正装 v1', status: scenarioId === 'blocked' ? 'missing' : 'ready' },
        ],
        scene: { id: 'scene-corridor', label: '208 客房走廊 · 常规夜景 v2', status: 'ready' },
        props: [{ id: 'prop-keycard', label: '13 层门卡 · 刷卡中 v1', status: scenarioId === 'blocked' ? 'missing' : 'ready' }],
        segments: [
          { id: 'segment-a', timecode: '0.0–2.0s', visual: '林夏停在 208 门前，抬手确认门牌。', dialogue: '旁白：凌晨两点，走廊尽头传来脚步声。', assets: ['林夏', '208 走廊'] },
          { id: 'segment-b', timecode: '2.0–5.0s', visual: '镜头缓慢前推，门卡指示灯由红转绿。', dialogue: '音效：门锁短促蜂鸣。', assets: ['门卡', '稳定帧'] },
          { id: 'segment-c', timecode: '5.0–7.0s', visual: '林夏侧身看向画外，动作停在回头瞬间。', dialogue: '林夏：谁在那里？', assets: ['林夏音色', '走廊环境声'] },
        ],
      },
      imageGeneration: {
        channel: 'chatgpt_web',
        activeTask: null,
        currentImageCandidateId: 'image-b',
      },
      imageCandidates: [
        { id: 'image-a', label: '候选 A', meta: 'ChatGPT 网页 · 16:9', isCurrent: false, tone: 'blue' },
        { id: 'image-b', label: '候选 B', meta: 'API · 16:9 · 当前', isCurrent: true, tone: 'purple' },
        { id: 'image-c', label: '候选 C', meta: '外部回填 · 16:9', isCurrent: false, tone: 'amber' },
      ],
      h3Draft: {
        status: scenarioId === 'h3-stale' ? 'stale' : scenarioId === 'h3-invalid' ? 'invalid' : 'ai-generated',
        statusLabel: scenarioId === 'h3-stale' ? '来源已变化' : scenarioId === 'h3-invalid' ? '结构校验失败' : 'AI 生成',
        actionLabel: scenarioId === 'h3-stale' || scenarioId === 'h3-invalid' ? '重新生成 H3 提示词' : '生成 H3 提示词',
        editable: true,
        canSubmitVideo: !['h3-stale', 'h3-invalid'].includes(scenarioId),
        sourceLabel: '镜头 03 · 当前分镜图与 3 个引用',
        generatedAt: '2026-09-09 14:32',
        generatedBy: 'H3 Prompt Compiler',
        text: '[0.0–2.0s] @图片1 林夏停在 208 门前……\n[2.0–5.0s] 镜头缓慢前推，门卡由红转绿……\n[5.0–7.0s] 林夏回头，画外脚步声停止……',
        validationChecks: ['结构校验', '引用槽位', '音频语义覆盖', '提示词风格'],
        validationErrors: [],
        recoveryActions: scenarioId === 'h3-invalid' ? ['编辑缺失槽位', '重新生成并保留旧草稿'] : [],
      },
      videoGeneration: {
        ownerStage: 'storyboard',
        requiresCostConfirmation: true,
        provider: 'MiniMax H3 · 参考生视频',
        outputDuration: '7s',
        resolution: '720p',
        aspectRatio: '16:9',
        estimatedCost: '¥1.80',
        estimatedTime: '约 5–10 分钟',
        concurrency: 2,
        degradations: [],
        adoptedCandidateId: 'video-a',
        activeTask: null,
        gate: { canSubmit: true, blockers: [], checks: [] },
        candidates: [
          { id: 'video-a', label: '候选 A', meta: '输出 7s · H3 · 当前用于本镜', status: 'ready', isAdopted: true, submittedAt: '14:20:05', completedAt: '14:26:40' },
          { id: 'video-b', label: '候选 B', meta: '输出 7s · H3 · 动作更自然', status: 'ready', isAdopted: false, submittedAt: '14:27:00', completedAt: '14:33:02' },
          { id: 'video-c', label: '候选 C', meta: scenarioId === 'video-generating' ? '生成中 64% · 已运行 3分12秒' : '失败 · 可按原输入重试', status: scenarioId === 'video-generating' ? 'running' : 'failed', isAdopted: false, submittedAt: '14:35:00', completedAt: null },
        ],
      },
      batchActions: [
        { id: 'generate-images', label: '生成缺失分镜图' },
        { id: 'generate-videos', label: '生成缺失镜头视频' },
        { id: 'retry-failed', label: '重试失败任务' },
      ],
      exportActions: [
        { id: 'html-storyboard', label: 'HTML 分镜表', includes: '当前结构 + 状态' },
        { id: 'srt', label: 'SRT 字幕草稿', includes: '对白与旁白时间轴' },
        { id: 'shot-package', label: 'Shot Package', includes: '结构 + 提示词 + 引用' },
      ],
      nextStage: { label: '进入成片', routeId: 'studio-cut', requires: 'all-required-shots-confirmed' },
      finalCutActions: [],
    };
    page.pageState = scenarioId === 'loading' ? 'loading' : scenarioId === 'empty' ? 'empty' : 'ready';
    const readiness = scenarioId === 'checking' ? 'checking' : ['2', '3'].includes(String(episodeId)) ? 'script-unapproved' : 'needs-attention';
    page.mediaReadiness = {
      status: readiness,
      text: readiness === 'checking' ? '正在准备素材…' : readiness === 'script-unapproved' ? '确认剧本后才能生成本集媒体' : '有 2 项可稍后处理',
      recovery: readiness === 'ready' ? null : { id: 'resolve-episode-assets', label: '去处理', target: { routeId: 'studio-assets', params: { projectId: String(projectId), episodeId: String(episodeId) } } },
    };
    page.recoveryActions = scenarioId === 'save-failed' ? scenarios['save-failed'].actions : [];
    page.conflictResolution = scenarioId === 'conflict' ? { actions: ['compare', 'merge-as-new-revision', 'reload-latest'], neverOverwriteEitherSide: true } : null;
    page.emptyState = scenarioId === 'empty' ? { primaryAction: { id: 'create-from-script', label: '从已确认剧本创建分镜' }, secondaryAction: { id: 'import-storyboard', label: '导入分镜结构' } } : null;
    if (scenarioId === 'empty') { page.shotDetails = []; page.scenes = []; }
    if (scenarioId === 'save-failed') page.selectedShot.autoSave = 'save-failed';
    return syncStoryboardDerived(page);
  }

  function getCutStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default: null,
      loading: { kind: 'loading', title: '正在恢复短片工作台', detail: '镜头、成片版本与导出状态正在载入。', actions: [] },
      empty: { kind: 'info', title: '本集还没有可审片的镜头', detail: '返回分镜生成并采用至少一个镜头视频后再来审片。', actions: [{ id: 'back-storyboard', label: '返回分镜' }] },
      blocked: { kind: 'blocking', title: '3 个镜头尚未生成视频', detail: '可以先审片和检查节奏；生成成片前需要处理缺失与失败的镜头。', actions: [{ id: 'back-storyboard', label: '返回分镜处理' }] },
      stale: { kind: 'warning', title: '镜头 05 的候选基于旧分镜图', detail: '旧媒体仍可播放和连播；建议回分镜确认后再生成本集成片。', actions: [{ id: 'repair-shot', label: '回分镜确认' }, { id: 'keep-stale', label: '继续使用旧视频' }] },
      composing: { kind: 'running', title: '正在生成本集成片', detail: '按镜头顺序合片并混音；离开页面不会中断。', actions: [{ id: 'open-task', label: '查看任务' }, { id: 'cancel-compose', label: '取消' }] },
      'compose-failed': { kind: 'recoverable-error', title: '成片生成失败', detail: '镜头、候选与合成设置均保留；可按原设置重试。', actions: [{ id: 'retry-compose', label: '按原设置重试' }, { id: 'open-diagnostic', label: '查看诊断' }] },
      exported: { kind: 'success', title: '成片 v3 已导出', detail: 'MP4 已保存；后续镜头变化会生成新版本。', actions: [{ id: 'open-output', label: '打开输出目录' }, { id: 'compare-versions', label: '比较历史版本' }] },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown cut scenario: ${scenarioId}`);
    const mediaReady = ['composing', 'compose-failed', 'exported'].includes(scenarioId);
    const baseShots = [
      { id: 'shot-01', number: '01', sceneId: 'scene-01', duration: 6, candidateId: 'video-01-a' },
      { id: 'shot-02', number: '02', sceneId: 'scene-01', duration: 5, candidateId: 'video-02-a' },
      { id: 'shot-03', number: '03', sceneId: 'scene-02', duration: 7, candidateId: 'video-03-a' },
      { id: 'shot-04', number: '04', sceneId: 'scene-02', duration: 7, candidateId: 'video-04-a' },
      { id: 'shot-05', number: '05', sceneId: 'scene-02', duration: 5, candidateId: 'video-05-a' },
      { id: 'shot-06', number: '06', sceneId: 'scene-03', duration: 6, candidateId: 'video-06-a' },
      { id: 'shot-07', number: '07', sceneId: 'scene-03', duration: 5, candidateId: null },
      { id: 'shot-08', number: '08', sceneId: 'scene-04', duration: 6, candidateId: null },
      { id: 'shot-09', number: '09', sceneId: 'scene-04', duration: 8, candidateId: null },
    ];
    const reviewShots = scenarioId === 'empty' ? [] : baseShots.map((item, index) => {
      let status = index < 6 ? 'completed' : ['generating', 'failed', 'missing'][index - 6];
      if (scenarioId === 'stale' && item.id === 'shot-05') status = 'stale';
      if (mediaReady) status = 'completed';
      const tone = status === 'completed' ? 'ok' : status === 'missing' || status === 'failed' ? 'danger' : 'warn';
      const candidateId = item.candidateId || (status === 'completed' ? `video-${item.number}-a` : null);
      const sourceLabel = status === 'completed' ? '候选 A · 用于本镜'
        : status === 'stale' ? '候选 A · 基于旧分镜图'
        : status === 'generating' ? '生成中'
        : status === 'failed' ? '生成失败' : '未生成';
      return { ...item, status, stale: status === 'stale', tone, candidateId, sourceLabel };
    });
    const completed = reviewShots.filter(item => item.status === 'completed').length;
    const blockers = [];
    const group = (label, list) => list.length && blockers.push(`镜头 ${list.map(item => item.number).join('、')}${label}`);
    group(' 正在生成', reviewShots.filter(item => item.status === 'generating'));
    group(' 生成失败，需要回分镜处理', reviewShots.filter(item => item.status === 'failed'));
    group(' 尚未生成', reviewShots.filter(item => item.status === 'missing'));
    group(' 基于旧分镜图，需要确认', reviewShots.filter(item => item.status === 'stale'));
    const history = mediaReady
      ? [
          { id: 'cut-v1', version: 1, createdAt: '昨天 21:40', statusLabel: '已保留' },
          { id: 'cut-v2', version: 2, createdAt: '今天 13:02', statusLabel: '已保留' },
          ...(scenarioId === 'exported' ? [{ id: 'cut-v3', version: 3, createdAt: '今天 15:02', statusLabel: '当前版本 · 已导出' }] : []),
        ]
      : [];
    const currentVersion = mediaReady ? 2 : 0;
    const selectedShotId = 'shot-03';
    const currentShot = reviewShots.find(item => item.id === selectedShotId) || null;
    return {
      routeId: 'studio-cut',
      projectId: String(projectId),
      episodeId: String(episodeId),
      scenarioId,
      scenario: scenarios[scenarioId],
      featureName: '短片',
      title: '第 1 集 · 凌晨两点的来客',
      subtitle: '逐镜审片、连播与整集合成',
      primaryWorkflow: 'episode-review-and-compose',
      videoGenerationAccess: 'secondary-repair',
      stageNavigation: [
        { id: 'script', label: '剧本', routeId: 'studio-script', state: 'done' },
        { id: 'assets', label: '设定', routeId: 'studio-assets', state: 'done' },
        mediaReady
          ? { id: 'storyboard', label: '分镜', routeId: 'studio-storyboard', state: 'done' }
          : { id: 'storyboard', label: '分镜 · 需处理 3 镜', routeId: 'studio-storyboard', state: 'warning', reason: '还有 3 个镜头需要处理' },
        { id: 'cut', label: '短片', routeId: 'studio-cut', state: 'current' },
      ],
      layout: ['review-player', 'compose-settings'],
      sceneSummary: { selected: '全部场次', sceneCount: 4, shotCount: reviewShots.length, totalDuration: '01:08' },
      toolbar: {
        primaryActions: [
          { id: 'select-scene', label: '选择场次' },
          { id: 'select-shot', label: `镜头 ${currentShot?.number || '--'}` },
          { id: 'play-all', label: '连续播放' },
          { id: 'compose', label: '生成成片' },
        ],
      },
      review: {
        sceneFilter: 'all',
        selectedShotId,
        mode: 'single',
        playbackState: 'paused',
        completed,
        total: reviewShots.length,
        shots: reviewShots,
        currentShot: currentShot ? {
          id: currentShot.id,
          number: currentShot.number,
          candidateId: currentShot.candidateId,
          status: currentShot.status,
          stale: currentShot.stale,
          duration: currentShot.duration,
          sourceLabel: currentShot.sourceLabel,
        } : null,
      },
      compose: {
        settings: { bgmStrategy: 'episode-track', narrationTts: true, subtitleBurn: false, upscale: false },
        bgmOptions: [
          { id: 'none', label: '不使用 BGM' },
          { id: 'episode-track', label: '整集 BGM · 午夜回廊' },
        ],
        narrationNote: '保留镜头原声；旁白 TTS 与 BGM 混音，不会覆盖原声。',
        gate: { canCompose: blockers.length === 0 && scenarioId !== 'composing', blockers },
        activeTask: scenarioId === 'composing'
          ? { id: 'task-compose-3', status: 'running', progress: 64, cancelState: 'available' }
          : null,
        lastError: scenarioId === 'compose-failed' ? '混音与响度步骤失败；镜头、候选与合成设置均已保留。' : null,
        result: mediaReady ? {
          version: currentVersion,
          fileName: `episode-01-v${currentVersion}.mp4`,
          durationLabel: '01:08',
          resolution: '1920×1080',
          canExport: true,
          exported: scenarioId === 'exported',
          exportedAt: scenarioId === 'exported' ? '今天 15:06' : null,
        } : null,
        history,
      },
      exportActions: [
        { id: 'export-mp4', label: '导出 MP4' },
        { id: 'export-srt', label: '导出 SRT 字幕' },
      ],
    };
  }

  function cloneCutPage(page) {
    return JSON.parse(JSON.stringify(page));
  }

  function getCutSelectedShot(page) {
    return page.review.shots.find(item => item.id === page.review.selectedShotId) || page.review.shots[0];
  }

  function syncCutDerived(page) {
    const selected = getCutSelectedShot(page);
    if (!selected) return page;
    page.review.selectedShotId = selected.id;
    page.review.currentShot = { ...selected };
    const blockers = [];
    const group = (label, list) => list.length && blockers.push(`镜头 ${list.map(item => item.number).join('、')}${label}`);
    group(' 正在生成', page.review.shots.filter(item => item.status === 'generating'));
    group(' 生成失败，需要回分镜处理', page.review.shots.filter(item => item.status === 'failed'));
    group(' 尚未生成', page.review.shots.filter(item => item.status === 'missing'));
    group(' 基于旧分镜图，需要确认', page.review.shots.filter(item => item.status === 'stale'));
    page.compose.gate = {
      canCompose: blockers.length === 0 && !(page.compose.activeTask && ['running', 'cancel-requested'].includes(page.compose.activeTask.status)),
      blockers,
    };
    return page;
  }

  function selectCutScene(page, sceneId) {
    const next = cloneCutPage(page);
    if (sceneId !== 'all' && !next.review.shots.some(item => item.sceneId === sceneId)) throw new Error(`Unknown cut scene: ${sceneId}`);
    next.review.sceneFilter = sceneId;
    const scoped = sceneId === 'all' ? next.review.shots : next.review.shots.filter(item => item.sceneId === sceneId);
    next.review.selectedShotId = scoped[0]?.id || next.review.selectedShotId;
    return syncCutDerived(next);
  }

  function selectCutShot(page, shotId) {
    const next = cloneCutPage(page);
    if (!next.review.shots.some(item => item.id === shotId)) throw new Error(`Unknown cut shot: ${shotId}`);
    next.review.selectedShotId = shotId;
    return syncCutDerived(next);
  }

  function selectCutShotByStep(page, direction) {
    const next = cloneCutPage(page);
    const index = next.review.shots.findIndex(item => item.id === next.review.selectedShotId);
    const target = index + Number(direction);
    if (target < 0) throw new Error('已经是第一镜');
    if (target >= next.review.shots.length) throw new Error('已经是最后一镜');
    next.review.selectedShotId = next.review.shots[target].id;
    return syncCutDerived(next);
  }

  function toggleCutPlayAll(page) {
    const next = cloneCutPage(page);
    if (next.review.mode === 'play-all') {
      next.review.mode = 'single';
      next.review.playbackState = 'paused';
    } else {
      next.review.mode = 'play-all';
      next.review.playbackState = 'playing';
    }
    return syncCutDerived(next);
  }

  function updateCutComposeSetting(page, key, value) {
    const next = cloneCutPage(page);
    const allowedKeys = ['bgmStrategy', 'narrationTts', 'subtitleBurn', 'upscale'];
    if (!allowedKeys.includes(key)) throw new Error(`Unknown compose setting: ${key}`);
    if (key === 'bgmStrategy') {
      if (!next.compose.bgmOptions.some(item => item.id === value)) throw new Error(`不支持的 BGM 策略: ${value}`);
      next.compose.settings.bgmStrategy = value;
    } else {
      next.compose.settings[key] = Boolean(value);
    }
    return syncCutDerived(next);
  }

  function composeEpisode(page) {
    const next = cloneCutPage(page);
    if (next.compose.activeTask && ['running', 'cancel-requested'].includes(next.compose.activeTask.status)) throw new Error('已有合成任务进行中，不能重复提交');
    if (!next.compose.gate.canCompose) throw new Error(`生成成片门禁未通过：${next.compose.gate.blockers.join('；')}`);
    next.compose.lastError = null;
    next.compose.activeTask = {
      id: `task-compose-${(next.compose.history.length || 0) + 1}`,
      status: 'running', progress: 0, cancelState: 'available',
    };
    return syncCutDerived(next);
  }

  function cancelEpisodeCompose(page) {
    const next = cloneCutPage(page);
    if (!next.compose.activeTask || next.compose.activeTask.status !== 'running') throw new Error('No active compose task');
    next.compose.activeTask.status = 'cancel-requested';
    next.compose.activeTask.cancelState = 'requested';
    return syncCutDerived(next);
  }

  function completeEpisodeCompose(page) {
    const next = cloneCutPage(page);
    if (!next.compose.activeTask || next.compose.activeTask.status !== 'running') throw new Error('No active compose task');
    const version = (next.compose.history.at(-1)?.version || 0) + 1;
    next.compose.activeTask = null;
    next.compose.result = {
      version,
      fileName: `episode-01-v${version}.mp4`,
      durationLabel: '01:08',
      resolution: '1920×1080',
      canExport: true,
      exported: false,
      exportedAt: null,
    };
    next.compose.history.push({ id: `cut-v${version}`, version, createdAt: '刚刚', statusLabel: '当前版本' });
    next.compose.history.forEach(item => { if (item.version !== version) item.statusLabel = '已保留'; });
    return syncCutDerived(next);
  }

  function exportCutResult(page, outputId) {
    const next = cloneCutPage(page);
    if (!next.exportActions.some(item => item.id === outputId)) throw new Error(`Unknown export output: ${outputId}`);
    if (!next.compose.result || !next.compose.result.canExport) throw new Error('尚无可导出的成片');
    if (outputId === 'export-mp4') {
      next.compose.result.exported = true;
      next.compose.result.exportedAt = '刚刚';
    }
    return syncCutDerived(next);
  }

  function transitionPrototypeState(state, action) {
    if (state.flow === 'external-ai' && action.type === 'select-result') {
      return {
        ...state,
        status: 'validating_result',
        selectedFile: action.file,
      };
    }
    if (state.routeId === 'studio-storyboard' && action.type === 'submit-shot-video') {
      if (!action.candidate?.id) throw new Error('Video candidate is required');
      return {
        ...state,
        officialVideoTasks: Number(state.officialVideoTasks || 0) + 1,
        videoCandidates: [...(state.videoCandidates || []), { ...action.candidate }],
      };
    }
    if (state.routeId === 'studio-storyboard' && action.type === 'adopt-shot-video') {
      if (!(state.videoCandidates || []).some(item => item.id === action.candidateId)) {
        throw new Error(`Unknown video candidate: ${action.candidateId}`);
      }
      return { ...state, adoptedVideoCandidateId: action.candidateId };
    }
    if (state.routeId === 'studio-storyboard' && (action.type === 'open-cut-review' || action.type === 'save-compile-and-open-cut')) {
      return {
        ...state,
        routeId: 'studio-cut',
      };
    }




    if (state.routeId === 'studio-cut' && action.type === 'start-composite') {
      if (action.canStart !== true) throw new Error('Start composite is blocked');
      return {
        ...state,
        status: 'compositing',
        creatorStatus: '成片版本正在生成',
        timelineRevisionId: action.timelineRevisionId || 'timeline-r12',
        pictureLockId: action.pictureLockId || 'picture-lock-r12',
        baseCompositeId: action.baseCompositeId || 'base-composite-r12',
      };
    }
    if (state.routeId === 'projects' && action.type === 'set-project-view') {
      return {
        ...state,
        projectViewMode: normalizeProjectListViewMode(action.viewMode),
      };
    }
    return { ...state };
  }

  return {
    buildPrototypeRouteRegistry,
    buildFeatureCoverageIndex,
    parsePrototypeLocation,
    formatPrototypeLocation,
    getPageModel,
    getProjectAssetDetailModel,
    getProjectAssetsModel,
    getProjectAssetStatSelection,
    getAssetDetailDrawerModel,
    getProjectAssetBatchPreview,
    getProjectAssetGenerationEnvelope,
    submitProjectAssetGeneration,
    completeProjectAssetGeneration,
    undoProjectAssetMediaSelection,
    filterAndSortProjectAssets,
    getProjectBibleModel,
    getProjectLookEditorModel,
    getProjectSettingsEditorUiState,
    getExternalAiContextModel,
    getProjectCardNavigationTarget,
    getProductNavigationModel,
    getProjectSectionNavigation,
    getEpisodeStageNavigation,
    getAuxiliaryToolEntries,
    getProjectOperationsModel,
    getAdvancedDataToolsModel,
    getProjectOverviewBlockerTarget,
    getProjectOverviewModel,
    getProjectOverviewPrimaryActionTarget,
    getProjectResumeNavigationTarget,
    getProjectStageNavigationTarget,
    getProjectEpisodesModel,
    getEpisodeSourceAuditModel,
    getEpisodeNavigationTarget,
    getEpisodeCreationEntryModel,
    getStoryboardMediaGenerationGuard,
    getExternalAiWizardModel,
    getEpisodeCreationFlow,
    getEpisodeCreationSourceGroups,
    getEpisodeCreationSourceTarget,
    getEpisodeTargetSelectorModel,
    getExternalAiCollaborationTaskModel,
    getEpisodePackageImportModel,
    getScriptStageModel,
    editScriptDraft,
    startScriptDraftSave,
    completeScriptDraftSave,
    checkScriptDraftForApproval,
    startScriptApproval,
    approveScriptDraft,
    startScriptAiCandidate,
    completeScriptAiCandidate,
    applyScriptAiCandidate,
    createScriptDraftFromHistory,
    decideScriptAssetChange,
    renameScriptScene,
    duplicateScriptScene,
    moveScriptScene,
    deleteScriptScene,
    undoDeleteScriptScene,
    selectScriptScene,
    addScriptScene,
    getEpisodeAssetsStageModel,
    getEpisodeAssetVersionComparisonModel,
    getEpisodeVoiceResolutionModel,
    applyEpisodeAssetDecision,
    getAiSettingsModel,
    getAiSettingsOneShotModel,
    getAiSettingsImportModel,
    getAiSettingsExportModel,
    getGlobalTaskModel,
    getTaskCenterModel,
    resolveDefaultImageChannel,
    getImageChannelSettingsModel,
    getChatGptEnvironmentModel,
    getProjectCreateModel,
    getProjectImportModel,
    getGeneralSettingsModel,
    getMediaRelocationConfirmationSummary,
    getLibraryModel,
    filterAndSortLibraryItems,
    getLibraryDetailModel,
    getLibraryProjectUseModel,
    confirmLibraryProjectUse,
    beginLibraryImport,
    confirmLibraryImport,
    completeLibraryImport,
    failLibraryImport,
    beginLibraryProjectSave,
    confirmLibraryProjectSave,
    resolveLibraryPublishConflict,
    archiveLibraryItem,
    validateQuickCreateConfig,
    getQuickCreateModel,
    archiveQuickCreateResult,
    resolveQuickCreateDestination,
    getCanvasModel,
    getStoryboardStageModel,
    selectStoryboardScene,
    selectStoryboardShot,
    selectStoryboardShotByStep,
    editStoryboardSegment,
    splitStoryboardSegment,
    mergeStoryboardSegment,
    moveStoryboardSegment,
    adoptStoryboardImageCandidate,
    generateStoryboardH3Prompt,
    editStoryboardImagePrompt,
    resetStoryboardImagePrompt,
    uploadStoryboardImage,
    getStoryboardAssetPreview,
    getStoryboardReferenceManager,
    addStoryboardShotReference,
    removeStoryboardShotReference,
    getStoryboardVideoBatchQuote,
    previewStoryboardVideoCandidate,
    adoptStoryboardVideoCandidate,
    undoStoryboardVideoAdoption,
    submitStoryboardVideoGeneration,
    submitStoryboardImageGeneration,
    completeStoryboardImageGeneration,
    editStoryboardH3Draft,
    startStoryboardH3Save,
    completeStoryboardH3Save,
    retryStoryboardVideoCandidate,
    cancelStoryboardVideoGeneration,
    applyStoryboardStructureUpdate,
    getStoryboardCutEntrySummary,
    getCutStageModel,
    selectCutScene,
    selectCutShot,
    selectCutShotByStep,
    toggleCutPlayAll,
    updateCutComposeSetting,
    composeEpisode,
    cancelEpisodeCompose,
    completeEpisodeCompose,
    exportCutResult,
    normalizeProjectListViewMode,
    transitionPrototypeState,
    addProjectAssetReference,
    addProjectAssetViewReference,
    removeProjectAssetReference,
    saveProjectAssetFields,
    setProjectAssetDetailSection,
    setProjectAssetGenerationMode,
    setProjectAssetCharacterGenerationMode,
    addProjectAssetCharacterCandidate,
    useProjectAssetCandidate,
    useProjectAssetVoiceCandidate,
    useProjectAssetViewCandidate,
  };
}));
