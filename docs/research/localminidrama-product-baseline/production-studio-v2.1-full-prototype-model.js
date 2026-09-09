(function exposeFullPrototypeModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionStudioV21FullPrototypeModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  const routes = [
    route('projects', /^#\/projects$/, [], () => '/projects', ['default', 'empty', 'loading', 'offline', 'no-results', 'task-paused']),
    route('project-new', /^#\/projects\/new$/, [], () => '/projects/new', ['default', 'source-picker', 'shell-created']),
    route('project-import', /^#\/projects\/import$/, [], () => '/projects/import', ['default', 'unsupported-archive', 'failed', 'succeeded']),
    route('project-overview', /^#\/projects\/([^/]+)\/overview$/, ['projectId'], p => `/projects/${p.projectId}/overview`, ['default', 'blocked', 'loading']),
    route('project-bible', /^#\/projects\/([^/]+)\/bible$/, ['projectId'], p => `/projects/${p.projectId}/bible`, ['default', 'look', 'empty', 'loading', 'load-failed', 'save-failed']),
    route('project-episodes', /^#\/projects\/([^/]+)\/episodes$/, ['projectId'], p => `/projects/${p.projectId}/episodes`, [
      'default', 'empty', 'source-picker', 'blank-manual', 'ai-script', 'novel-split',
      'external-ai-context', 'external-ai-waiting', 'episode-json-import', 'source-video',
      'json-target-not-blank', 'asset-match-conflict', 'import-failed', 'import-succeeded',
      'filter-script', 'filter-assets', 'filter-storyboard', 'filter-cut',
    ]),
    route('project-assets', /^#\/projects\/([^/]+)\/assets$/, ['projectId'], p => `/projects/${p.projectId}/assets`, [
      'default', 'empty', 'candidate-compare', 'media-offline', 'generation-failed',
      'version-conflict', 'delete-blocked', 'batch-generate', 'library-update', 'publish-blocked',
    ]),
    route('studio-script', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/script$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/script`, ['default', 'blocked', 'stale', 'diff', 'save-failed']),
    route('studio-assets', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/assets$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/assets`, ['default', 'blocked', 'stale', 'candidate-compare', 'look-change']),
    route('studio-storyboard', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/storyboard$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/storyboard`, ['default', 'blocked', 'stale', 'multi-segment', 'provider-blocked', 'prompt-gate-failed', 'h3-stale', 'h3-invalid', 'continuity', 'video-generating', 'generation-failed', 'batch-partial', 'candidate-compare', 'conflict']),
    route('studio-cut', /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/cut$/, ['projectId', 'episodeId'], p => `/projects/${p.projectId}/episodes/${p.episodeId}/cut`, ['default', 'blocked', 'stale', 'candidate-compare', 'retake-failed', 'picture-lock', 'audio-conflict', 'delivery-failed', 'offline-media', 'post-failed', 'exported']),
    route('library', /^#\/library$/, [], () => '/library', ['default', 'empty', 'offline', 'publish-conflict']),
    route('quick-create', /^#\/quick-create$/, [], () => '/quick-create', ['default', 'generating', 'failed', 'succeeded']),
    route('canvas', /^#\/canvas$/, [], () => '/canvas', ['default', 'restore-context', 'unsaved']),
    route('settings-ai', /^#\/settings\/ai$/, [], () => '/settings/ai', ['default', 'credential-expired', 'connection-failed', 'import-conflict', 'chatgpt-waiting', 'chatgpt-rebind']),
    route('settings-general', /^#\/settings\/general$/, [], () => '/settings/general', ['default', 'storage-offline', 'save-conflict']),
    route('settings-data', /^#\/settings\/data$/, [], () => '/settings/data', ['default', 'integrity-warning', 'storage-offline', 'migration-failed', 'cleanup-blocked']),
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
      'M-01':'library','F-01':'quick-create','X-01':'canvas','J-01':'settings-ai','D-01':'settings-data',
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
      const focusId = queryParams.get('focus');
      if (focusId) params.focusId = focusId;
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
    if (params.focusId) queryParams.set('focus', params.focusId);
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

  function getProjectSectionNavigation(projectId) {
    const projectKey = String(projectId);
    return [
      { id: 'project-overview', label: '概览', params: { projectId: projectKey } },
      { id: 'project-bible', label: '项目设定', params: { projectId: projectKey } },
      { id: 'project-episodes', label: '剧集', params: { projectId: projectKey } },
      { id: 'project-assets', label: '资产', params: { projectId: projectKey } },
    ];
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
          label: '删除项目',
          description: '移入回收站并保留恢复窗口；不会立即物理删除文件。',
          mutatesData: true,
          recoverable: true,
        },
      ],
      advancedToolsTarget: { routeId: 'settings-data', params: {} },
    };
  }

  function getAdvancedDataToolsModel(scenarioId = 'default') {
    const scenarios = {
      default: null,
      'integrity-warning': { tone: 'warn', title: '发现 2 个需要处理的数据问题', detail: '一个媒体文件离线，一个任务索引等待修复。' },
      'storage-offline': { tone: 'warn', title: '媒体根目录当前不可访问', detail: '项目数据库保持只读安全；重新连接磁盘后可执行媒体重定位。' },
      'migration-failed': { tone: 'danger', title: '上次迁移未完成', detail: '迁移 journal 已保留，可继续恢复或查看人工恢复说明。' },
      'cleanup-blocked': { tone: 'warn', title: '物理清理已阻断', detail: '所选文件仍被剧集、候选或交付引用，没有删除任何内容。' },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown advanced data tools scenario: ${scenarioId}`);
    return {
      featureName: '高级数据工具',
      description: '仅在排查本地文件、迁移或空间问题时使用，不参与日常创作。',
      scenario: scenarios[scenarioId],
      tools: [
        {
          id: 'integrity-check',
          label: '完整性检查',
          description: '只读核对数据库、媒体路径、引用和任务索引。',
          action: '开始检查',
          mutatesData: false,
        },
        {
          id: 'media-relocation',
          label: '媒体重定位',
          description: '扫描新的媒体根目录；确认匹配结果后才更新路径。',
          action: '选择新位置',
          mutatesData: true,
        },
        {
          id: 'migration-journal',
          label: '迁移与恢复记录',
          description: '查看迁移 journal、备份、校验结果及人工恢复说明。',
          action: '查看记录',
          mutatesData: false,
        },
        {
          id: 'physical-cleanup',
          label: '物理清理',
          description: '只处理无引用且位于受控目录内的可清理文件。',
          action: '预览可清理项',
          mutatesData: true,
          requiresDryRun: true,
        },
      ],
    };
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
      scenarioId: `filter-${stage}`,
    };
  }

  function buildProjectEpisodeRows(projectId) {
    const projectKey = String(projectId);
    return [
      {
        episodeId: '1', number: 1, title: '无人楼层', durationTarget: '92s', isBlank: false,
        recentStage: 'storyboard', recentPosition: '场次 02 · 分镜 03', nextAction: '继续分镜', blockers: 1,
        importSource: {
          kind: 'external-ai-result', schemaVersion: '2.1', filename: 'episode-01.json',
          sha256: '9c3dbe81…4f02', reportId: 'import-report-ep01', packageId: 'pkg_ep01_20260908',
        },
        stages: {
          script: { status: 'approved', label: '已确认' },
          assets: { status: 'ready_for_review', label: '待处理 1' },
          storyboard: { status: 'in_progress', label: '7/10 镜' },
          cut: { status: 'not_started', label: '未开始' },
        },
      },
      {
        episodeId: '2', number: 2, title: '门后的铃声', durationTarget: '85s', isBlank: false,
        recentStage: 'script', recentPosition: '剧本草稿', nextAction: '继续剧本', blockers: 0,
        importSource: null,
        stages: {
          script: { status: 'draft', label: '草稿' },
          assets: { status: 'not_started', label: '未开始' },
          storyboard: { status: 'not_started', label: '未开始' },
          cut: { status: 'not_started', label: '未开始' },
        },
      },
      {
        episodeId: '3', number: 3, title: '未命名', durationTarget: null, isBlank: true,
        recentStage: null, recentPosition: null, nextAction: '编辑或导入', blockers: 0,
        importSource: null,
        stages: {
          script: { status: 'not_started', label: '空白' },
          assets: { status: 'not_started', label: '未开始' },
          storyboard: { status: 'not_started', label: '未开始' },
          cut: { status: 'not_started', label: '未开始' },
        },
      },
    ].map(item => ({ ...item, projectId: projectKey }));
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

  function getEpisodeCreationFlow(sourceId) {
    const common = { sourceId, createsPaidMediaTasks: false };
    const flows = {
      blank: {
        ...common,
        title: '空白手工',
        steps: ['选择创建新剧集或填充空白剧集', '填写集号、标题和目标时长', '创建空白草稿', '进入剧本'],
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
    return JSON.parse(JSON.stringify(flow));
  }

  function getEpisodePackageImportModel(step = 1, {
    targetMode = 'create_new',
    assetConflictResolved = false,
    protocol = 'episode-package',
  } = {}) {
    const stepNames = ['目标与文件', '剧本与场次', '资产匹配', '分镜与时段', '确认写入'];
    if (!Number.isInteger(step) || step < 1 || step > stepNames.length) {
      throw new Error(`Unknown episode package import step: ${step}`);
    }
    const base = {
      step,
      stepTitle: stepNames[step - 1],
      stepNames,
      protocol,
      targetMode,
      allowedTargetModes: ['create_new', 'fill_blank'],
      disallowedTargetModes: ['merge', 'overwrite', 'append'],
      file: {
        name: protocol === 'external-ai-result' ? '外部AI结果-第3集.json' : 'episode-03.json',
        schema: protocol === 'external-ai-result' ? 'local-mini-drama.external-ai-result' : 'local-mini-drama.episode-package',
        version: '2.1',
        sha256: 'a18f90ce…2b77',
      },
      canAdvance: true,
    };
    if (step === 1) return {
      ...base,
      targets: [
        { id: 'create_new', label: '创建新剧集', allowed: true },
        { id: 'fill_blank', label: '填充空白第 3 集', allowed: true },
        { id: 'episode-1', label: '第 1 集 · 非空', allowed: false, code: 'TARGET_NOT_BLANK' },
      ],
    };
    if (step === 2) return {
      ...base,
      episodeSummary: { number: 3, title: '208 房没有住客', synopsisLength: 286, scriptLength: 1842 },
      storyScenes: ['酒店外景', '酒店走廊', '208 门口', '前台'],
      projectLookOverridable: false,
    };
    if (step === 3) return {
      ...base,
      unresolvedConflicts: assetConflictResolved ? 0 : 1,
      canAdvance: assetConflictResolved,
      matches: [
        { type: '人物状态', source: '林夏 / 夜班状态', result: 'source_key 精确匹配', decision: 'reuse' },
        { type: '人物', source: '陌生住客', result: '项目中不存在', decision: 'create' },
        { type: '场景资产', source: '208 房门口', result: '仅名称相似', decision: assetConflictResolved ? 'create' : null },
      ],
    };
    if (step === 4) return {
      ...base,
      structure: { storySceneCount: 4, shotCount: 10, segmentCount: 14, plannedDuration: '92s' },
      validation: ['分镜均归属明确场次', '时段连续闭合', '引用均可解析', '请求时长留待 Provider 适配'],
    };
    return {
      ...base,
      transactional: true,
      remoteGenerationCost: 0,
      createdMediaTasks: [],
      summary: { characters: 2, scenes: 4, props: 3, shots: 10, segments: 14 },
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
        routeId: 'project-episodes',
        params: { projectId: projectKey, focusId: episodeKey },
        scenarioId: 'source-picker',
      };
      return {
        routeId: `studio-${row.recentStage}`,
        params: { projectId: projectKey, episodeId: episodeKey },
        scenarioId: 'default',
      };
    }
    if (action === 'stage') {
      if (!['script', 'assets', 'storyboard', 'cut'].includes(stage)) throw new Error(`Unknown episode stage: ${stage}`);
      return {
        routeId: `studio-${stage}`,
        params: { projectId: projectKey, episodeId: episodeKey },
        scenarioId: 'default',
      };
    }
    throw new Error(`Unknown episode navigation action: ${action}`);
  }

  function getProjectEpisodesModel(projectId, scenarioId = 'default') {
    const projectKey = String(projectId);
    const overview = getProjectOverviewModel(projectKey, 'default');
    const rows = buildProjectEpisodeRows(projectKey);
    const activeStageFilter = scenarioId.startsWith('filter-') ? scenarioId.slice('filter-'.length) : null;
    const routeScenarios = buildPrototypeRouteRegistry().find(item => item.id === 'project-episodes').scenarios;
    if (!routeScenarios.includes(scenarioId)) throw new Error(`Unknown project episodes scenario: ${scenarioId}`);
    const scenarios = {
      default: null,
      empty: { kind: 'info', title: '还没有剧集', detail: '从六类来源创建首集；项目本身不会因此自动调用 AI。', actions: [{ id: 'open-sources', label: '新建 / 导入剧集' }] },
      'source-picker': { kind: 'info', title: '选择剧集来源', detail: '六类来源共用同一目标选择和安全边界。', actions: [{ id: 'open-sources', label: '选择来源' }] },
      'blank-manual': { kind: 'success', title: '空白剧集已创建', detail: '未调用 AI，可直接编辑剧本。', actions: [{ id: 'open-script', label: '进入剧本' }] },
      'ai-script': { kind: 'info', title: 'AI 剧本草稿准备中', detail: '完成后仍需人工审阅，不自动解析资产或确认剧本。', actions: [{ id: 'open-task', label: '查看任务' }] },
      'novel-split': { kind: 'info', title: '小说拆集预览', detail: '确认章节、目标集数和编号冲突后才批量创建草稿。', actions: [{ id: 'review-split', label: '查看拆集结果' }] },
      'external-ai-context': { kind: 'info', title: '外部 AI 创作上下文已准备', detail: '可复制上下文或继续创建本集任务包。', actions: [{ id: 'create-package', label: '创建任务包' }] },
      'external-ai-waiting': { kind: 'warning', title: '等待外部 AI 结果', detail: '任务包和资产快照已冻结；可安全离开，稍后选择结果 JSON。', actions: [{ id: 'copy-prompt', label: '复制任务说明' }, { id: 'download-package', label: '重新下载任务包' }, { id: 'select-result', label: '选择结果 JSON' }] },
      'episode-json-import': { kind: 'info', title: '单集制作包导入', detail: '先选文件与目标，再进行五步预览；当前没有写入。', actions: [{ id: 'start-import', label: '选择文件' }] },
      'source-video': { kind: 'info', title: '导入已有视频', detail: '只登记来源媒体并进入短片时间线，不创建远端生成任务。', actions: [{ id: 'select-video', label: '选择视频文件' }] },
      'json-target-not-blank': { kind: 'blocking', title: '不能导入到非空剧集', detail: '目标已有剧本、分镜或媒体，未写入任何数据。', actions: [{ id: 'choose-blank', label: '选择空白剧集' }, { id: 'create-new', label: '创建新剧集' }, { id: 'cancel', label: '取消' }] },
      'asset-match-conflict': { kind: 'blocking', title: '还有 1 个资产匹配冲突', detail: '同名不是同一资产；必须明确复用、新建或取消。', actions: [{ id: 'resolve-match', label: '处理冲突' }, { id: 'back-file', label: '返回选择文件' }] },
      'import-failed': { kind: 'recoverable-error', title: '导入事务已回滚', detail: '项目没有部份写入；文件、目标和匹配决策均已保留。', actions: [{ id: 'retry-import', label: '按原预览重试' }, { id: 'choose-file', label: '重新选择文件' }] },
      'import-succeeded': { kind: 'success', title: '第 3 集已导入为结构化草稿', detail: '没有自动确认阶段，也没有创建图片、视频或音频任务。', actions: [{ id: 'view-report', label: '查看报告' }, { id: 'open-script', label: '进入剧本' }, { id: 'open-assets', label: '检查设定' }, { id: 'open-storyboard', label: '进入分镜' }] },
      'filter-script': null,
      'filter-assets': null,
      'filter-storyboard': null,
      'filter-cut': null,
    };
    const visibleRows = scenarioId === 'empty'
      ? []
      : activeStageFilter
        ? rows.filter(item => item.stages[activeStageFilter]?.status !== 'not_started')
        : rows;
    return {
      projectId: projectKey,
      scenarioId,
      title: overview.title,
      description: overview.description,
      metadata: [...overview.metadata],
      stats: { total: 8, active: 2, needsAttention: 1, externalSources: 1 },
      stageFilters: [
        { id: 'all', label: '全部' },
        { id: 'script', label: '剧本' },
        { id: 'assets', label: '设定' },
        { id: 'storyboard', label: '分镜' },
        { id: 'cut', label: '短片' },
      ],
      activeStageFilter,
      rows,
      visibleRows,
      creationSources: buildEpisodeCreationSources(),
      managementActions: [
        { id: 'rename', label: '重命名' },
        { id: 'duplicate-draft', label: '复制为草稿' },
        { id: 'set-duration', label: '设置目标时长' },
        { id: 'reorder', label: '调整集序' },
        { id: 'archive', label: '归档剧集', recoverable: true },
        { id: 'view-source', label: '查看导入来源' },
      ],
      scenario: scenarios[scenarioId],
    };
  }

  function getEpisodeSourceAuditModel(projectId, episodeId, sectionId = 'raw') {
    const row = buildProjectEpisodeRows(projectId).find(item => item.episodeId === String(episodeId));
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
          { label: 'source_key', value: 'episode-01-external-ai' },
          { label: '内容摘要', value: '1 集、4 个叙事场次、10 个分镜、14 个时段' },
        ],
      },
      {
        id: 'normalized',
        label: '规范化结果',
        description: '按确定性适配规则转换为内部 Episode Package 2.1 后的只读快照。',
        entries: [
          { label: '适配器', value: 'external-ai-result@2.1 → episode-package@2.1' },
          { label: '目标', value: '创建第 1 集结构化草稿' },
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
      '7': {
        title: '凌晨两点的客房服务',
        description: '一名夜班前台在不存在住客的楼层不断收到客房服务请求。',
        metadata: ['都市悬疑', '16:9', '8 集', '最近编辑：刚刚'],
        sections: {
          nextAction: {
            label: '继续分镜 03',
            stage: 'storyboard',
            episodeId: '1',
            detail: '第 1 集《无人楼层》· 场次 02 · 分镜 03',
          },
          stages: [
            { id: 'script', label: '剧本', state: '已确认', summary: '1/1 集', tone: 'ok' },
            { id: 'assets', label: '设定', state: '待确认 1', summary: '8/9 项', tone: 'warn' },
            { id: 'storyboard', label: '分镜', state: '进行中', summary: '7/10 镜', tone: 'active' },
            { id: 'cut', label: '短片', state: '未开始', summary: '0/10 镜', tone: 'muted' },
          ],
          projectLook: {
            name: '都市悬疑 · 冷暖对撞',
            version: 4,
            status: '项目当前 Look',
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
              label: '查看 Look',
              type: 'open-drawer',
              manageTarget: { routeId: 'project-bible', scenarioId: 'look' },
            },
          },
          blockers: [
            {
              id: 'asset-scene-208-pending',
              type: '设定',
              title: '208 客房走廊待确认',
              detail: '影响第 2 集分镜确认',
              action: '检查设定',
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
              detail: '恢复认证后可继续原任务',
              action: '查看任务',
              target: { kind: 'task-drawer', taskId: 'task-shot-05-video' },
            },
          ],
        },
      },
      '9': {
        title: '雾港来信',
        description: '港口小城的失踪案牵出一批从未寄出的信。',
        metadata: ['年代悬疑', '16:9', '12 集', '最近编辑：昨天 21:42'],
        sections: {
          nextAction: { label: '继续设定', stage: 'assets', episodeId: '4', detail: '第 4 集《码头仓库》· 角色与场景设定' },
          stages: [
            { id: 'script', label: '剧本', state: '已确认', summary: '4/4 集', tone: 'ok' },
            { id: 'assets', label: '设定', state: '进行中', summary: '5/8 项', tone: 'active' },
            { id: 'storyboard', label: '分镜', state: '未开始', summary: '0/12 镜', tone: 'muted' },
            { id: 'cut', label: '短片', state: '未开始', summary: '0/12 镜', tone: 'muted' },
          ],
          projectLook: {
            name: '潮湿胶片 · 低饱和',
            version: 2,
            status: '项目当前 Look',
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
              label: '查看 Look',
              type: 'open-drawer',
              manageTarget: { routeId: 'project-bible', scenarioId: 'look' },
            },
          },
          blockers: [],
        },
      },
    };
    const project = projects[projectKey];
    if (!project) throw new Error(`Unknown project: ${projectKey}`);
    return {
      projectId: projectKey,
      scenarioId,
      title: project.title,
      description: project.description,
      metadata: [...project.metadata],
      sections: JSON.parse(JSON.stringify(project.sections)),
    };
  }

  function getProjectOverviewBlockerTarget({ projectId, blockerId } = {}) {
    const overview = getProjectOverviewModel(projectId, 'default');
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

  function getProjectBibleModel(projectId, scenarioId = 'default') {
    const overview = getProjectOverviewModel(projectId, 'default');
    const isEmpty = scenarioId === 'empty';
    const base = {
      projectId: overview.projectId,
      scenarioId,
      title: overview.title,
      featureName: '项目设定',
      managementScope: 'project',
      primaryAction: {
        label: '生成外部 AI 上下文',
        routeId: 'project-episodes',
        params: { projectId: overview.projectId },
        scenarioId: 'external-ai-context',
      },
      excludedKnowledgeSystems: [
        'structured-world-fact-database',
        'foreshadowing-tracker',
        'event-timeline',
      ],
      context: {
        title: '外部 AI 创作上下文',
        summary: isEmpty ? '补充项目信息后，外部 AI 会更准确地延续剧情。' : '夜班酒店中，不存在住客的楼层持续发出服务请求。规则：异常只在凌晨两点后出现。',
        editableFields: [
          { id: 'project-summary', label: '项目简介', value: isEmpty ? '' : overview.description },
          { id: 'genre', label: '题材', value: isEmpty ? '' : '都市悬疑' },
          { id: 'story-foundation', label: '故事基础设定', value: isEmpty ? '' : '当代城市酒店；异常事件只在凌晨两点后发生。' },
          { id: 'immutable-settings', label: '不可改变的设定', value: isEmpty ? '' : '不存在的 13 层不能被普通住客看到。' },
          { id: 'continuity-notes', label: '跨集连续性备注', value: isEmpty ? '' : '林夏左手旧伤；第 2 集前不知道 13 层的真实来源。' },
        ],
        includedSources: [
          '项目简介与题材',
          '故事基础设定',
          '不可改变的设定',
          '跨集连续性备注',
          '相邻剧集与最新剧本',
          '人物当前状态',
          '场景索引',
          '道具索引',
          'Project Look 摘要',
        ],
        missingFields: isEmpty ? ['项目简介', '故事基础设定'] : [],
      },
      projectLook: {
        ...JSON.parse(JSON.stringify(overview.sections.projectLook)),
        action: { routeId: 'project-bible', params: { projectId: overview.projectId }, scenarioId: 'look' },
      },
      productionObjects: [
        { id: 'characters', label: '人物与状态', count: isEmpty ? 0 : 4, summary: isEmpty ? '尚未创建人物' : '4 名人物 · 12 个状态', warning: isEmpty ? '' : '1 人缺少可用形象', target: { routeId: 'project-assets', params: { projectId: overview.projectId, focusId: 'characters' } } },
        { id: 'scenes', label: '场景', count: isEmpty ? 0 : 5, summary: isEmpty ? '尚未创建场景' : '5 个场景 · 4 个已有视觉资产', warning: isEmpty ? '' : '1 个场景待确认', target: { routeId: 'project-assets', params: { projectId: overview.projectId, focusId: 'scenes' } } },
        { id: 'props', label: '道具', count: isEmpty ? 0 : 7, summary: isEmpty ? '尚未创建道具' : '7 件道具 · 2 件关键道具', warning: isEmpty ? '' : '2 件缺少视觉资产', target: { routeId: 'project-assets', params: { projectId: overview.projectId, focusId: 'props' } } },
      ],
      excludedCapabilities: [
        'image-candidates',
        'voice-candidates',
        'media-generation',
        'cross-episode-media-usage',
      ],
      generationPolicy: {
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
      },
    };
    if (scenarioId === 'look') {
      return {
        ...base,
        viewId: 'project-look',
        projectLook: JSON.parse(JSON.stringify(overview.sections.projectLook)),
      };
    }
    if (scenarioId === 'load-failed') return { ...base, viewId: 'load-failed', recoveryAction: 'retry' };
    if (scenarioId === 'save-failed') return { ...base, viewId: 'bible-overview', preserveDraft: true };
    return { ...base, viewId: 'bible-overview' };
  }

  function getProjectAssetsModel(projectId, scenarioId = 'default', focusId = '') {
    const projectKey = String(projectId);
    const allowedTabs = ['all', 'characters', 'scenes', 'props'];
    const activeTab = allowedTabs.includes(focusId) ? focusId : 'all';
    const baseItems = [
      { id: 'character-linxia', type: 'characters', name: '林夏', subtitle: '主角 · 4 个状态', description: '夜班前台，冷静敏锐', contentStatus: '当前使用 v3', taskStatus: '1 个新候选', usage: '3 集 · 8 个分镜', usageCount: 8, issue: true, warning: '默认状态缺少侧视图', source: '剧本提取', mediaState: 'current', episodes: ['1', '2', '3'], updatedOrder: 5, imageTone: 'purple', totalStates: 4, voiceStatus: '音色已设置', voiceSource: '本地上传 · 18 秒', statePreviews: [{ name: '日常', tone: 'purple' }, { name: '制服', tone: 'blue' }, { name: '雨夜', tone: 'teal' }] },
      { id: 'character-manager', type: 'characters', name: '酒店经理', subtitle: '配角 · 2 个状态', description: '谨慎、圆滑，负责酒店夜间值守', contentStatus: '当前使用 v2', taskStatus: '无运行任务', usage: '2 集 · 4 个分镜', usageCount: 4, issue: true, warning: '本集配音策略需要人物音色', source: '外部 AI 导入', mediaState: 'current', episodes: ['1', '2'], updatedOrder: 3, imageTone: 'amber', totalStates: 2, voiceStatus: '音色未设置', voiceSource: '', statePreviews: [{ name: '正装', tone: 'amber' }, { name: '慌乱', tone: 'red' }] },
      { id: 'scene-corridor', type: 'scenes', name: '208 客房走廊', subtitle: '夜景 · 3 个剧情状态', description: '狭长走廊、冷白灯和 208 门口', contentStatus: '当前使用 v2', taskStatus: '无运行任务', usage: '2 集 · 6 个分镜', usageCount: 6, issue: scenarioId === 'media-offline', warning: scenarioId === 'media-offline' ? '主图文件离线' : '', source: '剧本提取', mediaState: scenarioId === 'media-offline' ? 'offline' : 'current', episodes: ['1', '2'], updatedOrder: 2, imageTone: 'blue', totalStates: 3, statePreviews: [{ name: '常规', tone: 'blue' }, { name: '雨夜', tone: 'teal' }, { name: '停电', tone: 'amber' }], libraryUpdate: scenarioId === 'library-update' ? '资产库有 v3 可用' : '' },
      { id: 'scene-lobby', type: 'scenes', name: '酒店大堂', subtitle: '主场景 · 2 个剧情状态', description: '暖色石材、玻璃反射和前台区域', contentStatus: '当前使用 v3', taskStatus: scenarioId === 'generation-failed' ? '1 个生成任务失败' : '2 个新候选', usage: '4 集 · 11 个分镜', usageCount: 11, issue: true, warning: scenarioId === 'generation-failed' ? '生成失败，原输入可重试' : '新候选使用不同 Look', source: '手工创建', mediaState: 'current', episodes: ['1', '2', '3', '4'], updatedOrder: 4, imageTone: 'teal', totalStates: 2, statePreviews: [{ name: '白天', tone: 'teal' }, { name: '深夜', tone: 'blue' }] },
      { id: 'prop-keycard', type: 'props', name: '13 层门卡', subtitle: '关键道具 · 3 个剧情状态', description: '黑色 RFID 门卡，进入 13 层的线索', contentStatus: '当前使用 v2', taskStatus: '无运行任务', usage: '3 集 · 7 个分镜', usageCount: 7, issue: false, warning: '', source: '外部 AI 导入', mediaState: 'current', episodes: ['1', '2', '3'], updatedOrder: 1, imageTone: 'red', totalStates: 3, statePreviews: [{ name: '完整', tone: 'red' }, { name: '刷卡', tone: 'amber' }, { name: '损坏', tone: 'purple' }] },
    ];
    const items = scenarioId === 'empty' ? [] : baseItems.filter(item => activeTab === 'all' || item.type === activeTab);
    const statValue = value => scenarioId === 'empty' ? 0 : value;
    return {
      projectId: projectKey,
      scenarioId,
      title: '凌晨两点的客房服务',
      featureName: '项目资产',
      activeTab,
      tabs: [
        { id: 'all', label: '全部' },
        { id: 'characters', label: '人物' },
        { id: 'scenes', label: '场景' },
        { id: 'props', label: '道具' },
      ],
      stats: [
        { id: 'characters', label: '人物', value: statValue(baseItems.filter(item => item.type === 'characters').length) },
        { id: 'character-states', label: '人物状态', value: statValue(baseItems.filter(item => item.type === 'characters').reduce((sum,item) => sum + item.totalStates, 0)) },
        { id: 'scenes', label: '场景', value: statValue(baseItems.filter(item => item.type === 'scenes').length) },
        { id: 'props', label: '道具', value: statValue(baseItems.filter(item => item.type === 'props').length) },
        { id: 'needs-attention', label: '需要处理', value: statValue(baseItems.filter(item => item.issue).length) },
      ],
      filters: ['状态', '使用情况', '来源', '媒体情况', '所在剧集'],
      filterGroups: [
        { id: 'status', label: '状态', options: [{ id: 'attention', label: '需要处理' }, { id: 'candidate', label: '有新候选' }, { id: 'failed', label: '生成失败' }, { id: 'archived', label: '已归档' }] },
        { id: 'usage', label: '使用情况', options: [{ id: 'used', label: '已使用' }, { id: 'unused', label: '未使用' }] },
        { id: 'source', label: '来源', options: [{ id: 'script', label: '剧本提取' }, { id: 'manual', label: '手工创建' }, { id: 'external', label: '外部 AI 导入' }, { id: 'library', label: '个人资产库' }] },
        { id: 'media', label: '媒体情况', options: [{ id: 'current', label: '有当前版本' }, { id: 'candidate-only', label: '只有候选' }, { id: 'offline', label: '文件离线' }] },
        { id: 'episode', label: '所在剧集', options: [{ id: '1', label: '第 1 集' }, { id: '2', label: '第 2 集' }, { id: '3', label: '第 3 集' }, { id: '4', label: '第 4 集' }] },
      ],
      sortOptions: [
        { id: 'updated-desc', label: '最近更新' },
        { id: 'name-asc', label: '名称' },
        { id: 'usage-desc', label: '使用最多' },
        { id: 'issues-first', label: '问题优先' },
      ],
      statFilters: {
        characters: { type: 'characters' },
        'character-states': { type: 'characters', level: 'state' },
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
        { id: 'archive-unused', label: '归档未使用资产' },
      ],
      batchPreview: { selected: 5, eligible: 3, skipped: 1, blocked: 1, tasks: 3, provider: '当前图片 Provider', model: '按对象配置', estimatedCost: '提交前按 Provider 报价', concurrency: 2, autoUseCandidate: false },
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

  function getProjectAssetStatSelection(statId) {
    const selections = {
      characters: { type: 'characters' },
      'character-states': { type: 'characters', level: 'state' },
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
      if (filters.status === 'archived' && !item.archived) return false;
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
    const sceneCapabilities = ['参考图', '从图提取描述', '提示词', '负向提示词', '单图', '四视图', '生成与上传', '资产库', '影响分镜'];
    const propCapabilities = ['参考图', '从图提取描述', '提示词', '负向提示词', '单图', '四视图', '生成与上传', '资产库', '关联分镜'];
    const sceneGenerationModes = [
      { id: 'single', label: '单图', implementation: 'existing', description: '生成一个主要观察视角', outputs: ['主视角'] },
      { id: 'quad-grid', label: '四宫格', implementation: 'existing', description: '同图生成四个互补视角', outputs: ['主视角', '反向视角', '俯视角', '补充视角'] },
      { id: 'top-down', label: '独立俯视图', implementation: 'new-v2.1', description: '单独生成空间布局和人物走位参考', outputs: ['俯视布局'] },
      { id: 'panorama', label: '全景图', implementation: 'new-v2.1', description: '建立完整空间关系和连续镜头参考', outputs: ['空间全景'] },
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
        currentVersion: '当前使用 v2',
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
        currentVersion: '当前使用 v3',
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
        currentVersion: '当前使用 v2',
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
        currentVersion: '当前使用 v2',
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
      assetId,
      assetKind: 'character',
      title: '林夏',
      type: '人物',
      sections,
      sectionIds,
      activeSectionId: 'overview',
      candidateActionLabel: '使用此图',
      activeStateId: 'state-daily',
      currentVersion: '当前使用 v3',
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

  function getScriptStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default: null,
      blocked: { kind:'blocking', title:'剧本为空，不能确认', detail:'请先输入内容、生成草稿或从其他项目复制剧本。', actions:[{id:'edit-script',label:'开始编辑'},{id:'open-ai',label:'用 AI 生成草稿'}] },
      stale: { kind:'warning', title:'已确认剧本之后又有新草稿', detail:'下游仍引用 script-r11；当前草稿 script-r12 尚未确认。', actions:[{id:'compare-approved',label:'与已确认版本比较'},{id:'keep-draft',label:'继续编辑'}] },
      diff: { kind:'info', title:'正在比较 script-r11 → script-r12', detail:'新增 2 个场次，修改 3 段对白，删除 1 个动作描述。', actions:[{id:'apply-revision',label:'采用为当前草稿'},{id:'back-editor',label:'返回编辑'}] },
      'save-failed': { kind:'recoverable-error', title:'保存失败，浏览器恢复副本已保留', detail:'当前输入未丢失；重新连接本地服务后可按同一 revision 重试。', actions:[{id:'retry-save',label:'重试保存'},{id:'copy-recovery',label:'复制恢复文本'}] },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown script scenario: ${scenarioId}`);
    return {
      projectId:String(projectId), episodeId:String(episodeId), scenarioId, scenario:scenarios[scenarioId],
      featureName:'剧本', title:'第 1 集 · 无人楼层', subtitle:'编辑、版本比较、资产解析与确认',
      stageNavigation:[
        {id:'script',label:'剧本',routeId:'studio-script',state:'current'},
        {id:'assets',label:'设定',routeId:'studio-assets',state:'available'},
        {id:'storyboard',label:'分镜',routeId:'studio-storyboard',state:'blocked'},
        {id:'cut',label:'短片',routeId:'studio-cut',state:'blocked'},
      ],
      scenes:[
        {id:'scene-01',number:'01',heading:'内景 · 酒店前台 · 深夜',status:'已保存',wordCount:326},
        {id:'scene-02',number:'02',heading:'内景 · 13 层走廊 · 深夜',status:'有修改',wordCount:418},
        {id:'scene-03',number:'03',heading:'内景 · 208 门口 · 深夜',status:'已保存',wordCount:287},
        {id:'scene-04',number:'04',heading:'内景 · 酒店前台 · 稍后',status:'已保存',wordCount:241},
      ],
      editor:{selectedSceneId:'scene-02',content:'林夏握紧门卡，走廊尽头再次响起服务铃。\n\n林夏：208 房明明没有登记住客。',dirty:true,saveState:scenarioId==='save-failed'?'save_failed':'saved'},
      autosave:{delayMs:800,shortcut:'Ctrl/Cmd+S',browserRecoveryCopy:true},
      currentRevision:{id:'script-r12',status:'草稿',savedAt:'刚刚',approvedRevisionId:'script-r11'},
      revisions:[{id:'script-r12',label:'当前草稿',status:'draft'},{id:'script-r11',label:'已确认',status:'approved'},{id:'script-r10',label:'外部 AI 回流',status:'history'}],
      aiActions:[{id:'idea',label:'根据想法续写'},{id:'rewrite',label:'改写选中段落'},{id:'multi-episode',label:'生成多集草稿'},{id:'copy-project',label:'从项目复制'}],
      assetExtraction:{sourceRevision:'script-r12',diff:{added:2,changed:3,removed:1,locked:2},preservesManualLocks:true,autoWrite:false},
      approval:{action:'approve-script',createsRevisionOnly:true,autoRefreshDownstream:false,downstreamEffect:'设定与分镜标记为需评估；用户在各阶段选择继续旧快照或刷新'},
    };
  }

  function getEpisodeAssetsStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default:null,
      blocked:{kind:'blocking',title:'本集还缺少 1 项必需资产',detail:'酒店经理的对白策略要求人物音色，但当前没有可用候选。',actions:[{id:'open-manager',label:'配置人物音色'},{id:'change-audio',label:'改用无角色音色策略'}]},
      stale:{kind:'warning',title:'项目资产已有新版本',detail:'林夏酒店制服由 v2 更新到 v3；本集仍固定 v2，可继续使用或逐项刷新。',actions:[{id:'compare-snapshot',label:'比较差异'},{id:'keep-snapshot',label:'继续旧快照'},{id:'refresh-selection',label:'刷新选用'}]},
      'candidate-compare':{kind:'info',title:'正在比较林夏 · 酒店制服候选',detail:'点击候选只预览；“用于本集”才修改本集选择，项目 current 不受影响。',actions:[{id:'use-episode',label:'用于本集'},{id:'open-project-asset',label:'打开项目资产'}]},
      'look-change':{kind:'warning',title:'Project Look 已更新至 v5',detail:'本集快照仍引用 Look v4；刷新会使未锁定 Prompt/媒体进入 stale。',actions:[{id:'review-look',label:'查看影响'},{id:'keep-look',label:'继续 v4'},{id:'refresh-look',label:'刷新到 v5'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown episode assets scenario: ${scenarioId}`);
    return {
      projectId:String(projectId),episodeId:String(episodeId),scenarioId,scenario:scenarios[scenarioId],
      featureName:'设定',title:'第 1 集 · 无人楼层',subtitle:'本集生产对象选择与不可变快照',
      stageNavigation:[
        {id:'script',label:'剧本',routeId:'studio-script',state:'done'},
        {id:'assets',label:'设定',routeId:'studio-assets',state:'current'},
        {id:'storyboard',label:'分镜',routeId:'studio-storyboard',state:'blocked'},
        {id:'cut',label:'短片',routeId:'studio-cut',state:'blocked'},
      ],
      source:{scriptRevision:'script-r11',projectLookRevision:'look-v4'},
      requiredGroups:[
        {id:'characters',label:'人物与状态',ready:2,total:2,items:[{id:'linxia-hotel',label:'林夏 · 酒店制服',projectCurrent:'v3',episodeSelection:'v2',status:'有更新'},{id:'manager-suit',label:'酒店经理 · 正装',projectCurrent:'v2',episodeSelection:'v2',status:'已就绪'}]},
        {id:'scenes',label:'场景与剧情状态',ready:2,total:2,items:[{id:'corridor-night',label:'13 层走廊 · 停电应急',projectCurrent:'v4',episodeSelection:'v4',status:'已就绪'},{id:'room-door',label:'208 门口 · 深夜',projectCurrent:'v2',episodeSelection:'v2',status:'已就绪'}]},
        {id:'props',label:'道具与状态',ready:1,total:1,items:[{id:'keycard',label:'13 层门卡 · 完整',projectCurrent:'v2',episodeSelection:'v2',status:'已就绪'}]},
        {id:'voices',label:'条件音色',ready:1,total:2,items:[{id:'linxia-voice',label:'林夏 · 冷静清晰',projectCurrent:'v1',episodeSelection:'v1',status:'已就绪'},{id:'manager-voice',label:'酒店经理音色',projectCurrent:'缺失',episodeSelection:'未选择',status:'阻塞'}]},
      ],
      snapshot:{id:'asset-snapshot-draft-13',immutable:true,autoRefreshFromProject:false,confirmAction:'confirm-asset-gate',captures:['asset/version id','media hash','voice revision','Look revision','selection reason']},
      gate:{canEnterStoryboard:false,blockers:[{id:'manager-voice',label:'酒店经理缺少条件音色'}],warnings:[{id:'linxia-version',label:'林夏有项目新版本可选'}]},
      batchPreflight:{checked:7,ready:6,blocking:1,warnings:1,actions:['只处理缺失','重新检查','确认本集设定']},
    };
  }

  function getAiSettingsModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'credential-expired':{kind:'blocking',title:'MiniMax 凭据已过期',detail:'新任务被阻止，已运行任务保持原 runtime owner。',actions:[{id:'replace-key',label:'更换密钥'},{id:'test-connection',label:'重新测试'}]},
      'connection-failed':{kind:'recoverable-error',title:'连接测试失败',detail:'DNS 解析失败；没有提交生成请求，也没有产生费用。',actions:[{id:'retry-test',label:'重试连接'},{id:'open-network',label:'查看网络诊断'}]},
      'import-conflict':{kind:'blocking',title:'导入配置与本机存在 2 项冲突',detail:'密钥不会随配置文件导入；请逐项选择保留本机或采用映射。',actions:[{id:'resolve-import',label:'逐项处理'},{id:'cancel-import',label:'取消导入'}]},
      'chatgpt-waiting':{kind:'running',title:'ChatGPT 网页任务等待外部完成',detail:'session 与 attempt 已保存；没有可信百分比，可安全离开。',actions:[{id:'open-session',label:'打开会话'},{id:'select-result',label:'选择结果'}]},
      'chatgpt-rebind':{kind:'warning',title:'原网页会话不可访问',detail:'可将新标签页绑定到同一 attempt；输入 fingerprint 不匹配时必须阻断。',actions:[{id:'rebind-tab',label:'重新绑定标签页'},{id:'view-fingerprint',label:'查看输入指纹'}]},
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
    };
  }

  function getGlobalTaskModel(focusTaskId = '') {
    const tasks = [
      {id:'task-shot-03-image',title:'镜头 03 · 图片候选',status:'等待网页结果',lifecycle:'waiting_external',progressPercent:null,progressSource:'unavailable',elapsed:'1分08秒',estimate:'历史通常 1–3 分钟',actions:['打开网页会话','选择结果','取消 attempt']},
      {id:'task-shot-03-video',title:'镜头 03 · 视频候选',status:'运行中 64%',lifecycle:'running',progressPercent:64,progressSource:'provider',elapsed:'3分12秒',estimate:'预计剩余 2–5 分钟',actions:['查看输入与 H3 草稿','取消']},
      {id:'task-shot-05-video',title:'镜头 05 · 视频候选',status:'认证已过期',lifecycle:'blocked',progressPercent:null,progressSource:'unavailable',elapsed:'等待 2分14秒',estimate:'恢复认证后继续原 attempt',actions:['恢复认证','查看输入']},
      {id:'task-external-ai-episode-03',title:'外部 AI · 第 3 集',status:'需要处理',lifecycle:'waiting_external',progressPercent:null,progressSource:'unavailable',elapsed:'2小时',estimate:'等待用户选择结果 JSON',actions:['继续处理']},
    ];
    return {featureName:'全局任务',focusTaskId,tabs:['进行中','需要处理','历史'],tasks,capabilityRule:'actions-from-provider-capability-only'};
  }

  function getProjectCreateModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'source-picker':{kind:'info',title:'项目壳已建立，选择首集来源',detail:'此处复用剧集中心的六类来源，不建立第二套导入流程。',actions:[{id:'choose-source',label:'选择来源'},{id:'open-empty-project',label:'暂不创建剧集'}]},
      'shell-created':{kind:'success',title:'项目“午夜前台”已创建',detail:'当前是可见的空项目；取消后不会静默删除。',actions:[{id:'open-project',label:'进入项目'},{id:'continue-source',label:'继续创建首集'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown project create scenario: ${scenarioId}`);
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'新建项目',fields:[{id:'name',label:'项目名称',value:'午夜前台'},{id:'aspect-ratio',label:'画幅',value:'16:9'},{id:'episode-duration',label:'默认单集时长',value:'90 秒'},{id:'output-location',label:'输出位置',value:'E:/LocalMiniDrama/午夜前台'}],sources:buildEpisodeCreationSources(),createSequence:['填写最小字段','显式创建项目壳','选择首集来源','进入目标页面'],cancelAfterShell:{keepsEmptyProject:true,recoveryActions:['进入空项目','从项目菜单移入回收站']}};
  }

  function getProjectImportModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'unsupported-archive':{kind:'blocking',title:'不支持此项目归档版本',detail:'只接受 local-mini-drama.project-archive@2.1；旧 ZIP 不会被猜测升级。',actions:[{id:'choose-current',label:'重新选择 V2.1 归档'},{id:'view-guide',label:'查看旧版本处理说明'}]},
      failed:{kind:'recoverable-error',title:'导入事务已回滚',detail:'没有创建项目壳或复制媒体；文件选择和校验报告已保留。',actions:[{id:'retry-import',label:'按原校验重试'},{id:'choose-file',label:'重新选择'}]},
      succeeded:{kind:'success',title:'项目归档已导入为新项目',detail:'8 集、23 个媒体和 41 条任务历史已恢复；2 个缺失媒体待重定位。',actions:[{id:'open-project',label:'打开项目'},{id:'open-report',label:'查看导入报告'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown project import scenario: ${scenarioId}`);
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'导入项目归档',acceptedArchive:'local-mini-drama.project-archive@2.1',rejectsEpisodePackage:true,transactional:true,defaultStrategies:['import-as-new'],replacementPolicy:'only-through-explicit-restore-flow',manifest:{project:'凌晨两点的客房服务',version:'2.1',episodes:8,media:{total:23,available:21,missing:2},tasks:41,requiredSpace:'4.8 GB',sourcePath:'E:/Backups/midnight-service-v2.1.zip'},checks:['manifest 与 schema','文件 hash','媒体可用性','目标目录空间','项目名称冲突'],reportPreservedOnFailure:true};
  }

  function getGeneralSettingsModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'storage-offline':{kind:'blocking',title:'媒体根目录不可访问',detail:'不会自动改写路径；请重新连接磁盘或进入高级数据工具执行重定位。',actions:[{id:'open-relocation',label:'打开媒体重定位'},{id:'retry-storage',label:'重新检测'}]},
      'save-conflict':{kind:'recoverable-error',title:'设置已在另一窗口更新',detail:'你的未保存值已保留，可比较后重新提交。',actions:[{id:'compare-settings',label:'比较差异'},{id:'reload-settings',label:'载入最新'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown general settings scenario: ${scenarioId}`);
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'常规设置',sections:[{id:'workspace',label:'工作区与数据库',fields:['工作区位置','自动备份保留天数']},{id:'output',label:'媒体与交付输出',fields:['媒体根目录','成片输出目录','临时文件目录']},{id:'creation-defaults',label:'创作默认值',fields:['默认画幅','默认单集时长','默认语言']}],advancedRepairTarget:{routeId:'settings-data',params:{}},savePolicy:'optimistic-revision-with-draft-preservation'};
  }

  function getLibraryModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      empty:{kind:'info',title:'个人资产库为空',detail:'可从项目资产发布，或导入已有图片、音色和媒体。',actions:[{id:'import-library',label:'导入素材'},{id:'open-projects',label:'从项目发布'}]},
      offline:{kind:'blocking',title:'2 个库媒体文件离线',detail:'元数据、来源和使用位置仍可见；重定位前不删除记录。',actions:[{id:'relocate-library',label:'重新定位'},{id:'filter-online',label:'只看在线'}]},
      'publish-conflict':{kind:'blocking',title:'库中已有相同 source hash 的不同版本',detail:'请选择固定引用现有版本、发布新版本或复制为独立资产。',actions:[{id:'use-existing',label:'使用现有版本'},{id:'publish-version',label:'发布新版本'},{id:'copy-independent',label:'复制为独立资产'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown library scenario: ${scenarioId}`);
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'个人资产库',filters:['类型','在线状态','许可','最近使用'],addModes:[{id:'pinned-reference',label:'固定版本引用',followsLibraryUpdates:false},{id:'project-copy',label:'复制到项目',followsLibraryUpdates:false}],items:[{id:'lib-linxia',type:'人物',name:'林夏身份锚点',version:'v3',provenance:'项目“凌晨两点”发布',license:'用户自有 · 本地项目可用',path:'E:/Library/characters/linxia-v3.png',usageLocations:['凌晨两点 · 第1集','门后铃声 · 第2集']},{id:'lib-corridor',type:'场景',name:'酒店走廊雨夜',version:'v4',provenance:'本地上传 + ComfyUI 候选',license:'用户自有 · 可复用',path:'E:/Library/scenes/corridor-v4.png',usageLocations:['凌晨两点 · 2个分镜']},{id:'lib-voice',type:'音色',name:'冷静女声 02',version:'v2',provenance:'MiniMax TTS 预设',license:'Provider 许可 · 需保留来源',path:'provider://minimax/voice-02',usageLocations:['林夏 · 2个项目']}],deletePolicy:'referenced-assets-archive-only'};
  }

  function getQuickCreateModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      generating:{kind:'running',title:'视频候选正在生成',detail:'canonical job 已入队；关闭页面不会停止任务。',actions:[{id:'open-task',label:'查看任务'},{id:'cancel-if-supported',label:'取消任务'}]},
      failed:{kind:'recoverable-error',title:'生成失败',detail:'Recipe、引用、费用快照和诊断均已保留。',actions:[{id:'retry-snapshot',label:'按原输入重试'},{id:'change-provider',label:'更换 Provider'}]},
      succeeded:{kind:'success',title:'候选已生成，尚未归档',detail:'请选择下载、入库或绑定到项目；关闭前会再次确认。',actions:[{id:'choose-destination',label:'选择去向'},{id:'preview-result',label:'预览结果'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown quick create scenario: ${scenarioId}`);
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'自由创作实验室',description:'不进入项目也能快速生成，但复用统一 Provider、任务、媒体和候选事实源。',jobContract:'canonical-generation-job',recipes:[{id:'image',label:'快速图片',inputs:['提示词','参考图','画幅','Provider']},{id:'video',label:'快速视频',inputs:['提示词/H3','参考图/首尾帧','时长','Provider']}],generationEnvelope:['Provider/模型','引用','输出参数','预计费用','预计处理时间','失败恢复'],resultDestinations:[{id:'download',label:'下载'},{id:'library',label:'加入个人资产库'},{id:'project-asset',label:'绑定项目资产'},{id:'shot-candidate',label:'加入分镜候选'},{id:'cut-timeline',label:'加入短片时间线'}],isFourStageGate:false,closePolicy:'unarchived-result-requires-save-or-discard'};
  }

  function getCanvasModel(scenarioId = 'default') {
    const scenarios = {
      default:null,
      'restore-context':{kind:'info',title:'已恢复上次高级视图上下文',detail:'项目、剧集、阶段、选中对象和视口均已恢复。',actions:[{id:'focus-selection',label:'聚焦选中对象'},{id:'reset-view',label:'重置视图'}]},
      unsaved:{kind:'blocking',title:'画布布局尚未保存',detail:'布局是视图状态；对象修改已经通过共享命令保存。',actions:[{id:'save-layout',label:'保存布局'},{id:'discard-layout',label:'放弃布局'},{id:'cancel-navigation',label:'留在画布'}]},
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown canvas scenario: ${scenarioId}`);
    return {scenarioId,scenario:scenarios[scenarioId],featureName:'高级画布',description:'标准页面的高级关系与批量编排视图，不拥有第二套业务数据。',context:{projectId:'7',episodeId:'1',stage:'assets',focusId:'character-linxia'},ownsDomainData:false,commandParity:true,layoutState:{scope:'view-only',revision:'layout-r7',dirty:scenarioId==='unsaved'},nodes:[{id:'character-linxia',type:'人物状态',label:'林夏 · 酒店制服',status:'使用中'},{id:'scene-corridor',type:'场景状态',label:'13 层走廊 · 停电',status:'有更新'},{id:'shot-03',type:'分镜',label:'镜头 03',status:'待重新编译'},{id:'video-a',type:'视频候选',label:'video-a',status:'已采用'}],edges:[['character-linxia','shot-03'],['scene-corridor','shot-03'],['shot-03','video-a']],sharedCommands:['useAssetVersion','submitGeneration','adoptCandidate','recompileShot','archiveObject'],advancedActions:['框选','分组','批量重编译','影响路径','Fit selection'],excludedProducts:['完整 2D 画板','完整 3D 导演台','视频重绘']};
  }

  function getStoryboardStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default: null,
      blocked: {
        kind: 'blocking',
        title: '2 个必需资产尚未就绪',
        detail: '酒店经理缺少当前人物图，13 层门卡的“刷卡中”状态没有可用候选。',
        actions: [{ id: 'open-assets', label: '返回设定处理' }],
      },
      stale: {
        kind: 'warning',
        title: '镜头输入已变化',
        detail: '人物“林夏·酒店制服”从 v2 更新到 v3；旧分镜图和视频候选保留，但已标记过期。',
        actions: [{ id: 'review-diff', label: '查看影响' }, { id: 'recompile', label: '重新编译' }],
      },
      'multi-segment': {
        kind: 'info',
        title: '当前分镜包含 3 个时段',
        detail: '时段保持连续闭合，总时长 7 秒；一个时段或多个时段都是合法结构。',
        actions: [{ id: 'edit-segments', label: '编辑时段' }],
      },
      'provider-blocked': {
        kind: 'blocking',
        title: '目标模型不支持当前结构',
        detail: '当前 Recipe 包含 3 个时段和 2 个场景，所选模型只接受单时段、单场景输入。',
        actions: [{ id: 'split-shot', label: '按建议拆分分镜' }, { id: 'change-provider', label: '更换模型' }],
      },
      'prompt-gate-failed': {
        kind: 'blocking',
        title: 'PromptStyleGate 未通过',
        detail: '人工运镜文本与结构化镜头方向冲突；系统不会覆盖人工内容。',
        actions: [{ id: 'open-prompt-diff', label: '查看冲突' }, { id: 'keep-manual', label: '保留人工文本并重编译' }],
      },
      'h3-stale': {
        kind: 'blocking',
        title: 'H3 提示词来源已变化',
        detail: 'Shot revision、人物状态或声音事件已更新；旧草稿保留，但不能用于新的正式视频任务。',
        actions: [{ id: 'compare-h3-source', label: '查看来源变化' }, { id: 'regenerate-h3', label: '重新生成 H3 提示词' }],
      },
      'h3-invalid': {
        kind: 'blocking',
        title: 'H3 提示词校验失败',
        detail: '当前草稿缺少一个引用槽位，且旁白语义未覆盖。人工文本不会被自动删除。',
        actions: [{ id: 'edit-h3', label: '编辑 H3 草稿' }, { id: 'regenerate-h3', label: '重新生成' }],
      },
      continuity: {
        kind: 'warning',
        title: '下一镜连续性需要确认',
        detail: '镜头 03 的结束动作方向与镜头 04 相反；稳定帧尚未建立依赖。',
        actions: [{ id: 'compare-continuity', label: '比较相邻镜头' }, { id: 'confirm-stable-frame', label: '确认稳定帧' }],
      },
      'video-generating': {
        kind: 'running',
        title: '镜头 03 正在生成视频',
        detail: 'H3 Story Video · 64% · 可安全离开本页，完成后进入候选历史。',
        actions: [{ id: 'open-task', label: '查看任务' }, { id: 'cancel-task', label: '取消任务' }],
      },
      'generation-failed': {
        kind: 'recoverable-error',
        title: '镜头视频生成失败',
        detail: '远端任务返回引用下载超时；原 Recipe、Prompt、引用和费用快照均已保留。',
        actions: [{ id: 'retry-snapshot', label: '按原输入重试' }, { id: 'open-diagnostic', label: '查看诊断' }],
      },
      'batch-partial': {
        kind: 'recoverable-error',
        title: '批量生成部分完成',
        detail: '6 个镜头成功，1 个失败，2 个因已有最新候选而跳过；成功结果不会回滚。',
        actions: [{ id: 'retry-failed', label: '只重试失败项' }, { id: 'open-batch-result', label: '查看批量结果' }],
      },
      'candidate-compare': {
        kind: 'info',
        title: '正在比较 3 个视频候选',
        detail: '点击候选只切换预览；必须点击“用于本镜”才会改变采用结果。',
        actions: [{ id: 'open-video-history', label: '展开候选历史' }],
      },
      conflict: {
        kind: 'recoverable-error',
        title: '镜头草稿发生版本冲突',
        detail: '另一个窗口已保存 Shot revision 19；你的草稿仍保留，可比较后合并。',
        actions: [{ id: 'compare-revisions', label: '比较并合并' }, { id: 'reload-shot', label: '载入最新版' }],
      },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown storyboard scenario: ${scenarioId}`);
    return {
      projectId: String(projectId),
      episodeId: String(episodeId),
      scenarioId,
      scenario: scenarios[scenarioId],
      featureName: '分镜',
      title: '第 1 集 · 凌晨两点的来客',
      subtitle: '镜头设计、分镜图与镜头视频生成',
      stageNavigation: [
        { id: 'script', label: '剧本', routeId: 'studio-script', state: 'done' },
        { id: 'assets', label: '设定', routeId: 'studio-assets', state: 'done' },
        { id: 'storyboard', label: '分镜', routeId: 'studio-storyboard', state: 'current' },
        { id: 'cut', label: '短片', routeId: 'studio-cut', state: 'available' },
      ],
      workspaceColumns: ['shot-inspector', 'visual-workbench', 'prompt-and-generation'],
      sceneSummary: { selected: '场次 02 · 无人楼层', sceneCount: 4, shotCount: 9, totalDuration: '01:08' },
      reextract: {
        label: '从当前剧本重新生成分镜',
        source: { kind: 'script-revision', revision: 12, label: '剧本 r12 · 已确认' },
        provider: '文字结构模型 · drama-structure-v2',
        estimatedCost: '约 ¥0.18',
        estimatedProcessingTime: '约 40–90 秒',
        diff: { added: 2, changed: 3, removed: 1, unchanged: 6 },
        applyMode: 'create-new-shot-revision',
        preservesManualLocks: true,
        preservesMediaHistory: true,
        steps: ['确认剧本来源', '生成新结构', '查看差异', '处理冲突', '创建新 Shot revision'],
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
        revision: 18,
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
      visualWorkbench: {
        modes: [
          { id: 'storyboard-image', label: '分镜图' },
          { id: 'blocking', label: '站位图' },
          { id: 'continuity', label: '连续性' },
          { id: 'previs', label: '动作预演 · 不进成片' },
        ],
        currentImageCandidateId: 'image-b',
        imageCandidates: [
          { id: 'image-a', label: '候选 A', meta: 'ChatGPT 网页 · 16:9', isCurrent: false, tone: 'blue' },
          { id: 'image-b', label: '候选 B', meta: 'API · 16:9 · 当前', isCurrent: true, tone: 'purple' },
          { id: 'image-c', label: '候选 C', meta: '外部回填 · 16:9', isCurrent: false, tone: 'amber' },
        ],
        continuityFrames: [
          { id: 'previous', label: '上一镜结束帧', status: 'ready' },
          { id: 'current', label: '本镜当前图', status: 'ready' },
          { id: 'next', label: '下一镜参考', status: 'needs-confirmation' },
        ],
      },
      promptCompiler: {
        mode: 'basic',
        sections: [
          { id: 'intent', label: '业务意图', summary: '夜间悬疑、克制表演、缓慢前推' },
          { id: 'motion', label: '动作与运镜', summary: '三时段连续动作，保持轴线方向' },
          { id: 'negative', label: '负向约束', summary: '避免人物变脸、门牌错字和走廊结构漂移' },
          { id: 'compiled', label: '编译结果', summary: 'H3 多模态描述 · 3 个引用槽位 · Gate 通过' },
        ],
        advancedFields: ['结构化角度', 'Universal mode', 'AV contract', '完整 H3 JSON'],
        h3Draft: {
          status: scenarioId === 'h3-stale' ? 'stale' : scenarioId === 'h3-invalid' ? 'invalid' : 'ai-generated',
          statusLabel: scenarioId === 'h3-stale' ? '来源已变化' : scenarioId === 'h3-invalid' ? '结构校验失败' : 'AI 生成',
          actionLabel: scenarioId === 'h3-stale' || scenarioId === 'h3-invalid' ? '重新生成 H3 提示词' : '生成 H3 提示词',
          editable: true,
          canSubmitVideo: !['h3-stale', 'h3-invalid'].includes(scenarioId),
          sourceRevision: 'Shot r18 · Recipe r7',
          sourceFingerprint: 'sha256:h3f7c2…91ab',
          generatedAt: '2026-09-09 14:32',
          generatedBy: 'H3 Prompt Compiler',
          text: '[0.0–2.0s] @图片1 林夏停在 208 门前……\n[2.0–5.0s] 镜头缓慢前推，门卡由红转绿……\n[5.0–7.0s] 林夏回头，画外脚步声停止……',
          validationChecks: ['结构校验', '引用槽位', '音频语义覆盖', 'PromptStyleGate'],
          recoveryActions: scenarioId === 'h3-invalid' ? ['编辑缺失槽位', '重新生成并保留旧草稿'] : [],
        },
        referenceManifest: [
          { segmentId: 'segment-a', items: ['林夏·酒店制服 v3', '208 走廊 v2'] },
          { segmentId: 'segment-b', items: ['13 层门卡 v1', '首帧 image-b'] },
          { segmentId: 'segment-c', items: ['林夏音色 v1', '稳定帧 artifact-22'] },
        ],
      },
      videoGeneration: {
        ownerStage: 'storyboard',
        requiresCostConfirmation: true,
        recipe: 'H3 Story Video · 都市悬疑',
        provider: 'MiniMax H3 · 多时段参考生视频',
        plannedDuration: '7s',
        requestedDuration: '8s',
        resolution: '720p',
        aspectRatio: '16:9',
        estimatedCost: '¥1.80',
        concurrency: 2,
        timing: {
          estimatedQueueWait: '约 1–2 分钟',
          estimatedProcessingTime: '约 4–8 分钟',
          estimatedTotalTime: '约 5–10 分钟',
          estimateBasis: 'MiniMax H3 最近 20 个同规格任务的 P50–P90',
          estimateIsGuaranteed: false,
          runningElapsed: scenarioId === 'video-generating' ? '已运行 3分12秒' : null,
          estimatedRemaining: scenarioId === 'video-generating' ? '预计还需 2–5 分钟' : null,
        },
        degradations: [],
        adoptedCandidateId: 'video-a',
        candidates: [
          { id: 'video-a', label: '候选 A', meta: '输出 8s · H3 · 当前用于本镜', status: 'ready', isAdopted: true, submittedAt: '14:20:05', startedAt: '14:21:12', completedAt: '14:26:40', queueDuration: '1分07秒', processingDuration: '5分28秒', totalDuration: '6分35秒' },
          { id: 'video-b', label: '候选 B', meta: '输出 8s · H3 · 动作更自然', status: 'ready', isAdopted: false, submittedAt: '14:27:00', startedAt: '14:27:48', completedAt: '14:33:02', queueDuration: '48秒', processingDuration: '5分14秒', totalDuration: '6分02秒' },
          { id: 'video-c', label: '候选 C', meta: scenarioId === 'video-generating' ? '生成中 64% · 已运行 3分12秒' : '失败 · 可按原输入重试', status: scenarioId === 'video-generating' ? 'running' : 'failed', isAdopted: false, submittedAt: '14:35:00', startedAt: scenarioId === 'video-generating' ? '14:36:10' : null, completedAt: null, queueDuration: scenarioId === 'video-generating' ? '1分10秒' : null, processingDuration: null, totalDuration: null },
        ],
      },
      batchActions: [
        { id: 'recompile', label: '重新编译' },
        { id: 'generate-images', label: '生成缺失/过期图片' },
        { id: 'generate-videos', label: '生成缺失/过期视频' },
        { id: 'confirm-shots', label: '确认所选分镜' },
        { id: 'share-recipe', label: '共享 Recipe' },
        { id: 'export-shot-package', label: '导出 Shot Package' },
      ],
      exportActions: [
        { id: 'html-storyboard', label: 'HTML 分镜表', includes: 'revision + hash' },
        { id: 'srt', label: 'SRT 字幕草稿', includes: 'revision + hash' },
        { id: 'shot-package', label: 'Shot Package', includes: 'revision + hash + manifest' },
      ],
      nextStage: { label: '进入短片审核', routeId: 'studio-cut', requires: 'all-required-shots-confirmed' },
      finalCutActions: [],
    };
  }

  function getCutStageModel(projectId, episodeId, scenarioId = 'default') {
    const scenarios = {
      default: null,
      blocked: {
        kind: 'blocking', title: '3 个必需镜头尚无采用视频', detail: '可返回分镜生成，或为确实不需要的镜头登记带原因和有效期的豁免。', actions: [{ id: 'back-storyboard', label: '返回分镜处理' }, { id: 'add-waiver', label: '登记豁免' }],
      },
      stale: {
        kind: 'warning', title: '2 个时间线片段引用了过期候选', detail: '旧媒体仍可播放；锁定画面前必须重新采用或确认保留。', actions: [{ id: 'review-stale', label: '逐项处理' }],
      },
      'candidate-compare': {
        kind: 'info', title: '正在比较镜头 03 的候选', detail: '改变默认候选不会自动替换已固定到时间线的片段。', actions: [{ id: 'replace-timeline', label: '替换当前时间线片段' }, { id: 'default-only', label: '仅改默认候选' }],
      },
      'retake-failed': {
        kind: 'recoverable-error', title: '局部重拍失败', detail: '原候选与时间范围 2.0–4.5s 均保留；可以复用输入快照再次提交。', actions: [{ id: 'retry-retake', label: '按原输入重试' }, { id: 'back-original', label: '继续使用原候选' }],
      },
      'picture-lock': {
        kind: 'success', title: '画面已锁定 · Picture revision 12', detail: '当前时间线转为只读；后续画面修改将派生新 revision。', actions: [{ id: 'derive-picture', label: '派生新画面版本' }],
      },
      'audio-conflict': {
        kind: 'blocking', title: '对白 5.0–7.0s 存在双重声音所有权', detail: 'H3 原生声音和后期 TTS 同时启用；必须选择唯一 owner。', actions: [{ id: 'use-h3-native', label: '保留 H3 原声' }, { id: 'use-post-tts', label: '静音原声并使用 TTS' }],
      },
      'delivery-failed': {
        kind: 'recoverable-error', title: '交付在混音与响度步骤失败', detail: 'Picture revision 12、调色和字幕中间结果均已保留。', retryFromStep: 'mix-loudness', preservesIntermediateResults: true, actions: [{ id: 'retry-delivery-step', label: '从混音步骤重试' }, { id: 'use-base-version', label: '回退基础版本' }],
      },
      'offline-media': {
        kind: 'blocking', title: '镜头 05 的采用视频文件离线', detail: '数据库候选和 hash 仍在；重新定位或改用在线历史候选后继续。', actions: [{ id: 'relocate-media', label: '重新定位文件' }, { id: 'use-online-history', label: '选择在线历史候选' }],
      },
      'post-failed': {
        kind: 'recoverable-error', title: '超分处理失败', detail: '技术匹配与调色结果已保留，失败不会清空时间线或音频。', actions: [{ id: 'retry-upscale', label: '重试超分' }, { id: 'skip-upscale', label: '跳过超分继续' }],
      },
      exported: {
        kind: 'success', title: '成片 revision 6 已导出', detail: 'MP4、manifest、字幕和质检报告均已保存；后续修改将派生 revision 7。', actions: [{ id: 'open-output', label: '打开输出目录' }, { id: 'compare-delivery', label: '比较历史成片' }],
      },
    };
    if (!(scenarioId in scenarios)) throw new Error(`Unknown cut scenario: ${scenarioId}`);
    const pictureReady = ['picture-lock', 'audio-conflict', 'delivery-failed', 'post-failed', 'exported'].includes(scenarioId);
    const readiness = pictureReady
      ? { completed: 9, required: 9, waived: 0, running: 0, failed: 0 }
      : { completed: 6, required: 9, waived: 0, running: 1, failed: 1 };
    const canPictureLock = readiness.completed + readiness.waived === readiness.required
      && readiness.running === 0 && readiness.failed === 0;
    const pictureLockBlockers = canPictureLock ? [] : [
      '3 个必需镜头尚未采用或豁免',
      '仍有 1 个视频任务运行中',
      '仍有 1 个失败任务未处理',
    ];
    const encodePassed = scenarioId === 'exported';
    const deliveryBlockers = encodePassed ? [] : [
      scenarioId === 'delivery-failed' ? '混音与响度步骤失败' : '编码校验仍在等待',
    ];
    return {
      projectId: String(projectId),
      episodeId: String(episodeId),
      scenarioId,
      scenario: scenarios[scenarioId],
      featureName: '短片',
      title: '第 1 集 · 凌晨两点的来客',
      subtitle: '整集审核、时间线、后期与交付',
      primaryWorkflow: 'episode-review-and-delivery',
      videoGenerationAccess: 'secondary-repair',
      tabs: [
        { id: 'review', label: '镜头审核' },
        { id: 'timeline', label: '时间线' },
        { id: 'delivery', label: '交付' },
      ],
      readiness,
      gates: { canPictureLock, pictureLockBlockers },
      reviewActions: [
        { id: 'play-current', label: '播放当前镜头' },
        { id: 'play-all', label: '连续播放' },
        { id: 'open-history', label: '候选历史' },
        { id: 'regenerate', label: '重新生成' },
        { id: 'retake', label: '局部重拍' },
      ],
      selectedShot: {
        id: 'shot-03', number: '03', candidateId: 'video-a', duration: '00:08', status: '已采用', sourceSnapshot: 'shot-03@r18 · recipe@r7 · refs@a81c',
      },
      shotRail: [
        { shotId: 'shot-01', number: '01', duration: 6, status: 'ready', candidateId: 'video-01-a' },
        { shotId: 'shot-02', number: '02', duration: 5, status: 'ready', candidateId: 'video-02-a' },
        { shotId: 'shot-03', number: '03', duration: 8, status: 'selected', candidateId: 'video-a' },
        { shotId: 'shot-04', number: '04', duration: 8, status: 'missing', candidateId: null },
        { shotId: 'shot-05', number: '05', duration: 5, status: 'failed', candidateId: null },
      ],
      timeline: {
        pictureRevision: 11,
        locked: scenarioId === 'picture-lock',
        clips: [
          { id: 'clip-01', shotId: 'shot-01', candidateId: 'video-01-a', in: '00:00.0', out: '00:06.0', speed: '1.0×', transition: '无' },
          { id: 'clip-02', shotId: 'shot-02', candidateId: 'video-02-a', in: '00:00.4', out: '00:05.0', speed: '1.0×', transition: '叠化 4f' },
          { id: 'clip-03', shotId: 'shot-03', candidateId: 'video-a', in: '00:00.0', out: '00:07.4', speed: '0.96×', transition: '硬切' },
        ],
        pictureLockChecks: ['采用候选或有效豁免', '媒体在线', '时长与重叠', '画幅一致', '无运行任务'],
      },
      audio: {
        ownerOptions: ['h3_native', 'post_tts', 'source_media', 'none'],
        rows: [
          { range: '0.0–5.0s', kind: '旁白', owner: 'post_tts', state: 'valid' },
          { range: '5.0–7.0s', kind: '林夏对白', owner: scenarioId === 'audio-conflict' ? 'conflict' : 'h3_native', state: scenarioId === 'audio-conflict' ? 'blocking' : 'valid' },
        ],
        bgmStrategies: ['none', 'episode-track', 'per-segment'],
        bgm: { strategy: 'episode-track', gain: '-16 LUFS', ducking: '-6 dB', fadeIn: '1.2s', fadeOut: '1.8s' },
      },
      subtitles: {
        source: '从剧本生成', editable: true, snapToAudio: true, safeAreaCheck: 'passed', overlapCheck: '1 warning', changesPictureLock: false,
      },
      postChain: [
        { id: 'base-composite', label: '基础合片母版', status: pictureReady ? 'done' : 'blocked' },
        { id: 'technical-match', label: '技术匹配', status: 'done' },
        { id: 'creative-look', label: '创意 Look / 调色', status: 'done' },
        { id: 'upscale', label: '可选超分', status: scenarioId === 'post-failed' ? 'failed' : 'optional' },
        { id: 'subtitles-watermark', label: '字幕 / 水印', status: 'ready' },
        { id: 'mix-loudness', label: '混音 / 响度', status: scenarioId === 'delivery-failed' ? 'failed' : 'ready' },
        { id: 'encode-validate', label: '编码校验', status: 'waiting' },
      ],
      postArtifacts: [
        { id:'base-composite', label:'基础合片母版', pictureRevision:12, hash:'sha256:base…91ca', preservedOnUpscaleFailure:true },
        { id:'upscaled-composite', label:'超分母版', source:'base-composite', status:scenarioId==='post-failed'?'failed':scenarioId==='exported'?'ready':'not-created' },
      ],
      upscaleDecision: {
        allowed:['skip','run','fallback-to-base'],
        current:scenarioId==='post-failed'?'fallback-to-base':scenarioId==='exported'?'run':'not-decided',
        persistedIn:'PostRevision',
      },
      delivery: {
        postRevision: 5,
        checks: ['Picture/Post revision', '编码参数', '黑帧', '静音与削波', '字幕安全区', '输出目录', '磁盘空间'],
        outputs: ['MP4 成片', 'manifest.json', 'SRT / ASS', '交付质检报告'],
        revisionPolicy: 'derive-after-delivery',
        canExport: encodePassed,
        blockers: deliveryBlockers,
        lineage: 'Picture revision 12 → Post revision 5 → Delivery revision 6',
      },
    };
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
    if (state.routeId === 'studio-cut' && action.type === 'adopt-cut-candidate') {
      const adoptedByShot = { ...(state.adoptedByShot || {}), [action.shotId]: action.candidateId };
      const timelineClips = (state.timelineClips || []).map(clip => (
        action.timelineDecision === 'replace' && clip.shotId === action.shotId
          ? { ...clip, candidateId: action.candidateId }
          : { ...clip }
      ));
      return { ...state, adoptedByShot, timelineClips };
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
    filterAndSortProjectAssets,
    getProjectBibleModel,
    getProjectCardNavigationTarget,
    getProjectSectionNavigation,
    getProjectOperationsModel,
    getAdvancedDataToolsModel,
    getProjectOverviewBlockerTarget,
    getProjectOverviewModel,
    getProjectStageNavigationTarget,
    getProjectEpisodesModel,
    getEpisodeSourceAuditModel,
    getEpisodeNavigationTarget,
    getEpisodeCreationFlow,
    getEpisodePackageImportModel,
    getScriptStageModel,
    getEpisodeAssetsStageModel,
    getAiSettingsModel,
    getGlobalTaskModel,
    getProjectCreateModel,
    getProjectImportModel,
    getGeneralSettingsModel,
    getLibraryModel,
    getQuickCreateModel,
    getCanvasModel,
    getStoryboardStageModel,
    getCutStageModel,
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
