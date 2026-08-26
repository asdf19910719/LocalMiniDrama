function mimeFromUrl(url) {
  const value = String(url || '').toLowerCase().split('?')[0]
  if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'image/jpeg'
  if (value.endsWith('.webp')) return 'image/webp'
  if (value.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function referenceFor(item, role, assetImageUrl) {
  if (!item) return null
  const url = assetImageUrl(item)
  if (!url) return null
  return {
    name: `${role}-${item.id}`,
    mime: mimeFromUrl(url),
    url,
    role,
    sourceId: item.id,
  }
}

export function buildExternalGenerationShotContext({ dramaId, storyboard, getScene, getCharacters, getProps, assetImageUrl }) {
  const sb = storyboard || {}
  const references = []
  const scene = referenceFor(getScene?.(sb.id), 'scene', assetImageUrl)
  if (scene) references.push(scene)
  for (const character of getCharacters?.(sb.id) || []) {
    const reference = referenceFor(character, 'character', assetImageUrl)
    if (reference) references.push(reference)
  }
  for (const prop of getProps?.(sb.id) || []) {
    const reference = referenceFor(prop, 'prop', assetImageUrl)
    if (reference) references.push(reference)
  }
  return {
    dramaId,
    storyboardId: sb.id,
    prompt: String(sb.image_prompt || sb.polished_prompt || sb.description || sb.title || '').trim(),
    references,
  }
}
