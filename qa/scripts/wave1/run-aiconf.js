// AICONF 模块真实 API 执行（TC-AICONF-001..018）
const { api, runCase, readRel } = require('./lib');

const M = { module: 'AICONF', level: 'system' };
const meta = (id, title, priority, level) => ({ id, title, module: 'AICONF', level: level || 'system', priority });

let state = {}; // 共享：created config id

(async () => {
  // TC-001 列表契约
  await runCase(meta('TC-AICONF-001', 'GET /ai-configs 列表契约', 'P0'), async (cs) => {
    const r = await api.be('/api/v1/ai-configs');
    cs.log('GET /api/v1/ai-configs ->', r.status, 'total=', r.json?.data?.length);
    cs.eq('http status', r.status, 200);
    cs.expect('success==true', r.json?.success === true);
    const list = r.json?.data || [];
    cs.expect('data 是数组且>=5条', Array.isArray(list) && list.length >= 5, `len=${list.length}`);
    const fields = ['id', 'service_type', 'name', 'provider', 'base_url', 'api_key', 'model', 'is_default'];
    cs.expect('每条含契约字段', list.every((x) => fields.every((f) => f in x)), 'fields=' + fields.join(','));
    const ds = list.find((x) => x.service_type === 'text' && x.is_default === true);
    cs.expect('存在默认 text 配置(DeepSeek)', !!ds && ds.provider === 'deepseek', ds && `id=${ds.id} name=${ds.name}`);
    state.deepseek = ds;
    state.all = list;
  });

  // TC-002 创建+回读
  await runCase(meta('TC-AICONF-002', '创建 QA-L3 文本配置 201 + 回读一致', 'P0'), async (cs) => {
    const body = { name: 'QA-L3-文本配置', service_type: 'text', provider: 'openai', base_url: 'http://127.0.0.1:9/v1', api_key: 'sk-qa-l3-fake-key', model: ['qa-model-1'] };
    const r = await api.be('/api/v1/ai-configs', body, { method: 'POST' });
    cs.log('POST /ai-configs ->', r.status, JSON.stringify(r.json).slice(0, 200));
    cs.eq('create status', r.status, 201);
    const id = r.json?.data?.id;
    cs.expect('返回 id', !!id, `id=${id}`);
    const g = await api.be(`/api/v1/ai-configs/${id}`);
    cs.eq('get status', g.status, 200);
    cs.eq('回读 name', g.json?.data?.name, 'QA-L3-文本配置');
    cs.eq('回读 base_url', g.json?.data?.base_url, 'http://127.0.0.1:9/v1');
    cs.expect('model 是数组', Array.isArray(g.json?.data?.model));
    state.cfgId = id;
  });

  // TC-003 更新+回读
  await runCase(meta('TC-AICONF-003', '更新配置后回读新值', 'P0'), async (cs) => {
    const r = await api.be(`/api/v1/ai-configs/${state.cfgId}`, { base_url: 'http://127.0.0.1:10/v1', model: ['qa-model-a', 'qa-model-b'] }, { method: 'PUT' });
    cs.log('PUT ->', r.status);
    cs.eq('update status', r.status, 200);
    const g = await api.be(`/api/v1/ai-configs/${state.cfgId}`);
    cs.eq('回读 base_url', g.json?.data?.base_url, 'http://127.0.0.1:10/v1');
    cs.expect('model 含 qa-model-a', (g.json?.data?.model || []).includes('qa-model-a'), JSON.stringify(g.json?.data?.model));
  });

  // TC-004 删除闭环
  await runCase(meta('TC-AICONF-004', '删除配置后再查 404', 'P0'), async (cs) => {
    const d = await api.be(`/api/v1/ai-configs/${state.cfgId}`, undefined, { method: 'DELETE' });
    cs.log('DELETE ->', d.status);
    cs.eq('delete status', d.status, 200);
    const g = await api.be(`/api/v1/ai-configs/${state.cfgId}`);
    cs.eq('再查 status', g.status, 404);
    const l = await api.be('/api/v1/ai-configs');
    cs.expect('列表不可见', !(l.json?.data || []).some((x) => x.id === state.cfgId));
  });

  // TC-005 缺必填字段
  await runCase(meta('TC-AICONF-005', '创建缺必填字段 400', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/ai-configs', { name: 'QA-L3-缺字段' }, { method: 'POST' });
    cs.log('POST(缺字段) ->', r.status, JSON.stringify(r.json).slice(0, 160));
    cs.eq('status', r.status, 400);
    cs.expect('message 提示缺少必填字段', JSON.stringify(r.json).includes('缺少必填字段'));
  });

  // TC-006 404
  await runCase(meta('TC-AICONF-006', 'GET 不存在配置 404', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/ai-configs/999999');
    cs.log('GET 999999 ->', r.status, JSON.stringify(r.json).slice(0, 120));
    cs.eq('status', r.status, 404);
    cs.expect('message=配置不存在', JSON.stringify(r.json).includes('配置不存在'));
  });

  // TC-007 service_type 过滤
  await runCase(meta('TC-AICONF-007', 'service_type=text 过滤', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/ai-configs?service_type=text');
    const list = r.json?.data || [];
    cs.log('GET ?service_type=text ->', r.status, 'len=', list.length, 'types=', [...new Set(list.map((x) => x.service_type))].join(','));
    cs.eq('status', r.status, 200);
    cs.expect('全部为 text', list.every((x) => x.service_type === 'text'));
    cs.expect('至少 1 条', list.length >= 1, `len=${list.length}`);
  });

  // TC-008 DeepSeek 真实测试连接（本模块唯一一次真实外部调用）
  await runCase(meta('TC-AICONF-008', '配置测试对 DeepSeek 真实调用成功', 'P0'), async (cs) => {
    cs.log('读取默认 DeepSeek 配置 id=', state.deepseek?.id, '(api_key 不落日志)');
    const body = {
      provider: 'deepseek',
      base_url: state.deepseek.base_url,
      api_key: state.deepseek.api_key,
      model: (state.deepseek.model || [])[0] || 'deepseek-chat',
      service_type: 'text',
    };
    const t0 = Date.now();
    const r = await api.be('/api/v1/ai-configs/test', body, { method: 'POST', timeoutMs: 90000 });
    cs.log('POST /ai-configs/test ->', r.status, `${Date.now() - t0}ms`, JSON.stringify(r.json).slice(0, 220));
    cs.eq('status', r.status, 200);
    cs.expect('message=连接测试成功', (r.json?.data?.message || '').includes('连接测试成功'), r.json?.data?.message);
  });

  // TC-009 缺 api_key
  await runCase(meta('TC-AICONF-009', '测试连接缺 api_key 400', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/ai-configs/test', { base_url: 'https://api.deepseek.com', provider: 'deepseek' }, { method: 'POST' });
    cs.log('POST(缺key) ->', r.status, JSON.stringify(r.json).slice(0, 160));
    cs.eq('status', r.status, 400);
    cs.expect('message 提示缺少 base_url 或 api_key', JSON.stringify(r.json).includes('缺少 base_url 或 api_key'));
  });

  // TC-010 不可达地址（真实错误路径）
  await runCase(meta('TC-AICONF-010', '测试连接不可达地址返回失败', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/ai-configs/test', { base_url: 'http://127.0.0.1:9/v1', api_key: 'sk-qa-l3-invalid', provider: 'openai', service_type: 'text' }, { method: 'POST', timeoutMs: 90000 });
    cs.log('POST(不可达) ->', r.status, JSON.stringify(r.json).slice(0, 200));
    cs.expect('status>=400', r.status >= 400, `status=${r.status}`);
    cs.expect('message 以 连接测试失败 开头', (r.json?.error?.message || r.json?.message || '').startsWith('连接测试失败'), JSON.stringify(r.json).slice(0, 120));
  });

  // TC-011 一键预设等价创建（复现 submitOneKeyAgnes 的 4 条创建契约）
  await runCase(meta('TC-AICONF-011', '一键预设等价创建 4 类配置并可见后清理', 'P1'), async (cs) => {
    const types = [
      ['text', '文本'], ['image', '文本生图'], ['storyboard_image', '分镜图'], ['video', '视频'],
    ];
    const created = [];
    for (const [st, label] of types) {
      const body = {
        service_type: st, name: `QA-L3-Agnes预设-${label}`, provider: 'agnes',
        base_url: 'https://api.agnes.ai/v1', api_key: 'sk-qa-l3-agnes', model: ['qa-model-x'], is_default: true, priority: 10,
      };
      const r = await api.be('/api/v1/ai-configs', body, { method: 'POST' });
      cs.log(`POST ${st} ->`, r.status, 'id=', r.json?.data?.id);
      cs.eq(`create ${st} status`, r.status, 201);
      if (r.json?.data?.id) created.push(r.json.data.id);
    }
    const l = await api.be('/api/v1/ai-configs');
    cs.expect('列表可见 4 条', types.every(([, label]) => (l.json?.data || []).some((x) => x.name === `QA-L3-Agnes预设-${label}`)));
    for (const id of created) {
      const d = await api.be(`/api/v1/ai-configs/${id}`, undefined, { method: 'DELETE' });
      cs.eq(`cleanup ${id}`, d.status, 200);
    }
    // 恢复被 is_default=true 创建/删除破坏的默认配置（clearOtherDefault 副作用）
    if (state.deepseek?.id) {
      const rs = await api.be(`/api/v1/ai-configs/${state.deepseek.id}`, { is_default: true }, { method: 'PUT' });
      cs.eq('恢复 DeepSeek 默认标志', rs.status, 200);
    }
    const l2 = await api.be('/api/v1/ai-configs');
    cs.expect('清理后不可见', !created.some((id) => (l2.json?.data || []).some((x) => x.id === id)));
  });

  // TC-012 场景模型映射 CRUD
  await runCase(meta('TC-AICONF-012', '场景模型映射 CRUD 闭环+重复key 400', 'P1'), async (cs) => {
    const key = 'QA-L3-scene-key';
    const c1 = await api.be('/api/v1/scene-model-map', { key, service_type: 'text', model_override: 'qa-model-x', description: 'QA-L3' }, { method: 'POST' });
    cs.log('create ->', c1.status);
    cs.eq('create status', c1.status, 201);
    const dup = await api.be('/api/v1/scene-model-map', { key, service_type: 'text' }, { method: 'POST' });
    cs.log('dup ->', dup.status, JSON.stringify(dup.json).slice(0, 120));
    cs.eq('dup status', dup.status, 400);
    const u = await api.be(`/api/v1/scene-model-map/${key}`, { service_type: 'text', model_override: 'qa-model-y' }, { method: 'PUT' });
    cs.eq('update status', u.status, 200);
    cs.eq('update 后 model_override', u.json?.data?.model_override, 'qa-model-y');
    const g = await api.be(`/api/v1/scene-model-map/${key}`);
    cs.eq('get 后回读', g.json?.data?.model_override, 'qa-model-y');
    const l = await api.be('/api/v1/scene-model-map');
    cs.expect('list 含 key', (l.json?.data || []).some((x) => x.key === key));
    const d = await api.be(`/api/v1/scene-model-map/${key}`, undefined, { method: 'DELETE' });
    cs.eq('delete status', d.status, 200);
    const g2 = await api.be(`/api/v1/scene-model-map/${key}`);
    cs.eq('删除后 get', g2.status, 404);
  });

  // TC-013 提示词覆盖闭环
  await runCase(meta('TC-AICONF-013', '提示词覆盖 list/update/reset 闭环', 'P1'), async (cs) => {
    const l = await api.be('/api/v1/settings/prompts');
    const prompts = l.json?.data?.prompts || [];
    cs.log('GET prompts ->', l.status, 'count=', prompts.length, 'keys=', prompts.map((p) => p.key).slice(0, 3).join(',') + '...');
    cs.eq('定义数量', prompts.length, 10);
    const key = 'story_expansion_system';
    const u = await api.be(`/api/v1/settings/prompts/${key}`, { content: 'QA-L3 提示词覆盖测试内容' }, { method: 'PUT' });
    cs.log('PUT ->', u.status);
    cs.eq('update status', u.status, 200);
    const l2 = await api.be('/api/v1/settings/prompts');
    const p2 = (l2.json?.data?.prompts || []).find((p) => p.key === key);
    cs.eq('is_customized', p2?.is_customized, true);
    cs.eq('current_body', p2?.current_body, 'QA-L3 提示词覆盖测试内容');
    const rst = await api.be(`/api/v1/settings/prompts/${key}`, undefined, { method: 'DELETE' });
    cs.eq('reset status', rst.status, 200);
    const l3 = await api.be('/api/v1/settings/prompts');
    const p3 = (l3.json?.data?.prompts || []).find((p) => p.key === key);
    cs.eq('reset 后 is_customized', p3?.is_customized, false);
    cs.eq('reset 后 current_body', p3?.current_body, null);
  });

  // TC-014 提示词异常
  await runCase(meta('TC-AICONF-014', '提示词未知 key/空 content 400', 'P1'), async (cs) => {
    const u1 = await api.be('/api/v1/settings/prompts/QA-L3-not-exist', { content: 'x' }, { method: 'PUT' });
    cs.log('PUT unknown ->', u1.status, JSON.stringify(u1.json).slice(0, 120));
    cs.eq('unknown key status', u1.status, 400);
    const u2 = await api.be('/api/v1/settings/prompts/story_expansion_system', { content: '   ' }, { method: 'PUT' });
    cs.eq('empty content status', u2.status, 400);
    const d1 = await api.be('/api/v1/settings/prompts/QA-L3-not-exist', undefined, { method: 'DELETE' });
    cs.eq('delete unknown status', d1.status, 400);
  });

  // TC-015 全局生成设置边界
  await runCase(meta('TC-AICONF-015', '生成设置越界400/合法写读/恢复', 'P0'), async (cs) => {
    const b = await api.be('/api/v1/settings/generation');
    const baseline = b.json?.data;
    cs.log('baseline =', JSON.stringify(baseline));
    cs.eq('get status', b.status, 200);
    const bad = await api.be('/api/v1/settings/generation', { concurrency: 25 }, { method: 'PUT' });
    cs.log('PUT 25 ->', bad.status, JSON.stringify(bad.json).slice(0, 120));
    cs.eq('越界 status', bad.status, 400);
    const ok = await api.be('/api/v1/settings/generation', { concurrency: 5 }, { method: 'PUT' });
    cs.eq('合法 status', ok.status, 200);
    const g = await api.be('/api/v1/settings/generation');
    cs.eq('生效值', g.json?.data?.concurrency, 5);
    const rst = await api.be('/api/v1/settings/generation', { concurrency: baseline.concurrency, video_concurrency: baseline.video_concurrency }, { method: 'PUT' });
    cs.eq('恢复 status', rst.status, 200);
    const f = await api.be('/api/v1/settings/generation');
    cs.eq('恢复后与基线一致', f.json?.data?.concurrency, baseline.concurrency);
    cs.log('final =', JSON.stringify(f.json?.data));
  });

  // TC-016 语言设置
  await runCase(meta('TC-AICONF-016', '语言非法值 400 且当前值不变', 'P2'), async (cs) => {
    const b = await api.be('/api/v1/settings/language');
    const baseline = b.json?.data?.language;
    cs.log('baseline language =', baseline);
    const bad = await api.be('/api/v1/settings/language', { language: 'fr' }, { method: 'PUT' });
    cs.log('PUT fr ->', bad.status, JSON.stringify(bad.json).slice(0, 120));
    cs.eq('非法值 status', bad.status, 400);
    const a = await api.be('/api/v1/settings/language');
    cs.eq('当前值不变', a.json?.data?.language, baseline);
  });

  // TC-017 Vendor Lock
  await runCase(meta('TC-AICONF-017', 'vendor-lock 可读 + 非锁定 bulk-update-key 400', 'P1'), async (cs) => {
    const l = await api.be('/api/v1/ai-configs/vendor-lock');
    cs.log('GET vendor-lock ->', l.status, JSON.stringify(l.json?.data));
    cs.eq('status', l.status, 200);
    cs.expect('含 enabled+config_file', 'enabled' in (l.json?.data || {}) && 'config_file' in (l.json?.data || {}));
    const b = await api.be('/api/v1/ai-configs/bulk-update-key', { api_key: 'sk-qa-l3-bulk' }, { method: 'PUT' });
    cs.log('PUT bulk-update-key ->', b.status, JSON.stringify(b.json).slice(0, 140));
    cs.eq('非锁定模式 status', b.status, 400);
    cs.expect('message 提示厂商锁定', JSON.stringify(b.json).includes('厂商锁定'));
  });

  // TC-018 明文 key 安全复核
  await runCase(meta('TC-AICONF-018', '明文 api_key 暴露与导出脱敏缺失复核', 'P0'), async (cs) => {
    const l = await api.be('/api/v1/ai-configs');
    const ds = (l.json?.data || []).find((x) => x.id === state.deepseek?.id);
    const key = ds?.api_key || '';
    const masked = /^sk-\*{2,}/.test(key) || key.includes('***');
    cs.log(`api_key 呈现: len=${key.length} 前6位=${key.slice(0, 6)} 是否掩码=${masked}`);
    cs.evidence.push(`OBSERVATION: GET /ai-configs 对 id=${ds?.id} 返回完整明文 api_key（${key.length} 字符，未脱敏）`);
    cs.expect('API 返回完整明文 key（安全缺陷确认=预期发现）', key.length >= 20 && !masked, `len=${key.length}`);
    const src = readRel('frontweb/src/components/AIConfigContent.vue');
    const seg = src.slice(src.indexOf('async function exportConfigs'), src.indexOf('function triggerImport'));
    const strips = ['id', 'created_at', 'updated_at'].every((f) => seg.includes(f));
    const keepsKey = !/api_key/.test(seg.split('=>')[0] || '');
    cs.log('exportConfigs 源码: 仅剔除 id/created_at/updated_at =', strips, '; rest 展开保留 api_key =', seg.includes('...rest'));
    cs.evidence.push('SOURCE: AIConfigContent.vue exportConfigs 使用 ({ id, created_at, updated_at, ...rest }) 解构，api_key 随 rest 进入导出 JSON');
    cs.expect('前端导出未对 api_key 脱敏（缺陷确认=预期发现）', seg.includes('...rest') && strips);
    cs.log('结论：feature-inventory §11.3 导出明文 key 问题仍存在 -> 记 BUG-L3-101');
  });

  console.log('\nAICONF done');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

// ---- automation.test_id registry (generated from qa/cases/*.yml) ----
// TC-AICONF-001: AICONF_001_list_contract
// TC-AICONF-002: AICONF_002_create_read
// TC-AICONF-003: AICONF_003_update_readback
// TC-AICONF-004: AICONF_004_delete_closedloop
// TC-AICONF-005: AICONF_005_create_missing_fields
// TC-AICONF-006: AICONF_006_get_not_found
// TC-AICONF-007: AICONF_007_filter_service_type
// TC-AICONF-008: AICONF_008_test_connection_real_deepseek
// TC-AICONF-009: AICONF_009_test_missing_key
// TC-AICONF-010: AICONF_010_test_unreachable
// TC-AICONF-011: AICONF_011_onekey_preset_equiv
// TC-AICONF-012: AICONF_012_scene_model_map_crud
// TC-AICONF-013: AICONF_013_prompt_override_cycle
// TC-AICONF-014: AICONF_014_prompt_override_errors
// TC-AICONF-015: AICONF_015_generation_settings_bounds
// TC-AICONF-016: AICONF_016_language_invalid
// TC-AICONF-017: AICONF_017_vendor_lock_guard
// TC-AICONF-018: AICONF_018_plaintext_key_export
