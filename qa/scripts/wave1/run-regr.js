// 已知已修 P1 不回归核验（TC-SCRIPT-901 / TC-ASSET-902 / TC-PROJ-903）
const { api, runCase } = require('./lib');

const meta = (id, title, module, priority) => ({ id, title, module, level: 'system', priority });

(async () => {
  // 找 QA-L3 项目（run-task.js 创建）
  const projs = await api.be('/api/v2/projects');
  const items = projs.json?.data?.items || [];
  const qaProj = items.find((p) => String(p.title).startsWith('QA-L3-'));
  const projId = qaProj?.id || 10;
  console.log('QA-L3 项目:', qaProj ? `id=${qaProj.id} title=${qaProj.title}` : `(未找到，回退用项目 10)`);

  // TC-SCRIPT-901（QA-002）
  await runCase(meta('TC-SCRIPT-901', 'QA-002 不回归：draft=null 时 script 接口返回 approved 正文', 'SCRIPT', 'P1'), async (cs) => {
    const r = await api.be('/api/v2/episodes/13/script');
    const d = r.json?.data;
    cs.log('GET /api/v2/episodes/13/script ->', r.status, 'keys=', d ? Object.keys(d).join(',') : r.text.slice(0, 120));
    cs.eq('status', r.status, 200);
    cs.eq('draft 为空', d?.draft ?? null, null);
    const len = (d?.approved?.content || '').length;
    cs.log('approved.content len =', len, '| 开头:', (d?.approved?.content || '').slice(0, 24));
    cs.expect('approved 正文非空(305 字)', len === 305, `len=${len}`);
    cs.expect('canConfirm 字段存在', 'canConfirm' in (d || {}));
    cs.evidence.push('API 契约支撑前端修复（无草稿时返回已确认正文），UI 展示由主会话 E2E 复核');
  });

  // TC-ASSET-902（QA-003）
  await runCase(meta('TC-ASSET-902', 'QA-003 不回归：项目素材 API 返回已有数据', 'ASSET', 'P1'), async (cs) => {
    const r = await api.be('/api/v2/projects/10/assets');
    const d = r.json?.data;
    cs.log('GET /api/v2/projects/10/assets ->', r.status, 'total=', d?.total, 'items=', (d?.items || []).map((i) => i.name).join(','));
    cs.eq('status', r.status, 200);
    cs.expect('items 非空', (d?.items || []).length >= 1, `total=${d?.total}`);
    cs.expect('含 林夏 角色素材', (d?.items || []).some((i) => i.name === '林夏'));
  });

  // TC-PROJ-903（QA-004）
  await runCase(meta('TC-PROJ-903', 'QA-004 不回归：归档列表 API 真实返回已删除剧集', 'PROJ', 'P1'), async (cs) => {
    const ce = await api.be(`/api/v2/projects/${projId}/episodes`, { title: 'QA-L3-回收站剧集', episode_number: 99 }, { method: 'POST' });
    cs.log('创建测试剧集 ->', ce.status, 'id=', ce.json?.data?.id, JSON.stringify(ce.json).slice(0, 160));
    cs.expect('创建成功', ce.status === 201 || ce.status === 200, `status=${ce.status}`);
    const eid = ce.json?.data?.id;
    if (!eid) { cs.failed.push('未获得剧集 id'); return; }
    const de = await api.be(`/api/v2/episodes/${eid}`, undefined, { method: 'DELETE' });
    cs.log('软删 ->', de.status, JSON.stringify(de.json).slice(0, 120));
    cs.eq('删除 status', de.status, 200);
    const ar = await api.be(`/api/v2/projects/${projId}/episodes?status=archived`);
    const list = ar.json?.data?.items || [];
    cs.log('archived ->', ar.status, 'count=', list.length, 'ids=', list.slice(0, 5).map((i) => i.id).join(','));
    cs.eq('archived status', ar.status, 200);
    cs.expect('包含刚删除的剧集', list.some((i) => i.id === eid), `eid=${eid}`);
    const hit = list.find((i) => i.id === eid) || {};
    cs.expect('item 带 deletedAt', hit.deletedAt !== undefined, JSON.stringify(hit.deletedAt));
  });

  console.log('\nREGR done');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

// ---- automation.test_id registry (generated from qa/cases/*.yml) ----
// TC-ASSET-902: REGR_902_qa003_assets_listed
// TC-PROJ-903: REGR_903_qa004_archived_listed
// TC-SCRIPT-901: REGR_901_qa002_script_approved
