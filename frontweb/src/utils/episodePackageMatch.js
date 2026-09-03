// 单集制作包导入 - 资产匹配纯函数(零 Vue 依赖,便于 node:test 直接测试)
// asset_matches 元素形状(后端 previewPackageImport 返回):
//   { type: 'character'|'scene'|'prop', source_key, name, decision: 'create'|'reuse'|'conflict',
//     existing_id, candidates: [{ id, name }] }
// decisions 形状(与后端 importPackage 入参一致):
//   { characters: { [source_key]: 'create'|'reuse' }, scenes: {...}, props: {...} }

const TYPE_TO_GROUP = { character: 'characters', scene: 'scenes', prop: 'props' }
const VALID_DECISIONS = new Set(['create', 'reuse'])

function normalizeMatches(matches) {
  return Array.isArray(matches) ? matches.filter((m) => m && typeof m === 'object') : []
}

/** 按 match.type 解析 decisions 中的分组键;未知类型返回 null */
function groupKeyOf(match) {
  return TYPE_TO_GROUP[match.type] || null
}

/**
 * 从 overrides(source_key → decision 平铺,或 { characters/scenes/props 分组嵌套)中取某项决策。
 * 非 create/reuse 的值视为未提供,返回 undefined。
 */
function overrideFor(overrides, match) {
  if (!overrides || typeof overrides !== 'object') return undefined
  if (!match.source_key) return undefined
  const raw = overrides[match.source_key] ?? nestedLookup(overrides, match)
  return VALID_DECISIONS.has(raw) ? raw : undefined
}

function nestedLookup(overrides, match) {
  const group = groupKeyOf(match)
  if (!group) return undefined
  const nested = overrides[group]
  if (!nested || typeof nested !== 'object') return undefined
  return nested[match.source_key]
}

/**
 * 构建 importPackage 所需的 decisions 对象:默认 create,overrides 覆盖。
 * 无 source_key 的匹配项无法承载决策(后端按 source_key 寻址),直接跳过。
 */
export function buildDecisions(matches, overrides) {
  const decisions = { characters: {}, scenes: {}, props: {} }
  for (const match of normalizeMatches(matches)) {
    const group = groupKeyOf(match)
    const sourceKey = match.source_key
    if (!group || !sourceKey) continue
    decisions[group][sourceKey] = overrideFor(overrides, match) || 'create'
  }
  return decisions
}

/**
 * 是否允许进入下一步:所有 conflict 项都必须在 decisions 中有 create/reuse 选择。
 * 非 conflict 项不强制;conflict 项若无 source_key 则永远无法满足(返回 false)。
 */
export function canProceedMatches(matches, decisions) {
  for (const match of normalizeMatches(matches)) {
    if (match.decision !== 'conflict') continue
    if (!match.source_key) return false
    const group = groupKeyOf(match)
    const chosen = group && decisions && typeof decisions === 'object'
      ? (decisions[group] || {})[match.source_key] ?? decisions[match.source_key]
      : undefined
    if (!VALID_DECISIONS.has(chosen)) return false
  }
  return true
}

/**
 * 统计各类型资产的 create/reuse/conflict 数量:
 *   { character: {create, reuse, conflict}, scene: {...}, prop: {...}, total }
 */
export function summarizeMatches(matches) {
  const summary = {
    character: { create: 0, reuse: 0, conflict: 0 },
    scene: { create: 0, reuse: 0, conflict: 0 },
    prop: { create: 0, reuse: 0, conflict: 0 },
    total: 0,
  }
  for (const match of normalizeMatches(matches)) {
    const bucket = summary[match.type]
    if (!bucket) continue
    if (bucket[match.decision] !== undefined) bucket[match.decision] += 1
    summary.total += 1
  }
  return summary
}
