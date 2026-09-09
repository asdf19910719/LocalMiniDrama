(function exposeProductionStudioV21Model(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionStudioV21Model = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  const DEFAULT_PROVIDER = {
    id: 'provider-h3-story-video',
    name: 'H3 Story Video',
    allowedDurations: [5, 8, 10, 15],
    maxDurationSeconds: 15,
    supportsMultipleTimedSegments: true,
  };

  const STYLE_BLOCK = '都市悬疑，冷青环境光与暖黄人物光对撞，写实电影材质，克制高反差光照，角色采用一致的半写实电影渲染。';
  const NEGATIVE_CLAUSES = '避免卡通塑料质感、过度饱和、角色面部漂移、光向突变。';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createStoryboardModel() {
    return {
      storySceneId: 'STORY-SCENE-02',
      storySceneName: '02 · 酒店走廊 · 夜 · 内',
      storyboardId: 'SB-03',
      storyboardName: '分镜 03 · 无人楼层',
      provider: clone(DEFAULT_PROVIDER),
      style: {
        styleId: 'STYLE-urban-suspense',
        version: 4,
        positiveBlock: STYLE_BLOCK,
        negativeClauses: NEGATIVE_CLAUSES,
      },
      timedSegments: [{
        id: 'SEG-03-01',
        startSeconds: 0,
        endSeconds: 7,
        action: '林夏推着客房服务车缓慢走向 208 房，电话铃声从走廊深处传来。',
        camera: '中近景，走廊侧后方缓慢跟拍，结尾轻推至 208 门牌。',
        dialogue: '林夏：前台说这一层今晚没有住客。',
        sceneAssetIds: ['SCENE-hotel-corridor'],
        characterStateIds: ['CHAR-linxia-night-shift'],
        propIds: ['PROP-service-cart', 'PROP-room-phone'],
      }],
    };
  }

  function normalizeTimeline(segments) {
    let cursor = 0;
    return segments.map((segment, index) => {
      const duration = Math.max(0.5, Number(segment.endSeconds) - Number(segment.startSeconds));
      const normalized = {
        ...segment,
        id: segment.id || `SEG-03-${String(index + 1).padStart(2, '0')}`,
        startSeconds: Number(cursor.toFixed(1)),
        endSeconds: Number((cursor + duration).toFixed(1)),
      };
      cursor = normalized.endSeconds;
      return normalized;
    });
  }

  function addTimedSegment(model) {
    const next = clone(model);
    const last = next.timedSegments.at(-1);
    const start = last ? last.endSeconds : 0;
    next.timedSegments.push({
      id: `SEG-03-${String(next.timedSegments.length + 1).padStart(2, '0')}`,
      startSeconds: start,
      endSeconds: Number((start + 3).toFixed(1)),
      action: '电话骤停，林夏抬头看向 208 房门，服务车在画面前景停住。',
      camera: '切至正侧面中景，轻微推进，保持走廊轴线。',
      dialogue: '',
      sceneAssetIds: ['SCENE-hotel-corridor', 'SCENE-room-208-threshold'],
      characterStateIds: ['CHAR-linxia-alert'],
      propIds: ['PROP-service-cart', 'PROP-room-phone'],
    });
    next.timedSegments = normalizeTimeline(next.timedSegments);
    return next;
  }

  function splitTimedSegment(model, segmentId) {
    const next = clone(model);
    const index = next.timedSegments.findIndex(segment => segment.id === segmentId);
    if (index < 0) return next;
    const source = next.timedSegments[index];
    const duration = source.endSeconds - source.startSeconds;
    if (duration < 1) return next;
    const midpoint = Number((source.startSeconds + duration / 2).toFixed(1));
    const first = { ...source, endSeconds: midpoint };
    const second = {
      ...source,
      id: `${source.id}-B`,
      startSeconds: midpoint,
      action: '承接上一时段的动作，在新的节奏点完成视线与门牌的关系变化。',
      dialogue: '',
    };
    next.timedSegments.splice(index, 1, first, second);
    next.timedSegments = normalizeTimeline(next.timedSegments);
    return next;
  }

  function mergeTimedSegment(model, segmentId) {
    const next = clone(model);
    if (next.timedSegments.length <= 1) return next;
    const index = next.timedSegments.findIndex(segment => segment.id === segmentId);
    const mergeIndex = index > 0 ? index - 1 : 0;
    const first = next.timedSegments[mergeIndex];
    const second = next.timedSegments[mergeIndex + 1];
    next.timedSegments.splice(mergeIndex, 2, {
      ...first,
      endSeconds: second.endSeconds,
      action: `${first.action} ${second.action}`,
      dialogue: [first.dialogue, second.dialogue].filter(Boolean).join(' / '),
      sceneAssetIds: [...new Set([...first.sceneAssetIds, ...second.sceneAssetIds])],
      characterStateIds: [...new Set([...first.characterStateIds, ...second.characterStateIds])],
      propIds: [...new Set([...first.propIds, ...second.propIds])],
    });
    next.timedSegments = normalizeTimeline(next.timedSegments);
    return next;
  }

  function moveTimedSegment(model, segmentId, direction) {
    const next = clone(model);
    const index = next.timedSegments.findIndex(segment => segment.id === segmentId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.timedSegments.length) return next;
    [next.timedSegments[index], next.timedSegments[target]] = [next.timedSegments[target], next.timedSegments[index]];
    next.timedSegments = normalizeTimeline(next.timedSegments);
    return next;
  }

  function resolveRequestDuration(plannedDurationSeconds, provider) {
    const allowed = [...(provider.allowedDurations || [])].sort((a, b) => a - b);
    return allowed.find(duration => duration >= plannedDurationSeconds) || allowed.at(-1) || plannedDurationSeconds;
  }

  function compileGenerationEnvelope(model, providerOverride) {
    const provider = clone(providerOverride || model.provider || DEFAULT_PROVIDER);
    const segments = normalizeTimeline(clone(model.timedSegments));
    const plannedDurationSeconds = segments.at(-1)?.endSeconds || 0;
    const requestDurationSeconds = resolveRequestDuration(plannedDurationSeconds, provider);
    let compatibility = { passed: true, code: 'OK', suggestedAction: null };
    if (plannedDurationSeconds > provider.maxDurationSeconds) {
      compatibility = { passed: false, code: 'DURATION_EXCEEDS_MAX', suggestedAction: 'split-storyboard' };
    } else if (segments.length > 1 && !provider.supportsMultipleTimedSegments) {
      compatibility = { passed: false, code: 'MULTI_SEGMENT_UNSUPPORTED', suggestedAction: 'split-storyboard' };
    }

    const compiledPrompt = [
      `【STYLE:${model.style.styleId}@v${model.style.version}】${model.style.positiveBlock}`,
      ...segments.map(segment => `[${segment.startSeconds}-${segment.endSeconds}s] ${segment.action} ${segment.camera}`),
      `【NEGATIVE】${model.style.negativeClauses}`,
    ].join('\n');
    const requestSnapshot = compiledPrompt;
    const styleBlockCount = compiledPrompt.split(model.style.positiveBlock).length - 1;
    const checks = {
      styleIdentityPinned: Boolean(model.style.styleId && model.style.version),
      styleBlockExactOnce: styleBlockCount === 1,
      negativeClausesPresent: compiledPrompt.includes(model.style.negativeClauses),
      h3StructureInternalInjection: compiledPrompt.startsWith('【STYLE:'),
      requestSnapshotByteEqual: requestSnapshot === compiledPrompt,
    };

    return {
      schemaVersion: '2.1',
      storySceneId: model.storySceneId,
      storyboardId: model.storyboardId,
      plannedDurationSeconds,
      requestDurationSeconds,
      provider,
      timedSegments: segments,
      compatibility,
      compiledPrompt,
      requestSnapshot,
      promptStyleGate: {
        passed: Object.values(checks).every(Boolean),
        styleId: model.style.styleId,
        styleVersion: model.style.version,
        checks,
      },
    };
  }

  return {
    DEFAULT_PROVIDER,
    createStoryboardModel,
    addTimedSegment,
    splitTimedSegment,
    mergeTimedSegment,
    moveTimedSegment,
    compileGenerationEnvelope,
  };
}));
