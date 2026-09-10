(function exposeProjectHubModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionStudioV21ProjectHubModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  function evaluateImportTarget({ mode, episode } = {}) {
    if (mode === 'create_new') {
      return {
        allowed: true,
        action: 'create_episode',
        episodeId: null,
        availableActions: ['continue', 'cancel'],
      };
    }
    if (mode === 'fill_existing' && episode?.isBlank === true) {
      return {
        allowed: true,
        action: 'fill_blank_episode',
        episodeId: episode.id,
        availableActions: ['continue', 'choose_another_episode', 'cancel'],
      };
    }
    return {
      allowed: false,
      code: 'TARGET_NOT_BLANK',
      episodeId: episode?.id ?? null,
      reasons: [...(episode?.reasons || [])],
      availableActions: ['choose_blank_episode', 'create_new_episode', 'cancel'],
    };
  }

  function buildProjectCards() {
    return [{
      id: 7,
      title: '凌晨两点的客房服务',
      episodeCount: 8,
      latestEpisode: '第 1 集 · 无人楼层',
      continueEpisodeId: 1,
      continueStage: 'storyboard',
      updatedOrder: 2,
      titleSortKey: 'lingchen-liangdian-kefang-fuwu',
      projectStatus: 'needs-attention',
      cover: { source: 'current-storyboard', label: '当前分镜', tone: 'night' },
      stages: {
        script: { status: 'approved', label: '已确认', summary: '1/1' },
        assets: { status: 'ready_for_review', label: '待确认 1', summary: '8/9' },
        storyboard: { status: 'in_progress', label: '进行中', summary: '7/10' },
        cut: { status: 'not_started', label: '未开始', summary: '0/10' },
      },
      staleCount: 1,
      blockers: 1,
      runningTasks: 1,
      updatedAt: '刚刚',
    }, {
      id: 9,
      title: '雾港来信',
      episodeCount: 12,
      latestEpisode: '第 4 集 · 码头仓库',
      continueEpisodeId: 4,
      continueStage: 'assets',
      updatedOrder: 1,
      titleSortKey: 'wugang-laixin',
      projectStatus: 'in-progress',
      cover: { source: 'project-poster', label: '项目封面', tone: 'harbor' },
      stages: {
        script: { status: 'approved', label: '已确认', summary: '4/4' },
        assets: { status: 'in_progress', label: '进行中', summary: '5/8' },
        storyboard: { status: 'not_started', label: '未开始', summary: '0/12' },
        cut: { status: 'not_started', label: '未开始', summary: '0/12' },
      },
      staleCount: 0,
      blockers: 0,
      runningTasks: 0,
      updatedAt: '昨天 21:42',
    }];
  }

  function getProjectListModel({ query = '', status = 'all', sort = 'updated-desc', scenarioId = 'default' } = {}) {
    const statusOptions = [
      { id: 'all', label: '全部' },
      { id: 'in-progress', label: '制作中' },
      { id: 'needs-attention', label: '需要处理' },
      { id: 'completed', label: '已完成' },
      { id: 'archived', label: '已归档' },
    ];
    const normalizedStatus = statusOptions.some(item => item.id === status) ? status : 'all';
    const normalizedSort = ['updated-desc', 'name-asc'].includes(sort) ? sort : 'updated-desc';
    const normalizedQuery = String(query || '').trim();
    const stageLabels = { script: '剧本', assets: '本集素材', storyboard: '分镜', cut: '成片' };
    const sourceProjects = buildProjectCards();

    if (scenarioId === 'load-failed') {
      return {
        kind: 'error', query: normalizedQuery, status: normalizedStatus, sort: normalizedSort,
        title: '项目索引读取失败',
        detail: '项目文件没有丢失；可以重试读取、重建只读索引或打开高级数据工具。',
        actions: [
          { id: 'retry-project-index', label: '重新读取' },
          { id: 'rebuild-project-index', label: '重建项目索引' },
          { id: 'open-data-tools', label: '打开高级数据工具' },
        ],
        items: [], totalCount: sourceProjects.length, resultCount: 0, statusOptions,
      };
    }

    let items = sourceProjects.map(project => {
      const stage = project.stages[project.continueStage];
      const health = [];
      if (project.runningTasks) health.push({ kind: 'running', label: `生成中 ${project.runningTasks}`, target: 'tasks' });
      if (project.blockers) health.push({ kind: 'attention', label: `待处理 ${project.blockers}`, target: 'overview' });
      if (project.staleCount) health.push({ kind: 'refresh', label: `需要更新 ${project.staleCount}`, target: 'overview' });
      if (scenarioId === 'task-paused' && project.id === 7) {
        health.splice(0, health.length, { kind: 'attention', label: '任务需要处理 1', target: 'tasks' });
      }
      return {
        id: project.id,
        title: project.title,
        episodeCount: project.episodeCount,
        updatedAt: project.updatedAt,
        updatedOrder: project.updatedOrder,
        projectStatus: project.projectStatus,
        cover: { ...project.cover },
        health,
        continueEpisodeId: project.continueEpisodeId,
        continueStage: project.continueStage,
        continueLabel: `继续第 ${project.continueEpisodeId} 集 · ${stageLabels[project.continueStage]}`,
        recentWork: {
          episodeId: project.continueEpisodeId,
          label: `第 ${project.continueEpisodeId} 集《${project.latestEpisode.replace(/^第\s*\d+\s*集\s*·\s*/, '')}》`,
          stage: project.continueStage,
          stageLabel: stageLabels[project.continueStage],
          progress: stage.summary,
        },
        titleSortKey: project.titleSortKey,
        locationBadge: null,
      };
    });

    if (normalizedQuery) {
      const term = normalizedQuery.toLocaleLowerCase('zh-CN');
      items = items.filter(item => item.title.toLocaleLowerCase('zh-CN').includes(term));
    }
    if (normalizedStatus !== 'all') items = items.filter(item => item.projectStatus === normalizedStatus);
    if (scenarioId === 'no-results') items = [];
    items.sort((a, b) => normalizedSort === 'name-asc'
      ? a.titleSortKey.localeCompare(b.titleSortKey)
      : b.updatedOrder - a.updatedOrder);

    return {
      kind: items.length ? 'ready' : 'empty-results',
      query: normalizedQuery,
      status: normalizedStatus,
      sort: normalizedSort,
      statusOptions,
      totalCount: sourceProjects.length,
      resultCount: items.length,
      items,
      banner: scenarioId === 'task-paused' ? {
        kind: 'attention',
        title: '“凌晨两点的客房服务”有 1 个任务需要处理',
        detail: '任务输入和已生成结果均已保留，可从项目任务列表继续恢复。',
        actions: [{ id: 'open-project-tasks', label: '查看项目任务' }],
      } : null,
      emptyState: items.length ? null : {
        title: '没有匹配项目',
        detail: '清除搜索或调整状态筛选后重试。',
        actions: [{ id: 'clear-filters', label: '清除条件' }],
      },
    };
  }

  function buildEpisodeRows() {
    return [{
      id: 7,
      number: 1,
      title: '无人楼层',
      durationTarget: 92,
      importSource: { filename: 'episode-01.json', schemaVersion: '2.1' },
      stages: {
        script: { status: 'approved', label: '已确认' },
        assets: { status: 'in_progress', label: '8/9' },
        storyboard: { status: 'in_progress', label: '7/10' },
        cut: { status: 'in_progress', label: '进行中' },
      },
      blockers: 1,
      nextAction: '继续分镜',
      lastPosition: '分镜 03',
    }, {
      id: 8,
      number: 2,
      title: '门后的铃声',
      durationTarget: 85,
      importSource: null,
      stages: {
        script: { status: 'draft', label: '草稿' },
        assets: { status: 'not_started', label: '未开始' },
        storyboard: { status: 'not_started', label: '未开始' },
        cut: { status: 'not_started', label: '未开始' },
      },
      nextAction: '继续剧本',
      lastPosition: '剧本',
    }, {
      id: 12,
      number: 3,
      title: '未命名',
      durationTarget: null,
      isBlank: true,
      importSource: null,
      stages: {
        script: { status: 'not_started', label: '空白' },
        assets: { status: 'not_started', label: '未开始' },
        storyboard: { status: 'not_started', label: '未开始' },
        cut: { status: 'not_started', label: '未开始' },
      },
      nextAction: '编辑或导入',
      lastPosition: null,
    }];
  }

  function buildCreationSources() {
    return [
      { id: 'blank', title: '空白手工', description: '从空白剧本开始，不调用 AI。', destination: 'script' },
      { id: 'ai', title: '想法 / 剧本 AI', description: '输入想法或初稿，生成可审阅的剧本草稿。', destination: 'script_review' },
      { id: 'novel', title: '小说 / 长文本', description: '预览分章和集号冲突后批量创建草稿。', destination: 'episode_list' },
      { id: 'external_ai', title: '外部 AI 协作', description: '生成上下文与任务包，等待外部结果回流。', destination: 'waiting_external' },
      { id: 'episode_json', title: '直接 V2.1 JSON', description: '进入五步预览，只导入结构化草稿。', destination: 'import_wizard' },
      { id: 'source_video', title: '已有视频', description: '登记来源媒体并进入短片时间线。', destination: 'cut' },
    ];
  }

  function canAdvanceAssetMatches(matches = []) {
    return matches.every((item) => item.status !== 'conflict' || Boolean(item.decision));
  }

  return { evaluateImportTarget, buildProjectCards, getProjectListModel, buildEpisodeRows, buildCreationSources, canAdvanceAssetMatches };
}));
