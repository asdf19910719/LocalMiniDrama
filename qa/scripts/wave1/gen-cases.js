// Wave1 用例 YAML 生成器（schema 见 guidance backend-api.md / TestAgent §9.2）
// 需求条款引用约定（feature-inventory.md 无正式 ID，按节-行建立稳定 slug）：
//   INV-11.x = docs/current/feature-inventory.md §11 第 x 行功能；INV-14.x = §14；INV-1.x = §1
//   ARCH-9.3 = docs/current/architecture.md §9.3 安全假设；BUG-QA-00x = docs/qa/bug-report.md
const fs = require('fs');
const path = require('path');

const cases = [];
function c(mod, o) { cases.push(Object.assign({ module: mod }, o)); }

function yml(o) {
  const L = [];
  const S = (s) => JSON.stringify(String(s));
  L.push(`id: ${o.id}`);
  L.push(`title: ${S(o.title)}`);
  L.push(`state: active`);
  L.push(`feature_id: ${o.feature_id}`);
  L.push(`requirement_ids: [${o.requirement_ids.join(', ')}]`);
  L.push(`level: ${o.level}`);
  L.push(`purpose: ${o.purpose}`);
  L.push(`priority: ${o.priority}`);
  L.push(`preconditions:`);
  o.preconditions.forEach(p => L.push(`  - ${S(p)}`));
  L.push(`test_data:`);
  Object.entries(o.test_data || {}).forEach(([k, v]) => L.push(`  ${k}: ${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}`));
  L.push(`steps:`);
  o.steps.forEach(s => L.push(`  - ${S(s)}`));
  L.push(`expected:`);
  o.expected.forEach(s => L.push(`  - ${S(s)}`));
  L.push(`assertions:`);
  o.assertions.forEach(a => L.push(`  - ${S(a)}`));
  L.push(`automation:`);
  L.push(`  status: implemented`);
  L.push(`  framework: node`);
  L.push(`  file: ${o.automation.file}`);
  L.push(`  test_id: ${o.automation.test_id}`);
  L.push(`targets:`);
  L.push(`  files: [${(o.target_files || []).map(f => JSON.stringify(f)).join(', ')}]`);
  L.push(`  symbols: [${(o.target_symbols || []).map(f => JSON.stringify(f)).join(', ')}]`);
  L.push(`  generated_by: "wave1-designer"`);
  L.push(`  generated_at: "2026-09-12"`);
  L.push(`regression_tags: [${(o.regression_tags || []).join(', ')}]`);
  L.push(`notes: ${JSON.stringify(o.notes || '')}`);
  return L.join('\n') + '\n';
}

const AICONF_FILE = 'qa/scripts/wave1/run-aiconf.js';
const TASK_FILE = 'qa/scripts/wave1/run-task.js';
const SHELL_FILE = 'qa/scripts/wave1/run-shell.js';
const REGR_FILE = 'qa/scripts/wave1/run-regr.js';

