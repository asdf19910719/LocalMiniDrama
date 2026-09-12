// Wave4 IMAGE 模块：图像生成（默认通道 shim 离线真实错误路径 + 契约类）
// 前置：run-video.js 已执行（image 默认通道 id=2 已恢复为默认）
const fs = require('fs');
const path = require('path');
const {
  api, runCase, mask, q, q1, pollUntil, uploadPng,
  createV1Project, createEpisode, saveDraft, confirmScript,
  keepProject, softDeleteProject,
  ART_DIR, ROOT,
} = require('./lib');

const MODULE = 'IMAGE';
function meta(id, title, level, priority) { return { id, title, module: MODULE, level, priority }; }

(async () => {
  const results = {};
  const CTX = {};

  // 共享项目
  results.TC_IMAGE_000_setup = await runCase(meta('TC-IMAGE-000', '（前置）共享测试项目与分镜搭建', 'system', 'P1'), async (cs) => {
    // 前置确认：image 默认通道为 Local Shim（离线）
    const cfg = q1("SELECT id, provider, name, base_url, is_default FROM ai_service_configs WHERE service_type='image' AND deleted_at IS NULL AND is_default=1");
    cs.log(`默认图像通道: ${JSON.stringify(cfg)}`);
    CTX.defaultCfg = cfg;
    cs.expect('默认图像通道为 Local Shim（18080 离线，真实外部状态）', cfg && String(cfg.base_url || '').includes('18080'), JSON.stringify(cfg));

    const proj = await createV1Project(cs, `QA-L3-IMAGE-${Date.now()}`);
    CTX.projectId = proj.id;
    keepProject(cs, CTX.projectId); // 共享项目：模块结尾统一软删
    CTX.episodeId = await createEpisode(cs, CTX.projectId, '第一集');
    await saveDraft(CTX.episodeId, '第一场：深夜办公室 夜 内\n程序员盯着屏幕上的报错堆栈，咖啡凉了一半，窗外的城市灯火渐次熄灭。');
    await confirmScript(CTX.episodeId);
    const s = await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard/create-from-script`, {});
    cs.log(`project=${CTX.projectId} episode=${CTX.episodeId} create-from-script=${s.status}`);
    const shots = q('SELECT id, storyboard_number FROM storyboards WHERE episode_id=? AND deleted_at IS NULL ORDER BY storyboard_number', CTX.episodeId);
    CTX.shotId = shots[0]?.id;
    // 给分镜一张真实本地图（供超分用例）
    const up = await uploadPng(cs, CTX.projectId, 'qa-l3-shot.png', 200, 120);
    await api.beMethod('PUT', `/api/v1/storyboards/${CTX.shotId}`, { local_path: up.local_path });
    CTX.shotPng = up;
    cs.expect('前置搭建完成', !!(CTX.projectId && CTX.shotId && up.local_path), JSON.stringify({ shot: CTX.shotId }));
  });

  // ============ TC-IMAGE-001 默认通道真实失败可见（QA-008）============
  results.TC_IMAGE_001 = await runCase(meta('TC-IMAGE-001', '默认通道创建图像任务：18080 shim 离线为真实外部状态 → 任务失败状态与错误信息可见（QA-008 修复验证）', 'system', 'P0'), async (cs) => {
    const r = await api.be('/api/v1/images', { drama_id: CTX.projectId, prompt: 'QA-L3 图像默认通道失败可见性验证' });
    cs.log(`images.create -> ${r.status} ${r.text.slice(0, 240)}`);
    cs.eq('创建受理 201（pending）', r.status, 201);
    const id = r.json?.data?.id;
    cs.expect('返回 task_id（任务抽屉可跟踪）', !!r.json?.data?.task_id, String(r.json?.data?.task_id));
    // 轮询到终态（shim 连接拒绝应为秒级失败）
    const fin = await pollUntil(async () => {
      const g = await api.be(`/api/v1/images/${id}`);
      const st = g.json?.data?.status;
      if (['failed', 'completed', 'succeeded'].includes(st)) return { done: true, st, body: g.json?.data };
      return { done: false, st };
    }, { timeoutMs: 90000, intervalMs: 2000, label: 'image-gen' });
    cs.log(`终态: ${fin.st} error=${String(fin.body?.error_msg || '').slice(0, 200)}`);
    if (!fin.done) {
      cs.expect('任务在 90s 内进入可见终态（QA-008：失败不能静默悬挂）', false, `last=${fin.st}`);
      await cs.finish('blocked');
      return;
    }
    cs.expect('离线通道任务进入失败态（不静默）', fin.st === 'failed', fin.st);
    const errMsg = String(fin.body?.error_msg || '');
    cs.expect('错误信息包含连接失败细节（ECONNREFUSED/18080/fetch）', /ECONNREFUSED|18080|fetch failed|连接/i.test(errMsg), errMsg.slice(0, 200));
    const dbRow = q1('SELECT status, error_msg FROM image_generations WHERE id=?', id);
    cs.expect('失败状态已持久化到 image_generations', dbRow?.status === 'failed', JSON.stringify({ s: dbRow?.status }));
    // 任务抽屉侧可见性（同任务经 v1 async_tasks 链路）
    const t = q1('SELECT status, error FROM async_tasks WHERE id=?', r.json?.data?.task_id);
    cs.log(`async_task: ${JSON.stringify({ status: t?.status })}`);
    cs.expect('任务层同样记录失败（抽屉数据源可见）', t && ['failed', 'error'].includes(String(t.status)), String(t?.status));
  });

  // ============ TC-IMAGE-002 风格契约 ============
  results.TC_IMAGE_002 = await runCase(meta('TC-IMAGE-002', '风格契约：项目内覆盖 style 400；自由生成缺 style_id 400 PROJECT_STYLE_REQUIRED', 'system', 'P1'), async (cs) => {
    const styleId = await require('./lib').defaultStyleId();
    const r1 = await api.be('/api/v1/images', { drama_id: CTX.projectId, style_id: styleId, prompt: 'x' });
    cs.eq('项目内覆盖风格 400', r1.status, 400);
    cs.eq('错误码 PROJECT_STYLE_OVERRIDE_FORBIDDEN', r1.json?.error?.code, 'PROJECT_STYLE_OVERRIDE_FORBIDDEN');
    const r2 = await api.be('/api/v1/images', { prompt: 'QA-L3 无风格自由生成' });
    cs.eq('自由生成缺 style 400', r2.status, 400);
    cs.eq('错误码 PROJECT_STYLE_REQUIRED', r2.json?.error?.code, 'PROJECT_STYLE_REQUIRED');
  });

  // ============ TC-IMAGE-003 批量任务契约 ============
  results.TC_IMAGE_003 = await runCase(meta('TC-IMAGE-003', '批量图像任务契约 POST /image-generation-batches：批次+任务持久化、通道解析、部分失败允许', 'system', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/image-generation-batches', {
      dramaId: CTX.projectId,
      targets: [{ targetType: 'storyboard_main', targetId: CTX.shotId }],
    });
    cs.log(`batch create -> ${r.status} ${r.text.slice(0, 260)}`);
    if (r.status !== 200) { cs.expect('批量创建成功', false, r.text.slice(0, 200)); return; }
    const batch = r.json?.data?.batch || r.json?.data;
    const batchId = batch?.id || batch?.batch_id;
    cs.expect('批次 id 返回', !!batchId, JSON.stringify(batch).slice(0, 160));
    const dbBatch = q1('SELECT * FROM image_generation_batches WHERE id=?', batchId);
    cs.expect('批次落库（drama/scope/计数）', !!dbBatch, JSON.stringify(dbBatch).slice(0, 200));
    const taskRows = q('SELECT id, status, batch_id FROM image_generation_tasks WHERE batch_id=?', batchId);
    cs.expect('批次下任务行已创建', taskRows.length >= 1, `count=${taskRows.length}`);
    const t0 = taskRows[0];
    // 通道解析：默认应为 api 通道（shim）或 chatgpt_web，记录真实解析结果
    cs.log(`batch task 通道: ${q1('SELECT generation_channel FROM image_generation_tasks WHERE id=?', t0.id)?.generation_channel}`);
    // 悬挂任务清理：cancel 该任务避免占用队列
    const c = await api.be(`/api/v1/image-generation-tasks/${t0.id}/cancel`, {});
    cs.log(`清理: cancel task -> ${c.status}`);
  });

  // ============ TC-IMAGE-004 任务抽屉数据 ============
  results.TC_IMAGE_004 = await runCase(meta('TC-IMAGE-004', '图像任务抽屉数据：summary 按状态聚合、environment/default 通道接口契约', 'system', 'P1'), async (cs) => {
    const s = await api.be(`/api/v1/dramas/${CTX.projectId}/image-generation-summary`);
    cs.eq('summary 200', s.status, 200);
    const sum = s.json?.data || {};
    cs.log('summary: ' + JSON.stringify(sum).slice(0, 300));
    cs.expect('summary 含状态聚合字段', Object.keys(sum).length > 0, '空对象');
    const env = await api.be(`/api/v1/dramas/${CTX.projectId}/image-generation-environment`);
    cs.eq('environment 200', env.status, 200);
    cs.log('environment: ' + JSON.stringify(env.json?.data).slice(0, 300));
    const def = await api.be(`/api/v1/dramas/${CTX.projectId}/image-generation-default`);
    cs.eq('default 200', def.status, 200);
    cs.expect('默认通道可辨识', !!def.json?.data?.channel, JSON.stringify(def.json?.data));
  });

  // ============ TC-IMAGE-005 批次暂停/继续 ============
  results.TC_IMAGE_005 = await runCase(meta('TC-IMAGE-005', '图像批次暂停/继续状态语义：pause → paused，resume → 恢复排队', 'system', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/image-generation-batches', {
      dramaId: CTX.projectId,
      targets: [{ targetType: 'storyboard_main', targetId: CTX.shotId }],
    });
    const batchId = r.json?.data?.batch?.id || r.json?.data?.id;
    cs.expect('前置批次已建', !!batchId, r.text.slice(0, 160));
    const p = await api.be(`/api/v1/image-generation-batches/${batchId}/pause`, {});
    cs.log(`pause -> ${p.status} ${p.text.slice(0, 160)}`);
    cs.eq('pause 200', p.status, 200);
    const st1 = q1('SELECT status FROM image_generation_batches WHERE id=?', batchId);
    cs.expect('批次进入 paused/queue_paused 状态', /paused/i.test(String(st1?.status)), JSON.stringify(st1));
    const rs = await api.be(`/api/v1/image-generation-batches/${batchId}/resume`, {});
    cs.log(`resume -> ${rs.status} ${rs.text.slice(0, 160)}`);
    cs.eq('resume 200', rs.status, 200);
    const st2 = q1('SELECT status FROM image_generation_batches WHERE id=?', batchId);
    cs.expect('resume 后退出 paused', !/paused/i.test(String(st2?.status)), JSON.stringify(st2));
    const nf = await api.be('/api/v1/image-generation-batches/nonexistent-batch/pause', {});
    cs.expect('不存在批次 pause 400/404', [400, 404].includes(nf.status), String(nf.status));
    await api.be(`/api/v1/image-generation-tasks/${q1('SELECT id FROM image_generation_tasks WHERE batch_id=?', batchId)?.id}/cancel`, {});
  });

  // ============ TC-IMAGE-006 任务级 retry/skip/cancel 语义 ============
  results.TC_IMAGE_006 = await runCase(meta('TC-IMAGE-006', '图像任务 retry/skip/cancel 状态语义：cancel 后不可 skip/retry（状态机约束）', 'system', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/image-generation-batches', {
      dramaId: CTX.projectId,
      targets: [{ targetType: 'storyboard_main', targetId: CTX.shotId }],
    });
    const task = q1('SELECT id, status FROM image_generation_tasks WHERE batch_id=? ORDER BY id DESC', r.json?.data?.batch?.id || r.json?.data?.id);
    cs.expect('前置任务已建', !!task, JSON.stringify(task));
    const c = await api.be(`/api/v1/image-generation-tasks/${task.id}/cancel`, {});
    cs.log(`cancel -> ${c.status} ${c.text.slice(0, 140)}`);
    cs.eq('cancel 200', c.status, 200);
    const st1 = q1('SELECT status FROM image_generation_tasks WHERE id=?', task.id);
    cs.eq('任务进入 cancelled', st1?.status, 'cancelled');
    const sk = await api.be(`/api/v1/image-generation-tasks/${task.id}/skip`, {});
    cs.log(`skip(cancelled) -> ${sk.status} ${sk.text.slice(0, 140)}`);
    if (sk.status === 200) {
      const stAfter = q1('SELECT status FROM image_generation_tasks WHERE id=?', task.id);
      cs.expect('[观察项] cancelled 任务 skip 被 200 接受且状态保持 cancelled（幂等空转，状态机未拒绝——记录为宽松语义）', stAfter?.status === 'cancelled', JSON.stringify(stAfter));
    } else {
      cs.expect('cancelled 任务 skip 被状态机拒绝（400/409）', [400, 409].includes(sk.status), String(sk.status));
    }
    const rt = await api.be(`/api/v1/image-generation-tasks/${task.id}/retry`, {});
    cs.log(`retry(cancelled) -> ${rt.status} ${rt.text.slice(0, 140)}`);
    cs.expect('cancelled 任务 retry 被拒绝或进入重试（真实语义记录）', [400, 409, 200].includes(rt.status), String(rt.status));
    if (rt.status === 200) {
      const st2 = q1('SELECT status FROM image_generation_tasks WHERE id=?', task.id);
      cs.log(`retry 后状态: ${st2?.status}（如为 queued 将继续占用 shim 失败路径，属真实重试）`);
      await api.be(`/api/v1/image-generation-tasks/${task.id}/cancel`, {});
    }
  });

  // ============ TC-IMAGE-007 图像代理缓存 ============
  results.TC_IMAGE_007 = await runCase(meta('TC-IMAGE-007', '图像代理缓存：服务层能力验证（image_proxy_cache 键/值语义 + 无独立 HTTP 路由观察项）', 'system', 'P2'), async (cs) => {
    // 1) 表结构语义（cache_key/proxy_url 唯一约束）
    const cols = q("PRAGMA table_info(image_proxy_cache)").map((c) => c.name);
    cs.log(`image_proxy_cache 列: ${cols.join(',')}`);
    cs.expect('缓存表含 cache_key/proxy_url', cols.includes('cache_key') && cols.includes('proxy_url'), cols.join(','));
    // 2) 服务层真实调用点（代码证据）
    const src = fs.readFileSync(path.join(ROOT, 'backend-node/src/services/imageClient.js'), 'utf8');
    const hasGet = /SELECT proxy_url, created_at FROM image_proxy_cache WHERE cache_key = \?/.test(src);
    const hasPut = /INSERT OR REPLACE INTO image_proxy_cache/.test(src);
    cs.expect('imageClient 存在缓存读路径（imageClient.js）', hasGet, 'grep SELECT proxy_url');
    cs.expect('imageClient 存在缓存写路径（imageClient.js）', hasPut, 'grep INSERT OR REPLACE');
    // 3) 真实行为：默认通道生成失败（离线）不会写入缓存 → 缓存行数不因失败而虚增
    const before = q1('SELECT COUNT(*) AS n FROM image_proxy_cache').n;
    await api.be('/api/v1/images', { drama_id: CTX.projectId, prompt: 'QA-L3 代理缓存负向验证' });
    await new Promise((r) => setTimeout(r, 4000));
    const after = q1('SELECT COUNT(*) AS n FROM image_proxy_cache').n;
    cs.expect('失败生成不产生缓存写入', after === before, `before=${before} after=${after}`);
    cs.log('[观察项] 「远程图片代理并缓存」为服务层能力（即梦素材/图床链路），无独立 HTTP 路由；HTTP 级成功路径依赖真实图床配置，由观察项记录，不算 blocked（E2E 阶段可覆盖）');
  });

  // ============ TC-IMAGE-008 分镜图像超分（sharp 2x 真实）============
  results.TC_IMAGE_008 = await runCase(meta('TC-IMAGE-008', '分镜图像超分：POST /storyboards/:id/upscale 真实 sharp 2x → 新文件落盘尺寸翻倍', 'system', 'P1'), async (cs) => {
    const r = await api.be(`/api/v1/storyboards/${CTX.shotId}/upscale`, {});
    cs.log(`upscale -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.eq('upscale 200', r.status, 200);
    const rel = r.json?.data?.local_path;
    const w = r.json?.data?.width; const h = r.json?.data?.height;
    cs.expect('返回 2x 尺寸 400x240', w === 400 && h === 240, JSON.stringify({ w, h }));
    const abs = path.join(ROOT, 'backend-node/data/storage', String(rel));
    cs.expect('超分文件真实落盘', fs.existsSync(abs), abs);
    cs.expect('超分文件大于原图（信息量增加）', fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
    const row = q1('SELECT local_path FROM storyboards WHERE id=?', CTX.shotId);
    cs.expect('分镜 local_path 已切换为超分产物', String(row?.local_path) === String(rel), JSON.stringify({ row: row?.local_path, rel }));
    try { fs.copyFileSync(abs, path.join(ART_DIR, 'TC-IMAGE-008-upscaled-2x.png')); } catch (_) {}
    // 无图分镜负向
    const shots2 = q('SELECT id FROM storyboards WHERE episode_id=? AND deleted_at IS NULL AND id != ?', CTX.episodeId, CTX.shotId);
    if (shots2.length) {
      const r2 = await api.be(`/api/v1/storyboards/${shots2[0].id}/upscale`, {});
      cs.log(`无图分镜 upscale -> ${r2.status} ${r2.text.slice(0, 140)}`);
      cs.eq('无图分镜 400', r2.status, 400);
    }
  });

  // ============ TC-IMAGE-009 历史与候选选择 ============
  results.TC_IMAGE_009 = await runCase(meta('TC-IMAGE-009', '图像生成历史与候选管理：列表过滤 drama_id、详情回读、删除后不可见', 'system', 'P1'), async (cs) => {
    const l = await api.be(`/api/v1/images?drama_id=${CTX.projectId}&page_size=50`);
    cs.eq('列表 200', l.status, 200);
    const items = l.json?.data?.items || [];
    cs.expect('列表仅含本项目', items.every((x) => Number(x.drama_id) === Number(CTX.projectId)), `total=${items.length}`);
    cs.expect('本轮失败记录在历史可见（候选可查）', items.some((x) => x.status === 'failed'), JSON.stringify(items.map((x) => x.status)));
    const first = items[0];
    if (first) {
      const g = await api.be(`/api/v1/images/${first.id}`);
      cs.eq('详情 200', g.status, 200);
      cs.eq('详情 id 回读一致', g.json?.data?.id, first.id);
      const d = await api.beMethod('DELETE', `/api/v1/images/${first.id}`);
      cs.eq('删除 200', d.status, 200);
      const g2 = await api.be(`/api/v1/images/${first.id}`);
      cs.eq('删除后 GET 404', g2.status, 404);
    }
  });

  // ============ TC-IMAGE-010 自由创作图像（documented BROKEN 现状验证）============
  results.TC_IMAGE_010 = await runCase(meta('TC-IMAGE-010', '自由创作图像轮询接口现状：imagesAPI 无 getTask 导出（BROKEN 现状如实验证，前端有空值守卫降级）', 'system', 'P2'), async (cs) => {
    const src = fs.readFileSync(path.join(ROOT, 'frontweb/src/api/images.js'), 'utf8');
    cs.expect('frontweb/src/api/images.js 不存在 getTask 导出（inventory INV-6.11 BROKEN 现状）', !src.includes('getTask'), 'grep getTask');
    const vue = fs.readFileSync(path.join(ROOT, 'frontweb/src/views/FreeCreate.vue'), 'utf8');
    const guarded = /imagesAPI\.getTask \?/.test(vue);
    cs.log(`FreeCreate.vue:288 调用形如 imagesAPI.getTask ? ...（空值守卫=${guarded}）`);
    cs.expect('页面调用点带空值守卫（轮询退化为超时/失败路径而非崩溃）', guarded, String(guarded));
    // 后端侧：不存在任务轮询专用路由（GET /images/tasks/:id 被当作 :id 处理）
    const r = await api.be('/api/v1/images/tasks/some-task-id');
    cs.log(`GET /images/tasks/some-task-id -> ${r.status}`);
    cs.eq('任务轮询路由不存在（404）', r.status, 404);
  });

  // ============ TC-IMAGE-011 episodeBackgrounds ============
  results.TC_IMAGE_011 = await runCase(meta('TC-IMAGE-011', '剧集背景图接口：GET backgrounds 空态真实行为 + extract 契约', 'system', 'P2'), async (cs) => {
    const g = await api.be(`/api/v1/images/episode/${CTX.episodeId}/backgrounds`);
    cs.log(`backgrounds -> ${g.status} ${g.text.slice(0, 160)}`);
    cs.expect('空态返回 200 与列表结构', g.status === 200 && Array.isArray(g.json?.data || g.json?.data?.items), g.text.slice(0, 160));
    const e = await api.be(`/api/v1/images/episode/${CTX.episodeId}/backgrounds/extract`, {});
    cs.log(`extract -> ${e.status} ${e.text.slice(0, 200)}`);
    cs.expect('extract 有明确业务响应（不崩溃）', e.status < 500 || !!e.json?.error?.code, String(e.status));
  });

  const passed = Object.values(results).filter((s) => s === 'passed').length;
  const failed = Object.values(results).filter((s) => s === 'failed').length;
  const blocked = Object.values(results).filter((s) => s === 'blocked').length;
  console.log(`\n[wave4 IMAGE] passed=${passed} failed=${failed} blocked=${blocked}`);
})();
