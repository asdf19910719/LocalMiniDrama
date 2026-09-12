// PROJ 模块执行（TC-PROJ-001..017）：项目与剧集，真实 API
const fs = require('fs');
const path = require('path');
const { api, runCase, q1, q, createV1Project, defaultStyleId, ART_DIR } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'PROJ', level: level || 'system', priority });
const uniq = `QA-L3-PROJ-${Date.now()}`;

(async () => {
  // TC-001 项目列表/分页/关键字过滤
  await runCase(meta('TC-PROJ-001', '项目列表：分页、关键字过滤与 v2 卡片列表', 'P0'), async (cs) => {
    const a = await createV1Project(cs, `${uniq}-001-A`);
    const b = await createV1Project(cs, `${uniq}-001-B`);
    const kw = await api.be(`/api/v1/dramas?page=1&page_size=50&keyword=${encodeURIComponent(`${uniq}-001`)}`);
    cs.log(`keyword 搜索 -> ${kw.status} total=${kw.json?.data?.pagination?.total}`);
    cs.eq('keyword 搜索 status', kw.status, 200);
    const titles = (kw.json?.data?.items || []).map((d) => d.title);
    cs.expect('含项目 A', titles.includes(`${uniq}-001-A`), JSON.stringify(titles));
    cs.expect('含项目 B', titles.includes(`${uniq}-001-B`), JSON.stringify(titles));
    const p1 = await api.be(`/api/v1/dramas?page=1&page_size=1&keyword=${encodeURIComponent(`${uniq}-001`)}`);
    cs.eq('分页 page1 status', p1.status, 200);
    cs.eq('page_size=1 返回 1 条', (p1.json?.data?.items || []).length, 1);
    cs.eq('pagination.total == 2', p1.json?.data?.pagination?.total, 2);
    const p9 = await api.be(`/api/v1/dramas?page=99&page_size=10&keyword=${encodeURIComponent(`${uniq}-001`)}`);
    cs.eq('超范围页 items 空', (p9.json?.data?.items || []).length, 0);
    const v2 = await api.be(`/api/v2/projects?q=${encodeURIComponent(`${uniq}-001`)}`);
    cs.log(`v2 列表 -> ${v2.status} total=${v2.json?.data?.total}`);
    cs.eq('v2 列表 status', v2.status, 200);
    cs.eq('v2 命中 2 条', v2.json?.data?.total, 2);
    const v2t = await api.be(`/api/v2/projects?q=${encodeURIComponent(`${uniq}-001`)}&sort=title`);
    cs.expect('v2 sort=title 可用且条数一致', v2t.json?.data?.total === 2, `total=${v2t.json?.data?.total}`);
    const arch = await api.be(`/api/v2/projects?status=archived`);
    const archIds = (arch.json?.data?.items || []).map((c) => c.id);
    cs.expect('活跃项目不出现在 archived 列表', !archIds.includes(a.id) && !archIds.includes(b.id));
  });

  // TC-002 项目统计
  await runCase(meta('TC-PROJ-002', '项目统计接口：total 与 by_status 真实计数', 'P0'), async (cs) => {
    const s0 = await api.be('/api/v1/dramas/stats');
    cs.eq('stats status', s0.status, 200);
    const before = s0.json?.data?.total;
    const p = await createV1Project(cs, `${uniq}-002`);
    const s1 = await api.be('/api/v1/dramas/stats');
    cs.eq('新建后 total +1', s1.json?.data?.total, before + 1);
    const draftRow = (s1.json?.data?.by_status || []).find((r) => r.status === 'draft');
    cs.expect('by_status 含 draft 计数', draftRow && draftRow.count >= 1, JSON.stringify(s1.json?.data?.by_status));
    const v2 = await api.be(`/api/v2/projects/${p.id}/overview`);
    cs.eq('v2 overview status', v2.status, 200);
    cs.eq('overview.hero.episodeCount', v2.json?.data?.hero?.episodeCount, 0);
    cs.log('overview hero:', JSON.stringify(v2.json?.data?.hero));
  });

  // TC-003 新建项目全字段回读
  await runCase(meta('TC-PROJ-003', '新建项目全字段（标题/简介/题材/风格/画幅/目标时长 metadata）创建与回读', 'P0'), async (cs) => {
    const styleId = await defaultStyleId();
    const r = await api.be('/api/v1/dramas', {
      title: `${uniq}-003`,
      description: 'QA-L3 全字段项目简介',
      genre: '都市',
      style_id: styleId,
      metadata: { aspect_ratio: '9:16', target_duration_seconds: 120, folder_label: 'QA-L3 文件夹A' },
    });
    cs.log(`create -> ${r.status} id=${r.json?.data?.id}`);
    cs.eq('create status', r.status, 201);
    const id = r.json.data.id;
    cs.cleanupProjectIds.push(id);
    const g = await api.be(`/api/v1/dramas/${id}`);
    const d = g.json?.data || {};
    cs.eq('回读 title', d.title, `${uniq}-003`);
    cs.eq('回读 description', d.description, 'QA-L3 全字段项目简介');
    cs.eq('回读 genre', d.genre, '都市');
    cs.eq('回读 style_id', d.style_id, styleId);
    cs.eq('回读 status=draft', d.status, 'draft');
    const meta = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : d.metadata || {};
    cs.eq('metadata.aspect_ratio', meta.aspect_ratio, '9:16');
    cs.eq('metadata.target_duration_seconds', meta.target_duration_seconds, 120);
    cs.eq('metadata.folder_label', meta.folder_label, 'QA-L3 文件夹A');
    const row = q1('SELECT metadata FROM dramas WHERE id = ?', id);
    cs.expect('DB metadata JSON 落库', row && row.metadata.includes('aspect_ratio'), String(row?.metadata).slice(0, 120));
  });

  // TC-004 新建项目参数校验
  await runCase(meta('TC-PROJ-004', '新建项目参数校验：缺标题/缺风格/非法风格/旧 style 字段拒绝', 'P1'), async (cs) => {
    const noTitle = await api.be('/api/v1/dramas', { style_id: await defaultStyleId() });
    cs.log(`缺标题 -> ${noTitle.status} ${noTitle.text.slice(0, 90)}`);
    cs.eq('缺标题 400', noTitle.status, 400);
    const noStyle = await api.be('/api/v1/dramas', { title: `${uniq}-004-nostyle` });
    cs.expect('缺 style_id 400 + PROJECT_STYLE_REQUIRED', noStyle.status === 400 && noStyle.json?.error?.code === 'PROJECT_STYLE_REQUIRED', `${noStyle.status} ${noStyle.json?.error?.code}`);
    const badStyle = await api.be('/api/v1/dramas', { title: `${uniq}-004-badstyle`, style_id: 'qa-l3-not-exist-style' });
    cs.eq('非法 style_id 400', badStyle.status, 400);
    const legacy = await api.be('/api/v1/dramas', { title: `${uniq}-004-legacy`, style: 'some-style' });
    cs.expect('旧 style 字段 400 + PROJECT_STYLE_OVERRIDE_FORBIDDEN', legacy.status === 400 && legacy.json?.error?.code === 'PROJECT_STYLE_OVERRIDE_FORBIDDEN', `${legacy.status} ${legacy.json?.error?.code}`);
    const v2empty = await api.be('/api/v2/projects', { title: '' });
    cs.eq('v2 空标题 400', v2empty.status, 400);
    const v2dur = await api.be('/api/v2/projects', { title: `${uniq}-004-dur`, video_duration_seconds: 60 });
    cs.expect('v2 时长偏好字段 400（已删除字段）', v2dur.status === 400, `${v2dur.status} ${v2dur.text.slice(0, 90)}`);
    const orphanEp = await api.be('/api/v2/projects/99999999/episodes', { title: 'x' });
    cs.eq('不存在项目建剧集 404', orphanEp.status, 404);
  });

  // TC-005 编辑项目属性
  await runCase(meta('TC-PROJ-005', '编辑项目属性：v1 PUT 与 v2 PATCH 回读一致', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-005`);
    const u = await api.beMethod('PUT', `/api/v1/dramas/${p.id}`, { title: `${uniq}-005-改`, description: '改后简介', genre: '悬疑', status: 'producing' });
    cs.log(`PUT -> ${u.status}`);
    cs.eq('PUT status', u.status, 200);
    cs.eq('PUT 返回新标题', u.json?.data?.title, `${uniq}-005-改`);
    const g = await api.be(`/api/v1/dramas/${p.id}`);
    cs.eq('回读 status=producing', g.json?.data?.status, 'producing');
    cs.eq('回读 genre=悬疑', g.json?.data?.genre, '悬疑');
    const pv = await api.beMethod('PATCH', `/api/v2/projects/${p.id}`, { title: `${uniq}-005-v2改`, aspectRatio: '16:9', description: 'v2 描述' });
    cs.eq('v2 PATCH status', pv.status, 200);
    cs.eq('v2 PATCH 后 hero.title', pv.json?.data?.hero?.title, `${uniq}-005-v2改`);
    cs.eq('v2 PATCH 后 hero.aspectRatio', pv.json?.data?.hero?.aspectRatio, '16:9');
    const miss = await api.beMethod('PATCH', '/api/v2/projects/99999999', { title: 'x' });
    cs.eq('v2 PATCH 不存在项目 404', miss.status, 404);
  });

  // TC-006 大纲保存与 metadata 合并语义（PARTIAL 观察点）
  await runCase(meta('TC-PROJ-006', '大纲保存：tags JSON 落库 + metadata 合并不覆盖（标签/文件夹语义 PARTIAL 观察）', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-006`, {
      metadata: { aspect_ratio: '9:16', folder_label: 'QA-L3 文件夹B' },
    });
    const o = await api.beMethod('PUT', `/api/v1/dramas/${p.id}/outline`, {
      title: `${uniq}-006`,
      summary: '大纲简介-新',
      genre: '奇幻',
      tags: ['QA-L3-标签1', '标签2'],
      metadata: { canvas_layout: { nodes: [] } },
    });
    cs.log(`outline -> ${o.status} ${o.text.slice(0, 80)}`);
    cs.eq('outline status', o.status, 200);
    const g = await api.be(`/api/v1/dramas/${p.id}`);
    const d = g.json?.data || {};
    const meta = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : d.metadata || {};
    cs.expect('summary 写入 description', d.description === '大纲简介-新', String(d.description));
    const tags = Array.isArray(d.tags) ? d.tags : (() => { try { return JSON.parse(d.tags || '[]'); } catch { return []; } })();
    cs.expect('tags 含 QA-L3-标签1', tags.includes('QA-L3-标签1'), JSON.stringify(tags));
    cs.eq('metadata 保留 aspect_ratio（合并不覆盖）', meta.aspect_ratio, '9:16');
    cs.eq('metadata 保留 folder_label', meta.folder_label, 'QA-L3 文件夹B');
    cs.expect('metadata 合入 canvas_layout', 'canvas_layout' in meta, JSON.stringify(Object.keys(meta)));
    const row = q1('SELECT tags, metadata FROM dramas WHERE id = ?', p.id);
    cs.expect('DB tags JSON 列落库', String(row?.tags || '').includes('QA-L3-标签1'), String(row?.tags).slice(0, 80));
    cs.log(`[观察项 INV-2.13] 标签/文件夹语义存于 dramas.tags(JSON 字符串) 与 dramas.metadata(JSON)：无独立结构与一致约束，与 feature-inventory PARTIAL 描述一致`);
  });

  // TC-007 v2 项目概览
  await runCase(meta('TC-PROJ-007', 'v2 项目概览聚合（hero/style/素材聚合/阶段汇总）与 404', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-007`);
    await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '第一集' });
    const ov = await api.be(`/api/v2/projects/${p.id}/overview`);
    cs.eq('overview status', ov.status, 200);
    const d = ov.json?.data || {};
    cs.eq('hero.title', d.hero?.title, `${uniq}-007`);
    cs.eq('hero.episodeCount', d.hero?.episodeCount, 1);
    cs.expect('style.styleId 非空', Boolean(d.style?.styleId), JSON.stringify(d.style));
    cs.expect('style.appliesTo=future-generations-only', d.style?.appliesTo === 'future-generations-only', d.style?.appliesTo);
    cs.expect('assetsAggregate.objectCount 数字', typeof d.assetsAggregate?.objectCount === 'number', JSON.stringify(d.assetsAggregate));
    cs.expect('stageSummary 含 4 阶段', ['script', 'assets', 'storyboard', 'cut'].every((k) => d.stageSummary?.[k]), JSON.stringify(Object.keys(d.stageSummary || {})));
    const miss = await api.be('/api/v2/projects/99999999/overview');
    cs.eq('不存在项目 404', miss.status, 404);
  });

  // TC-008 剧集新建与列表
  await runCase(meta('TC-PROJ-008', '剧集新建（自动集号）与列表回读', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-008`);
    const e1 = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '开局' });
    cs.log(`e1 -> ${e1.status} ${e1.text.slice(0, 100)}`);
    cs.eq('e1 status', e1.status, 201);
    cs.eq('e1 episodeNumber=1', e1.json?.data?.episodeNumber, 1);
    const e2 = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '反转' });
    cs.eq('e2 status', e2.status, 201);
    cs.eq('e2 episodeNumber=2（自动递增）', e2.json?.data?.episodeNumber, 2);
    const dup = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: 'x', episodeNumber: 1 });
    cs.expect('集号冲突 409 EPISODE_NUMBER_CONFLICT', dup.status === 409 && dup.json?.error?.code === 'EPISODE_NUMBER_CONFLICT', `${dup.status} ${dup.json?.error?.code}`);
    const list = await api.be(`/api/v2/projects/${p.id}/episodes`);
    cs.eq('list status', list.status, 200);
    const items = list.json?.data?.items || list.json?.data || [];
    const arr = Array.isArray(items) ? items : items.items || [];
    cs.eq('列表数量 2', arr.length, 2);
    cs.expect('列表含标题', arr.map((x) => x.title).includes('反转'), JSON.stringify(arr.map((x) => x.title)));
    const blankList = await api.be(`/api/v2/projects/${p.id}/episodes/blank`);
    cs.log(`blank 列表 -> ${blankList.status} ${blankList.text.slice(0, 100)}`);
    cs.eq('blank 列表 status', blankList.status, 200);
  });

  // TC-009 剧集编辑与详情
  await runCase(meta('TC-PROJ-009', '剧集编辑（v2 标题/目标时长 + v1 批量更新梗概）与详情回读', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-009`);
    const e = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '旧标题' });
    const eid = e.json.data.id;
    const up = await api.beMethod('PATCH', `/api/v2/episodes/${eid}`, { title: '新标题-QA', targetDuration: 95 });
    cs.log(`PATCH -> ${up.status} ${up.text.slice(0, 140)}`);
    cs.eq('PATCH status', up.status, 200);
    const g = await api.be(`/api/v2/episodes/${eid}`);
    const d = g.json?.data || {};
    cs.eq('回读 title', d.title, '新标题-QA');
    cs.eq('回读 targetDuration=95', d.targetDuration, 95);
    const bad = await api.beMethod('PATCH', `/api/v2/episodes/${eid}`, { title: '' });
    cs.eq('v2 空标题 400', bad.status, 400);
    // 梗概走 v1 批量保存（saveEpisodes upsert）
    await api.beMethod('PUT', `/api/v1/dramas/${p.id}/episodes`, { episodes: [{ episode_number: 1, title: '新标题-QA', description: '本集梗概-QA', duration: 95 }] });
    const g1 = await api.be(`/api/v1/dramas/${p.id}`);
    const ep1 = (g1.json?.data?.episodes || [])[0] || {};
    cs.expect('v1 回读 description', ep1.description === '本集梗概-QA', String(ep1.description));
    cs.expect('v1 回读 duration=95', Number(ep1.duration) === 95, String(ep1.duration));
    const miss = await api.beMethod('PATCH', '/api/v2/episodes/99999999', { title: 'x' });
    cs.eq('不存在剧集 PATCH 404', miss.status, 404);
  });

  // TC-010 剧集软删与恢复
  await runCase(meta('TC-PROJ-010', '剧集软删（回收站）与恢复、归档列表可见', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-010`);
    const e = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '待删除集' });
    const eid = e.json.data.id;
    const del = await api.beMethod('DELETE', `/api/v2/episodes/${eid}`);
    cs.log(`delete -> ${del.status} ${del.text.slice(0, 140)}`);
    cs.eq('delete status', del.status, 200);
    cs.eq('deleted=true', del.json?.data?.deleted, true);
    const list = await api.be(`/api/v2/projects/${p.id}/episodes`);
    const live = (list.json?.data?.items || list.json?.data || []);
    cs.expect('活跃列表不含已删集', !(Array.isArray(live) ? live : []).some((x) => x.id === eid));
    const arch = await api.be(`/api/v2/projects/${p.id}/episodes?status=archived`);
    const archArr = Array.isArray(arch.json?.data) ? arch.json.data : arch.json?.data?.items || [];
    cs.expect('归档列表含已删集', archArr.some((x) => x.id === eid), JSON.stringify(archArr.map((x) => x.id)));
    const res = await api.be(`/api/v2/episodes/${eid}/restore`, {});
    cs.eq('restore status', res.status, 200);
    const list2 = await api.be(`/api/v2/projects/${p.id}/episodes`);
    const live2 = Array.isArray(list2.json?.data) ? list2.json.data : list2.json?.data?.items || [];
    cs.expect('恢复后回到活跃列表', live2.some((x) => x.id === eid));
  });

  // TC-011 剧集删除影响查询
  await runCase(meta('TC-PROJ-011', '剧集删除影响查询 delete-impact 返回级联计数', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-011`);
    const e = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '影响查询集' });
    const eid = e.json.data.id;
    const imp = await api.be(`/api/v2/episodes/${eid}/delete-impact`);
    cs.log(`delete-impact -> ${imp.status} ${imp.text.slice(0, 160)}`);
    cs.eq('delete-impact status', imp.status, 200);
    cs.expect('返回 impacts 结构', imp.json?.data && typeof imp.json.data === 'object' && ('impacts' in (imp.json.data || {}) || 'scriptRevisions' in (imp.json.data || {})), imp.text.slice(0, 120));
    const miss = await api.be('/api/v2/episodes/99999999/delete-impact');
    cs.eq('不存在剧集 404', miss.status, 404);
  });

  // TC-012 批量脚本导入
  await runCase(meta('TC-PROJ-012', '批量脚本导入：批量建立/更新剧集，未提交集软删', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-012`);
    const b1 = await api.beMethod('PUT', `/api/v1/dramas/${p.id}/episodes`, {
      episodes: [
        { episode_number: 1, title: '第一集', script_content: '内景 咖啡店 日\n第一场对白。', description: '首集', duration: 90 },
        { episode_number: 2, title: '第二集', script_content: '外景 天台 夜\n第二场对白。', description: '次集', duration: 100 },
        { episode_number: 3, title: '第三集', script_content: '内景 实验室 夜' },
      ],
    });
    cs.log(`批量导入3集 -> ${b1.status} ${b1.text.slice(0, 80)}`);
    cs.eq('批量导入 status', b1.status, 200);
    let g = await api.be(`/api/v1/dramas/${p.id}`);
    cs.eq('剧集数=3', (g.json?.data?.episodes || []).length, 3);
    const b2 = await api.beMethod('PUT', `/api/v1/dramas/${p.id}/episodes`, {
      episodes: [
        { episode_number: 1, title: '第一集-修订', script_content: '修订后的剧本内容-QA-L3' },
        { episode_number: 2, title: '第二集' },
      ],
    });
    cs.eq('二次导入 status', b2.status, 200);
    g = await api.be(`/api/v1/dramas/${p.id}`);
    const eps = g.json?.data?.episodes || [];
    cs.eq('未提交的第 3 集被软删（剩 2 集）', eps.length, 2);
    const ep1 = eps.find((x) => x.episode_number === 1);
    cs.expect('第 1 集内容被更新（upsert 保留 id）', (ep1?.script_content || '').includes('修订后的剧本内容'), String(ep1?.script_content).slice(0, 60));
    cs.log(`ep1 id=${ep1?.id} title=${ep1?.title}`);
    const bad = await api.beMethod('PUT', `/api/v1/dramas/${p.id}/episodes`, { episodes: 'not-array' });
    cs.eq('episodes 非数组 400', bad.status, 400);
  });

  // TC-013 剧集草稿复制（复制起点）
  await runCase(meta('TC-PROJ-013', '复制剧集草稿 copy-draft：复制内容作为生产起点', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-013`);
    const src = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '母本集' });
    const srcId = src.json.data.id;
    await api.beMethod('PUT', `/api/v2/episodes/${srcId}/script/draft`, { content: '内景 街道 夜\nQA-L3 复制源剧本正文。', title: '母本集' });
    const cp = await api.be(`/api/v2/episodes/${srcId}/copy-draft`, {});
    cs.log(`copy-draft -> ${cp.status} ${cp.text.slice(0, 140)}`);
    cs.eq('copy status', cp.status, 201);
    const copy = cp.json?.data || {};
    cs.expect('副本 id 不同于源', copy.id !== srcId, `copy=${copy.id} src=${srcId}`);
    cs.expect('副本标题带（草稿副本）', String(copy.title || '').includes('草稿副本'), String(copy.title));
    const epRow = q1('SELECT script_content FROM episodes WHERE id = ?', copy.id);
    cs.expect('副本剧本内容一致（数据流：源→副本，DB 证据）', String(epRow?.script_content || '').includes('QA-L3 复制源剧本正文'), String(epRow?.script_content).slice(0, 60));
    const rev = q1('SELECT content, source FROM episode_script_revisions WHERE episode_id = ? ORDER BY revision DESC', copy.id);
    cs.expect('副本剧本版本落库 source=copy-draft', rev && rev.source === 'copy-draft' && String(rev.content || '').includes('QA-L3 复制源剧本正文'), JSON.stringify(rev).slice(0, 100));
  });

  // TC-014 项目软删与恢复
  await runCase(meta('TC-PROJ-014', '项目软删（回收站）与恢复、归档过滤', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-014`);
    const del = await api.beMethod('DELETE', `/api/v2/projects/${p.id}`);
    cs.log(`delete -> ${del.status} ${del.text.slice(0, 100)}`);
    cs.eq('delete status', del.status, 200);
    cs.expect('deleted=true recoverable=true', del.json?.data?.deleted === true && del.json?.data?.recoverable === true, del.text.slice(0, 80));
    const ov = await api.be(`/api/v2/projects/${p.id}/overview`);
    cs.eq('软删后 overview 404', ov.status, 404);
    const arch = await api.be('/api/v2/projects?status=archived');
    cs.expect('archived 列表含该项目', (arch.json?.data?.items || []).some((c) => c.id === p.id), `items=${(arch.json?.data?.items || []).length}`);
    const res = await api.be(`/api/v2/projects/${p.id}/restore`, {});
    cs.eq('restore status', res.status, 200);
    const ov2 = await api.be(`/api/v2/projects/${p.id}/overview`);
    cs.eq('恢复后 overview 200', ov2.status, 200);
  });

  // TC-015 项目永久删除正常路径
  await runCase(meta('TC-PROJ-015', '项目永久删除：DB 行级联删除 + 存储目录清理 + 二次删除 404', 'P0'), async (cs) => {
    const styleId = await defaultStyleId();
    const r = await api.be('/api/v1/dramas', { title: `${uniq}-015-perm`, style_id: styleId, metadata: { folder_label: 'QA-L3-015' } });
    const id = r.json.data.id; // 永久删除用例：不登记软删清理
    await api.be(`/api/v2/projects/${id}/episodes`, { title: '将被级联删除的集' });
    const before = q1('SELECT COUNT(*) AS n FROM episodes WHERE drama_id = ?', id);
    cs.eq('删除前剧集数', before.n, 1);
    const del = await api.beMethod('DELETE', `/api/v1/dramas/${id}`);
    cs.log(`permanent delete -> ${del.status} ${del.text.slice(0, 220)}`);
    cs.eq('delete status', del.status, 200);
    cs.eq('deleted=true', del.json?.data?.deleted, true);
    const csStatus = del.json?.data?.storage?.cleanup_status;
    cs.expect('storage 清理完成（ok 或 missing=无可清理目录）', csStatus === 'ok' || csStatus === 'missing', JSON.stringify(del.json?.data?.storage));
    cs.expect('storage exists=false（目录已不存在）', del.json?.data?.storage?.exists === false, String(del.json?.data?.storage?.exists));
    const dramaRow = q1('SELECT id FROM dramas WHERE id = ?', id);
    cs.expect('DB dramas 行已删', !dramaRow, `row=${JSON.stringify(dramaRow)}`);
    const epRows = q('SELECT id FROM episodes WHERE drama_id = ?', id);
    cs.eq('DB 级联删除剧集', epRows.length, 0);
    const again = await api.beMethod('DELETE', `/api/v1/dramas/${id}`);
    cs.eq('二次删除 404', again.status, 404);
    fs.writeFileSync(path.join(ART_DIR, 'TC-PROJ-015-delete-result.json'), del.text);
  });

  // TC-016 永久删除部分成功风险（观察项，代码级）
  await runCase(meta('TC-PROJ-016', '永久删除部分成功风险观察：DB 事务成功后文件清理失败无回滚（PARTIAL）', 'P2', 'unit'), async (cs) => {
    const src = fs.readFileSync(path.join(__dirname, '../../../backend-node/src/services/projectDeletionService.js'), 'utf8');
    const lines = src.split('\n');
    const fnIdx = lines.findIndex((l) => l.includes('function deleteProjectPermanently'));
    cs.log(`deleteProjectPermanently 位于 projectDeletionService.js:${fnIdx + 1}`);
    const body = lines.slice(fnIdx, fnIdx + 22).join('\n');
    cs.expect('先执行 DB 事务删除', /db\.transaction\(\(\) => deleteProjectRows/.test(body), 'db.transaction(() => deleteProjectRows...)');
    cs.expect('后执行目录清理 cleanupProjectDirectory', body.includes('cleanupProjectDirectory(preview.storage)'), 'cleanupProjectDirectory');
    cs.expect('清理失败仅记日志（无回滚/补偿）', /cleanup_status === 'failed'[\s\S]*log\?\.error\?/.test(body) || /log\?\.error\?[\s\S]*storage cleanup did not/.test(body), 'log?.error only');
    // 真实正常路径证据：永久删除一个最小项目并检查返回的 storage 对象
    const styleId = await defaultStyleId();
    const r = await api.be('/api/v1/dramas', { title: `${uniq}-016-perm`, style_id: styleId });
    const id = r.json.data.id;
    const del = await api.beMethod('DELETE', `/api/v1/dramas/${id}`);
    cs.eq('正常路径删除 status', del.status, 200);
    cs.log(`正常路径 storage 返回: ${del.text.slice(0, 200)}`);
    const st = del.json?.data?.storage || {};
    cs.expect('正常路径无残留（cleanup ok/missing 且目录不存在）', (st.cleanup_status === 'ok' || st.cleanup_status === 'missing') && st.exists === false, JSON.stringify(st));
    cs.log('[观察项 INV-2.3] 部分成功风险与 feature-inventory「数据库删除成功、文件清理失败时可能形成部分成功」一致：当前实现先删库后清文件，失败仅记日志（projectDeletionService.js deleteProjectPermanently），无补偿事务。按文档口径记录为已知边界，不判缺陷。');
  });

  // TC-017 剧集排序
  await runCase(meta('TC-PROJ-017', '剧集排序 reorder：集号按 order 重排，非法 order 409', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-017`);
    const ids = [];
    for (const t of ['甲', '乙', '丙']) {
      const e = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: t });
      ids.push(e.json.data.id);
    }
    const reversed = [...ids].reverse();
    const re = await api.beMethod('PUT', `/api/v2/projects/${p.id}/episodes/order`, { order: reversed });
    cs.log(`reorder -> ${re.status} ${re.text.slice(0, 100)}`);
    cs.eq('reorder status', re.status, 200);
    const list = await api.be(`/api/v2/projects/${p.id}/episodes`);
    const arr = Array.isArray(list.json?.data) ? list.json.data : list.json?.data?.items || [];
    const byNum = {};
    for (const e of arr) byNum[String(e.episodeNumber)] = e.title;
    cs.log(`重排后列表: ${JSON.stringify(arr.map((e) => [e.episodeNumber, e.title]))}`);
    cs.eq('重排后第1集是丙', byNum['1'], '丙');
    cs.eq('重排后第3集是甲', byNum['3'], '甲');
    const bad = await api.beMethod('PUT', `/api/v2/projects/${p.id}/episodes/order`, { order: [ids[0]] });
    cs.expect('order 不完整 409 EPISODE_ORDER_CONFLICT', bad.status === 409 && bad.json?.error?.code === 'EPISODE_ORDER_CONFLICT', `${bad.status} ${bad.json?.error?.code}`);
  });
})();
