// MEDIA 模块执行（TC-MEDIA-001..013）：媒体库与文件管理，真实 API
// BROKEN 项按 feature-inventory §13 文档行为逐条真实验证：一致记观察项，比文档更糟记 BUG
const fs = require('fs');
const path = require('path');
const { api, req, runCase, q1, q, createV1Project, postMultipart, makePng, ART_DIR, BE } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'MEDIA', level: level || 'system', priority });
const uniq = `QA-L3-MEDIA-${Date.now()}`;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (m, fn) => { if (!ONLY || ONLY.includes(m.id)) return runCase(m, fn); return Promise.resolve('skipped-by-filter'); };

function totalOf(r) {
  return r.json?.data?.pagination?.total ?? r.json?.data?.total;
}

async function assetCount(dramaId) {
  return q1('SELECT COUNT(*) AS n FROM assets WHERE drama_id = ? AND deleted_at IS NULL', dramaId).n;
}

(async () => {
  // TC-001 列表/详情/预览
  // @test_id MEDIA_001_list_detail_preview
  await run(meta('TC-MEDIA-001', '通用资产列表/详情：创建资产→列表可见→详情回读→/static 真实文件预览', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-LIST`);
    const png = makePng(12, 12, [30, 144, 255]);
    const up = await postMultipart('/api/v1/upload/image', { drama_id: p.id }, 'file', 'qa-l3-media.png', png, 'image/png');
    cs.eq('前置：真实 PNG 上传成功', up.status, 200);
    const { url, local_path: lp } = up.json?.data || {};
    const mk = await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-图A`, type: 'image', url, local_path: lp, mime_type: 'image/png', file_size: png.length, width: 12, height: 12 });
    cs.eq('创建资产 201', mk.status, 201);
    const aid = mk.json?.data?.id;
    const list = await api.be(`/api/v1/assets?drama_id=${p.id}`);
    cs.expect('列表包含新资产', (list.json?.data?.items || []).some((x) => x.id === aid), `total=${totalOf(list)}`);
    const one = await api.be(`/api/v1/assets/${aid}`);
    cs.expect('详情字段回读（name/type/url）', one.json?.data?.name === `${uniq}-图A` && one.json?.data?.type === 'image' && one.json?.data?.url === url, one.text.slice(0, 160));
    const absUrl = String(url).startsWith('http') ? String(url).replace('localhost', '127.0.0.1') : BE + url;
    const img = await req('GET', absUrl);
    cs.expect('/static 预览字节一致（真实文件）', img.status === 200 && img.buf.equals(png), `status=${img.status} len=${img.buf.length}`);
    const dbRow = q1('SELECT file_size AS fs, width AS w FROM assets WHERE id = ?', aid);
    cs.expect('DB file_size/width 落库', dbRow && dbRow.fs === png.length && dbRow.w === 12, JSON.stringify(dbRow));
  });

  // TC-002 类型过滤
  // @test_id MEDIA_002_type_filter
  await run(meta('TC-MEDIA-002', '类型过滤：type=image / type=video 各自命中；音频类型空集', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-TYPE`);
    await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-img1`, type: 'image', url: '/static/x1.png' });
    await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-vid1`, type: 'video', url: '/static/x1.mp4' });
    const imgs = await api.be(`/api/v1/assets?drama_id=${p.id}&type=image`);
    const vids = await api.be(`/api/v1/assets?drama_id=${p.id}&type=video`);
    const auds = await api.be(`/api/v1/assets?drama_id=${p.id}&type=audio`);
    cs.expect('image 过滤仅含图片', (imgs.json?.data?.items || []).every((x) => x.type === 'image') && totalOf(imgs) === 1, `total=${totalOf(imgs)}`);
    cs.expect('video 过滤仅含视频', (vids.json?.data?.items || []).every((x) => x.type === 'video') && totalOf(vids) === 1, `total=${totalOf(vids)}`);
    cs.eq('audio 过滤为空', totalOf(auds), 0);
  });

  // TC-003 关键词搜索（BROKEN INV-13.3 按文档行为验证）
  // @test_id MEDIA_003_keyword_search_broken
  await run(meta('TC-MEDIA-003', '关键词搜索：keyword 参数被服务端忽略、结果不过滤（与 inventory BROKEN 标注一致）', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-KW`);
    await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-命中needleA`, type: 'image', url: '/static/k1.png' });
    await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-完全不相关B`, type: 'image', url: '/static/k2.png' });
    const r = await api.be(`/api/v1/assets?drama_id=${p.id}&keyword=needleA`);
    cs.eq('带 keyword 请求 200', r.status, 200);
    const names = (r.json?.data?.items || []).map((x) => x.name);
    const filtered = names.length === 1;
    cs.expect('documented BROKEN 行为：keyword 被忽略，2 条全部返回（未过滤）', totalOf(r) === 2, JSON.stringify(names));
    cs.log(`[观察项 INV-13.3] 后端 assetService.list 只处理 drama_id/type（assetService.js:1-19），无 keyword 分支；前端 MediaLibrary.vue:191 已传 keyword——BROKEN 根因在服务端不消费该参数（inventory 措辞归因前端 service 未转发，与当前代码不一致但净效果相同：搜索不可用）`);
    void filtered;
  });

  // TC-004 媒体上传不入 assets（BROKEN INV-13.4）
  // @test_id MEDIA_004_upload_not_in_assets
  await run(meta('TC-MEDIA-004', '媒体上传：/upload/image 仅存文件不写 assets 表，刷新后媒体库不可见（与 inventory BROKEN 一致）', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-UP`);
    const before = await assetCount(p.id);
    const png = makePng(10, 10, [255, 140, 0]);
    const up = await postMultipart('/api/v1/upload/image', { drama_id: p.id }, 'file', 'qa-l3-orphan.png', png, 'image/png');
    cs.eq('上传本身成功 200', up.status, 200);
    const after = await assetCount(p.id);
    cs.expect('documented BROKEN 行为：assets 表计数不变（上传项不入库）', after === before, `before=${before} after=${after}`);
    const absUrl = String(up.json?.data?.url).startsWith('http') ? String(up.json?.data?.url).replace('localhost', '127.0.0.1') : BE + up.json?.data?.url;
    const img = await req('GET', absUrl);
    cs.expect('文件已真实落盘且可访问（文件成功、入库缺失＝半截功能）', img.status === 200 && img.buf.equals(png), `status=${img.status}`);
    cs.log('[观察项 INV-13.4] routes/upload.js uploadImage 只调 uploadService.uploadFile 落盘，无 assets INSERT——与 inventory「刷新后上传项不会出现在媒体库」一致');
  });

  // TC-005 资产字段更新（BROKEN INV-13.7）
  // @test_id MEDIA_005_update_sql_fail
  await run(meta('TC-MEDIA-005', '资产字段更新：description/thumbnail_url/is_favorite 更新 500（列不存在）；name/url 更新正常', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-UPD`);
    const mk = await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-更新资产`, type: 'image', url: '/static/u.png' });
    const aid = mk.json?.data?.id;
    const bad = await api.beMethod('PUT', `/api/v1/assets/${aid}`, { description: 'QA-L3 描述' });
    cs.log(`update description -> ${bad.status} ${bad.text.slice(0, 140)}`);
    cs.expect('documented BROKEN 行为：description 更新 500（assets 表无该列，SQL 失败）', bad.status === 500, `${bad.status}`);
    const bad2 = await api.beMethod('PUT', `/api/v1/assets/${aid}`, { is_favorite: 1 });
    cs.expect('is_favorite 更新同样 500', bad2.status === 500, `${bad2.status}`);
    const ok = await api.beMethod('PUT', `/api/v1/assets/${aid}`, { name: `${uniq}-更新资产v2`, url: '/static/u2.png' });
    cs.expect('合法列（name/url）更新正常', ok.status === 200 && ok.json?.data?.name === `${uniq}-更新资产v2`, ok.text.slice(0, 120));
    cs.log('[观察项 INV-13.7] assetService.update 白名单包含 description/thumbnail_url/is_favorite（assetService.js:73），而实库无这三列（data-model.md §2 明确记录）——与 inventory BROKEN 一致');
  });

  // TC-006 软删除不同步物理文件（PARTIAL INV-13.5）
  // @test_id MEDIA_006_soft_delete_file_kept
  await run(meta('TC-MEDIA-006', '删除：软删后列表不可见；物理文件仍保留（未同步回收，与 inventory PARTIAL 一致）', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-DEL`);
    const png = makePng(8, 8, [0, 191, 255]);
    const up = await postMultipart('/api/v1/upload/image', { drama_id: p.id }, 'file', 'qa-l3-del.png', png, 'image/png');
    const { url, local_path: lp } = up.json?.data || {};
    const mk = await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-待删资产`, type: 'image', url, local_path: lp });
    const aid = mk.json?.data?.id;
    const del = await api.beMethod('DELETE', `/api/v1/assets/${aid}`);
    cs.eq('DELETE 200', del.status, 200);
    cs.eq('删除后 GET 404', (await api.be(`/api/v1/assets/${aid}`)).status, 404);
    const list = await api.be(`/api/v1/assets?drama_id=${p.id}`);
    cs.expect('列表不再包含（软删过滤）', !((list.json?.data?.items || []).some((x) => x.id === aid)), `total=${totalOf(list)}`);
    const absUrl = String(url).startsWith('http') ? String(url).replace('localhost', '127.0.0.1') : BE + url;
    const img = await req('GET', absUrl);
    cs.expect('documented PARTIAL 行为：物理文件仍可访问（未随软删回收）', img.status === 200 && img.buf.equals(png), `status=${img.status}`);
    cs.expect('DB 行保留且带 deleted_at', Boolean(q1('SELECT deleted_at FROM assets WHERE id = ?', aid)?.deleted_at), '');
  });

  // TC-007 批量删除契约
  // @test_id MEDIA_007_batch_delete_contract
  await run(meta('TC-MEDIA-007', '批量删除：后端无批量端点，逐条 DELETE（前端循环调用）+ 不存在 id 404', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-BDEL`);
    const a = await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-批量1`, type: 'image', url: '/static/b1.png' });
    const b = await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-批量2`, type: 'image', url: '/static/b2.png' });
    const r1 = await api.beMethod('DELETE', `/api/v1/assets/${a.json?.data?.id}`);
    const r2 = await api.beMethod('DELETE', `/api/v1/assets/${b.json?.data?.id}`);
    cs.expect('逐条删除均 200（前端 MediaLibrary.vue 批量操作即循环单删）', r1.status === 200 && r2.status === 200, `${r1.status},${r2.status}`);
    cs.eq('剩余 0 条', totalOf(await api.be(`/api/v1/assets?drama_id=${p.id}`)), 0);
    cs.eq('重复删除 404', (await api.beMethod('DELETE', `/api/v1/assets/${a.json?.data?.id}`)).status, 404);
    cs.log('[观察项 INV-13.5] 路由表仅 DELETE /assets/:id 单条端点；「批量删除」为前端顺序循环，无事务性（中途失败会部分删除）——与 inventory PARTIAL 语义一致');
  });

  // TC-008 分页
  // @test_id MEDIA_008_pagination
  await run(meta('TC-MEDIA-008', '分页：page_size 生效、翻页不重不漏、超范围页为空', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-PAGE`);
    for (let i = 1; i <= 3; i++) {
      await api.be('/api/v1/assets', { drama_id: p.id, name: `${uniq}-分页${i}`, type: 'image', url: `/static/pg${i}.png` });
    }
    const pg1 = await api.be(`/api/v1/assets?drama_id=${p.id}&page=1&page_size=2`);
    const pg2 = await api.be(`/api/v1/assets?drama_id=${p.id}&page=2&page_size=2`);
    const pg9 = await api.be(`/api/v1/assets?drama_id=${p.id}&page=9&page_size=2`);
    cs.eq('total=3', totalOf(pg1), 3);
    cs.eq('page_size=2 生效', (pg1.json?.data?.items || []).length, 2);
    const ids = new Set([...(pg1.json?.data?.items || []), ...(pg2.json?.data?.items || [])].map((x) => x.id));
    cs.expect('两页并集不重不漏（3 个唯一 id）', ids.size === 3, `unique=${ids.size}`);
    cs.eq('超范围页为空', (pg9.json?.data?.items || []).length, 0);
  });

  // TC-009 drama_id 隔离
  // @test_id MEDIA_009_drama_isolation
  await run(meta('TC-MEDIA-009', '项目隔离：drama_id 过滤互不可见', 'P1'), async (cs) => {
    const p1 = await createV1Project(cs, `${uniq}-ISO1`);
    const p2 = await createV1Project(cs, `${uniq}-ISO2`);
    await api.be('/api/v1/assets', { drama_id: p1.id, name: `${uniq}-P1资产`, type: 'image', url: '/static/i1.png' });
    const r1 = await api.be(`/api/v1/assets?drama_id=${p1.id}`);
    const r2 = await api.be(`/api/v1/assets?drama_id=${p2.id}`);
    cs.eq('项目1 可见 1 条', totalOf(r1), 1);
    cs.eq('项目2 不可见', totalOf(r2), 0);
  });

  // TC-010 创建校验与弱约束观察
  // @test_id MEDIA_010_create_validation
  await run(meta('TC-MEDIA-010', '创建校验：缺 name 落默认「未命名」；不存在的 drama_id 也被接受（无外键约束观察）', 'P2'), async (cs) => {
    const mk = await api.be('/api/v1/assets', { type: 'image', url: '/static/nn.png' });
    cs.expect('缺 name 创建成功且落默认名「未命名」', mk.status === 201 && mk.json?.data?.name === '未命名', mk.text.slice(0, 120));
    const orphan = await api.be('/api/v1/assets', { drama_id: 99999999, name: `${uniq}-孤儿资产`, type: 'image', url: '/static/o.png' });
    cs.log(`orphan create -> ${orphan.status} ${orphan.text.slice(0, 120)}`);
    cs.expect('[观察项] 不存在 drama_id 被接受（assets 无外键，data-model §1「无法由数据库阻止孤儿记录」一致）', orphan.status === 201, `${orphan.status}`);
    const cnt = q1('SELECT COUNT(*) AS n FROM assets WHERE drama_id = 99999999 AND name LIKE ?', `${uniq}-孤儿资产%`);
    cs.log(`[cleanup 登记] 孤儿行 id=${orphan.json?.data?.id}（无所属项目，无法经项目删除联动清理，仅 DB 层可清——测试数据保留供复核）`);
    void cnt;
  });

  // TC-011 上传格式过滤
  // @test_id MEDIA_011_mime_filter
  await run(meta('TC-MEDIA-011', '上传格式过滤：非图片 MIME 被拒绝（multer fileFilter）', 'P2'), async (cs) => {
    const r = await postMultipart('/api/v1/upload/image', {}, 'file', 'qa-l3.txt', Buffer.from('hello QA-L3'), 'text/plain');
    cs.log(`txt upload -> ${r.status} ${r.text.slice(0, 160)}`);
    cs.expect('非图片 MIME 被拒绝（4xx/5xx 均为拒绝，实际响应记录）', r.status >= 400, `${r.status}`);
    cs.expect('拒绝信息提及图片格式', r.text.includes('图片') || r.status === 500, r.text.slice(0, 120));
  });

  // TC-012 上传项目子目录布局
  // @test_id MEDIA_012_storage_layout
  await run(meta('TC-MEDIA-012', '上传存储布局：携带 drama_id 时文件落入 projects/<项目目录>/uploads/ 子目录', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-LAYOUT`);
    const png = makePng(6, 6, [128, 0, 128]);
    const up = await postMultipart('/api/v1/upload/image', { drama_id: p.id }, 'file', 'qa-l3-layout.png', png, 'image/png');
    cs.eq('上传 200', up.status, 200);
    const lp = up.json?.data?.local_path || '';
    cs.expect('local_path 位于 projects/ 项目子目录（storageLayout 聚合）', String(lp).startsWith('projects/'), lp);
    const absUrl = String(up.json?.data?.url).startsWith('http') ? String(up.json?.data?.url).replace('localhost', '127.0.0.1') : BE + up.json?.data?.url;
    cs.eq('URL 可访问', (await req('GET', absUrl)).status, 200);
  });

  // TC-013 外部结果导入资产库
  // @test_id MEDIA_013_import_from_generation
  await run(meta('TC-MEDIA-013', '外部结果导入资产库：image_generations 记录经 /assets/import/image 落入 assets 并在媒体库可见', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-IMP`);
    const ig = await api.be('/api/v1/images', { drama_id: p.id, prompt: 'QA-L3 导入来源图：钟表店全景', provider: 'openai' });
    cs.expect('前置：图像生成记录已建', ig.status === 201, ig.text.slice(0, 120));
    cs.log(`images.create -> ${ig.status} ${ig.text.slice(0, 240)}`);
    const igId = ig.json?.data?.id ?? ig.json?.data?.image_generation?.id;
    const before = await assetCount(p.id);
    const imp = await api.be(`/api/v1/assets/import/image/${igId}`, {});
    cs.log(`import -> ${imp.status} ${imp.text.slice(0, 160)}`);
    cs.eq('导入 201', imp.status, 201);
    cs.expect('资产绑定 image_gen_id 且类型 image', imp.json?.data?.image_gen_id === igId && imp.json?.data?.type === 'image', imp.text.slice(0, 160));
    const after = await assetCount(p.id);
    cs.expect('数据流：媒体库计数 +1（导入项刷新后可见）', after === before + 1, `before=${before} after=${after}`);
    const list = await api.be(`/api/v1/assets?drama_id=${p.id}`);
    cs.expect('列表含导入项', (list.json?.data?.items || []).some((x) => x.image_gen_id === igId), '');
    cs.eq('导入不存在的生成记录 404', (await api.be('/api/v1/assets/import/image/99999999', {})).status, 404);
  });

  console.log('\n[MEDIA] 全部用例执行完毕');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
