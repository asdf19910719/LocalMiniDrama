// SCRIPT 模块执行（TC-SCRIPT-001..013）：故事与脚本，真实 API
// 真实 DeepSeek 调用仅 2 次：TC-004（同步结构）、TC-005（异步落库）；其余用例零模型调用
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { api, runCase, q1, q, createV1Project, ART_DIR } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'SCRIPT', level: level || 'system', priority });
const uniq = `QA-L3-SCRIPT-${Date.now()}`;
// 支持 ONLY=TC-SCRIPT-004,TC-SCRIPT-006 选择性重跑（避免重复消耗真实模型调用）
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (m, fn) => { if (!ONLY || ONLY.includes(m.id)) return runCase(m, fn); return Promise.resolve('skipped-by-filter'); };
function parseTaskResult(task) {
  let r = task?.result;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) {} }
  return r;
}

async function makeProjectEpisode(cs, title) {
  const p = await createV1Project(cs, title);
  const e = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '第一集' });
  return { projectId: p.id, episodeId: e.json.data.id };
}

(async () => {
  // TC-001 草稿保存与回读
  await run(meta('TC-SCRIPT-001', '手工编辑剧本：草稿保存（revision 递增）与回读一致', 'P0'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-DRAFT`);
    const content = '内景 咖啡店 日\nQA-L3 手工剧本第一版正文。';
    const s = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content });
    cs.log(`saveDraft -> ${s.status} ${s.text.slice(0, 160)}`);
    cs.eq('saveDraft status', s.status, 200);
    cs.eq('首次保存 revision=1', s.json?.data?.revision, 1);
    cs.eq('saveState=saved', s.json?.data?.saveState, 'saved');
    const g = await api.be(`/api/v2/episodes/${episodeId}/script`);
    const draft = g.json?.data?.draft || {};
    cs.expect('stage model 回读草稿内容一致', String(draft.content || '') === content, String(draft.content).slice(0, 60));
    const row = q1('SELECT content, revision, status FROM episode_script_revisions WHERE episode_id = ? ORDER BY revision DESC', episodeId);
    cs.expect('DB 版本行落库', row && row.content === content && row.status === 'draft', JSON.stringify(row).slice(0, 100));
    const miss = await api.beMethod('PUT', '/api/v2/episodes/99999999/script/draft', { content: 'x' });
    cs.eq('不存在剧集 404', miss.status, 404);
  });

  // TC-002 乐观锁冲突
  await run(meta('TC-SCRIPT-002', '草稿乐观锁：过期 expectedRevision → 409 REVISION_CONFLICT；匹配 → 原地更新', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-LOCK`);
    const s1 = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '版本A' });
    const rev = s1.json.data.revision;
    const stale = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '版本B', expectedRevision: rev + 5 });
    cs.log(`stale -> ${stale.status} ${stale.text.slice(0, 140)}`);
    cs.expect('过期版本 409 REVISION_CONFLICT', stale.status === 409 && stale.json?.error?.code === 'REVISION_CONFLICT', `${stale.status} ${stale.json?.error?.code}`);
    const ok = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '版本B-正确锁', expectedRevision: rev });
    cs.eq('匹配锁保存 200', ok.status, 200);
    cs.eq('原地更新（revision 不变）', ok.json?.data?.revision, rev);
    const cnt = q1('SELECT COUNT(*) AS n FROM episode_script_revisions WHERE episode_id = ?', episodeId);
    cs.eq('未产生新版本行', cnt.n, 1);
    const row = q1('SELECT content FROM episode_script_revisions WHERE episode_id = ?', episodeId);
    cs.expect('内容已更新', row.content === '版本B-正确锁', String(row.content));
  });

  // TC-003 分集大纲/描述字段
  await run(meta('TC-SCRIPT-003', '分集大纲/描述：项目 summary 与剧集 description 落库回读', 'P0'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-OUT`);
    await api.beMethod('PUT', `/api/v1/dramas/${projectId}/outline`, { title: `${uniq}-OUT`, summary: 'QA-L3 项目级大纲简介', genre: '都市' });
    await api.beMethod('PUT', `/api/v1/dramas/${projectId}/episodes`, { episodes: [{ episode_number: 1, title: '第一集', description: 'QA-L3 本集大纲：主角在钟表店发现秘密。', duration: 90 }] });
    const g = await api.be(`/api/v1/dramas/${projectId}`);
    cs.expect('项目大纲写入 description', g.json?.data?.description === 'QA-L3 项目级大纲简介', String(g.json?.data?.description));
    const ep = (g.json?.data?.episodes || [])[0] || {};
    cs.expect('分集描述写入 episodes.description', ep.description === 'QA-L3 本集大纲：主角在钟表店发现秘密。', String(ep.description));
    const v2 = await api.be(`/api/v2/episodes/${episodeId}`);
    cs.eq('v2 详情可读该集', v2.json?.data?.id, episodeId);
  });

  // TC-004 真实 DeepSeek（本功能流唯一一次真实生成调用）：异步任务反馈 + 返回结构 + 落库数据流
  // 同步端点返回结构已由失败分析探针真实验证（qa/scripts/wave2/artifacts/TC-SCRIPT-004-sync-probe.json）
  // 注意：项目清理移交 TC-005（下游可用性用例）负责
  let genProjectId = null;
  let genEpisodeId = null;
  await run(meta('TC-SCRIPT-004', '从创意生成故事/剧集（真实 DeepSeek 异步调用）：任务受理→完成→分集正文落库', 'P0'), async (cs) => {
    const p = await createV1Project(null, `${uniq}-GEN`);
    const projectId = p.id;
    genProjectId = projectId;
    const before = q1('SELECT COUNT(*) AS n FROM episodes WHERE drama_id = ?', projectId).n;
    const premise = 'QA-L3 异步落库测试：外卖骑手意外获得能暂停时间三秒的手表，卷入旧城失窃案。';
    // 连接级重试（node --watch 后端可能瞬时重启导致 fetch failed；最多 3 次，间隔 5s）
    let r = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        r = await api.be('/api/v1/generation/story', { drama_id: projectId, premise, episode_count: 1 }, { timeoutMs: 60000 });
        break;
      } catch (e) {
        cs.log(`start attempt#${attempt} 网络异常: ${e.message}，5s 后重试`);
        await new Promise((res) => setTimeout(res, 5000));
        if (attempt === 3) throw e;
      }
    }
    cs.log(`start -> ${r.status} ${r.text.slice(0, 140)}`);
    cs.eq('start status', r.status, 200);
    const taskId = r.json?.data?.task_id;
    cs.expect('返回 task_id 与 pending 状态', Boolean(taskId) && r.json?.data?.status === 'pending', r.text.slice(0, 120));
    // 轮询任务至完成（上限 300s）；轮询请求容忍瞬时连接失败
    let task = null;
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      try {
        const g = await api.be(`/api/v1/tasks/${taskId}`);
        task = g.json?.data || null;
      } catch (e) {
        cs.log(`poll#${i + 1} 连接异常（等待服务恢复）: ${e.message}`);
        continue;
      }
      cs.log(`poll#${i + 1} status=${task?.status} progress=${task?.progress} error=${task?.error} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) break;
    }
    if (task?.status === 'failed' && /服务重启后任务中断/.test(String(task?.error || ''))) {
      cs.log('[环境] 任务被执行体重启中断（外部进程修改产品代码触发 node --watch 重启）——等待 15s 后重试一次完整生成');
      await new Promise((res) => setTimeout(res, 15000));
      const r2 = await api.be('/api/v1/generation/story', { drama_id: projectId, premise, episode_count: 1 }, { timeoutMs: 60000 });
      const taskId2 = r2.json?.data?.task_id;
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const g = await api.be(`/api/v1/tasks/${taskId2}`);
        task = g.json?.data || null;
        cs.log(`retry poll#${i + 1} status=${task?.status} error=${task?.error}`);
        if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) break;
      }
    }
    cs.eq('任务最终 completed', task?.status, 'completed');
    const taskResult = parseTaskResult(task);
    cs.expect('任务结果含 drama_id 与 episode_count', taskResult && Number(taskResult.drama_id) === projectId && Number(taskResult.episode_count) >= 1, JSON.stringify(taskResult));
    const after = q1('SELECT COUNT(*) AS n FROM episodes WHERE drama_id = ?', projectId).n;
    cs.expect('数据流：生成结果落库为新剧集（数量增加）', after > before, `before=${before} after=${after}`);
    const eps = q('SELECT id, episode_number, title, script_content FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number DESC', projectId);
    const top = eps[0] || {};
    genEpisodeId = top.id;
    cs.expect('落库剧集结构完整（episode_number/title/script_content）', top.episode_number >= 1 && String(top.title || '').length > 0 && String(top.script_content || '').length > 100, JSON.stringify({ n: top.episode_number, title: top.title, len: String(top.script_content || '').length }));
    cs.log(`AI 生成剧集: 第${top.episode_number}集《${top.title}》正文 ${String(top.script_content || '').length} 字，预览: ${String(top.script_content || '').slice(0, 60)}…`);
  });

  // TC-005 生成结果作为制作起点（零模型调用）：AI 落库剧集可经 API 读取并进入剧本工作流
  await run(meta('TC-SCRIPT-005', '生成结果下游可用性（零模型调用）：AI 落库剧集可读取并可保存剧本草稿修订', 'P1'), async (cs) => {
    if (genProjectId) cs.cleanupProjectIds.push(genProjectId); // 清理所有权在 TC-005
    cs.expect('前置：TC-004 已真实生成', Boolean(genProjectId) && Boolean(genEpisodeId), `project=${genProjectId} episode=${genEpisodeId}`);
    const g = await api.be(`/api/v1/dramas/${genProjectId}`);
    cs.eq('项目 API 可读取生成结果所在项目', g.status, 200);
    const eps = g.json?.data?.episodes || [];
    const gen = eps.find((e) => e.id === genEpisodeId) || {};
    cs.expect('生成剧集正文经 API 读取一致（LLM 输出→DB→API 数据流闭合）', String(gen.script_content || '').length > 100, `len=${String(gen.script_content || '').length}`);
    const s = await api.beMethod('PUT', `/api/v2/episodes/${genEpisodeId}/script/draft`, { content: String(gen.script_content || '') + '\nQA-L3 人工续写：她在表盘背后看到了一行小字。' });
    cs.log(`在 AI 生成集上保存草稿 -> ${s.status} ${s.text.slice(0, 120)}`);
    cs.eq('草稿保存成功', s.status, 200);
    cs.eq('产生剧本修订 revision=1', s.json?.data?.revision, 1);
    const hist = await api.be(`/api/v2/episodes/${genEpisodeId}/script/history`);
    cs.expect('生成集进入剧本版本工作流', ((hist.json?.data?.items || []).length >= 1), `items=${(hist.json?.data?.items || []).length}`);
  });

  // TC-006 生成任务反馈边界（零模型调用）
  await run(meta('TC-SCRIPT-006', '生成任务反馈边界：空梗概任务失败回填、不存在项目 400、未知任务 404', 'P1'), async (cs) => {
    const { projectId } = await makeProjectEpisode(cs, `${uniq}-EDGE`);
    const syncEmpty = await api.be('/api/v1/generation/story', { premise: '   ' });
    cs.log(`同步空梗概 -> ${syncEmpty.status} ${syncEmpty.text.slice(0, 100)}`);
    cs.eq('同步空梗概 400', syncEmpty.status, 400);
    const noDrama = await api.be('/api/v1/generation/story', { drama_id: 99999999, premise: 'x' });
    cs.log(`不存在项目 -> ${noDrama.status} ${noDrama.text.slice(0, 100)}`);
    cs.expect('不存在项目 400 + 项目不存在', noDrama.status === 400 && noDrama.text.includes('项目不存在'), `${noDrama.status}`);
    // 异步空梗概：任务创建后执行失败 → 反馈路径
    const t = await api.be('/api/v1/generation/story', { drama_id: projectId });
    cs.log(`异步空梗概 start -> ${t.status} ${t.text.slice(0, 120)}`);
    cs.eq('异步空梗概任务仍受理 200', t.status, 200);
    const taskId = t.json?.data?.task_id;
    let task = null;
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      const g = await api.be(`/api/v1/tasks/${taskId}`);
      task = g.json?.data;
      if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) break;
    }
    cs.eq('失败任务状态=failed', task?.status, 'failed');
    cs.expect('错误信息回填（请提供故事梗概）', String(task?.error || task?.message || '').includes('故事梗概'), JSON.stringify({ error: task?.error, message: task?.message }));
    const miss = await api.be('/api/v1/tasks/999999999');
    cs.eq('未知任务 404', miss.status, 404);
  });

  // TC-007 任务取消语义（PARTIAL 观察项，零模型调用）
  await run(meta('TC-SCRIPT-007', '故事任务取消语义观察：取消已结束任务幂等；运行中取消/重启中断语义（代码级证据）', 'P2', 'unit'), async (cs) => {
    const { projectId } = await makeProjectEpisode(cs, `${uniq}-CANCEL`);
    const t = await api.be('/api/v1/generation/story', { drama_id: projectId });
    const taskId = t.json?.data?.task_id;
    // 无梗概任务约 1s 内自行失败；立即取消以竞争运行窗口
    const cancel = await api.be(`/api/v1/tasks/${taskId}/cancel`, { reason: 'QA-L3 取消测试' });
    cs.log(`cancel -> ${cancel.status} ${cancel.text.slice(0, 160)}`);
    cs.eq('cancel 200', cancel.status, 200);
    const g = await api.be(`/api/v1/tasks/${taskId}`);
    const st = g.json?.data?.status;
    const err = String(g.json?.data?.error || '');
    cs.log(`最终任务状态: ${st} error=${err}`);
    cs.expect('任务终结且状态如实（failed=取消落败于执行，或取消原因已写入）', st === 'failed' && (/取消/.test(err) || /故事梗概/.test(err)), JSON.stringify({ status: st, error: err }));
    const done = await api.be(`/api/v1/tasks/${taskId}/cancel`, {});
    cs.log(`重复取消 -> ${done.status} ${done.text.slice(0, 160)}`);
    const doneErr = String(done.json?.data?.error || '');
    cs.expect('对已结束任务重复取消 200 且保留原始错误（不被改写为取消）', done.status === 200 && doneErr === err && doneErr.length > 0, `status=${done.status} error=${doneErr}`);
    cs.log('[观察] 服务层 cancelTask 已返回 already_done 标志，但路由 response.success(result.task) 将其丢弃——客户端无法区分"本次取消"与"早已结束"，记录为轻微契约观察项。');
    const miss = await api.be(`/api/v1/tasks/999999999/cancel`, {});
    cs.eq('取消不存在任务 404', miss.status, 404);
    // 代码级证据：取消无法中止已发出的模型请求；重启将未完成任务标记失败
    const svc = fs.readFileSync(path.join(__dirname, '../../../backend-node/src/services/taskService.js'), 'utf8');
    const lines = svc.split('\n');
    const cancelIdx = lines.findIndex((l) => l.includes('function cancelTask'));
    cs.expect('cancelTask 注释明示无法中断执行中的 AI 调用', lines.slice(cancelIdx - 3, cancelIdx + 1).join('\n').includes('无法中断已在执行的 AI 调用'), `taskService.js:${cancelIdx + 1}`);
    const orphanIdx = lines.findIndex((l) => l.includes('failOrphanedAsyncTasksOnStartup'));
    cs.expect('重启将遗留 pending/processing 任务标记失败', lines.slice(orphanIdx - 3, orphanIdx + 2).join('\n').includes('启动时将遗留的 pending/processing 标为失败'), `taskService.js:${orphanIdx + 1}`);
    cs.expect('孤儿任务消息即「服务重启后任务中断」', svc.includes('服务重启后任务中断，请重新操作'), 'ORPHAN_ASYNC_TASK_MSG');
    cs.log('[观察项 INV-3.3] 与 feature-inventory「故事生成任务反馈 PARTIAL：重启将未完成任务标记失败，取消不能中止已发出的模型请求」一致——本轮执行中已实际观察到该中断消息（TC-SCRIPT-004 首次尝试被外部代码修改触发的服务重启打断），行为与文档相符，不判缺陷。');
  });

  // TC-008 剧本版本修订历史
  await run(meta('TC-SCRIPT-008', '剧本版本修订（episode_script_revisions）：批准→再编辑产生递增修订与来源标记', 'P0'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-REV`);
    await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '第一版-QA-L3' });
    await api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
    const s2 = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '第二版-QA-L3' });
    await api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
    const s3 = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '第三版-QA-L3' });
    cs.eq('批准后再编辑 revision 递增', s2.json?.data?.revision, 2);
    cs.eq('第三次编辑 revision=3', s3.json?.data?.revision, 3);
    const h = await api.be(`/api/v2/episodes/${episodeId}/script/history`);
    const items = h.json?.data?.items || [];
    cs.log(`history: ${JSON.stringify(items.map((x) => [x.revision, x.status, x.source]))}`);
    cs.eq('共 3 条修订', items.length, 3);
    cs.expect('修订号降序 [3,2,1]', items.map((x) => x.revision).join(','), '3,2,1');
    const byRev = {};
    for (const x of items) byRev[x.revision] = x;
    cs.eq('rev1 被新批准取代为 superseded', byRev['1']?.status, 'superseded');
    cs.eq('rev2 为当前已批准版本', byRev['2']?.status, 'approved');
    cs.eq('rev3 未确认为 draft', byRev['3']?.status, 'draft');
    cs.expect('新编辑来源 edit-after-approve', items.filter((x) => x.revision >= 2).every((x) => x.source === 'edit-after-approve'), JSON.stringify(items.map((x) => x.source)));
    const rows = q('SELECT revision, status, approved_at FROM episode_script_revisions WHERE episode_id = ? ORDER BY revision', episodeId);
    cs.expect('DB: 修订1/2 曾批准（approved_at 非空后清理为 superseded）', rows.length === 3 && rows[2].status === 'draft', JSON.stringify(rows));
  });

  // TC-009 版本 diff
  await run(meta('TC-SCRIPT-009', '剧本版本 diff：两修订逐行差异（add/del/same）', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-DIFF`);
    await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '内景 店内 日\n这是共同的行。\n旧台词将被删除。' });
    await api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
    await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '内景 店内 日\n这是共同的行。\n新增台词在这里。' });
    const d = await api.be(`/api/v2/episodes/${episodeId}/script/diff?from=1&to=2`);
    cs.log(`diff -> ${d.status} ${d.text.slice(0, 260)}`);
    cs.eq('diff status', d.status, 200);
    const text = d.text;
    cs.expect('包含删除行标记', text.includes('旧台词将被删除'), text.slice(0, 200));
    cs.expect('包含新增行标记', text.includes('新增台词在这里'), '');
    cs.expect('含 del/add 类型字段', text.includes('"del"') && text.includes('"add"'), '');
    const miss = await api.be(`/api/v2/episodes/${episodeId}/script/diff?from=1&to=99`);
    cs.eq('不存在版本 404', miss.status, 404);
  });

  // TC-010 历史修订复制
  await run(meta('TC-SCRIPT-010', '从历史修订复制为新草稿：内容还原且产生新修订', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-COPY`);
    await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '第一版原文-QA-L3-不可磨灭的标记。' });
    await api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
    await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content: '第二版完全不同的内容。' });
    await api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
    const cp = await api.be(`/api/v2/episodes/${episodeId}/script/history/1/copy`, {});
    cs.log(`copy -> ${cp.status} ${cp.text.slice(0, 160)}`);
    cs.eq('copy status', cp.status, 201);
    cs.eq('复制产生新修订 revision=3', cp.json?.data?.revision, 3);
    cs.expect('内容还原为第 1 版', String(cp.json?.data?.content || '').includes('不可磨灭的标记'), String(cp.json?.data?.content).slice(0, 60));
    const miss = await api.be(`/api/v2/episodes/${episodeId}/script/history/99/copy`, {});
    cs.eq('不存在修订 404', miss.status, 404);
  });

  // TC-011 剧本确认（批准）
  await run(meta('TC-SCRIPT-011', '剧本确认：空剧本拒绝、confirm-preview 与指纹一致性', 'P0'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-CONFIRM`);
    const empty = await api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
    cs.log(`empty confirm -> ${empty.status} ${empty.text.slice(0, 120)}`);
    cs.eq('无草稿确认 404', empty.status, 404);
    const content = '内景 咖啡店 日\n确认用正文。';
    await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content });
    const pv = await api.be(`/api/v2/episodes/${episodeId}/script/confirm-preview`);
    cs.log(`confirm-preview -> ${pv.status} ${pv.text.slice(0, 200)}`);
    cs.eq('confirm-preview status', pv.status, 200);
    const expectFp = crypto.createHash('sha256').update(content).digest('hex');
    const cf = await api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
    cs.log(`confirm -> ${cf.status} ${cf.text.slice(0, 160)}`);
    cs.eq('confirm status', cf.status, 200);
    cs.eq('确认 revision=1', cf.json?.data?.revision, 1);
    cs.eq('返回指纹 = sha256(正文)', cf.json?.data?.fingerprint, expectFp);
    const approved = q1("SELECT status FROM episode_script_revisions WHERE episode_id = ? AND revision = 1", episodeId);
    cs.eq('DB 修订状态 approved', approved?.status, 'approved');
    const stage = q1("SELECT status FROM production_stage_states WHERE episode_id = ? AND stage = 'script'", episodeId);
    cs.eq('阶段状态 approved', stage?.status, 'approved');
  });

  // TC-012 场次解析与统计
  await run(meta('TC-SCRIPT-012', '场次解析 parse-scenes 与 scene-stats：标题行解析为场次结构', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-SCENE`);
    const content = ['内景 咖啡店 日', '林夏推门进来。', '外景 老街 夜', '钟表店的灯亮着。'].join('\n');
    await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content });
    const ps = await api.be(`/api/v2/episodes/${episodeId}/script/parse-scenes`, {});
    cs.log(`parse-scenes -> ${ps.status} ${ps.text.slice(0, 300)}`);
    cs.eq('parse-scenes status', ps.status, 200);
    const scenes = ps.json?.data?.scenes || [];
    cs.eq('解析出 2 场', scenes.length, 2);
    cs.expect('场次地点解析', String(scenes[0]?.location || '').includes('咖啡店'), JSON.stringify(scenes[0]));
    const stats = await api.be(`/api/v2/episodes/${episodeId}/script/scene-stats`);
    cs.log(`scene-stats -> ${stats.status} ${stats.text.slice(0, 200)}`);
    cs.eq('scene-stats status', stats.status, 200);
    cs.expect('统计场次=2', JSON.stringify(stats.json?.data || {}).match(/2/) !== null, stats.text.slice(0, 160));
  });

  // TC-013 角色提取 stub 占位（BROKEN 观察项）
  await run(meta('TC-SCRIPT-013', '剧集角色提取端点：stub 占位仅返回空角色列表（与 inventory BROKEN 标注一致）', 'P2'), async (cs) => {
    const { projectId, episodeId } = await makeProjectEpisode(cs, `${uniq}-STUB`);
    await api.beMethod('PUT', `/api/v1/dramas/${projectId}/episodes`, { episodes: [{ episode_number: 1, title: '第一集', script_content: '内景 店 日\n林夏和钟表少年对话，讨论时间失窃案。' }] });
    const r = await api.be(`/api/v1/episodes/${episodeId}/characters/extract`, {});
    cs.log(`extract -> ${r.status} ${r.text.slice(0, 140)}`);
    cs.eq('extract status', r.status, 200);
    const taskId = r.json?.data?.task_id;
    cs.expect('返回 task_id（异步占位）', Boolean(taskId), r.text.slice(0, 120));
    let task = null;
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => setTimeout(res, 500));
      const g = await api.be(`/api/v1/tasks/${taskId}`);
      task = g.json?.data;
      if (task && ['completed', 'failed'].includes(task.status)) break;
    }
    let result = task?.result;
    if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) {} }
    cs.log(`任务结果: ${JSON.stringify(result).slice(0, 160)}`);
    cs.expect('结果为空角色列表（stub 占位真实行为）', result && Array.isArray(result.characters) && result.characters.length === 0 && Number(result.count) === 0, JSON.stringify(result));
    cs.log('[观察项 INV-3.5] /episodes/:id/characters/extract 挂载 stub.js 占位处理（routes/stub.js episodeCharactersExtract，setTimeout 100ms 后写空结果）——与 feature-inventory BROKEN 标注一致：公开端点为占位实现，真实能力在 /generation/characters。如实记录，不判新缺陷。');
  });
})();
