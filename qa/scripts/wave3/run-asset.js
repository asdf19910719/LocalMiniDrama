// ASSET 模块执行（TC-ASSET-001..018）：角色/场景/道具与素材库，真实 API
// 真实 DeepSeek 调用仅 1 次：TC-010 提示词润色（本 wave 预算内）；TC-016 四视图使用已润色提示词不触发文本模型
const fs = require('fs');
const path = require('path');
const { api, req, runCase, q1, q, createV1Project, createEpisode, saveCharacters, postMultipart, makePng, ART_DIR } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'ASSET', level: level || 'system', priority });
const uniq = `QA-L3-ASSET-${Date.now()}`;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (m, fn) => { if (!ONLY || ONLY.includes(m.id)) return runCase(m, fn); return Promise.resolve('skipped-by-filter'); };

(async () => {
  // TC-001 角色 CRUD 闭环
  // @test_id ASSET_001_character_crud
  await run(meta('TC-ASSET-001', '角色 CRUD 闭环：批量保存创建→详情→更新→删除→读取 404', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-CRUD`);
    const created = await saveCharacters(p.id, [
      { name: `${uniq}-林小海`, role: '主角', description: 'QA-L3 角色描述v1', appearance: '黑色短发，红色外套', personality: '冲动热心' },
      { name: `${uniq}-钟叔`, role: '配角', description: '钟表店老板' },
    ]);
    cs.eq('批量保存创建 2 个角色', created.length, 2);
    const c1 = created[0];
    cs.expect('字段落库（role/description/appearance）', c1.role === '主角' && c1.description === 'QA-L3 角色描述v1' && c1.appearance === '黑色短发，红色外套', JSON.stringify({ role: c1.role, desc: c1.description }));
    const one = await api.be(`/api/v1/characters/${c1.id}`);
    cs.eq('GET /characters/:id', one.status, 200);
    cs.eq('详情 name 一致', one.json?.data?.character?.name, c1.name);
    const up = await api.beMethod('PUT', `/api/v1/characters/${c1.id}`, { description: 'QA-L3 角色描述v2', voice_style: '沉稳男声' });
    cs.eq('PUT 更新 200', up.status, 200);
    const one2 = await api.be(`/api/v1/characters/${c1.id}`);
    cs.expect('更新后 description/voice_style 回读一致', one2.json?.data?.character?.description === 'QA-L3 角色描述v2' && one2.json?.data?.character?.voice_style === '沉稳男声', one2.json?.data?.character?.description);
    const del = await api.beMethod('DELETE', `/api/v1/characters/${c1.id}`);
    cs.eq('DELETE 200', del.status, 200);
    const gone = await api.be(`/api/v1/characters/${c1.id}`);
    cs.eq('删除后读取 404', gone.status, 404);
  });

  // TC-002 角色排序（观察项）
  // @test_id ASSET_002_character_sort
  await run(meta('TC-ASSET-002', '角色列表排序：按 sort_order,name；sort_order 无任何 API 写入口（观察项）', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-SORT`);
    await saveCharacters(p.id, [
      { name: `${uniq}-C-第三` },
      { name: `${uniq}-A-第一` },
      { name: `${uniq}-B-第二` },
    ]);
    const list = await api.be(`/api/v1/dramas/${p.id}/characters`);
    cs.eq('GET /dramas/:id/characters', list.status, 200);
    const names = (list.json?.data || []).map((c) => c.name).filter((n) => String(n).startsWith(uniq));
    cs.expect('创建顺序 C,A,B 被按 name 升序重排为 A,B,C（ORDER BY sort_order ASC, name ASC）', JSON.stringify(names) === JSON.stringify([`${uniq}-A-第一`, `${uniq}-B-第二`, `${uniq}-C-第三`]), JSON.stringify(names));
    // 观察项：updateCharacter 白名单无 sort_order，PUT 传入被静默忽略
    const rows = q('SELECT id, name, sort_order FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC', p.id);
    cs.expect('DB 层 sort_order 全为 0（无写入口）', rows.every((r) => Number(r.sort_order) === 0), JSON.stringify(rows.map((r) => r.sort_order)));
    cs.log('[观察项 INV-4.1b] 角色「排序」实为固定 ORDER BY sort_order,name；创建时 sort_order 恒 0，PUT /characters/:id 白名单（characterLibraryService.updateCharacter）不接收 sort_order，无任何 API 可调整顺序——inventory 标注 COMPLETE，实际排序能力不可达。行为如实记录。');
  });

  // TC-003 角色主图上传（真实 PNG）
  // @test_id ASSET_003_upload_main_image
  await run(meta('TC-ASSET-003', '角色主图上传（真实 PNG multipart）：文件落盘、URL 可访问、image_url 绑定', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-UP`);
    const [c] = await saveCharacters(p.id, [{ name: `${uniq}-上传角色` }]);
    const png = makePng(16, 16, [120, 40, 200]);
    cs.expect('测试 PNG 真实生成（签名+CRC+IDAT 自检）', png.slice(1, 4).toString('ascii') === 'PNG' && png.length > 60, `bytes=${png.length}`);
    const up = await postMultipart(`/api/v1/characters/${c.id}/upload-image`, {}, 'file', 'qa-l3-main.png', png, 'image/png');
    cs.log(`upload -> ${up.status} ${up.text.slice(0, 200)}`);
    cs.eq('上传 200', up.status, 200);
    const url = up.json?.data?.url;
    const localPath = up.json?.data?.local_path;
    cs.expect('返回 url 与 local_path', Boolean(url) && Boolean(localPath), JSON.stringify({ url, local_path: localPath }));
    const absUrl = String(url).startsWith('http') ? String(url).replace('localhost', '127.0.0.1') : BE + url;
    const fetchImg = await req('GET', absUrl);
    cs.eq('GET 静态图片 URL 200', fetchImg.status, 200);
    cs.expect('字节与上传内容一致（真实文件落盘）', fetchImg.buf.equals(png), `len=${fetchImg.buf.length} vs ${png.length}`);
    cs.expect('Content-Type 为图片', String(fetchImg.headers.get('content-type') || '').includes('image'), fetchImg.headers.get('content-type'));
    const one = await api.be(`/api/v1/characters/${c.id}`);
    cs.eq('characters.image_url 已绑定上传 URL', one.json?.data?.character?.image_url, url);
    const dbRow = q1('SELECT image_url, local_path FROM characters WHERE id = ?', c.id);
    cs.expect('DB 层 image_url/local_path 落库', dbRow.image_url === url && dbRow.local_path === localPath, JSON.stringify(dbRow));
    // PNG 结构复核（产物保留）
    fs.writeFileSync(path.join(ART_DIR, 'TC-ASSET-003-uploaded.png'), fetchImg.buf);
  });

  // TC-004 主图绑定更新与保护
  // @test_id ASSET_004_image_binding
  await run(meta('TC-ASSET-004', '主图绑定：PUT /characters/:id/image 换图生效；仅传 ref_image 不清空主图', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-BIND`);
    const [c] = await saveCharacters(p.id, [{ name: `${uniq}-绑定角色`, image_url: '/static/characters/qa-l3-old.png' }]);
    const r1 = await api.beMethod('PUT', `/api/v1/characters/${c.id}/image`, { image_url: '/static/characters/qa-l3-new.png' });
    cs.eq('PUT image 换主图 200', r1.status, 200);
    const one = await api.be(`/api/v1/characters/${c.id}`);
    cs.eq('主图已更新为 new', one.json?.data?.character?.image_url, '/static/characters/qa-l3-new.png');
    const r2 = await api.beMethod('PUT', `/api/v1/characters/${c.id}/image`, { ref_image: '/static/characters/qa-l3-ref.png' });
    cs.eq('仅传 ref_image 200', r2.status, 200);
    const one2 = await api.be(`/api/v1/characters/${c.id}`);
    cs.eq('主图未被清空（仅 ref_image 更新）', one2.json?.data?.character?.image_url, '/static/characters/qa-l3-new.png');
    const dbRow = q1('SELECT ref_image, image_url FROM characters WHERE id = ?', c.id);
    cs.eq('DB ref_image 落库', dbRow.ref_image, '/static/characters/qa-l3-ref.png');
    const miss = await api.beMethod('PUT', '/api/v1/characters/99999999/image', { image_url: 'x' });
    cs.eq('不存在角色 404', miss.status, 404);
  });

  // TC-005 角色额外图片
  // @test_id ASSET_005_extra_images
  await run(meta('TC-ASSET-005', '角色额外图片：extra_images JSON 落库并经项目角色列表回读', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-EXTRA`);
    const [c] = await saveCharacters(p.id, [{ name: `${uniq}-多图角色`, image_url: '/static/characters/qa-l3-main.png' }]);
    const extras = ['/static/characters/qa-l3-e1.png', '/static/characters/qa-l3-e2.png'];
    const r = await api.beMethod('PUT', `/api/v1/characters/${c.id}/image`, { extra_images: JSON.stringify(extras) });
    cs.eq('PUT extra_images 200', r.status, 200);
    const list = await api.be(`/api/v1/dramas/${p.id}/characters`);
    const row = (list.json?.data || []).find((x) => x.id === c.id) || {};
    let parsed = row.extra_images;
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (_) {} }
    cs.expect('项目角色列表回读 extra_images 数组一致', JSON.stringify(parsed) === JSON.stringify(extras), JSON.stringify(row.extra_images));
    const dbRow = q1('SELECT extra_images FROM characters WHERE id = ?', c.id);
    cs.expect('DB 层 JSON 可解析且一致', JSON.stringify(JSON.parse(dbRow.extra_images)) === JSON.stringify(extras), String(dbRow.extra_images));
  });

  // TC-006 状态变体 CRUD
  // @test_id ASSET_006_variant_crud
  await run(meta('TC-ASSET-006', '角色状态变体 CRUD：创建（默认/自定义 source_key）→列表→更新→同 source_key 409→删除', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-VAR`);
    const [c] = await saveCharacters(p.id, [{ name: `${uniq}-变体角色` }]);
    const v1 = await api.be(`/api/v1/characters/${c.id}/variants`, { name: '常服', is_default: 1 });
    cs.log(`create v1 -> ${v1.status} ${v1.text.slice(0, 160)}`);
    cs.eq('创建默认变体 201', v1.status, 201);
    const v1id = v1.json?.data?.id;
    cs.eq('首个变体 source_key 自动为 default', v1.json?.data?.source_key, 'default');
    const v2 = await api.be(`/api/v1/characters/${c.id}/variants`, { name: '雨衣', source_key: `${uniq}-raincoat`, appearance: '黄色雨衣' });
    cs.eq('创建第二变体 201', v2.status, 201);
    const v2id = v2.json?.data?.id;
    const list = await api.be(`/api/v1/characters/${c.id}/variants`);
    cs.expect('变体列表 200 且含 2 条', list.status === 200 && (list.json?.data || []).length === 2, JSON.stringify((list.json?.data || []).map((v) => v.name)));
    const up = await api.beMethod('PUT', `/api/v1/character-variants/${v2id}`, { name: '黄色雨衣', appearance: '明黄色连体雨衣' });
    cs.eq('更新变体 200', up.status, 200);
    cs.eq('更新后 name 生效', up.json?.data?.name, '黄色雨衣');
    const dup = await api.be(`/api/v1/characters/${c.id}/variants`, { name: '重复键', source_key: `${uniq}-raincoat` });
    cs.eq('同 source_key 409 VARIANT_KEY_CONFLICT', dup.status, 409);
    cs.eq('错误码明确', dup.json?.error?.code, 'VARIANT_KEY_CONFLICT');
    const noName = await api.be(`/api/v1/characters/${c.id}/variants`, { appearance: 'x' });
    cs.eq('缺 name 400', noName.status, 400);
    const del = await api.beMethod('DELETE', `/api/v1/character-variants/${v2id}`);
    cs.eq('删除变体 200', del.status, 200);
    const list2 = await api.be(`/api/v1/characters/${c.id}/variants`);
    cs.expect('删除后列表仅剩默认变体', JSON.stringify((list2.json?.data || []).map((v) => v.id)) === JSON.stringify([v1id]), JSON.stringify((list2.json?.data || []).map((v) => v.id)));
  });

  // TC-007 默认变体唯一性
  // @test_id ASSET_007_default_variant_exclusive
  await run(meta('TC-ASSET-007', '默认变体互斥：is_default 切换后同人物仅一个默认', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-DEF`);
    const [c] = await saveCharacters(p.id, [{ name: `${uniq}-默认变体角色` }]);
    const a = await api.be(`/api/v1/characters/${c.id}/variants`, { name: '状态A', is_default: 1 });
    const b = await api.be(`/api/v1/characters/${c.id}/variants`, { name: '状态B', is_default: 1 });
    cs.eq('创建两个默认变体均 201', a.status, 201);
    const list = await api.be(`/api/v1/characters/${c.id}/variants`);
    const defaults = (list.json?.data || []).filter((v) => Number(v.is_default) === 1);
    cs.eq('同人物默认变体仅 1 个（后者胜出）', defaults.length, 1);
    cs.eq('默认为后创建的状态B', defaults[0]?.name, '状态B');
    // 切回 A
    const setA = await api.beMethod('PUT', `/api/v1/character-variants/${a.json?.data?.id}`, { is_default: 1 });
    cs.eq('切回状态A 200', setA.status, 200);
    const list2 = await api.be(`/api/v1/characters/${c.id}/variants`);
    const defaults2 = (list2.json?.data || []).filter((v) => Number(v.is_default) === 1);
    cs.eq('切换后仍仅 1 个默认', defaults2.length, 1);
    cs.eq('默认为状态A', defaults2[0]?.name, '状态A');
  });

  // TC-008 场景 CRUD
  // @test_id ASSET_008_scene_crud
  await run(meta('TC-ASSET-008', '场景 CRUD：创建（地点/时间/氛围/描述）→详情→更新→删除→404', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-SCENE`);
    const ep = await createEpisode(cs, p.id);
    const mk = await api.be('/api/v1/scenes', { drama_id: p.id, episode_id: ep, location: `QA-L3-钟表店-${Date.now()}`, time: '日', atmosphere: '昏黄怀旧', description: 'QA-L3 场景描述', prompt: '老式钟表店内部，齿轮与挂钟' });
    cs.log(`create scene -> ${mk.status} ${mk.text.slice(0, 160)}`);
    cs.expect('创建场景 201', mk.status === 201 || mk.status === 200, mk.status);
    const sid = mk.json?.data?.id;
    const one = await api.be(`/api/v1/scenes/${sid}`);
    cs.eq('GET 场景 200', one.status, 200);
    const d = one.json?.data?.scene || one.json?.data || {};
    cs.expect('字段回读（location/time/atmosphere/description）', String(d.location).includes('钟表店') && d.time === '日' && d.atmosphere === '昏黄怀旧' && d.description === 'QA-L3 场景描述', JSON.stringify({ loc: d.location, time: d.time }));
    const up = await api.beMethod('PUT', `/api/v1/scenes/${sid}`, { atmosphere: '深夜幽蓝', description: 'QA-L3 场景描述v2' });
    cs.expect('PUT 更新 200', up.status === 200, up.status);
    const one2 = await api.be(`/api/v1/scenes/${sid}`);
    const d2 = one2.json?.data?.scene || one2.json?.data || {};
    cs.expect('更新后回读一致（atmosphere/description）', d2.atmosphere === '深夜幽蓝' && d2.description === 'QA-L3 场景描述v2', JSON.stringify({ a: d2.atmosphere, de: d2.description }));
    const del = await api.beMethod('DELETE', `/api/v1/scenes/${sid}`);
    cs.eq('DELETE 200', del.status, 200);
    cs.eq('删除后读取 404', (await api.be(`/api/v1/scenes/${sid}`)).status, 404);
  });

  // TC-009 道具 CRUD
  // @test_id ASSET_009_prop_crud
  await run(meta('TC-ASSET-009', '道具 CRUD：缺参 400→创建→更新→删除→404', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-PROP`);
    const noName = await api.be('/api/v1/props', { drama_id: p.id });
    cs.eq('缺 name 400', noName.status, 400);
    const mk = await api.be('/api/v1/props', { drama_id: p.id, name: `${uniq}-黄铜怀表`, type: '关键道具', description: 'QA-L3 道具描述', prompt: '黄铜怀表，表盖刻着花纹' });
    cs.log(`create prop -> ${mk.status} ${mk.text.slice(0, 140)}`);
    cs.eq('创建道具 201', mk.status, 201);
    const pid = mk.json?.data?.id;
    const one = await api.be(`/api/v1/props/${pid}`);
    const pd = one.json?.data?.prop || one.json?.data || {};
    cs.expect('字段回读', pd.name === `${uniq}-黄铜怀表` && pd.type === '关键道具', one.text.slice(0, 140));
    const up = await api.beMethod('PUT', `/api/v1/props/${pid}`, { description: 'QA-L3 道具描述v2', negative_prompt: '现代物品' });
    cs.eq('PUT 更新 200', up.status, 200);
    const upd = up.json?.data?.prop || up.json?.data || {};
    cs.expect('更新回读', upd.description === 'QA-L3 道具描述v2' && upd.negative_prompt === '现代物品', up.text.slice(0, 160));
    const del = await api.beMethod('DELETE', `/api/v1/props/${pid}`);
    cs.eq('DELETE 200', del.status, 200);
    cs.eq('删除后读取 404', (await api.be(`/api/v1/props/${pid}`)).status, 404);
    cs.eq('删除不存在道具 404', (await api.beMethod('DELETE', `/api/v1/props/${pid}`)).status, 404);
  });

  // TC-010 提示词润色（本 wave 唯一一次 ASSET 真实 DeepSeek 调用）
  // @test_id ASSET_010_polish_real
  await run(meta('TC-ASSET-010', '角色描述/提示词润色（真实 DeepSeek）：polished_prompt 生成并落库回读', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-POLISH`);
    const [c] = await saveCharacters(p.id, [{ name: `${uniq}-润色角色`, appearance: '二十岁女性，齐耳短发，左眉有一道浅疤，喜欢穿工装外套', description: '修表学徒，沉默寡言但手极稳' }]);
    let r = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        r = await api.be(`/api/v1/characters/${c.id}/generate-prompt`, {}, { timeoutMs: 120000 });
        break;
      } catch (e) {
        cs.log(`attempt#${attempt} 网络异常: ${e.message}，3s 后重试`);
        await new Promise((res) => setTimeout(res, 3000));
        if (attempt === 3) throw e;
      }
    }
    cs.log(`generate-prompt -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.eq('润色 200', r.status, 200);
    const pp = r.json?.data?.polished_prompt || '';
    cs.expect('返回非空 polished_prompt（真实模型输出）', String(pp).length > 100, `len=${String(pp).length}`);
    cs.expect('输出为中文四视图提示词结构（含角色相关关键词）', /角色|外貌|四视图|服装|发型/.test(String(pp)), String(pp).slice(0, 120));
    const one = await api.be(`/api/v1/characters/${c.id}`);
    const dbPp = one.json?.data?.character?.polished_prompt;
    cs.expect('polished_prompt 已落库并与响应一致', dbPp === pp, `db_len=${String(dbPp || '').length}`);
  });

  // TC-011 润色异常路径（零模型调用）
  // @test_id ASSET_011_polish_error_paths
  await run(meta('TC-ASSET-011', '润色异常路径：不存在角色 404、不存在场景 404（均不触发模型调用）', 'P1'), async (cs) => {
    const r1 = await api.be('/api/v1/characters/99999999/generate-prompt', {}, { timeoutMs: 30000 });
    cs.eq('不存在角色 generate-prompt 404', r1.status, 404);
    const r2 = await api.be('/api/v1/scenes/99999999/generate-prompt', {}, { timeoutMs: 30000 });
    cs.eq('不存在场景 generate-prompt 404', r2.status, 404);
    const r3 = await api.be('/api/v1/characters/99999999/generate-four-view-image', {}, { timeoutMs: 30000 });
    cs.eq('不存在角色 generate-four-view-image 404', r3.status, 404);
  });

  // TC-012 公共角色素材库
  // @test_id ASSET_012_character_library
  await run(meta('TC-ASSET-012', '公共角色素材库：角色入库→库列表可见→从库应用主图到另一角色（导入项目）', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-CLIB`);
    const [src] = await saveCharacters(p.id, [{ name: `${uniq}-入库角色`, image_url: '/static/characters/qa-l3-lib.png', description: 'QA-L3 库描述' }]);
    const add = await api.be(`/api/v1/characters/${src.id}/add-to-library`, { category: 'QA-L3-分类' });
    cs.log(`add-to-library -> ${add.status} ${add.text.slice(0, 160)}`);
    cs.expect('角色入库成功', add.status === 200 && add.json?.data?.item?.id, add.text.slice(0, 160));
    const libId = add.json?.data?.item?.id;
    const list = await api.be('/api/v1/character-library');
    const hit = (list.json?.data?.items || list.json?.data || []).find?.((x) => x && x.id === libId);
    cs.expect('库列表可见该条目', Boolean(hit), `total=${list.json?.data?.total ?? 'n/a'}`);
    const [dst] = await saveCharacters(p.id, [{ name: `${uniq}-应用目标角色` }]);
    const apply = await api.beMethod('PUT', `/api/v1/characters/${dst.id}/image-from-library`, { library_id: libId });
    cs.eq('image-from-library 应用 200', apply.status, 200);
    const one = await api.be(`/api/v1/characters/${dst.id}`);
    cs.eq('目标角色主图=库条目图（库→项目数据流闭合）', one.json?.data?.character?.image_url, '/static/characters/qa-l3-lib.png');
    const noLib = await api.beMethod('PUT', `/api/v1/characters/${dst.id}/image-from-library`, { library_id: 99999999 });
    cs.eq('不存在库条目 404', noLib.status, 404);
    const del = await api.beMethod('DELETE', `/api/v1/character-library/${libId}`);
    cs.eq('清理库条目 200', del.status, 200);
  });

  // TC-013 公共场景素材库
  // @test_id ASSET_013_scene_library
  await run(meta('TC-ASSET-013', '公共场景素材库：场景入库→库列表可见→字段一致', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-SLIB`);
    const mk = await api.be('/api/v1/scenes', { drama_id: p.id, location: `QA-L3-库场景-${Date.now()}`, time: '夜', prompt: '雨夜霓虹街道', image_url: '/static/scenes/qa-l3-scene.png' });
    const sid = mk.json?.data?.id;
    const add = await api.be(`/api/v1/scenes/${sid}/add-to-library`, { category: 'QA-L3-场景分类' });
    cs.log(`scene add-to-library -> ${add.status} ${add.text.slice(0, 160)}`);
    cs.expect('场景入库成功', add.status === 200 && add.json?.data?.item?.id, add.text.slice(0, 160));
    const libId = add.json?.data?.item?.id;
    const list = await api.be('/api/v1/scene-library');
    const items = list.json?.data?.items || list.json?.data || [];
    const hit = (Array.isArray(items) ? items : []).find((x) => x && x.id === libId);
    cs.expect('场景库列表可见', Boolean(hit), `total=${list.json?.data?.total ?? 'n/a'}`);
    cs.expect('库条目 location 与源场景一致', hit && String(hit.location).includes('库场景'), JSON.stringify(hit || {}).slice(0, 120));
    await api.beMethod('DELETE', `/api/v1/scene-library/${libId}`);
    cs.log('[cleanup] 已删除场景库条目');
  });

  // TC-014 公共道具素材库
  // @test_id ASSET_014_prop_library
  await run(meta('TC-ASSET-014', '公共道具素材库：本剧库与公共素材库双入口入库→prop_libraries 可见', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-PLIB`);
    const mk = await api.be('/api/v1/props', { drama_id: p.id, name: `${uniq}-入库道具`, prompt: '黄铜怀表', image_url: '/static/props/qa-l3-prop-lib.png' });
    const pid = mk.json?.data?.id;
    const r1 = await api.be(`/api/v1/props/${pid}/add-to-library`, { category: 'QA-L3' });
    cs.log(`prop add-to-library -> ${r1.status} ${r1.text.slice(0, 140)}`);
    cs.expect('本剧道具库入库成功', r1.status === 200, r1.text.slice(0, 140));
    const r2 = await api.be(`/api/v1/props/${pid}/add-to-material-library`, {});
    cs.log(`prop add-to-material-library -> ${r2.status} ${r2.text.slice(0, 140)}`);
    cs.expect('公共素材库入库成功', r2.status === 200, r2.text.slice(0, 140));
    const list = await api.be('/api/v1/prop-library');
    const items = list.json?.data?.items || list.json?.data || [];
    const hits = (Array.isArray(items) ? items : []).filter((x) => x && String(x.name || '').includes(`${uniq}-入库道具`));
    cs.expect('道具库可检索到入库条目', hits.length >= 1, `hits=${hits.length}`);
  });

  // TC-015 素材库直连 CRUD
  // @test_id ASSET_015_library_direct_crud
  await run(meta('TC-ASSET-015', '素材库直连 CRUD：POST/PUT/DELETE /character-library 全链路', 'P2', 'integration'), async (cs) => {
    const mk = await api.be('/api/v1/character-library', { name: `${uniq}-直建库角色`, category: 'QA-L3', description: 'QA-L3 直建描述', image_url: '/static/library/qa-l3.png' });
    cs.log(`create library item -> ${mk.status} ${mk.text.slice(0, 140)}`);
    cs.expect('直建库条目成功', mk.status === 200 || mk.status === 201, mk.status);
    const libId = mk.json?.data?.id;
    const one = await api.be(`/api/v1/character-library/${libId}`);
    cs.eq('GET 库条目 200', one.status, 200);
    const up = await api.beMethod('PUT', `/api/v1/character-library/${libId}`, { description: 'QA-L3 直建描述v2' });
    cs.expect('PUT 更新成功', up.status === 200, up.status);
    const one2 = await api.be(`/api/v1/character-library/${libId}`);
    cs.eq('更新回读一致', one2.json?.data?.description, 'QA-L3 直建描述v2');
    const del = await api.beMethod('DELETE', `/api/v1/character-library/${libId}`);
    cs.eq('DELETE 200', del.status, 200);
    cs.eq('删除后读取 404', (await api.be(`/api/v1/character-library/${libId}`)).status, 404);
  });

  // TC-016 四视图接口契约（有 polished_prompt 时不触发文本模型；图像通道 18080 离线为真实外部状态）
  // @test_id ASSET_016_four_view_contract
  await run(meta('TC-ASSET-016', '角色四视图接口契约：风格覆盖拒绝 400、已润色角色受理 200、任务记录落库', 'P2'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-FV`);
    const [c] = await saveCharacters(p.id, [{ name: `${uniq}-四视图角色`, image_url: '/static/characters/qa-l3-fv.png' }]);
    await api.beMethod('PUT', `/api/v1/characters/${c.id}`, { polished_prompt: 'QA-L3 预置四视图提示词：白色背景，角色三视图站立像，服装细节清晰。' });
    const so = await api.be(`/api/v1/characters/${c.id}/generate-four-view-image`, { style: 'QA-L3-试图覆盖风格' });
    cs.eq('携带 style 覆盖被拒绝 400', so.status, 400);
    cs.eq('错误码 PROJECT_STYLE_OVERRIDE_FORBIDDEN', so.json?.error?.code, 'PROJECT_STYLE_OVERRIDE_FORBIDDEN');
    const r = await api.be(`/api/v1/characters/${c.id}/generate-four-view-image`, {}, { timeoutMs: 60000 });
    cs.log(`generate-four-view -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.eq('四视图任务受理 200', r.status, 200);
    cs.eq('message 为任务已提交', r.json?.data?.message, '四视图生成任务已提交');
    const genId = r.json?.data?.image_generation?.id;
    cs.expect('返回 image_generation 记录', Boolean(genId), r.text.slice(0, 160));
    const dbRow = genId ? q1('SELECT id, character_id, frame_type, status FROM image_generations WHERE id = ?', genId) : null;
    cs.expect('image_generations 记录落库且绑定角色', dbRow && Number(dbRow.character_id) === c.id, JSON.stringify(dbRow || {}));
    cs.log(`[记录] 生成记录初始 status=${dbRow?.status}；图像通道 127.0.0.1:18080 离线为真实外部状态，成功路径由 E2E 阶段覆盖，此处只验接口契约`);
  });

  // TC-017 批量图像接口契约
  // @test_id ASSET_017_batch_contract
  await run(meta('TC-ASSET-017', '角色批量生成图像接口契约：空列表 400、超上限 400、合法列表受理 count 一致', 'P1'), async (cs) => {
    const empty = await api.be('/api/v1/characters/batch-generate-images', { character_ids: [] });
    cs.eq('空 character_ids 400', empty.status, 400);
    const over = await api.be('/api/v1/characters/batch-generate-images', { character_ids: Array.from({ length: 11 }, (_, i) => i + 1) });
    cs.eq('超过 10 个 400', over.status, 400);
    cs.expect('提示单次上限', over.text.includes('10'), over.text.slice(0, 120));
    const p = await createV1Project(cs, `${uniq}-BATCH`);
    const chars = await saveCharacters(p.id, [{ name: `${uniq}-批量A`, appearance: '红衣少女' }, { name: `${uniq}-批量B`, appearance: '灰衣老者' }]);
    const ok = await api.be('/api/v1/characters/batch-generate-images', { character_ids: chars.map((c) => c.id) });
    cs.log(`batch -> ${ok.status} ${ok.text.slice(0, 160)}`);
    cs.eq('合法批量受理 200', ok.status, 200);
    cs.eq('受理 count=2', ok.json?.data?.count, 2);
  });

  // TC-018 前端 addToTeamLibrary 陈旧契约验证
  // @test_id ASSET_018_stale_team_library
  await run(meta('TC-ASSET-018', '前端 addToTeamLibrary 声明路由后端不存在（BROKEN 陈旧契约按真实行为验证）', 'P2'), async (cs) => {
    const r1 = await api.be('/api/v1/characters/1/add-to-team-library', {});
    cs.log(`POST /characters/1/add-to-team-library -> ${r1.status} ${r1.text.slice(0, 120)}`);
    cs.expect('角色 add-to-team-library 404（后端未挂载）', r1.status === 404, r1.status);
    const r2 = await api.be('/api/v1/scenes/1/add-to-team-library', {});
    cs.log(`POST /scenes/1/add-to-team-library -> ${r2.status} ${r2.text.slice(0, 120)}`);
    cs.expect('场景 add-to-team-library 404（后端未挂载）', r2.status === 404, r2.status);
    cs.log('[观察项 INV-4.17] frontweb/src/api/characters.js:38 与 scenes.js:31 声明 add-to-team-library，后端 index.js 无对应路由——与 inventory「BROKEN：声明了后端不存在的路由」一致，如实记录不判新缺陷');
  });

  console.log('\n[ASSET] 全部用例执行完毕');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
