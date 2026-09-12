// TASK 模块真实 API 执行（TC-TASK-001..013）—— DeepSeek 真实调用共 2 次（TC-003 正常 + TC-009 取消分支）
const { execFileSync } = require('child_process');
const { api, runCase, readRel } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'TASK', level: level || 'system', priority });
const state = {};

async function waitForTerminal(cs, taskId, timeoutMs, pollMs = 1500) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await api.be(`/api/v1/tasks/${taskId}`);
    last = r.json?.data;
    if (last && (last.status === 'completed' || last.status === 'failed')) return last;
    await new Promise((s) => setTimeout(s, pollMs));
  }
  return last;
}

(async () => {
  // 前置：创建 QA-L3 项目（TASK 流共用 fixture）
  const proj = await api.be('/api/v1/dramas', { title: 'QA-L3-任务验证项目', summary: 'Wave1 TASK 模块测试项目', style_id: 'rh-101-cinematic' }, { method: 'POST' });
  if (proj.status !== 201) { console.error('FATAL: 无法创建 QA-L3 项目', proj.status, proj.text.slice(0, 200)); process.exit(1); }
  state.dramaId = proj.json?.data?.id;
  console.log('QA-L3 项目 id =', state.dramaId);

  // TC-001
  await runCase(meta('TC-TASK-001', 'GET 不存在任务 404', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/tasks/qa-l3-nonexistent-task-id');
    cs.log('GET ->', r.status, JSON.stringify(r.json).slice(0, 120));
    cs.eq('status', r.status, 404);
    cs.expect('message=任务不存在', JSON.stringify(r.json).includes('任务不存在'));
  });

  // TC-002
  await runCase(meta('TC-TASK-002', 'GET /tasks 缺 resource_id 400', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/tasks');
    cs.log('GET ->', r.status, JSON.stringify(r.json).slice(0, 120));
    cs.eq('status', r.status, 400);
    cs.expect('message=缺少resource_id参数', JSON.stringify(r.json).includes('缺少resource_id'));
  });

  // TC-003 + TC-006（in-flight 去重，与 TC-003 共用同一次真实调用）
  await runCase(meta('TC-TASK-003', '真实故事生成任务状态机 pending→processing→completed + 产出写回', 'P0'), async (cs) => {
    const s = await api.be('/api/v1/generation/story', { drama_id: String(state.dramaId), premise: 'QA-L3 测试梗概：外卖骑手在雨夜送错了一份订单，收件人地址通向一座已经拆除的楼。', episode_count: 1 }, { method: 'POST' });
    cs.log('POST /generation/story ->', s.status, JSON.stringify(s.json).slice(0, 160));
    cs.eq('start status', s.status, 200);
    const taskId = s.json?.data?.task_id;
    cs.expect('返回 task_id', !!taskId, taskId);
    state.storyTaskId = taskId;

    const first = await api.be(`/api/v1/tasks/${taskId}`);
    cs.log('立即查询 status=', first.json?.data?.status, '(期望 pending/processing)');
    cs.expect('初始为未完成态', ['pending', 'processing'].includes(first.json?.data?.status), first.json?.data?.status);
    state.firstSeen = first.json?.data?.status;

    // TC-006 in-flight 去重核验（不新增 DeepSeek 调用）
    await runCase(meta('TC-TASK-006', '同资源进行中任务去重返回相同 task_id', 'P0'), async (cs6) => {
      const s2 = await api.be('/api/v1/generation/story', { drama_id: String(state.dramaId), premise: 'QA-L3 去重核验第二次发起。', episode_count: 1 }, { method: 'POST' });
      cs6.log('second POST ->', s2.status, 'task_id=', s2.json?.data?.task_id);
      cs6.eq('same task_id', s2.json?.data?.task_id, taskId);
    });

    const fin = await waitForTerminal(cs, taskId, 240000);
    cs.log('终态 status=', fin?.status, 'progress=', fin?.progress, 'result=', fin?.result);
    cs.eq('终态 completed', fin?.status, 'completed');
    let result = fin?.result;
    if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) {} }
    cs.expect('result.episode_count>=1', (result?.episode_count ?? 0) >= 1, JSON.stringify(result).slice(0, 160));
    cs.expect('completed_at 非空', !!fin?.completed_at, fin?.completed_at);

    // 数据流交接点：产出写回项目（episodes 经 API 可见）
    const eps = await api.be(`/api/v2/projects/${state.dramaId}/episodes`);
    const items = eps.json?.data?.items || [];
    cs.log('GET v2 episodes ->', eps.status, 'count=', items.length, 'titles=', items.map((i) => i.title).join(','));
    cs.expect('项目下新增剧集>=1（产出持久化）', items.length >= 1, `count=${items.length}`);
    state.episodeId = items[0]?.id;
  });

  // TC-004 字段契约
  await runCase(meta('TC-TASK-004', '任务详情字段契约完整', 'P0'), async (cs) => {
    const r = await api.be(`/api/v1/tasks/${state.storyTaskId}`);
    const t = r.json?.data;
    cs.log('GET task ->', r.status, JSON.stringify(t).slice(0, 300));
    ['id', 'type', 'status', 'progress', 'message', 'resource_id', 'created_at', 'updated_at'].forEach((f) =>
      cs.expect(`字段 ${f} 存在`, f in (t || {})));
    cs.eq('type', t?.type, 'story_generation');
    cs.expect('progress 为数值', typeof t?.progress === 'number', t?.progress);
  });

  // TC-005 按资源查询
  await runCase(meta('TC-TASK-005', 'GET /tasks?resource_id 返回资源任务列表', 'P1'), async (cs) => {
    const r = await api.be(`/api/v1/tasks?resource_id=${state.dramaId}`);
    const list = r.json?.data || [];
    cs.log('GET ->', r.status, 'count=', list.length, 'ids=', list.slice(0, 3).map((t) => t.id.slice(0, 8)).join(','));
    cs.eq('status', r.status, 200);
    cs.expect('包含 story 任务', list.some((t) => t.id === state.storyTaskId));
    cs.expect('该项 status=completed', (list.find((t) => t.id === state.storyTaskId) || {}).status === 'completed');
  });

  // TC-007 取消终态任务幂等
  await runCase(meta('TC-TASK-007', '取消已完成任务 already_done 幂等', 'P1'), async (cs) => {
    const r = await api.be(`/api/v1/tasks/${state.storyTaskId}/cancel`, { reason: 'QA-L3 幂等取消' }, { method: 'POST' });
    cs.log('POST cancel ->', r.status, JSON.stringify(r.json).slice(0, 200));
    cs.eq('status', r.status, 200);
    cs.eq('already_done', r.json?.data?.already_done, true);
    const g = await api.be(`/api/v1/tasks/${state.storyTaskId}`);
    cs.eq('状态仍 completed', g.json?.data?.status, 'completed');
  });

  // TC-008 取消不存在任务
  await runCase(meta('TC-TASK-008', '取消不存在任务 404', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/tasks/qa-l3-nonexistent-task-id/cancel', { reason: 'x' }, { method: 'POST' });
    cs.log('POST cancel ->', r.status, JSON.stringify(r.json).slice(0, 120));
    cs.eq('status', r.status, 404);
  });

  // TC-009 运行中取消（DeepSeek 真实调用第 2 次，TASK 流异常分支）
  await runCase(meta('TC-TASK-009', '运行中任务取消：标 failed 但无法中止已发出的模型请求', 'P0'), async (cs) => {
    const s = await api.be('/api/v1/generation/story', { drama_id: String(state.dramaId), premise: 'QA-L3 取消语义测试：深夜便利店的最后一位顾客买了伞和电池。', episode_count: 1 }, { method: 'POST' });
    const taskId = s.json?.data?.task_id;
    cs.log('start ->', s.status, 'task_id=', taskId);
    cs.expect('新任务 id（不同于 TC-003）', !!taskId && taskId !== state.storyTaskId);
    const c = await api.be(`/api/v1/tasks/${taskId}/cancel`, { reason: 'QA-L3 用户取消原因' }, { method: 'POST' });
    cs.log('立即 cancel ->', c.status, JSON.stringify(c.json).slice(0, 160));
    cs.eq('cancel status', c.status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    const t1 = await api.be(`/api/v1/tasks/${taskId}`);
    cs.log('取消后 1.5s status=', t1.json?.data?.status, 'error=', t1.json?.data?.error);
    cs.eq('标为 failed', t1.json?.data?.status, 'failed');
    cs.expect('error=取消原因', (t1.json?.data?.error || '').includes('QA-L3 用户取消原因'), t1.json?.data?.error);

    // 观察窗口：外部调用未被中止时，后台完成会把 failed 覆盖为 completed
    cs.log('进入观察窗口（最多 180s）验证外部调用是否被中止…');
    const fin = await waitForTerminal(cs, taskId, 180000, 3000);
    const finalStatus = fin?.status;
    cs.log('最终 status=', finalStatus, 'result=', fin?.result);
    if (finalStatus === 'completed') {
      cs.evidence.push('OBSERVATION: 取消标记为 failed 后，后台 DeepSeek 调用继续完成并将状态覆盖为 completed —— 证实 cancel 不能中止已发出的模型请求（feature-inventory §14.2 PARTIAL 原文语义一致，按现状记录）');
    } else if (finalStatus === 'failed') {
      cs.evidence.push('OBSERVATION: 取消后任务保持 failed（后台调用随后失败或被拒绝），未观察到覆盖');
    }
    cs.expect('到达终态', ['completed', 'failed'].includes(finalStatus), finalStatus);
    state.cancelTaskId = taskId;
    state.cancelFinal = finalStatus;
  });

  // TC-010 不存在项目
  await runCase(meta('TC-TASK-010', '不存在项目发起生成 400', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/generation/story', { drama_id: 99999999, premise: 'x' }, { method: 'POST' });
    cs.log('POST ->', r.status, JSON.stringify(r.json).slice(0, 140));
    cs.eq('status', r.status, 400);
    cs.expect('message=项目不存在', JSON.stringify(r.json).includes('项目不存在'));
  });

  // TC-011 重启恢复语义（不重启，源码+DB 核验）
  await runCase(meta('TC-TASK-011', '重启恢复语义核验（源码+DB 只读）', 'P1', 'integration'), async (cs) => {
    const svc = readRel('backend-node/src/services/taskService.js');
    cs.expect('failOrphanedAsyncTasksOnStartup 存在', svc.includes('function failOrphanedAsyncTasksOnStartup'));
    cs.expect('孤儿消息常量存在', svc.includes('服务重启后任务中断，请重新操作'));
    const app = readRel('backend-node/src/app.js');
    const idx = readRel('backend-node/src/routes/index.js');
    const wired = app.includes('failOrphanedAsyncTasksOnStartup') || idx.includes('failOrphanedAsyncTasksOnStartup');
    cs.log('app.js 引用 failOrphanedAsyncTasksOnStartup =', app.includes('failOrphanedAsyncTasksOnStartup'), '; routes/index.js =', idx.includes('failOrphanedAsyncTasksOnStartup'));
    cs.expect('启动链调用该函数', wired);
    // DB 只读统计（python sqlite3，避免 ABI 问题）
    let out = '';
    try {
      out = execFileSync('python', ['-c',
        "import sqlite3;con=sqlite3.connect('data/drama_generator.db');"
        + "print('pending=',con.execute(\"select count(*) from async_tasks where status='pending' and deleted_at is null\").fetchone()[0],"
        + "'processing=',con.execute(\"select count(*) from async_tasks where status='processing' and deleted_at is null\").fetchone()[0],"
        + "'orphan_marked=',con.execute(\"select count(*) from async_tasks where message='服务重启后任务中断，请重新操作'\").fetchone()[0])"], { cwd: 'E:/project/LocalMiniDrama/backend-node', encoding: 'utf8' }).trim();
    } catch (e) { out = 'DB_QUERY_ERR ' + e.message; }
    cs.log('DB 只读统计:', out);
    const m = out.match(/pending= (\d+) processing= (\d+) orphan_marked= (\d+)/);
    if (m) {
      cs.expect('无遗留 pending', Number(m[1]) === 0, `pending=${m[1]}`);
      cs.expect('无遗留 processing', Number(m[2]) === 0, `processing=${m[2]}`);
    } else cs.failed.push('DB 统计解析失败: ' + out);
    cs.evidence.push('SOURCE: taskService.js:98-149 启动时将遗留 pending/processing 标记为失败（非续跑）；video_generation/video_merge 有 config_snapshot 可恢复例外分支（:113-135）');
    cs.evidence.push('CONSTRAINT: 用户禁止重启服务，仅核验当前行为与源码语义');
  });

  // TC-012 前端去重源码核验
  await runCase(meta('TC-TASK-012', '前端任务去重与续接源码核验', 'P2', 'unit'), async (cs) => {
    const src = readRel('frontweb/src/stores/generationTaskStore.js');
    const lines = src.split('\n');
    const findLine = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
    const l1 = findLine('function taskKey');
    const l2 = findLine('pollPromises.value.has(taskId)');
    const l3 = findLine('function attachPollIfNeeded') || findLine('attachPollIfNeeded');
    cs.log(`taskKey@L${l1} pollPromises去重@L${l2} attachPollIfNeeded@L${l3}`);
    cs.expect('taskKey 按 drama/episode/resource 合成键', l1 > 0 && src.includes('dramaId') && src.includes('resourceType'), `L${l1}`);
    cs.expect('同 taskId 轮询复用已有 promise', l2 > 0, `L${l2}`);
    cs.expect('断线重连 attachPollIfNeeded', l3 > 0, `L${l3}`);
    cs.evidence.push(`SOURCE: frontweb/src/stores/generationTaskStore.js taskKey@${l1} pollTask-dedup@${l2} attachPollIfNeeded@${l3}`);
  });

  // TC-013 缺 premise 后台失败
  await runCase(meta('TC-TASK-013', '缺 premise：任务创建成功但后台失败落库', 'P1'), async (cs) => {
    const s = await api.be('/api/v1/generation/story', { drama_id: String(state.dramaId) }, { method: 'POST' });
    cs.log('POST(无premise) ->', s.status, 'task_id=', s.json?.data?.task_id);
    cs.eq('start status', s.status, 200);
    const taskId = s.json?.data?.task_id;
    cs.expect('返回 task_id（入口未校验）', !!taskId);
    const fin = await waitForTerminal(cs, taskId, 30000, 1000);
    cs.log('终态 status=', fin?.status, 'error=', fin?.error);
    cs.eq('终态 failed', fin?.status, 'failed');
    cs.expect('error=请提供故事梗概', (fin?.error || '').includes('故事梗概'), fin?.error);
  });

  console.log('\nTASK done. dramaId=', state.dramaId);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

// ---- automation.test_id registry (generated from qa/cases/*.yml) ----
// TC-TASK-001: TASK_001_get_not_found
// TC-TASK-002: TASK_002_list_missing_param
// TC-TASK-003: TASK_003_story_task_lifecycle
// TC-TASK-004: TASK_004_task_contract
// TC-TASK-005: TASK_005_list_by_resource
// TC-TASK-006: TASK_006_inflight_dedup
// TC-TASK-007: TASK_007_cancel_terminal_idempotent
// TC-TASK-008: TASK_008_cancel_not_found
// TC-TASK-009: TASK_009_cancel_active_race
// TC-TASK-010: TASK_010_story_missing_drama
// TC-TASK-011: TASK_011_restart_recovery_semantics
// TC-TASK-012: TASK_012_frontend_dedup_source
// TC-TASK-013: TASK_013_story_missing_premise
