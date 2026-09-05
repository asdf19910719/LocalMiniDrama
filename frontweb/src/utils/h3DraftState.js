// H3 提示词草稿的纯 UI 状态推导(Task 17):零 Vue / DOM 业务依赖,供测试与面板共用。
// 草稿与 freshness 数据形状来自后端:
//   draft: storyboard_h3_prompt_drafts 行(status: 'valid'|'invalid', manually_edited: 0|1,
//          final_compiled_prompt, validation_errors 为路由层解析后的对象)
//   freshness: { stale: boolean, reasons: ['prompt'|'slots'|'params'|'config'|'skill'] }

const FRESHNESS_REASON_LABELS = Object.freeze({
  prompt: '万能提示词已变化',
  slots: '参考图已变化',
  params: '时长/画幅/音频已变化',
  config: '视频配置已变化',
  skill: 'H3 技能版本已变化',
  context: '分镜音频/语义上下文已变化',
})

const IMAGE_REF_RE = /@图片\s*(\d+)/g

/** freshness 维度 → 中文标签;未知 key 原样透传,非数组输入返回 [] */
export function mapFreshnessReasons(reasons) {
  const list = Array.isArray(reasons) ? reasons : []
  return list.map((reason) => FRESHNESS_REASON_LABELS[String(reason).trim().toLowerCase()] || String(reason))
}

/**
 * 草稿 → 抽屉 UI 状态。
 * chip 优先级:invalid(结构校验失败)> stale(来源已变化)> edited(已人工修改)> ai(AI 生成);
 * 无草稿 → 'none'。canGenerate 五条件:有草稿、status==='valid'、未 stale、非保存中、
 * 外部结构检查 structureValid !== false(缺省视为通过)。
 */
export function deriveH3DraftUiState({ draft, freshness, saving, structureValid } = {}) {
  if (!draft) return { chip: 'none', canGenerate: false, reasons: [] }
  const stale = Boolean(freshness?.stale)
  const reasons = Array.isArray(freshness?.reasons) ? freshness.reasons.map(String) : []
  let chip
  if (String(draft.status) === 'invalid') chip = 'invalid'
  else if (String(draft.status) === 'needs_review') chip = draft.semantic_review_confirmed ? 'reviewed' : 'needs_review'
  else if (stale) chip = 'stale'
  else if (Boolean(draft.manually_edited)) chip = 'edited'
  else chip = 'ai'
  const acceptedStatus = String(draft.status) === 'valid'
    || (String(draft.status) === 'needs_review' && Number(draft.semantic_review_confirmed) === 1)
  const canGenerate = Boolean(draft)
    && acceptedStatus
    && !stale
    && !saving
    && structureValid !== false
  return { chip, canGenerate, reasons }
}

/** 提取提示词文本中的 @图片N 引用(1-based,去重升序) */
export function extractImageRefIndexes(text) {
  const value = text == null ? '' : String(text)
  const found = new Set()
  for (const match of value.matchAll(IMAGE_REF_RE)) {
    const index = Number(match[1])
    if (Number.isInteger(index) && index > 0) found.add(index)
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * spec §12.2 存量万能提示词 @图片N 漂移检查(简化口径,只警告不阻塞):
 * 槽位按逻辑序固定编号、缺图仍占位,因此仅当引用编号大于当前槽位总数时判定漂移;
 * 引用存在空洞或指向缺图占位槽位不视为漂移。slots 可传槽位数组(取 length)或槽数。
 */
export function checkImageRefDrift(text, slots) {
  const slotCount = Array.isArray(slots)
    ? slots.length
    : (Number.isFinite(Number(slots)) ? Math.max(0, Number(slots)) : 0)
  const references = extractImageRefIndexes(text)
  const outOfRange = references.filter((index) => index > slotCount)
  return { drift: outOfRange.length > 0, references, slotCount, outOfRange }
}

/** 槽位口径参考图:仅取 image_available=true 且有地址的槽位,顺序=槽位序(不去重不重排) */
export function collectAvailableSlotUrls(slots) {
  const list = Array.isArray(slots) ? slots : []
  return list
    .filter((slot) => slot?.image_available && String(slot?.image_url || '').trim())
    .map((slot) => String(slot.image_url).trim())
}

/** 相对地址拼接应用基地址;http(s) 与空值原样返回;无 base 时退回原值(便于 Node 测试) */
export function absoluteAssetUrl(url, base = (typeof window !== 'undefined' && window.location?.origin) || '') {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (!base) return value
  return `${String(base).replace(/\/+$/, '')}${value.startsWith('/') ? value : `/${value}`}`
}

/** 后端 validation_errors(对象 {code,message,missing[],empty[]} 或字符串)→ 可读文本行 */
export function formatH3ValidationErrors(errors) {
  if (!errors) return []
  if (typeof errors === 'string') return errors.trim() ? [errors] : []
  if (Array.isArray(errors)) return errors.flatMap((item) => formatH3ValidationErrors(item))
  const lines = []
  const message = String(errors.message || errors.code || '').trim()
  if (message) lines.push(message)
  const missing = Array.isArray(errors.missing) ? errors.missing.filter(Boolean) : []
  if (missing.length) lines.push(`缺少段落：${missing.join('、')}`)
  const empty = Array.isArray(errors.empty) ? errors.empty.filter(Boolean) : []
  if (empty.length) lines.push(`段落内容为空：${empty.join('、')}`)
  return lines
}
