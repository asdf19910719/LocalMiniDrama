function text(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

const CHATGPT_TARGET_LABELS = {
  character: '角色设定图',
  scene: '场景参考图',
  prop: '道具参考图',
  storyboard_main: '分镜主图',
  storyboard_first: '分镜首帧',
  storyboard_last: '分镜尾帧',
}

/** Resolve visual generation copy without leaking narrative-only fields. */
export function resolveImageGenerationPrompt(targetType, target = {}, override = '') {
  const explicit = text(override)
  if (explicit) return explicit
  const type = text(targetType).toLowerCase()
  if (type === 'character') {
    return [target.polished_prompt, target.appearance, target.name].map(text).find(Boolean) || ''
  }
  if (type === 'scene') {
    return [target.polished_prompt_single, target.polished_prompt, target.prompt, target.location, target.time].map(text).find(Boolean) || ''
  }
  if (type === 'prop') {
    return [target.polished_prompt, target.prompt, target.description, target.name].map(text).find(Boolean) || ''
  }
  return [target.polished_prompt, target.image_prompt, target.description, target.title, target.name].map(text).find(Boolean) || ''
}

/** Add ChatGPT-only execution instructions without changing the audited business prompt. */
export function buildChatGPTImageGenerationPrompt(prompt, targetType) {
  const businessPrompt = text(prompt)
  if (!businessPrompt) return ''
  const targetLabel = CHATGPT_TARGET_LABELS[text(targetType).toLowerCase()] || '图片'
  return `这是一个全新的、彼此独立的图片生成任务。
忽略本会话此前所有人物、场景、道具、图片和提示词。
不得延续、引用或混合之前任务的设定。
只依据本条消息和本次附带的参考图片生成。
请直接生成${targetLabel}，不要仅回复文字或复述提示词。

【本次唯一有效的生图提示词】
${businessPrompt}`
}