// ---------------- AICONF ----------------
c('AICONF', {
  id: 'TC-AICONF-001', title: 'GET /ai-configs 返回标准 success 包且字段契约完整、含默认 DeepSeek 文本配置',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.1'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['后端 5679 运行中', '库内已存在 DeepSeek 文本配置(id=4)'],
  test_data: { endpoint: 'GET /api/v1/ai-configs' },
  steps: ['GET /api/v1/ai-configs', '校验响应包与字段', '定位默认 text 配置'],
  expected: ['success=true 且 data 为数组', '每条含 id/service_type/name/provider/base_url/api_key/model 字段', '存在 is_default=true 且 service_type=text 的配置(DeepSeek)'],
  assertions: ['resp.success == true', 'Array.isArray(resp.data) && resp.data.length >= 5', 'every(cfg => has id/service_type/name/provider/base_url)', 'exists(cfg.service_type=text && cfg.is_default && cfg.provider=deepseek)'],
  file: AICONF_FILE, test_id: 'AICONF_001_list_contract', target_files: ['backend-node/src/routes/aiConfig.js', 'backend-node/src/routes/index.js'], target_symbols: ['aiConfigRoutes.list'], tags: ['aiconf', 'crud', 'smoke'],
});
c('AICONF', {
  id: 'TC-AICONF-002', title: '创建 QA-L3 文本配置返回 201 且 GET 回读字段一致（CRUD 创建+读闭环）',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.1'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['后端 5679 运行中', 'vendor lock 未启用(默认)'],
  test_data: { name: 'QA-L3-文本配置', service_type: 'text', provider: 'openai', base_url: 'http://127.0.0.1:9/v1', api_key: 'sk-qa-l3-fake-key' },
  steps: ['POST /api/v1/ai-configs 创建 QA-L3 配置', 'GET /api/v1/ai-configs/{id} 回读'],
  expected: ['创建返回 201/created', '回读 name/base_url/provider 与请求一致', 'model 为数组'],
  assertions: ['create.status == 201', 'get.data.name == "QA-L3-文本配置"', 'get.data.base_url == "http://127.0.0.1:9/v1"', 'Array.isArray(get.data.model)'],
  file: AICONF_FILE, test_id: 'AICONF_002_create_read', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['aiConfigRoutes.create', 'aiConfigRoutes.get'], tags: ['aiconf', 'crud'],
});
c('AICONF', {
  id: 'TC-AICONF-003', title: '更新 QA-L3 配置 base_url/model 后 GET 返回新值（改后查一致）',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.1'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['TC-AICONF-002 创建的 QA-L3 配置存在'],
  test_data: { update_base_url: 'http://127.0.0.1:10/v1', update_model: ['qa-model-a', 'qa-model-b'] },
  steps: ['PUT /api/v1/ai-configs/{id} 更新 base_url 与 model', 'GET /api/v1/ai-configs/{id} 回读'],
  expected: ['更新返回 200', '回读 base_url 为新值', '回读 model 含 qa-model-a/qa-model-b'],
  assertions: ['update.status == 200', 'get.data.base_url == "http://127.0.0.1:10/v1"', 'get.data.model includes "qa-model-a"'],
  file: AICONF_FILE, test_id: 'AICONF_003_update_readback', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['aiConfigRoutes.update'], tags: ['aiconf', 'crud'],
});
c('AICONF', {
  id: 'TC-AICONF-004', title: '删除 QA-L3 配置后再 GET 返回 404（删除闭环+级联不可见）',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.1'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['TC-AICONF-002 创建的 QA-L3 配置存在'],
  test_data: {},
  steps: ['DELETE /api/v1/ai-configs/{id}', 'GET /api/v1/ai-configs/{id}', 'GET /api/v1/ai-configs 列表确认不可见'],
  expected: ['删除返回 200', '再查返回 404', '列表中不再出现该 id'],
  assertions: ['del.status == 200', 'get.status == 404', 'list 不含该 id'],
  file: AICONF_FILE, test_id: 'AICONF_004_delete_closedloop', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['aiConfigRoutes.delete'], tags: ['aiconf', 'crud'],
});
c('AICONF', {
  id: 'TC-AICONF-005', title: '创建配置缺少必填字段返回 400 及中文错误信息',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.1'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { body: { name: 'QA-L3-缺字段' } },
  steps: ['POST /api/v1/ai-configs 只带 name'],
  expected: ['返回 400', '错误信息提示缺少必填字段 service_type/name/provider/base_url'],
  assertions: ['status == 400', 'error message contains "缺少必填字段"'],
  file: AICONF_FILE, test_id: 'AICONF_005_create_missing_fields', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['aiConfigRoutes.create'], tags: ['aiconf', 'exception'],
});
c('AICONF', {
  id: 'TC-AICONF-006', title: 'GET 不存在的配置 ID 返回 404 配置不存在',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.1'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { id: 999999 },
  steps: ['GET /api/v1/ai-configs/999999'],
  expected: ['返回 404', 'message=配置不存在'],
  assertions: ['status == 404', 'message contains "配置不存在"'],
  file: AICONF_FILE, test_id: 'AICONF_006_get_not_found', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['aiConfigRoutes.get'], tags: ['aiconf', 'exception'],
});
c('AICONF', {
  id: 'TC-AICONF-007', title: 'service_type=text 过滤查询仅返回 text 类型配置',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.1'], level: 'system', purpose: 'boundary', priority: 'P1',
  preconditions: ['库内同时存在 text/image/video 配置'],
  test_data: { query: 'service_type=text' },
  steps: ['GET /api/v1/ai-configs?service_type=text'],
  expected: ['每条返回的 service_type 均为 text', '不少于 1 条(DeepSeek)'],
  assertions: ['every(cfg.service_type == "text")', 'data.length >= 1'],
  file: AICONF_FILE, test_id: 'AICONF_007_filter_service_type', target_files: ['backend-node/src/services/aiConfigService.js'], target_symbols: ['listConfigs'], tags: ['aiconf', 'boundary'],
});
c('AICONF', {
  id: 'TC-AICONF-008', title: '配置测试接口对 DeepSeek 真实调用成功（真实外部调用 1 次）',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.2'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['DeepSeek 真实 key 已配置(id=4)', '外网可达 api.deepseek.com'],
  test_data: { provider: 'deepseek', base_url: 'https://api.deepseek.com', source: 'config id=4 (key 经 API 读取，不落日志)' },
  steps: ['GET /api/v1/ai-configs/4 读取 base_url/api_key', 'POST /api/v1/ai-configs/test 携带真实 key'],
  expected: ['success=true 且 message=连接测试成功'],
  assertions: ['resp.success == true', 'resp.data.message contains "连接测试成功"'],
  file: AICONF_FILE, test_id: 'AICONF_008_test_connection_real_deepseek', target_files: ['backend-node/src/routes/aiConfig.js', 'backend-node/src/services/aiConfigService.js'], target_symbols: ['aiConfigRoutes.testConnection', 'aiConfigService.testConnection'], tags: ['aiconf', 'real-deepseek', 'smoke'],
  notes: 'DeepSeek 真实调用预算：本模块仅此 1 次（l3-context 每功能流≤2 次）',
});
c('AICONF', {
  id: 'TC-AICONF-009', title: '配置测试缺少 api_key 返回 400 不发起外部调用',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.2'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { body: { base_url: 'https://api.deepseek.com', provider: 'deepseek' } },
  steps: ['POST /api/v1/ai-configs/test 不带 api_key'],
  expected: ['返回 400', 'message=缺少 base_url 或 api_key'],
  assertions: ['status == 400', 'message contains "缺少 base_url 或 api_key"'],
  file: AICONF_FILE, test_id: 'AICONF_009_test_missing_key', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['aiConfigRoutes.testConnection'], tags: ['aiconf', 'exception'],
});
c('AICONF', {
  id: 'TC-AICONF-010', title: '配置测试指向不可达地址返回连接测试失败错误响应',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.2'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中', '本机 127.0.0.1:9 无监听(保留端口必然拒绝)'],
  test_data: { base_url: 'http://127.0.0.1:9/v1', api_key: 'sk-qa-l3-invalid' },
  steps: ['POST /api/v1/ai-configs/test 携带不可达 base_url'],
  expected: ['非 2xx 或 success=false', 'message 以 连接测试失败 开头'],
  assertions: ['status >= 400', 'message startsWith "连接测试失败"'],
  file: AICONF_FILE, test_id: 'AICONF_010_test_unreachable', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['aiConfigRoutes.testConnection'], tags: ['aiconf', 'exception', 'real-error-path'],
});
c('AICONF', {
  id: 'TC-AICONF-011', title: '一键预设等价创建：按 Agnes 预设契约经 API 一次建 4 类配置并可见（预设=前端组合创建的 API 复现）',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.4'], level: 'integration', purpose: 'functional', priority: 'P1',
  preconditions: ['vendor lock 未启用', '前端 AIConfigContent.vue 一键预设为纯前端多次 aiAPI.create（源码 2380-2419 行）'],
  test_data: { name_prefix: 'QA-L3-Agnes预设-', base_url: 'https://api.agnes.ai/v1', api_key: 'sk-qa-l3-agnes', types: ['text', 'image', 'storyboard_image', 'video'] },
  steps: ['按前端 submitOneKeyAgnes 的 4 条 payload 依次 POST /api/v1/ai-configs', 'GET 列表确认 4 条可见', 'DELETE 全部清理'],
  expected: ['4 条均 201', '列表可见且 service_type 正确', '清理后不可见'],
  assertions: ['4x create.status == 201', 'list contains all 4 names', 'after delete none visible'],
  file: AICONF_FILE, test_id: 'AICONF_011_onekey_preset_equiv', target_files: ['frontweb/src/components/AIConfigContent.vue'], target_symbols: ['submitOneKeyAgnes'], tags: ['aiconf', 'preset'],
  notes: '一键预设本身是前端组合逻辑，本用例在 API 层复现其创建契约',
});
c('AICONF', {
  id: 'TC-AICONF-012', title: '场景模型映射 CRUD 闭环 + 重复 key 创建被拒',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.6'], level: 'system', purpose: 'functional', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { key: 'QA-L3-scene-key', service_type: 'text', model_override: 'qa-model-x' },
  steps: ['POST /scene-model-map 创建', '重复 POST 同 key', 'GET /scene-model-map/{key}', 'PUT 更新 model_override', 'GET 列表含该 key', 'DELETE', 'GET 确认 404'],
  expected: ['创建 201', '重复创建 400 场景键已存在', '更新后回读新值', '删除后再查 404'],
  assertions: ['create.status == 201', 'dup.status == 400', 'update.data.model_override == "qa-model-x"', 'del后再查 status == 404'],
  file: AICONF_FILE, test_id: 'AICONF_012_scene_model_map_crud', target_files: ['backend-node/src/routes/sceneModelMap.js'], target_symbols: ['sceneModelMapRoutes.create/update/remove'], tags: ['aiconf', 'crud', 'mapping'],
});
c('AICONF', {
  id: 'TC-AICONF-013', title: '提示词覆盖：list 展示 10 组定义，update 后 is_customized=true，reset 后还原',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.7'], level: 'system', purpose: 'functional', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { key: 'story_expansion_system', content: 'QA-L3 提示词覆盖测试内容' },
  steps: ['GET /settings/prompts', 'PUT /settings/prompts/story_expansion_system', 'GET 确认 current_body/is_customized', 'DELETE 还原', 'GET 确认 current_body=null'],
  expected: ['list 含 10 组提示词定义', 'update 后 is_customized=true 且 current_body=新内容', 'reset 后 is_customized=false'],
  assertions: ['list.data.prompts.length == 10', 'after update is_customized == true', 'after reset is_customized == false && current_body == null'],
  file: AICONF_FILE, test_id: 'AICONF_013_prompt_override_cycle', target_files: ['backend-node/src/routes/promptOverrides.js'], target_symbols: ['routes.list/update/reset'], tags: ['aiconf', 'prompt'],
});
c('AICONF', {
  id: 'TC-AICONF-014', title: '提示词覆盖异常：未知 key 400、空 content 400',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.7'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { unknown_key: 'QA-L3-not-exist', empty_content: '   ' },
  steps: ['PUT /settings/prompts/QA-L3-not-exist', 'PUT /settings/prompts/story_expansion_system 空 content', 'DELETE 未知 key'],
  expected: ['两次 PUT 均 400', 'DELETE 未知 key 400'],
  assertions: ['put(unknown).status == 400', 'put(empty).status == 400', 'del(unknown).status == 400'],
  file: AICONF_FILE, test_id: 'AICONF_014_prompt_override_errors', target_files: ['backend-node/src/routes/promptOverrides.js'], target_symbols: ['routes.update/reset'], tags: ['aiconf', 'exception'],
});
c('AICONF', {
  id: 'TC-AICONF-015', title: '全局生成设置：并发数越界 400、合法值写读一致、恢复原值',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.8'], level: 'system', purpose: 'boundary', priority: 'P0',
  preconditions: ['后端 5679 运行中'],
  test_data: { invalid: 25, valid: 5 },
  steps: ['GET /settings/generation 记录基线', 'PUT concurrency=25', 'PUT concurrency=5', 'GET 确认生效', 'PUT 恢复基线'],
  expected: ['越界返回 400 图片并发数需为 1-20 之间的整数', '合法值写入后 GET 返回 5', '恢复后与基线一致'],
  assertions: ['put(25).status == 400', 'get-after == 5', 'final == baseline'],
  file: AICONF_FILE, test_id: 'AICONF_015_generation_settings_bounds', target_files: ['backend-node/src/routes/settings.js'], target_symbols: ['getGenerationSettings/updateGenerationSettings'], tags: ['aiconf', 'settings', 'boundary'],
});
c('AICONF', {
  id: 'TC-AICONF-016', title: '语言设置：非法值 400 且当前值不被破坏',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.8'], level: 'system', purpose: 'exception', priority: 'P2',
  preconditions: ['后端 5679 运行中'],
  test_data: { invalid: 'fr' },
  steps: ['GET /settings/language 记录当前', 'PUT language=fr', 'GET 确认未变'],
  expected: ['非法值 400 语言参数错误，只支持 zh 或 en', '当前语言不被修改'],
  assertions: ['put.status == 400', 'get-after == baseline'],
  file: AICONF_FILE, test_id: 'AICONF_016_language_invalid', target_files: ['backend-node/src/routes/settings.js'], target_symbols: ['updateLanguage'], tags: ['aiconf', 'settings'],
});
c('AICONF', {
  id: 'TC-AICONF-017', title: 'Vendor Lock 状态可读；非锁定模式下 bulk-update-key 被拒 400',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.9'], level: 'system', purpose: 'functional', priority: 'P1',
  preconditions: ['当前环境 vendor lock 未启用（enabled=false）'],
  test_data: { api_key: 'sk-qa-l3-bulk' },
  steps: ['GET /ai-configs/vendor-lock', 'PUT /ai-configs/bulk-update-key'],
  expected: ['返回 {enabled, config_file} 结构', '非锁定模式返回 400 批量换Key仅在厂商锁定模式下可用'],
  assertions: ['lock.data has enabled+config_file', 'bulk.status == 400', 'message contains "厂商锁定"'],
  file: AICONF_FILE, test_id: 'AICONF_017_vendor_lock_guard', target_files: ['backend-node/src/routes/aiConfig.js'], target_symbols: ['vendorLock/bulkUpdateKey'], tags: ['aiconf', 'vendor-lock'],
});
c('AICONF', {
  id: 'TC-AICONF-018', title: '安全：GET /ai-configs 返回明文 api_key 且前端导出不脱敏（feature-inventory PARTIAL 项复核）',
  feature_id: 'F-AICONF', requirement_ids: ['INV-11.3', 'ARCH-9.3'], level: 'system', purpose: 'exception', priority: 'P0',
  preconditions: ['后端 5679 运行中', 'AIConfigContent.vue exportConfigs(2424 行) 仅剔除 id/created_at/updated_at'],
  test_data: {},
  steps: ['GET /api/v1/ai-configs 检查 api_key 是否明文', '源码核验前端导出字段过滤逻辑', '若明文输出则记缺陷'],
  expected: ['理想：API 对 key 脱敏（如 sk-***后4位），导出不携带明文 key', '实际：若返回明文 key，验证 feature-inventory §11 导出安全边界不合格仍存在'],
  assertions: ['记录 api_key 是否完整明文（长度==原始且非掩码）', 'exportConfigs 源码 rest 展开包含 api_key 字段'],
  file: AICONF_FILE, test_id: 'AICONF_018_plaintext_key_export', target_files: ['backend-node/src/routes/aiConfig.js', 'frontweb/src/components/AIConfigContent.vue'], target_symbols: ['aiConfigRoutes.list', 'exportConfigs'], tags: ['aiconf', 'security'],
  notes: '预期发现缺陷：明文 key 经 API 暴露并被导出功能写出（ARCH-9.3 已声明该安全模型，产品边界仍不合格）',
});

