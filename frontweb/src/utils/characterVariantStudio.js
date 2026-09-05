function parseExtraImages(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : []
  } catch (_) {
    return []
  }
}

function currentVariantPath(variant) {
  return String(variant?.local_path || variant?.image_url || '').trim()
}

export function buildVariantImageCandidates(variant) {
  const current = currentVariantPath(variant)
  const paths = []
  if (current) paths.push(current)
  for (const path of parseExtraImages(variant?.extra_images)) {
    if (!paths.includes(path)) paths.push(path)
  }
  return paths.map((path, index) => ({
    key: path,
    path,
    is_current: index === 0 && path === current,
    label: index === 0 && path === current ? '当前状态图' : `候选 ${index - (current ? 0 : -1)}`,
  }))
}

function isRemotePath(path) {
  return /^https?:\/\//i.test(path) || /^\/(?:api|static)\//i.test(path)
}

export function buildVariantPrimaryPatch(variant, selectedPath) {
  const selected = String(selectedPath || '').trim()
  if (!selected) throw new Error('请选择候选图')
  const current = currentVariantPath(variant)
  const extras = parseExtraImages(variant?.extra_images).filter((path) => path !== selected && path !== current)
  if (current && current !== selected) extras.unshift(current)
  return {
    image_url: isRemotePath(selected) ? selected : '',
    local_path: isRemotePath(selected) ? null : selected,
    extra_images: extras,
  }
}

export function findVariantAffectedStoryboards(storyboards, variantId) {
  const targetId = Number(variantId)
  if (!Number.isFinite(targetId)) return []
  const seen = new Set()
  return (Array.isArray(storyboards) ? storyboards : [])
    .filter((storyboard) => (Array.isArray(storyboard?.character_variant_links) ? storyboard.character_variant_links : [])
      .some((link) => Number(link?.variant_id) === targetId))
    .filter((storyboard) => {
      const key = Number(storyboard?.id)
      if (!Number.isFinite(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (Number(a?.storyboard_number) || 0) - (Number(b?.storyboard_number) || 0))
}
