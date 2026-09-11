// AI 配置导入/导出纯函数（Task 4.2，§13.3）。
// 铁律：任何导出与更新体不得携带密钥字段——既用白名单字段组表，又在出口做一次深度剔除兜底。

export const SECRET_FIELD_NAMES = [
  'api_key', 'apiKey', 'keyTail', 'api_key_tail', 'secret', 'secret_access_key',
  'access_key', 'password', 'token', 'accessToken', 'refresh_token',
]

/** 深度剔除密钥字段（对象/数组递归），返回新结构不动入参 */
export function stripSecretFields(value) {
  if (Array.isArray(value)) return value.map((item) => stripSecretFields(item))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELD_NAMES.includes(k)) continue
      out[k] = stripSecretFields(v)
    }
    return out
  }
  return value
}

/**
 * 由 V1 配置列表（可能含 api_key——绝不允许存活）+ overview 聚合导出负载。
 * 地址（base_url）不是密钥，导出以便导入端还原；密钥/浏览器授权一概不在导出内。
 */
export function buildExportPayload(v1Configs, overview) {
  const list = Array.isArray(v1Configs) ? v1Configs : []
  const payload = {
    kind: 'localminidrama-ai-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    providers: list.map((c) => ({
      id: c.id,
      serviceType: c.service_type || c.serviceType || 'text',
      provider: c.provider || '',
      name: c.name || '',
      baseUrl: c.base_url || c.baseUrl || '',
      model: Array.isArray(c.model) ? c.model.map(String) : [],
      defaultModel: c.default_model || null,
      priority: c.priority ?? 0,
      isDefault: !!(c.is_default ?? c.isDefault),
      isActive: (c.is_active ?? c.isActive) === false ? false : true,
    })),
    imageDefault: {
      global: (overview && overview.imageDefault && overview.imageDefault.global) || null,
    },
    note: '脱敏导出：不含 API 密钥、浏览器授权与项目数据；导入采用后如需真实调用，请在本机编辑对应配置补填密钥。',
  }
  return stripSecretFields(payload)
}

/** 解析粘贴的导入文本：失败返回 { ok:false, error }（调用方行内呈现，不抛异常） */
export function parseImportedConfig(text) {
  let data
  try {
    data = JSON.parse(String(text || ''))
  } catch (_) {
    return { ok: false, error: '不是合法的 JSON 文本，请粘贴完整导出内容' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '导入内容需为配置 JSON 对象' }
  }
  if (!Array.isArray(data.providers)) {
    return { ok: false, error: '缺少 providers 数组：这不是本工具导出的 AI 配置文件' }
  }
  const bad = data.providers.find((p) => !p || typeof p !== 'object' || !(p.serviceType || p.service_type))
  if (bad !== undefined) {
    return { ok: false, error: 'providers 中存在缺少 serviceType 的条目，文件可能不完整或被修改过' }
  }
  return { ok: true, config: data }
}

function normalizeIncoming(raw) {
  return {
    id: raw.id != null ? Number(raw.id) : null,
    serviceType: raw.serviceType || raw.service_type || 'text',
    provider: raw.provider || '',
    name: raw.name || '',
    baseUrl: raw.baseUrl || raw.base_url || '',
    model: Array.isArray(raw.model) ? raw.model.map(String) : [],
    defaultModel: raw.defaultModel || raw.default_model || null,
    priority: raw.priority ?? 0,
    isDefault: !!(raw.isDefault ?? raw.is_default),
    isActive: (raw.isActive ?? raw.is_active) === false ? false : true,
  }
}

/**
 * 与本机配置比对，产出逐项差异行：
 * - provider 行：与本机可匹配 → adoptable（fields 为差异字段）；无差异或本机缺失 → adoptable:false + 原因；
 * - global_image_default 行：导入含全局默认通道且与本机不同 → 可采用（经 PUT image-default 生效）。
 * 每行 decision 默认 'keep'（保留本机），由界面二选一切换为 'adopt'（采用导入）。
 */
