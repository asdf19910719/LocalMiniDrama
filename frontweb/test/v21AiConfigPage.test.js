import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('api 客户端：AI 配置聚合三端点与 V1 复用封装齐备', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /aiConfigOverview/, 'api：GET /api/v2/ai-config/overview')
  assert.match(api, /\/ai-config\/overview/, 'api：overview 路径')
  assert.match(api, /setImageDefault/, 'api：PUT /api/v2/ai-config/image-default')
  assert.match(api, /\/ai-config\/image-default/, 'api：image-default 路径')
  assert.match(api, /testProviderConnection/, 'api：POST /api/v2/ai-config/providers/:id/test')
  assert.match(api, /providers\/\$\{id\}\/test/, 'api：连接测试路径')
  assert.match(api, /updateV1AiConfig/, 'api：复用 V1 PUT /ai-configs/:id（编辑写入）')
  assert.match(api, /listV1AiConfigs/, 'api：复用 V1 GET /ai-configs（导出聚合数据源）')
  assert.match(api, /getImageGenerationSettings/, 'api：ChatGPT 网页配置真实状态来源')
})

test('① Provider 卡有编辑/测试连接；编辑抽屉密钥留空=不修改（api_key 仅在输入非空时进入请求体）；hint 经 toError 可达 UI', async () => {
  const view = read('src/views/productionStudio/AiConfigV21View.vue')
  assert.match(view, /测试连接/, '每张 Provider 卡应有测试连接操作')
  assert.match(view, /编辑/, '每张 Provider 卡应有编辑操作')
  assert.match(view, /留空=不修改|留空则不修改|留空表示不修改/, '密钥输入应注明留空=不修改')
  assert.match(view, /editForm\.apiKey[\s\S]{0,120}api_key/, 'api_key 应仅在输入非空时写入请求体')
  assert.match(view, /updateV1AiConfig/, '保存应走 V1 update 端点')
  assert.match(view, /testProviderConnection/, '测试连接应调用 V2.1 测试端点（密钥只在服务端参与）')
  assert.match(view, /密钥已写入本机安全存储/, '保存密钥成功后应提示密钥落点')
  assert.match(view, /testResult|testState/, '测试结果应就地呈现（成功/失败原因与建议）')
  assert.match(view, /建议：\{\{ testState\[p\.id\]\.hint \}\}/, '失败块应渲染恢复建议')

  // 行为断言：后端错误响应 error.hint（恢复建议）必须经 toError 保留，否则到不了 UI（评审修复）
  const { toError } = await import('../src/v21/api.js')
  const withHint = toError({
    response: {
      status: 400,
      data: { error: { code: 'CONNECTION_TEST_FAILED', message: '连接测试失败: API Key 无效 (401)', hint: '请检查 API Key 是否正确、是否已过期' } },
    },
  })
  assert.equal(withHint.code, 'CONNECTION_TEST_FAILED')
  assert.equal(withHint.status, 400)
  assert.equal(withHint.message, '连接测试失败: API Key 无效 (401)')
  assert.equal(withHint.hint, '请检查 API Key 是否正确、是否已过期', 'error.hint 必须透传（否则恢复建议到不了 UI）')
  assert.equal(toError(new Error('boom')).hint, '', '无 hint 的错误应以空串兜底')
  assert.equal(toError(new Error('boom')).code, 'NETWORK_ERROR')
})

