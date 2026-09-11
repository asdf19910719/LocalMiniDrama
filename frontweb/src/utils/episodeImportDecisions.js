// V2.1 制作包导入 · 资产匹配决策工具（P0-4）
// 后端事实（backend-node/src/v21/import/episodeImportV21.js buildImportPlan）：
// - preview 返回 assets.matches: [{ type, sourceKey, name, action, existingId }]
//   type: 'character' | 'character_state' | 'scene' | 'prop'
//   action: 'create' | 'reuse' | 'match-with-character'（人物状态随人物创建/关联，无独立复用指针）
// - confirm 接受 decisions.ignoredSourceKeys：被忽略的匹配项不创建、不关联

export const MATCH_TYPE_LABELS = {
  character: '人物',
  character_state: '人物状态',
  scene: '场景',
  prop: '道具',
}

export function matchTypeLabel(type) {
  if (!type) return '素材'
  return MATCH_TYPE_LABELS[type] || type
}

export function matchActionLabel(m) {
  if (!m) return '新建'
  if (m.action === 'reuse') {
    return m.existingId != null ? `复用 · 已有 #${m.existingId}` : '复用'
  }
  if (m.action === 'match-with-character') return '随人物处理'
  return '新建'
}

// 后端当前 preview 不返回冲突标记；若未来补回 requiresDecision/ambiguous 等显式标记，UI 即生效
export function matchRequiresDecision(m) {
  return Boolean(m && (m.requiresDecision === true || m.ambiguous === true))
}

// 从 per-sourceKey 勾选表收集被忽略的 sourceKeys（保持 matches 顺序，跳过空键）
export function collectIgnoredSourceKeys(matches, ignoredMap) {
  const keys = []
  for (const m of matches || []) {
    if (m && m.sourceKey && ignoredMap && ignoredMap[m.sourceKey]) keys.push(m.sourceKey)
  }
  return keys
}

// 未决冲突数 = 后端标记待决策、且未被用户勾选忽略的匹配项
export function unresolvedConflictCount(matches, ignoredKeys) {
  const ignored = new Set(ignoredKeys || [])
  return (matches || []).filter((m) => matchRequiresDecision(m) && !(m.sourceKey && ignored.has(m.sourceKey))).length
}
