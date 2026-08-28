function text(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
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