export function diffImportedConfig(config, localConfigs, overview) {
  const locals = Array.isArray(localConfigs) ? localConfigs : []
  const byId = new Map(locals.map((c) => [c.id, c]))
  const rows = []
  for (const raw of config.providers || []) {
    const incoming = normalizeIncoming(raw)
    let local = incoming.id != null ? byId.get(incoming.id) : undefined
    if (!local) {
      local = locals.find((c) =>
        (c.service_type || c.serviceType) === incoming.serviceType && (c.name || '') === incoming.name)
    }
    if (!local) {
      rows.push({
        kind: 'provider', decision: 'keep', adoptable: false, configId: null,
        title: `${incoming.name || '(未命名)'} · ${incoming.serviceType}`,
        incoming, fields: [],
        reason: '本机无此配置，且导入不含密钥、无法直接创建；如需使用请到 AI 配置·高级页手动添加并填入密钥',
      })
      continue
    }
    const fields = []
    const lname = local.name || ''
    if (lname !== incoming.name) fields.push({ field: 'name', label: '名称', local: lname, incoming: incoming.name })
    const lurl = local.base_url || local.baseUrl || ''
    if (lurl !== incoming.baseUrl) fields.push({ field: 'base_url', label: '服务地址', local: lurl, incoming: incoming.baseUrl })
    if ((local.provider || '') !== incoming.provider) {
      fields.push({ field: 'provider', label: 'Provider', local: local.provider || '', incoming: incoming.provider })
    }
    const lmodels = Array.isArray(local.model) ? local.model.map(String) : []
    if (JSON.stringify(lmodels) !== JSON.stringify(incoming.model)) {
      fields.push({ field: 'model', label: '模型列表', local: lmodels.join(', '), incoming: incoming.model.join(', ') })
    }
    const ldm = local.default_model || null
    if ((ldm || null) !== (incoming.defaultModel || null)) {
      fields.push({ field: 'default_model', label: '默认模型', local: ldm || '（未设置）', incoming: incoming.defaultModel || '（未设置）' })
    }
    const ldef = !!(local.is_default ?? local.isDefault)
    if (ldef !== incoming.isDefault) {
      fields.push({ field: 'is_default', label: '默认标记', local: ldef ? '默认' : '非默认', incoming: incoming.isDefault ? '默认' : '非默认' })
    }
    if (!fields.length) {
      rows.push({
        kind: 'provider', decision: 'keep', adoptable: false, configId: local.id,
        title: `${lname} · ${incoming.serviceType}`, incoming, fields: [],
        reason: '与本机配置一致，无需采用',
      })
      continue
    }
    rows.push({
      kind: 'provider', decision: 'keep', adoptable: true, configId: local.id,
      title: `${lname} · ${incoming.serviceType}`, incoming, fields, reason: '',
    })
  }
  const localGlobal = (overview && overview.imageDefault && overview.imageDefault.global && overview.imageDefault.global.channel) || null
  const incomingGlobal = (config && config.imageDefault && config.imageDefault.global && config.imageDefault.global.channel) || null
  if (incomingGlobal && localGlobal && incomingGlobal !== localGlobal) {
    rows.push({
      kind: 'global_image_default', decision: 'keep', adoptable: true, configId: null,
      title: '全局默认生图通道', local: localGlobal, incoming: incomingGlobal, fields: [], reason: '',
    })
  }
  return rows
}

/** 采用导入的 provider 行 → V1 PUT /ai-configs/:id 请求体（只含差异字段，绝不含密钥） */
export function buildUpdateBody(row) {
  if (!row || row.kind !== 'provider' || !row.incoming) return {}
  const body = {}
  for (const f of row.fields || []) {
    if (f.field === 'name') body.name = row.incoming.name
    else if (f.field === 'base_url') body.base_url = row.incoming.baseUrl
    else if (f.field === 'provider') body.provider = row.incoming.provider
    else if (f.field === 'model') body.model = row.incoming.model
    else if (f.field === 'default_model') body.default_model = row.incoming.defaultModel
    else if (f.field === 'is_default') body.is_default = row.incoming.isDefault
  }
  return stripSecretFields(body)
}
