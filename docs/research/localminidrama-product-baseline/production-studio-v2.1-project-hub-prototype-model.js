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

  return { evaluateImportTarget, buildProjectCards, buildEpisodeRows, buildCreationSources, canAdvanceAssetMatches };
}));