test('② 默认生图通道区块：全局默认 + 项目默认，设为默认调 PUT image-default 并刷新', () => {
  const view = read('src/views/productionStudio/AiConfigV21View.vue')
  assert.match(view, /全局默认/, '应有全局默认区块')
  assert.match(view, /项目默认/, '应有项目默认区块')
  assert.match(view, /setImageDefault/, '设为默认应调 PUT /api/v2/ai-config/image-default')
  assert.match(view, /setDefaultChannel\('global'/, '全局作用域参数')
  assert.match(view, /setDefaultChannel\('project'/, '项目作用域参数')
  assert.match(view, /listProjects/, '项目下拉应有项目数据源')
  assert.match(view, /chatgptWebEnabled/, 'chatgpt_web 未启用时按钮应给出禁用理由')
  assert.match(view, /load\(\)/, '成功后应刷新 overview')
})

test('③ 导出剔除密钥字段（buildExportPayload / stripSecretFields 行为断言）', async () => {
  const mod = await import('../src/v21/aiConfigTransfer.js')
  const payload = mod.buildExportPayload(
    [
      { id: 5, service_type: 'text', provider: 'openai', name: '中转', base_url: 'https://api.example.com/v1', api_key: 'sk-secret-9999', model: ['gpt-4o-mini'], default_model: 'gpt-4o-mini', priority: 2, is_default: 1, is_active: 1 },
    ],
    { imageDefault: { global: { channel: 'api', source: 'install_default' } } },
  )
  const raw = JSON.stringify(payload)
  assert.ok(!raw.includes('sk-secret-9999'), '导出不得包含密钥值')
  assert.doesNotMatch(raw, /api_key|apiKey|keyTail/, '导出不得包含密钥字段名')
  assert.equal(payload.kind, 'localminidrama-ai-config')
  assert.equal(payload.providers.length, 1)
  assert.equal(payload.providers[0].serviceType, 'text')
  assert.equal(payload.providers[0].baseUrl, 'https://api.example.com/v1', '地址不是密钥，可导出用于导入还原')
  assert.deepEqual(payload.imageDefault.global, { channel: 'api', source: 'install_default' })
  // 深度剔除：任何嵌套结构里的密钥字段都不得存活
  assert.deepEqual(
    mod.stripSecretFields({ a: { api_key: 'x', keep: 1, b: [{ token: 't', ok: 2 }] }, apiKey: 'y' }),
    { a: { keep: 1, b: [{ ok: 2 }] } },
  )
})

test('④ 导入：解析失败行内报错；差异列表逐项「保留本机/采用导入」二选一；确认后逐项更新（不含密钥）', async () => {
  const mod = await import('../src/v21/aiConfigTransfer.js')
  const view = read('src/views/productionStudio/AiConfigV21View.vue')

  // 解析失败 → 行内错误（不抛出未捕获异常）
  const bad = mod.parseImportedConfig('这不是 JSON')
  assert.equal(bad.ok, false)
  assert.ok(bad.error)
  const notOurs = mod.parseImportedConfig('{"foo": 1}')
  assert.equal(notOurs.ok, false)
  assert.match(notOurs.error, /providers/)

  // 差异列表：可更新项二选一；本机缺失项诚实不可采用
  const diff = mod.diffImportedConfig(
    { providers: [
      { id: 5, serviceType: 'text', provider: 'openai', name: '改名中转', baseUrl: 'https://new.example.com/v1', model: ['gpt-4o'], defaultModel: 'gpt-4o', isDefault: true },
      { serviceType: 'image', provider: 'openai', name: '本机没有的配置', baseUrl: 'https://x.example.com', model: [], defaultModel: null },
    ], imageDefault: { global: { channel: 'chatgpt_web' } } },
    [{ id: 5, service_type: 'text', provider: 'openai', name: '中转', base_url: 'https://api.example.com/v1', model: ['gpt-4o-mini'], default_model: 'gpt-4o-mini', is_default: 0 }],
    { imageDefault: { global: { channel: 'api', source: 'install_default' } } },
  )
  assert.equal(diff.length, 3, '两条 provider 差异 + 一条全局默认通道差异')
  const updatable = diff[0]
  assert.equal(updatable.adoptable, true)
  assert.equal(updatable.decision, 'keep', '默认保留本机')
  assert.ok(updatable.fields.some((f) => f.field === 'name'))
  assert.ok(updatable.fields.some((f) => f.field === 'base_url'))
  const missing = diff[1]
  assert.equal(missing.adoptable, false, '本机缺失且导入无密钥：不可直接创建')
  assert.match(missing.reason, /密钥|高级页/)
  const channelRow = diff[2]
  assert.equal(channelRow.kind, 'global_image_default')
  assert.equal(channelRow.adoptable, true)

  // 采用导入时构造 V1 update body：只含差异字段，绝不含密钥
  const body = mod.buildUpdateBody({ ...updatable, decision: 'adopt' })
  assert.equal(body.name, '改名中转')
  assert.equal(body.base_url, 'https://new.example.com/v1')
  assert.deepEqual(body.model, ['gpt-4o'])
  assert.equal(body.is_default, true)
  assert.doesNotMatch(JSON.stringify(body), /api_key|apiKey/)

  // 视图契约：逐项选择 + 确认应用 + 行内错误
  assert.match(view, /保留本机/, '每行应有保留本机选项')
  assert.match(view, /采用导入/, '每行应有采用导入选项')
  assert.match(view, /buildUpdateBody/, '确认后应逐项构造不含密钥的更新体')
  assert.match(view, /parseImportedConfig/, '粘贴解析失败应行内报错')
  assert.match(view, /脱敏|不含密钥/, '导出确认框应注明脱敏范围')
})

test('⑤ overview 加载失败显示错误横幅 + 重试；不再静默清空', () => {
  const view = read('src/views/productionStudio/AiConfigV21View.vue')
  assert.match(view, /loadError/, '应有加载失败状态')
  assert.match(view, /重试/, '横幅应提供重试')
  assert.doesNotMatch(view, /catch\s*\(\)\s*\{\s*this\.configs\s*=\s*\[\]/, '不得静默清空（旧行为）')
  assert.match(view, /aiConfigOverview/, '页面应消费 overview 聚合端点')
})

test('⑥ ChatGPT 环境检测诚实禁用（桥接未接入，不伪造数据）；业务映射只读降级并链到高级页', () => {
  const view = read('src/views/productionStudio/AiConfigV21View.vue')
  assert.match(view, /桌面桥/, '环境检查应诚实说明依赖桌面桥')
  assert.match(view, /当前版本未接入/, '明确当前版本未接入')
  assert.match(view, /ai-config\/advanced/, '业务映射应链到 AI 配置·高级页')
  assert.match(view, /生成设置|请在 AI 配置·高级页调整/, '业务映射修改应给出去处说明')
})

test('⑦ 容器约束：不用 Element Plus / 原生弹窗', () => {
  const view = read('src/views/productionStudio/AiConfigV21View.vue')
  assert.doesNotMatch(view, /element-plus|ElMessage|ElDialog|ElDrawer/i, 'v21 容器禁用 Element Plus')
  assert.doesNotMatch(view, /window\.confirm|window\.alert|window\.prompt|(^|[^.\w])alert\(/, '禁用浏览器原生弹窗')
})