// ---------------- TASK ----------------
c('TASK', {
  id: 'TC-TASK-001', title: 'GET 不存在的任务 ID 返回 404 任务不存在',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { task_id: 'qa-l3-nonexistent-task-id' },
  steps: ['GET /api/v1/tasks/qa-l3-nonexistent-task-id'],
  expected: ['404 且 message=任务不存在'],
  assertions: ['status == 404', 'message contains "任务不存在"'],
  file: TASK_FILE, test_id: 'TASK_001_get_not_found', target_files: ['backend-node/src/routes/task.js'], target_symbols: ['getTaskStatus'], tags: ['task', 'exception'],
});
c('TASK', {
  id: 'TC-TASK-002', title: 'GET /tasks 缺少 resource_id 参数返回 400',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: {},
  steps: ['GET /api/v1/tasks（不带 resource_id）'],
  expected: ['400 且 message=缺少resource_id参数'],
  assertions: ['status == 400', 'message contains "缺少resource_id"'],
  file: TASK_FILE, test_id: 'TASK_002_list_missing_param', target_files: ['backend-node/src/routes/task.js'], target_symbols: ['getResourceTasks'], tags: ['task', 'exception'],
});
c('TASK', {
  id: 'TC-TASK-003', title: '真实故事生成任务完整状态机：pending→processing→completed 且产出写回项目（数据流交接点）',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1', 'INV-14.4'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['QA-L3 项目已创建', 'DeepSeek 默认文本配置可用', 'DeepSeek 真实调用预算：本用例 1 次'],
  test_data: { project: 'QA-L3-任务验证项目', premise: 'QA-L3 测试梗概：外卖骑手在雨夜送错了…', episode_count: 1 },
  steps: ['POST /api/v1/dramas 创建 QA-L3 项目', 'POST /api/v1/generation/story {drama_id, premise}', '轮询 GET /tasks/{task_id} 至终态', 'GET /api/v1/dramas/{id} 确认剧集写回'],
  expected: ['创建即返回 task_id 且 status=pending', '终态为 completed', 'result 含 drama_id/episode_count>=1', '项目下真实新增剧集（A 的产出被持久化并可见）'],
  assertions: ['task.status == "completed"', 'task.result.episode_count >= 1', 'drama episodes count >= 1（经 API 复核）'],
  file: TASK_FILE, test_id: 'TASK_003_story_task_lifecycle', target_files: ['backend-node/src/services/storyGenerationService.js', 'backend-node/src/services/taskService.js'], target_symbols: ['startStoryGeneration/processStoryGeneration'], tags: ['task', 'real-deepseek', 'data-flow', 'smoke'],
});
c('TASK', {
  id: 'TC-TASK-004', title: '任务详情字段契约完整（id/type/status/progress/message/error/result/resource_id/时间戳）',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['TC-TASK-003 已产生完成任务'],
  test_data: {},
  steps: ['GET /api/v1/tasks/{TC-003 的 task_id}'],
  expected: ['返回全部契约字段且类型正确'],
  assertions: ['has id/type/status/progress/message/resource_id/created_at/updated_at', 'status in [completed,failed] 且 progress 为 number'],
  file: TASK_FILE, test_id: 'TASK_004_task_contract', target_files: ['backend-node/src/services/taskService.js'], target_symbols: ['rowToTask'], tags: ['task', 'contract'],
});
c('TASK', {
  id: 'TC-TASK-005', title: 'GET /tasks?resource_id= 返回该资源任务列表且包含刚完成的任务（按资源查询一致）',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1'], level: 'system', purpose: 'functional', priority: 'P1',
  preconditions: ['TC-TASK-003 已产生任务且 resource_id=QA-L3 项目 id'],
  test_data: {},
  steps: ['GET /api/v1/tasks?resource_id={QA-L3 项目 id}'],
  expected: ['列表非空', '包含 TC-003 任务且状态一致'],
  assertions: ['tasks.some(t => t.id == storyTaskId)', 't.status == "completed"'],
  file: TASK_FILE, test_id: 'TASK_005_list_by_resource', target_files: ['backend-node/src/services/taskService.js'], target_symbols: ['getTasksByResource'], tags: ['task', 'query'],
});
c('TASK', {
  id: 'TC-TASK-006', title: '同资源进行中任务去重：任务未完成期间重复发起返回同一 task_id',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['TC-TASK-003 任务仍处于 pending/processing（创建后立即复测）'],
  test_data: {},
  steps: ['TC-003 发起后立刻再次 POST /generation/story 同 drama_id', '比较两次 task_id'],
  expected: ['第二次返回相同 task_id（storyGenerationService.js:161-170 in-flight 去重）'],
  assertions: ['second.task_id == first.task_id'],
  file: TASK_FILE, test_id: 'TASK_006_inflight_dedup', target_files: ['backend-node/src/services/storyGenerationService.js'], target_symbols: ['startStoryGeneration (existing 查询分支)'], tags: ['task', 'dedup'],
});
c('TASK', {
  id: 'TC-TASK-007', title: '取消已完成任务幂等：返回 ok 且 already_done=true 不改状态',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.2'], level: 'system', purpose: 'functional', priority: 'P1',
  preconditions: ['TC-TASK-003 任务已 completed'],
  test_data: {},
  steps: ['POST /api/v1/tasks/{id}/cancel', 'GET 确认状态仍 completed'],
  expected: ['ok=true 且 already_done=true', '状态不被改为 failed'],
  assertions: ['resp.already_done == true', 'task.status == "completed"'],
  file: TASK_FILE, test_id: 'TASK_007_cancel_terminal_idempotent', target_files: ['backend-node/src/services/taskService.js'], target_symbols: ['cancelTask'], tags: ['task', 'cancel', 'idempotent'],
});
c('TASK', {
  id: 'TC-TASK-008', title: '取消不存在的任务返回 404',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.2'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { task_id: 'qa-l3-nonexistent-task-id' },
  steps: ['POST /api/v1/tasks/qa-l3-nonexistent-task-id/cancel'],
  expected: ['404 任务不存在'],
  assertions: ['status == 404'],
  file: TASK_FILE, test_id: 'TASK_008_cancel_not_found', target_files: ['backend-node/src/routes/task.js'], target_symbols: ['cancelTaskStatus'], tags: ['task', 'exception'],
});
c('TASK', {
  id: 'TC-TASK-009', title: '运行中任务取消：记录被标 failed 但无法中止已发出的模型请求（PARTIAL 语义核验）',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.2'], level: 'system', purpose: 'exception', priority: 'P0',
  preconditions: ['DeepSeek 真实调用预算：本用例为 TASK 流第 2 次（异常分支）', 'QA-L3 项目存在'],
  test_data: { premise: 'QA-L3 取消语义测试：深夜便利店 last customer…', cancel_reason: 'QA-L3 用户取消原因' },
  steps: ['POST /generation/story 发起第二次生成', '立即 POST /tasks/{id}/cancel 携带 reason', '轮询至终态并记录最终状态'],
  expected: ['取消后任务先变 failed 且 error=取消原因', '观察：若后台生成完成后 result 覆盖为 completed，则证实 cancel 不能中止外部调用（feature-inventory §14.2 PARTIAL 原文语义）'],
  assertions: ['cancel 响应 ok=true', '终态记录（failed 或 completed-overwritten）+ evidence 记录最终状态与时间线'],
  file: TASK_FILE, test_id: 'TASK_009_cancel_active_race', target_files: ['backend-node/src/services/taskService.js', 'backend-node/src/services/storyGenerationService.js'], target_symbols: ['cancelTask/processStoryGeneration'], tags: ['task', 'cancel', 'real-deepseek'],
  notes: '无论终态为 failed 或被覆盖 completed，均属当前 PARTIAL 行为；若被覆盖则按现状记录（不判缺陷，因需求已声明该边界）',
});
c('TASK', {
  id: 'TC-TASK-010', title: '对不存在项目发起故事生成返回 400 项目不存在（无外部调用）',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { drama_id: 99999999 },
  steps: ['POST /generation/story {drama_id:99999999, premise:...}'],
  expected: ['400 且 message=项目不存在'],
  assertions: ['status == 400', 'message contains "项目不存在"'],
  file: TASK_FILE, test_id: 'TASK_010_story_missing_drama', target_files: ['backend-node/src/services/storyGenerationService.js'], target_symbols: ['startStoryGeneration'], tags: ['task', 'exception'],
});
c('TASK', {
  id: 'TC-TASK-011', title: '重启恢复语义核验（不重启服务）：源码启动清扫逻辑存在 + DB 无遗留 pending/processing',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.3'], level: 'integration', purpose: 'regression', priority: 'P1',
  preconditions: ['禁止重启服务（用户约束）', 'DB 只读查询允许'],
  test_data: {},
  steps: ['源码核验 app.js 启动链调用 failOrphanedAsyncTasksOnStartup', 'python sqlite3 只读查询 async_tasks 状态分布', '记录孤儿标记消息计数'],
  expected: ['当前行为=启动时把遗留 pending/processing 标为 failed（非续跑），与 feature-inventory §14.3 PARTIAL 描述一致', '当前 DB 无 pending/processing 遗留'],
  assertions: ['taskService.js:98 failOrphanedAsyncTasksOnStartup 存在且被启动链调用', 'DB pending+processing == 0'],
  file: TASK_FILE, test_id: 'TASK_011_restart_recovery_semantics', target_files: ['backend-node/src/services/taskService.js', 'backend-node/src/app.js'], target_symbols: ['failOrphanedAsyncTasksOnStartup'], tags: ['task', 'recovery'],
  notes: '受"禁止重启服务"约束，仅核验当前行为与源码语义，不做重启实验',
});
c('TASK', {
  id: 'TC-TASK-012', title: '前端任务去重与续接源码级核验：taskKey 轮询去重 + 断线重连 attach',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.8'], level: 'unit', purpose: 'regression', priority: 'P2',
  preconditions: ['源码可读'],
  test_data: {},
  steps: ['读 frontweb/src/stores/generationTaskStore.js', '核验 taskKey({dramaId,episodeId,resourceType,resourceId})', '核验 pollPromises Map 同 taskId 复用', '核验 attachPollIfNeeded 续接'],
  expected: ['taskKey 按 drama:episode:resource 合成键（33 行）', 'pollTask 已有同 taskId promise 时直接复用（255-261 行）', 'attachPollIfNeeded 支持重连后端任务（344 行）'],
  assertions: ['三处源码逻辑均存在并有对应行号证据'],
  file: TASK_FILE, test_id: 'TASK_012_frontend_dedup_source', target_files: ['frontweb/src/stores/generationTaskStore.js'], target_symbols: ['taskKey/pollTask/attachPollIfNeeded'], tags: ['task', 'source-check'],
});
c('TASK', {
  id: 'TC-TASK-013', title: '故事生成缺 premise：任务创建成功但后台失败，终态 failed 且 error=请提供故事梗概（无外部调用）',
  feature_id: 'F-TASK', requirement_ids: ['INV-14.1'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['QA-L3 项目存在'],
  test_data: { drama_id: '(TC-003 创建的 QA-L3 项目)' },
  steps: ['POST /generation/story {drama_id} 不带 premise', '轮询该任务至终态'],
  expected: ['HTTP 200 且返回 task_id（入口不校验）', '任务终态 failed', 'error=请提供故事梗概'],
  assertions: ['create.status == 200 && task_id 非空', 'task.status == "failed"', 'task.error contains "故事梗概"'],
  file: TASK_FILE, test_id: 'TASK_013_story_missing_premise', target_files: ['backend-node/src/services/storyGenerationService.js'], target_symbols: ['generateStory (premise 校验分支)'], tags: ['task', 'exception', 'async-failure'],
  notes: '入口不校验 premise 而由后台失败——属可改进的契约设计，若 error 未正确落库记缺陷',
});

// ---------------- SHELL ----------------
c('SHELL', {
  id: 'TC-SHELL-001', title: 'SPA 可服务性：3013 全部顶级路由返回 200 且为 index.html 文档',
  feature_id: 'F-SHELL', requirement_ids: ['INV-1.1'], level: 'system', purpose: 'functional', priority: 'P0',
  preconditions: ['Vite dev server 3013 运行中'],
  test_data: { routes: ['/projects', '/projects/new', '/tasks', '/library', '/settings', '/settings/data-tools', '/ai-config', '/media-library', '/quick-create', '/projects/import-archive'] },
  steps: ['逐路由 curl http://127.0.0.1:3013{route}'],
  expected: ['每条路由 200', 'content-type text/html', '响应体为 SPA index.html（含 /src/main.ts 或 root 挂载点标记）'],
  assertions: ['10 条路由全部 status==200', 'body contains <div id="app"> 或等效 index.html 标记'],
  file: SHELL_FILE, test_id: 'SHELL_001_spa_routes_served', target_files: ['frontweb/vite.config.js'], target_symbols: ['historyApiFallback (Vite 内建)'], tags: ['shell', 'spa', 'smoke'],
});
c('SHELL', {
  id: 'TC-SHELL-002', title: '前端路由表完整性：router 路由定义与视图文件一一存在且覆盖 test-map 页面清单',
  feature_id: 'F-SHELL', requirement_ids: ['INV-1.1', 'INV-1.2'], level: 'unit', purpose: 'regression', priority: 'P0',
  preconditions: ['源码可读'],
  test_data: { router: 'frontweb/src/router/index.js', map: 'docs/qa/product-test-map.md' },
  steps: ['解析 router/index.js 全部 path/component', '核验每个 component 文件存在', '对照 product-test-map P01-P23'],
  expected: ['每条路由的视图文件真实存在', 'P01-P23 页面在路由表中可对应（P20 自由创作等保留路由存在）', '404 catch-all 存在'],
  assertions: ['路由数 >= 20', 'missing files == 0', 'has /:pathMatch(.*)* -> NotFoundView'],
  file: SHELL_FILE, test_id: 'SHELL_002_router_integrity', target_files: ['frontweb/src/router/index.js'], target_symbols: ['routes'], tags: ['shell', 'source-check'],
});
c('SHELL', {
  id: 'TC-SHELL-003', title: '未知路径 SPA 回退返回 200 index.html，404 渲染由前端 catch-all 路由承担',
  feature_id: 'F-SHELL', requirement_ids: ['INV-1.1'], level: 'system', purpose: 'boundary', priority: 'P1',
  preconditions: ['Vite dev server 3013 运行中', 'router/index.js:135 存在 /:pathMatch(.*)* -> NotFoundView'],
  test_data: { path: '/qa-l3-definitely-not-a-route' },
  steps: ['curl http://127.0.0.1:3013/qa-l3-definitely-not-a-route', '源码核验 catch-all 路由'],
  expected: ['HTTP 200 + index.html（SPA fallback 标准行为）', '前端渲染 NotFoundView（P23 404 页）'],
  assertions: ['status == 200', 'content-type text/html', 'router has pathMatch catch-all'],
  file: SHELL_FILE, test_id: 'SHELL_003_unknown_route_fallback', target_files: ['frontweb/src/router/index.js'], target_symbols: ['not-found route'], tags: ['shell', 'spa', 'boundary'],
});
c('SHELL', {
  id: 'TC-SHELL-004', title: 'API 未知路径返回 404 JSON 且不回退 index.html（/api/v1 与 /api/v2 一致）',
  feature_id: 'F-SHELL', requirement_ids: ['INV-1.1'], level: 'system', purpose: 'exception', priority: 'P1',
  preconditions: ['后端 5679 运行中'],
  test_data: { paths: ['/api/v1/qa-l3-unknown', '/api/v2/qa-l3-unknown'] },
  steps: ['curl 两条未知 API 路径'],
  expected: ['均 404', '响应为 JSON 错误（error=API endpoint not found）', '不返回 HTML'],
  assertions: ['status == 404', 'body JSON has error field', 'content-type application/json'],
  file: SHELL_FILE, test_id: 'SHELL_004_unknown_api_paths', target_files: ['backend-node/src/app.js'], target_symbols: ['404 fallback'], tags: ['shell', 'api', 'exception'],
});
c('SHELL', {
  id: 'TC-SHELL-005', title: '静态资源代理：3013 经 /static 代理取得后端存储文件，与 5679 直连一致',
  feature_id: 'F-SHELL', requirement_ids: ['INV-1.2'], level: 'integration', purpose: 'functional', priority: 'P1',
  preconditions: ['3013 与 5679 均运行', '存在已知静态文件（QA-003 资产头图 /static/v21-mock/15da54e6-*.png）'],
  test_data: { file: '/static/v21-mock/15da54e6-ca71-4d95-9dd3-9a242b181e0c.png' },
  steps: ['GET http://127.0.0.1:3013{file}（走 Vite 代理）', 'GET http://127.0.0.1:5679{file}（直连）'],
  expected: ['两者均 200 且 content-type 为 image/*', '字节一致（长度相同）'],
  assertions: ['proxy.status == 200 && direct.status == 200', 'content-length equal && image/*'],
  file: SHELL_FILE, test_id: 'SHELL_005_static_proxy', target_files: ['frontweb/vite.config.js'], target_symbols: ['/static proxy'], tags: ['shell', 'proxy'],
});
c('SHELL', {
  id: 'TC-SHELL-006', title: '/health 健康检查契约：status=ok 且返回 app/version 元信息',
  feature_id: 'F-SHELL', requirement_ids: ['INV-1.1'], level: 'system', purpose: 'functional', priority: 'P2',
  preconditions: ['后端 5679 运行中'],
  test_data: {},
  steps: ['GET http://127.0.0.1:5679/health'],
  expected: ['200', 'status=ok', 'app=LocalMiniDrama API，version 非空'],
  assertions: ['status == 200', 'body.status == "ok"', 'body.app non-empty'],
  file: SHELL_FILE, test_id: 'SHELL_006_health_contract', target_files: ['backend-node/src/app.js'], target_symbols: ['/health'], tags: ['shell', 'smoke'],
});

// ---------------- 已知已修 P1 不回归 ----------------
c('SCRIPT', {
  id: 'TC-SCRIPT-901', title: '已知已修 P1 QA-002 不回归：draft=null 时 script 接口返回 approved 正文（API 契约支撑前端修复）',
  feature_id: 'F-SCRIPT-REG', requirement_ids: ['BUG-QA-002'], level: 'system', purpose: 'regression', priority: 'P1',
  preconditions: ['剧集 13 存在 approved 剧本修订(305 字)且 draft 为空'],
  test_data: { episode_id: 13 },
  steps: ['GET /api/v2/episodes/13/script', '核验 approved.content 与 draft 状态'],
  expected: ['draft=null 时 approved.content 非空(305 字)', 'canConfirm/hasUnconfirmedChanges 字段存在'],
  assertions: ['data.draft == null', 'data.approved.content.length == 305', 'has canConfirm field'],
  file: REGR_FILE, test_id: 'REGR_901_qa002_script_approved', target_files: ['backend-node/src/v21/routes.js', 'backend-node/src/v21/script'], target_symbols: ['GET /episodes/:episodeId/script'], tags: ['regression', 'qa-002'],
});
c('ASSET', {
  id: 'TC-ASSET-902', title: '已知已修 P1 QA-003 不回归：项目素材 API 返回已有数据（列表非空）',
  feature_id: 'F-ASSET-REG', requirement_ids: ['BUG-QA-003'], level: 'system', purpose: 'regression', priority: 'P1',
  preconditions: ['项目 10 存在素材(林夏 id=14)'],
  test_data: { project_id: 10 },
  steps: ['GET /api/v2/projects/10/assets'],
  expected: ['items 非空', '含 name=林夏 的角色素材'],
  assertions: ['data.total >= 1', 'items.some(i => i.name == "林夏")'],
  file: REGR_FILE, test_id: 'REGR_902_qa003_assets_listed', target_files: ['backend-node/src/v21/assets/assetQueryService.js'], target_symbols: ['listAssets'], tags: ['regression', 'qa-003'],
});
c('PROJ', {
  id: 'TC-PROJ-903', title: '已知已修 P1 QA-004 不回归：归档（回收站）剧集列表 API 真实返回已删除剧集',
  feature_id: 'F-PROJ-REG', requirement_ids: ['BUG-QA-004'], level: 'system', purpose: 'regression', priority: 'P1',
  preconditions: ['QA-L3 项目存在', '可在 QA-L3 项目内创建并软删 1 个测试剧集'],
  test_data: { title: 'QA-L3-回收站剧集' },
  steps: ['POST /api/v2/projects/{id}/episodes 创建 QA-L3 剧集', 'DELETE /api/v2/episodes/{eid} 软删', 'GET /api/v2/projects/{id}/episodes?status=archived'],
  expected: ['归档列表包含刚删除的剧集', 'item 带 deletedAt 字段'],
  assertions: ['archived.items.some(i => i.id == eid)', 'item.deletedAt 非空'],
  file: REGR_FILE, test_id: 'REGR_903_qa004_archived_listed', target_files: ['backend-node/src/v21/episodes/episodeCenterService.js'], target_symbols: ['listEpisodes (archivedOnly 分支 :147)'], tags: ['regression', 'qa-004'],
});

// write files
let n = 0;
for (const cs of cases) {
  const dir = path.join(__dirname, '..', '..', 'cases', cs.module);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, cs.id + '.yml');
  const obj = {
    id: cs.id, title: cs.title, feature_id: cs.feature_id, requirement_ids: cs.requirement_ids,
    level: cs.level, purpose: cs.purpose, priority: cs.priority,
    preconditions: cs.preconditions, test_data: cs.test_data, steps: cs.steps, expected: cs.expected,
    assertions: cs.assertions,
    automation: { status: 'implemented', framework: 'node', file: cs.file, test_id: cs.test_id },
    targets: { files: cs.target_files || [], symbols: cs.target_symbols || [], generated_by: 'wave1-designer', generated_at: '2026-09-12' },
    regression_tags: cs.tags, notes: cs.notes || '',
  };
  fs.writeFileSync(file, yml(obj));
  n++;
}
console.log('wrote', n, 'case files');
