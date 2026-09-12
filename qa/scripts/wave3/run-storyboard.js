// STORYBOARD 模块执行（TC-STORYBOARD-001..022）：分镜脚本，真实 API
// 真实 DeepSeek 调用仅 1 次：TC-015 从剧集生成分镜（预算内）；润色类 LLM 端点按预算约束跳过真实调用
const fs = require('fs');
const path = require('path');
const { api, runCase, q1, q, createV1Project, createEpisode, saveDraft, confirmScript, saveCharacters, ART_DIR } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'STORYBOARD', level: level || 'system', priority });
const uniq = `QA-L3-SB-${Date.now()}`;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (m, fn) => { if (!ONLY || ONLY.includes(m.id)) return runCase(m, fn); return Promise.resolve('skipped-by-filter'); };

const SCRIPT = `内景 钟表店 日\n${'QA-L3主角'}低头修表，齿轮声细密。\n\n外景 老街 夜\n${'QA-L3主角'}收摊回家，霓虹灯闪烁。`;

async function makeStoryboardReady(cs, tag, scriptText) {
  const p = await createV1Project(cs, `${uniq}-${tag}`);
  const epId = await createEpisode(cs, p.id, '第一集');
  const text = scriptText || SCRIPT;
  const d = await saveDraft(epId, text);
  if (d.status !== 200) throw new Error('saveDraft failed: ' + d.status);
  const c = await confirmScript(epId);
  if (c.status !== 200) throw new Error('confirm failed: ' + c.status + ' ' + c.text.slice(0, 120));
  // v2.1 草稿只写 episode_script_revisions（不写 episodes.script_content）；
  // 经典 v1 分镜生成读取 episodes.script_content —— 经 v1 批量剧集更新补写该列（生产前端同一用法）
  const ep = await api.be(`/api/v2/episodes/${epId}`);
  const epNo = ep.json?.data?.episodeNumber ?? ep.json?.data?.episode_number ?? 1;
  const w = await api.beMethod('PUT', `/api/v1/dramas/${p.id}/episodes`, { episodes: [{ episode_number: epNo, title: '第一集', script_content: text }] });
  if (w.status !== 200) throw new Error('sync script_content failed: ' + w.status);
  return { projectId: p.id, episodeId: epId };
}

async function v1Shots(episodeId) {
  const r = await api.be(`/api/v1/episodes/${episodeId}/storyboards`);
  return { status: r.status, list: r.json?.data?.storyboards || [], body: r.json?.data };
}

(async () => {
  // TC-001 v2.1 结构创建：场次→镜头+时段
  // @test_id STORYBOARD_001_create_from_script
  await run(meta('TC-STORYBOARD-001', '从剧本结构创建分镜（场次→镜头+时段）：镜头数=场次数、标题取场次标题、每镜 6 秒时段', 'P0'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'STRUCT');
    const r = await api.be(`/api/v2/episodes/${episodeId}/storyboard/create-from-script`, {});
    cs.log(`create-from-script -> ${r.status} ${r.text.slice(0, 120)}`);
    cs.eq('结构创建 201', r.status, 201);
    cs.eq('created == 场次数 2', r.json?.data?.created, 2);
    const list = await api.be(`/api/v2/episodes/${episodeId}/storyboard`);
    const shots = list.json?.data?.shots || [];
    cs.eq('镜头列表数量 2', shots.length, 2);
    cs.expect('镜头标题来自场次标题', String(shots[0]?.title).includes('钟表店') && String(shots[1]?.title).includes('老街'), JSON.stringify(shots.map((s) => s.title)));
    cs.expect('每镜 duration=6 秒（DEFAULT_SHOT_SECONDS）', shots.every((s) => Number(s.duration) === 6), JSON.stringify(shots.map((s) => s.duration)));
    cs.expect('镜号连续 1..2', shots.map((s) => s.storyboard_number).join(','), '1,2');
    const segs = q('SELECT * FROM storyboard_segments WHERE storyboard_id = ? ORDER BY seq', shots[0].id);
    cs.expect('每镜含时段结构（seq=1, 0→6s, visual=场次摘要）', segs.length === 1 && Number(segs[0].start_seconds) === 0 && Number(segs[0].end_seconds) === 6, JSON.stringify(segs.map((s) => [s.seq, s.start_seconds, s.end_seconds])));
    const scRows = q1('SELECT COUNT(*) AS n FROM story_scenes WHERE episode_id = ?', episodeId);
    cs.eq('数据流：场次来自已确认剧本 story_scenes', scRows.n, 2);
  });

  // TC-002 结构创建前置校验（零模型）
  // @test_id STORYBOARD_002_requires_approved
  await run(meta('TC-STORYBOARD-002', '结构创建前置：无已确认剧本 409 SCRIPT_NOT_APPROVED', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-NOAPP`);
    const epId = await createEpisode(cs, p.id, '第一集');
    const r = await api.be(`/api/v2/episodes/${epId}/storyboard/create-from-script`, {});
    cs.log(`no-approved -> ${r.status} ${r.text.slice(0, 140)}`);
    cs.eq('未确认剧本 409', r.status, 409);
    cs.eq('错误码 SCRIPT_NOT_APPROVED', r.json?.error?.code, 'SCRIPT_NOT_APPROVED');
  });

  // TC-003 结构 diff 向导
  // @test_id STORYBOARD_003_structure_diff
  await run(meta('TC-STORYBOARD-003', '结构 diff：剧本新增场次后 preview 标记 added；apply-structure-diff 落为新镜头', 'P1'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'DIFF');
    await api.be(`/api/v2/episodes/${episodeId}/storyboard/create-from-script`, {});
    // 剧本追加第三场并重新确认
    await saveDraft(episodeId, SCRIPT + '\n\n内景 地下工作室 夜\nQA-L3主角发现秘密图纸。');
    await confirmScript(episodeId);
    const diff = await api.be(`/api/v2/episodes/${episodeId}/storyboard/structure-diff`);
    cs.eq('structure-diff 200', diff.status, 200);
    const added = diff.json?.data?.added || [];
    cs.eq('preview 标记 1 条 added', added.length, 1);
    cs.expect('added 内容为新场次标题', String(added[0]?.title || '').includes('地下工作室'), JSON.stringify(added).slice(0, 140));
    const apply = await api.be(`/api/v2/episodes/${episodeId}/storyboard/apply-structure-diff`, { diff: { added } });
    cs.eq('apply-structure-diff 200', apply.status, 200);
    const list = await api.be(`/api/v2/episodes/${episodeId}/storyboard`);
    cs.eq('应用后镜头数 3', (list.json?.data?.shots || []).length, 3);
    cs.expect('新镜头标题落库', String((list.json?.data?.shots || [])[2]?.title || '').includes('地下工作室'), (list.json?.data?.shots || [])[2]?.title);
  });

  // TC-004 v1 手动创建
  // @test_id STORYBOARD_004_manual_create
  await run(meta('TC-STORYBOARD-004', '手动新增分镜：全字段创建→v1 列表按镜号有序回读', 'P0'), async (cs) => {
    const { projectId, episodeId } = await makeStoryboardReady(cs, 'MANUAL');
    const mk = await api.be('/api/v1/storyboards', {
      episode_id: episodeId, storyboard_number: 1, title: `${uniq}-镜一`, description: '主角修表特写', dialogue: '这块表，停在三点。', narration: '旁白：钟表店的一天开始了',
      shot_type: '特写', angle: '平拍', movement: '固定', duration: 8, atmosphere: '怀旧', action: '指尖转动发条',
    });
    cs.log(`create storyboard -> ${mk.status} ${mk.text.slice(0, 140)}`);
    cs.eq('创建分镜 201', mk.status, 201);
    cs.log('[观察项 INV-5.2b] POST /storyboards 不传 storyboard_number 时默认写 0（storyboardCanonicalRepository.js:358）——前端画布创建时自行计算 max+1 传入，API 层不自动编号，调用方漏传会产生重复镜号，如实记录');
    const sid = mk.json?.data?.id;
    cs.eq('镜号自动为 1', mk.json?.data?.storyboard_number, 1);
    const { list } = await v1Shots(episodeId);
    cs.expect('v1 列表可见且字段回读', list.length === 1 && list[0].title === `${uniq}-镜一` && list[0].shot_type === '特写' && Number(list[0].duration) === 8, JSON.stringify(list.map((s) => [s.title, s.shot_type, s.duration])));
    const dbRow = q1('SELECT dialogue, narration, atmosphere, action FROM storyboards WHERE id = ?', sid);
    cs.expect('DB 对白/旁白/氛围/动作落库', dbRow.dialogue === '这块表，停在三点。' && dbRow.narration.startsWith('旁白：') && dbRow.atmosphere === '怀旧', JSON.stringify(dbRow));
    void projectId;
  });

  // TC-005 插入与删除
  // @test_id STORYBOARD_005_insert_delete
  await run(meta('TC-STORYBOARD-005', '分镜插入/删除：insert-before 后续镜号整体后移；删除软删且列表不再可见', 'P0'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'INS', SCRIPT);
    const a = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: 'A' });
    const b = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 2, title: 'B' });
    const c = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 3, title: 'C' });
    cs.expect('三个分镜创建', JSON.stringify([a.status, b.status, c.status]) === JSON.stringify([201, 201, 201]), JSON.stringify([a.status, b.status, c.status]));
    const ins = await api.be(`/api/v1/storyboards/${c.json?.data?.id}/insert-before`, {});
    cs.eq('在 C 前插入 201', ins.status, 201);
    const insId = ins.json?.data?.id;
    cs.eq('新分镜占用 C 原镜号 3', ins.json?.data?.storyboard_number, 3);
    let { list } = await v1Shots(episodeId);
    const byTitle = Object.fromEntries(list.map((s) => [s.title, s.storyboard_number]));
    cs.expect('C 被挤到 4，A/B 不变', byTitle['C'] === 4 && byTitle['A'] === 1 && byTitle['B'] === 2, JSON.stringify(byTitle));
    const del = await api.beMethod('DELETE', `/api/v1/storyboards/${insId}`);
    cs.eq('删除插入镜 200', del.status, 200);
    ({ list } = await v1Shots(episodeId));
    cs.expect('删除后列表不含该镜', !list.some((s) => s.id === insId), `total=${list.length}`);
    const dbRow = q1('SELECT deleted_at FROM storyboards WHERE id = ?', insId);
    cs.expect('DB 软删标记（deleted_at 非空）', Boolean(dbRow?.deleted_at), String(dbRow?.deleted_at));
    const cnt = q1('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL', episodeId);
    cs.eq('活跃分镜剩 3', cnt.n, 3);
  });

  // TC-006 镜号排序完整性
  // @test_id STORYBOARD_006_number_integrity
  await run(meta('TC-STORYBOARD-006', '镜号排序完整性：多次插入/删除后镜号无重复且按序排列', 'P1'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'ORDER');
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: i + 1, title: `S${i}` });
      ids.push(r.json?.data?.id);
    }
    await api.be(`/api/v1/storyboards/${ids[1]}/insert-before`, {});
    await api.be(`/api/v1/storyboards/${ids[0]}/insert-before`, {});
    await api.beMethod('DELETE', `/api/v1/storyboards/${ids[2]}`);
    const { list } = await v1Shots(episodeId);
    const nums = list.map((s) => s.storyboard_number);
    cs.expect('镜号升序', JSON.stringify(nums) === JSON.stringify([...nums].sort((x, y) => x - y)), JSON.stringify(nums));
    cs.expect('镜号无重复', new Set(nums).size === nums.length, JSON.stringify(nums));
    cs.eq('剩余 4 镜（3 建 + 2 插 - 1 删）', list.length, 4);
  });

  // TC-007 行内编辑全字段
  // @test_id STORYBOARD_007_inline_edit
  await run(meta('TC-STORYBOARD-007', '行内编辑全字段：旁白/动作/对白/景别/机位/运镜/氛围/情绪/转场/提示词 PUT 回读一致', 'P0'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'EDIT');
    const mk = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '编辑镜' });
    const sid = mk.json?.data?.id;
    const patch = {
      title: '编辑镜v2', description: 'desc-v2', narration: 'nar-v2', action: 'act-v2', dialogue: 'dlg-v2',
      shot_type: '远景', angle: '俯拍', angle_h: '左 30', angle_v: '俯 15', angle_s: '旋转', movement: '推镜',
      atmosphere: '紧张', emotion: '惊恐', emotion_intensity: 0.8, transition: '硬切',
      image_prompt: 'img-prompt-v2', video_prompt: 'video-prompt-v2', layout_description: 'layout-v2',
      lighting_style: 'low_key', depth_of_field: 'shallow', duration: 12,
    };
    cs.log('[契约观察] transition 为 AV 契约 JSON 字段：字符串输入会被规范化为结构化对象（storyboardAvContractService），断言按规范化语义');
    const up = await api.beMethod('PUT', `/api/v1/storyboards/${sid}`, patch);
    cs.log(`edit -> ${up.status} ${up.text.slice(0, 120)}`);
    cs.eq('行内编辑 200', up.status, 200);
    const one = await api.be(`/api/v1/storyboards/${sid}`);
    const d = one.json?.data || {};
    const mismatches = Object.entries(patch).filter(([k, v]) => k !== 'transition' && JSON.stringify(d[k]) !== JSON.stringify(v));
    cs.expect('其余 20 个编辑字段回读一致', mismatches.length === 0, JSON.stringify(mismatches));
    const trOk = (typeof d.transition === 'object' && d.transition && d.transition.type === 'cut') || d.transition === '硬切';
    cs.expect('transition 按音画契约规范化（硬切→结构化 type=cut）', trOk, JSON.stringify(d.transition));
    const dbRow = q1('SELECT shot_type, movement, emotion_intensity, transition FROM storyboards WHERE id = ?', sid);
    cs.expect('DB 层关键字段一致（transition 已规范化落库）', dbRow.shot_type === '远景' && dbRow.movement === '推镜' && Number(dbRow.emotion_intensity) === 0.8 && String(dbRow.transition).includes('"type":"cut"'), JSON.stringify(dbRow).slice(0, 200));
  });

  // TC-008 绑定角色
  // @test_id STORYBOARD_008_bind_characters
  await run(meta('TC-STORYBOARD-008', '绑定角色：character_ids 写入 JSON 投影并同步 storyboard_characters 关系表', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeStoryboardReady(cs, 'BINDC');
    const chars = await saveCharacters(projectId, [{ name: `${uniq}-镜中角色A` }, { name: `${uniq}-镜中角色B` }]);
    const mk = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '绑定镜', character_ids: chars.map((c) => c.id) });
    cs.eq('创建带角色绑定分镜 201', mk.status, 201);
    const sid = mk.json?.data?.id;
    const one = await api.be(`/api/v1/storyboards/${sid}`);
    cs.expect('GET 回读 characters JSON 为角色 ID 数组', JSON.stringify(one.json?.data?.characters) === JSON.stringify(chars.map((c) => c.id)), JSON.stringify(one.json?.data?.characters));
    const links = q('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?', sid);
    if (links.length === 0) {
      cs.log(`[观察项 INV-5.4b/INV-15.2] character_ids 同步 storyboard_characters 落了 0 行——syncStoryboardCharacterLinks（storyboardService.js:92-97）按「角色名」去 character_libraries 找同名项并写入**库条目 id**，找不到则静默跳过：真实项目角色（不在库中）不会被记录；即便命中也会把 character_libraries.id 写进名为 character_id 的列（引用语义错表）。与 feature-inventory §15「storyboard_characters 表 LEGACY 实库为空、角色关联以 storyboards.characters JSON 为准」一致，如实记录不判新缺陷`);
    } else {
      cs.log(`[观察] storyboard_characters 写入 ${links.length} 行（character_id=${links.map((l) => l.character_id).join(',')}），注意其语义为 character_libraries.id（storyboardService.js:95-97）`);
    }
    // 解绑（JSON 投影为准）
    await api.beMethod('PUT', `/api/v1/storyboards/${sid}`, { character_ids: [chars[0].id] });
    const one2 = await api.be(`/api/v1/storyboards/${sid}`);
    cs.expect('解绑后 characters JSON 仅剩 1 个角色（JSON 为权威事实源）', JSON.stringify(one2.json?.data?.characters) === JSON.stringify([chars[0].id]), JSON.stringify(one2.json?.data?.characters));
  });

  // TC-009 绑定角色变体
  // @test_id STORYBOARD_009_bind_variants
  await run(meta('TC-STORYBOARD-009', '绑定角色状态变体：character_variant_links 落 storyboard_character_variants 并被投影回读', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeStoryboardReady(cs, 'BINDV');
    const [ch] = await saveCharacters(projectId, [{ name: `${uniq}-变体镜角色`, image_url: '/static/characters/qa-l3-sbv.png' }]);
    const v = await api.be(`/api/v1/characters/${ch.id}/variants`, { name: '战损', source_key: `${uniq}-wound` });
    const vid = v.json?.data?.id;
    const mk = await api.be('/api/v1/storyboards', {
      episode_id: episodeId, storyboard_number: 1, title: '变体绑定镜',
      character_variant_links: [{ character_id: ch.id, variant_id: vid, reference_role: '主体', sort_order: 1, framing_note: '半身' }],
    });
    cs.eq('创建带变体绑定分镜 201', mk.status, 201);
    const sid = mk.json?.data?.id;
    const row = q1('SELECT * FROM storyboard_character_variants WHERE storyboard_id = ?', sid);
    cs.expect('storyboard_character_variants 落库（variant/reference_role/framing_note）', row && Number(row.variant_id) === Number(vid) && row.reference_role === '主体' && row.framing_note === '半身', JSON.stringify(row || {}).slice(0, 160));
    const one = await api.be(`/api/v1/storyboards/${sid}`);
    const links = one.json?.data?.character_variant_links || one.json?.data?.variant_links || [];
    cs.expect('GET 投影回读变体关联', links.length === 1 && Number(links[0]?.variant_id ?? links[0]?.variantId) === Number(vid), JSON.stringify(links).slice(0, 160));
  });

  // TC-010 绑定道具
  // @test_id STORYBOARD_010_bind_props
  await run(meta('TC-STORYBOARD-010', '绑定道具：创建时 prop_ids 与 POST /storyboards/:id/props 两条路径均写 storyboard_props', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeStoryboardReady(cs, 'BINDP');
    const p1 = await api.be('/api/v1/props', { drama_id: projectId, name: `${uniq}-道具壹`, image_url: '/static/props/p1.png' });
    const p2 = await api.be('/api/v1/props', { drama_id: projectId, name: `${uniq}-道具贰`, image_url: '/static/props/p2.png' });
    const mk = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '道具镜', prop_ids: [p1.json?.data?.id] });
    const sid = mk.json?.data?.id;
    let one = await api.be(`/api/v1/storyboards/${sid}`);
    cs.expect('创建路径绑定回读 prop_ids', JSON.stringify(one.json?.data?.prop_ids) === JSON.stringify([p1.json?.data?.id]), JSON.stringify(one.json?.data?.prop_ids));
    const assoc = await api.be(`/api/v1/storyboards/${sid}/props`, { prop_ids: [p2.json?.data?.id] });
    cs.eq('associateProps 路径 200', assoc.status, 200);
    let rows = q('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?', sid);
    cs.expect('associateProps 为「整表替换」语义：传入 [p2] 后仅剩 p2（propService.associateWithStoryboard 先 DELETE 全部再插入）', JSON.stringify(rows.map((r) => Number(r.prop_id))) === JSON.stringify([p2.json?.data?.id]), JSON.stringify(rows));
    const assoc2 = await api.be(`/api/v1/storyboards/${sid}/props`, { prop_ids: [p1.json?.data?.id, p2.json?.data?.id] });
    cs.eq('替换为完整集合 200', assoc2.status, 200);
    rows = q('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?', sid);
    cs.expect('全量绑定后关系表两行', rows.length === 2, JSON.stringify(rows));
    one = await api.be(`/api/v1/storyboards/${sid}`);
    cs.expect('GET prop_ids 含两个道具', (one.json?.data?.prop_ids || []).length === 2, JSON.stringify(one.json?.data?.prop_ids));
  });

  // TC-011 绑定场景
  // @test_id STORYBOARD_011_bind_scene
  await run(meta('TC-STORYBOARD-011', '绑定场景：scene_id 持久化，删除场景时分镜 scene_id 置空（不悬挂）', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeStoryboardReady(cs, 'BINDS');
    const sc = await api.be('/api/v1/scenes', { drama_id: projectId, episode_id: episodeId, location: `QA-L3-分镜场景-${Date.now()}`, time: '日', prompt: 'x' });
    const sceneId = sc.json?.data?.id;
    const mk = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '场景镜', scene_id: sceneId });
    const sid = mk.json?.data?.id;
    let one = await api.be(`/api/v1/storyboards/${sid}`);
    cs.eq('scene_id 绑定回读', one.json?.data?.scene_id, sceneId);
    await api.beMethod('DELETE', `/api/v1/scenes/${sceneId}`);
    one = await api.be(`/api/v1/storyboards/${sid}`);
    cs.eq('场景删除后 scene_id 置空（级联清理）', one.json?.data?.scene_id ?? null, null);
  });

  // TC-012 引用槽位
  // @test_id STORYBOARD_012_reference_slots
  await run(meta('TC-STORYBOARD-012', '引用槽位：场景+角色状态按序解析为槽位，指纹稳定可复核', 'P1'), async (cs) => {
    const { projectId, episodeId } = await makeStoryboardReady(cs, 'SLOT');
    const sc = await api.be('/api/v1/scenes', { drama_id: projectId, episode_id: episodeId, location: `QA-L3-槽位场景`, time: '夜', prompt: 'x', image_url: '/static/scenes/slot.png' });
    const sceneId = sc.json?.data?.id;
    const [ch] = await saveCharacters(projectId, [{ name: `${uniq}-槽位角色`, image_url: '/static/characters/slot.png' }]);
    const v = await api.be(`/api/v1/characters/${ch.id}/variants`, { name: '常服', source_key: `${uniq}-casual` });
    await api.beMethod('PUT', `/api/v1/character-variants/${v.json?.data?.id}`, { image_url: '/static/variants/slot.png' });
    const mk = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '槽位镜', scene_id: sceneId, character_variant_links: [{ character_id: ch.id, variant_id: v.json?.data?.id, sort_order: 1 }] });
    cs.log('[观察项/缺陷] 缺 sort_order 的变体关联会被 500 INTERNAL_ERROR 拒绝（「人物状态排序值无效」）——校验类错误误用 500，另记 BUG-L3-302');
    cs.log(`create slot shot -> ${mk.status} ${mk.text.slice(0, 160)}`);
    const sid = mk.json?.data?.id;
    const s1 = await api.be(`/api/v1/storyboards/${sid}/reference-slots`);
    cs.eq('reference-slots 200', s1.status, 200);
    const slots = s1.json?.data?.slots || [];
    cs.eq('槽位总数 2（场景+变体）', s1.json?.data?.total, 2);
    cs.expect('槽位 1 为场景且图可用', slots[0]?.type === 'scene' && slots[0]?.image_available === true, JSON.stringify(slots[0] || {}).slice(0, 140));
    cs.expect('槽位 2 为人物状态且图可用', slots[1]?.type === 'character_variant' && Number(slots[1]?.variant_id) === Number(v.json?.data?.id) && slots[1]?.image_available === true, String(JSON.stringify(slots[1] || {})).slice(0, 160));
    const s2 = await api.be(`/api/v1/storyboards/${sid}/reference-slots`);
    cs.eq('两次解析指纹一致（幂等）', s2.json?.data?.fingerprint, s1.json?.data?.fingerprint);
    const nf = await api.be('/api/v1/storyboards/99999999/reference-slots');
    cs.eq('不存在分镜 404', nf.status, 404);
  });

  // TC-013 帧提示词手存（不触发 LLM 的 frame-prompts 读写路径）
  // @test_id STORYBOARD_013_frame_prompts
  await run(meta('TC-STORYBOARD-013', '首/尾帧提示词：手动保存 first/last → 列表回读；非法 frame_type 400', 'P1'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'FRAME');
    const mk = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '帧镜' });
    const sid = mk.json?.data?.id;
    const p1 = await api.beMethod('PUT', `/api/v1/storyboards/${sid}/frame-prompts/first`, { prompt: 'QA-L3 首帧：修表台特写', description: '台灯下', layout: '单主体居中' });
    cs.eq('保存首帧提示词 200', p1.status, 200);
    const p2 = await api.beMethod('PUT', `/api/v1/storyboards/${sid}/frame-prompts/last`, { prompt: 'QA-L3 尾帧：主角走出店门' });
    cs.eq('保存尾帧提示词 200', p2.status, 200);
    const list = await api.be(`/api/v1/storyboards/${sid}/frame-prompts`);
    const fps = list.json?.data?.frame_prompts || [];
    cs.expect('列表含 first/last 两帧', fps.map((f) => f.frame_type).sort().join(',') === 'first,last', JSON.stringify(fps.map((f) => f.frame_type)));
    cs.expect('首帧 prompt/layout 回读一致', fps.find((f) => f.frame_type === 'first')?.prompt === 'QA-L3 首帧：修表台特写' && fps.find((f) => f.frame_type === 'first')?.layout === '单主体居中', JSON.stringify(fps).slice(0, 160));
    const bad = await api.beMethod('PUT', `/api/v1/storyboards/${sid}/frame-prompts/middle`, { prompt: 'x' });
    cs.eq('非法 frame_type 400', bad.status, 400);
    const rows = q('SELECT frame_type, prompt FROM frame_prompts WHERE storyboard_id = ?', sid);
    cs.expect('DB frame_prompts 落库', rows.length === 2, JSON.stringify(rows));
  });

  // TC-014 沿用上一镜尾帧（契约：无视频时的真实错误路径）
  // @test_id STORYBOARD_014_tail_frame_contract
  await run(meta('TC-STORYBOARD-014', '尾帧衔接契约：缺参 400；无已完成视频 400（成功路径依赖视频生成，属 VIDEO/E2E 范围）', 'P1'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'TAIL');
    const mk = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '尾帧镜' });
    const sid = mk.json?.data?.id;
    const noArgs = await api.be(`/api/v1/storyboards/${sid}/link-tail-frame`, {});
    cs.expect('缺 drama_id 400 缺少必要参数', noArgs.status === 400 && noArgs.json?.error === '缺少必要参数', noArgs.text.slice(0, 100));
    const noVideo = await api.be(`/api/v1/storyboards/${sid}/link-tail-frame`, { drama_id: 1 });
    cs.log(`no-video -> ${noVideo.status} ${noVideo.text.slice(0, 120)}`);
    cs.expect('当前分镜无可用本地视频 400', noVideo.status === 400 && String(noVideo.json?.error || noVideo.text).includes('视频'), noVideo.text.slice(0, 120));
  });

  // TC-015 从剧集生成分镜（本 wave 唯一一次 STORYBOARD 真实 DeepSeek 调用）
  // @test_id STORYBOARD_015_generate_real
  await run(meta('TC-STORYBOARD-015', '从剧集生成分镜（真实 DeepSeek 异步）：任务受理→完成→结构化镜头落库', 'P0'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'GEN', `内景 钟表店 日\n${'QA-L3主角'}与钟叔争执，怀表摔在地上停摆。\n\n外景 老街 夜\n${'QA-L3主角'}捡起怀表，发现表盖内侧刻着陌生名字。`);
    const before = q1('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL', episodeId).n;
    let r = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        r = await api.be(`/api/v1/episodes/${episodeId}/storyboards`, { storyboard_count: 3, video_duration: 15, aspect_ratio: '9:16' }, { timeoutMs: 60000 });
        break;
      } catch (e) {
        cs.log(`start attempt#${attempt} 网络异常: ${e.message}，5s 后重试`);
        await new Promise((res) => setTimeout(res, 5000));
        if (attempt === 3) throw e;
      }
    }
    cs.log(`generate -> ${r.status} ${r.text.slice(0, 140)}`);
    cs.eq('生成受理 200', r.status, 200);
    const taskId = r.json?.data?.task_id || r.json?.data?.id;
    cs.expect('返回异步任务 ID', Boolean(taskId), r.text.slice(0, 120));
    if (!taskId) return;
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
      cs.log(`poll#${i + 1} status=${task?.status} progress=${task?.progress} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) break;
    }
    cs.eq('任务最终 completed', task?.status, 'completed');
    const { list } = await v1Shots(episodeId);
    cs.expect('数据流：生成产生新分镜（数量增加）', list.length > before, `before=${before} after=${list.length}`);
    const sample = list[0] || {};
    cs.expect('镜头结构完整（storyboard_number/description/duration）', sample.storyboard_number >= 1 && (sample.description || sample.action || sample.dialogue) && Number(sample.duration) > 0, JSON.stringify({ n: sample.storyboard_number, d: sample.description, dur: sample.duration }).slice(0, 160));
    cs.log(`[AI 产出] 共 ${list.length} 镜；首镜：${String(sample.description || sample.title || '').slice(0, 80)}`);
  });

  // TC-016 生成前置校验（零模型）
  // @test_id STORYBOARD_016_generate_preconditions
  await run(meta('TC-STORYBOARD-016', '生成前置校验（零模型调用）：不存在剧集与空剧本均在任务创建前拒绝', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-NOPRE`);
    const epId = await createEpisode(cs, p.id, '第一集');
    const r1 = await api.be(`/api/v1/episodes/99999999/storyboards`, { storyboard_count: 2 }, { timeoutMs: 30000 });
    cs.log(`no-episode -> ${r1.status} ${r1.text.slice(0, 120)}`);
    cs.expect('不存在剧集被拒绝且提示剧集不存在', r1.status >= 400 && r1.text.includes('剧集不存在'), `${r1.status}`);
    const r2 = await api.be(`/api/v1/episodes/${epId}/storyboards`, { storyboard_count: 2 }, { timeoutMs: 30000 });
    cs.log(`empty-script -> ${r2.status} ${r2.text.slice(0, 120)}`);
    cs.expect('空剧本被拒绝且提示剧本内容为空', r2.status >= 400 && r2.text.includes('剧本内容为空'), `${r2.status}`);
    cs.log('[观察项] 两类业务前置错误均以 500 INTERNAL_ERROR 返回（generateStoryboard service 抛错→internalError），语义应为 400——如实记录');
  });

  // TC-017 v2 分镜列表与完成度
  // @test_id STORYBOARD_017_v2_list_completion
  await run(meta('TC-STORYBOARD-017', 'v2 分镜列表：shots 与 completion 完成度结构', 'P1'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'V2LIST');
    await api.be('/api/v1/storyboards', { episode_id: episodeId, title: 'V2镜一', dialogue: '台词', duration: 5 });
    const r = await api.be(`/api/v2/episodes/${episodeId}/storyboard`);
    cs.eq('v2 storyboard 200', r.status, 200);
    const data = r.json?.data || {};
    cs.expect('shots 数组 + completion 结构', Array.isArray(data.shots) && data.shots.length === 1 && typeof data.completion === 'object', JSON.stringify({ shots: data.shots?.length, completion: data.completion }).slice(0, 140));
    const segs = q('SELECT * FROM storyboard_segments WHERE storyboard_id = ?', data.shots[0].id);
    if (segs.length === 0) cs.log('[记录] 手工 v1 创建镜头无段结构（段由 v2.1 结构创建/段编辑维护），completion 基于段计算');
    cs.expect('镜头含 completion 字段', 'completion' in (data.shots[0] || {}), JSON.stringify(data.shots[0]?.completion).slice(0, 100));
  });

  // TC-018 v2 镜头详情与段编辑
  // @test_id STORYBOARD_018_v2_segment_edit
  await run(meta('TC-STORYBOARD-018', 'v2 镜头详情与段编辑：segments 读写（visual/dialogue/sound）回读一致', 'P1', 'integration'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'SEG');
    await api.be(`/api/v2/episodes/${episodeId}/storyboard/create-from-script`, {});
    const list = await api.be(`/api/v2/episodes/${episodeId}/storyboard`);
    const shot = (list.json?.data?.shots || [])[0];
    const det = await api.be(`/api/v2/storyboards/${shot.id}`);
    cs.eq('镜头详情 200', det.status, 200);
    const shotData = det.json?.data?.shot || det.json?.data || {};
    const seg = (shotData.segments || [])[0];
    cs.expect('详情含段结构', Boolean(seg), String(JSON.stringify(shotData.segments)).slice(0, 140));
    const segId = seg.id;
    const patch = await api.beMethod('PATCH', `/api/v2/storyboards/${shot.id}/segments/${segId}`, { visual: '主角推门而入（QA-L3 改）', dialogue: '我来取表。' });
    cs.log(`patch segment -> ${patch.status} ${patch.text.slice(0, 120)}`);
    cs.eq('段编辑 200', patch.status, 200);
    const det2 = await api.be(`/api/v2/storyboards/${shot.id}`);
    const seg2 = ((det2.json?.data?.shot || det2.json?.data || {}).segments || [])[0];
    cs.expect('段编辑回读一致', seg2.visual === '主角推门而入（QA-L3 改）' && seg2.dialogue === '我来取表。', JSON.stringify(seg2).slice(0, 160));
    const dbRow = q1('SELECT visual, dialogue FROM storyboard_segments WHERE id = ?', segId);
    cs.expect('DB 段行一致', dbRow.visual === '主角推门而入（QA-L3 改）', JSON.stringify(dbRow));
  });

  // TC-019 Excel 导出（真实产物，使用真实前端导出工具）
  // @test_id STORYBOARD_019_excel_export
  await run(meta('TC-STORYBOARD-019', '分镜 Excel 导出：真实前端导出工具以 API 实时数据构建 24 列工作表并落盘', 'P0', 'integration'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'XLS');
    await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '导出镜一', dialogue: '导出对白A', narration: '导出旁白A', shot_type: '特写', movement: '固定', duration: 6, description: '导出描述A' });
    await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 2, title: '导出镜二', dialogue: '导出对白B', duration: 7, description: '导出描述B' });
    const { list } = await v1Shots(episodeId);
    const sheet = await import('file:///E:/project/LocalMiniDrama/frontweb/src/utils/exportStoryboardSheet.js');
    const rows = sheet.buildStoryboardSheetRows({
      storyboards: list,
      getField: (sb, f) => sb[f],
      getScene: () => null,
      getCharacters: () => [],
      getProps: () => [],
      getMovementLabel: (m) => m,
      getFirstFramePrompt: () => null,
      getLastFramePrompt: () => null,
    });
    cs.eq('行数=镜头数 2', rows.length, 2);
    cs.expect('每行 24 列（与 COLUMNS 一致）', rows.every((r) => r.length === 24), `cols=${rows[0]?.length}`);
    const rowA = rows[0];
    cs.expect('首行标题/景别/时长/对白/旁白与 API 数据一致（导出数据流：DB→API→导出行）', String(rowA[2]).includes('导出镜一') && String(rowA[4]) === '6' && rowA[5] === '特写' && rowA[13] === '导出对白A' && rowA[14] === '导出旁白A', JSON.stringify(rowA.slice(0, 16)).slice(0, 220));
    cs.expect('次行镜二数据一致', String(rows[1][2]).includes('导出镜二') && rows[1][13] === '导出对白B', JSON.stringify(rows[1].slice(0, 15)).slice(0, 160));
    // 表头取自真实工具源码中的 COLUMNS 字面量；用与 downloadStoryboardExcel 相同的 HTML 模板落盘 .xls（DOM 下载在 Node 不可执行）
    const src = fs.readFileSync('E:/project/LocalMiniDrama/frontweb/src/utils/exportStoryboardSheet.js', 'utf8');
    const m = src.match(/const COLUMNS = \[([\s\S]*?)\]/);
    const columns = m ? eval(`[${m[1]}]`) : [];
    cs.eq('表头列数 24', columns.length, 24);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
    const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');
    const body = rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    const html = `<!DOCTYPE html>\n<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">\n<head><meta charset="utf-8"></head>\n<body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const out = path.join(ART_DIR, 'TC-STORYBOARD-019-storyboard-sheet.xls');
    fs.writeFileSync(out, '\uFEFF' + html, 'utf8');
    cs.expect('导出产物已落盘（qa/run/wave3-artifacts）', fs.existsSync(out) && fs.statSync(out).size > 500, `${out} bytes=${fs.statSync(out).size}`);
  });

  // TC-020 SRT 导出
  // @test_id STORYBOARD_020_srt_export
  await run(meta('TC-STORYBOARD-020', 'SRT 导出：无成片版本 API 如实拒绝；真实 buildSrt 以本集镜头数据产出合法 SRT 产物', 'P0', 'integration'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'SRT');
    await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: 'SRT镜一', duration: 5 });
    await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 2, title: 'SRT镜二', duration: 8 });
    const r = await api.be(`/api/v2/episodes/${episodeId}/cut/export`, { format: 'srt' });
    cs.log(`cut/export srt -> ${r.status} ${r.text.slice(0, 140)}`);
    cs.expect('无成片版本时 ok=false + 明确 reason（真实 API 契约）', r.status === 200 && r.json?.data?.ok === false && String(r.json?.data?.reason || '').includes('成片'), r.text.slice(0, 140));
    // 真实 cutService.buildSrt（产品源码 + 只读实库数据）产出 SRT 产物
    const cutService = require('E:/project/LocalMiniDrama/backend-node/src/v21/cut/cutService.js');
    const Database = require('E:/project/LocalMiniDrama/backend-node/node_modules/better-sqlite3');
    const roDb = new Database('E:/project/LocalMiniDrama/backend-node/data/drama_generator.db', { readonly: true, fileMustExist: true });
    const svc = cutService.createCutService(roDb, { log: console });
    const srt = svc.buildSrt(episodeId);
    cs.expect('SRT 含 2 条 cue（按镜头时段）', (srt.match(/-->/g) || []).length === 2, JSON.stringify(srt).slice(0, 160));
    cs.expect('时间戳格式 HH:MM:SS,mmm --> HH:MM:SS,mmm', /\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(srt), srt.split('\n').slice(0, 4).join(' | '));
    cs.expect('首条 cue 时段为 0→5s', srt.includes('00:00:00,000 --> 00:00:05,000'), srt.split('\n')[1]);
    const out = path.join(ART_DIR, 'TC-STORYBOARD-020-episode.srt');
    fs.writeFileSync(out, srt, 'utf8');
    cs.expect('SRT 产物已落盘', fs.existsSync(out) && fs.statSync(out).size > 40, `${out} bytes=${fs.statSync(out).size}`);
    roDb.close();
  });

  // TC-021 批量推理（摄影参数推断，非图像推理）
  // @test_id STORYBOARD_021_batch_infer
  await run(meta('TC-STORYBOARD-021', '批量推理接口：按镜头字段推断运动/光效/景深并回填；overwrite=false 不覆盖已有值', 'P1'), async (cs) => {
    const { episodeId } = await makeStoryboardReady(cs, 'INFER');
    const a = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 1, title: '推断镜A', action: '主角猛然起身打翻台灯', atmosphere: '夜晚紧张' });
    const b = await api.be('/api/v1/storyboards', { episode_id: episodeId, storyboard_number: 2, title: '推断镜B', action: '缓慢推门', movement: '已手工指定' });
    void b;
    const r = await api.be('/api/v1/storyboards/batch-infer-params', { episode_id: episodeId, overwrite: false });
    cs.log(`batch-infer -> ${r.status} ${r.text.slice(0, 140)}`);
    cs.eq('批量推理 200', r.status, 200);
    cs.expect('total=2 且 updated>=1', Number(r.json?.data?.total) === 2 && Number(r.json?.data?.updated) >= 1, JSON.stringify(r.json?.data));
    const rowA = q1('SELECT movement, lighting_style, depth_of_field FROM storyboards WHERE id = ?', a.json?.data?.id);
    cs.expect('镜A 被回填推断参数', Boolean(rowA.movement || rowA.lighting_style || rowA.depth_of_field), JSON.stringify(rowA));
    const rowB = q1('SELECT movement FROM storyboards WHERE id = ?', b.json?.data?.id);
    cs.eq('overwrite=false 保留镜B 已有 movement', rowB.movement, '已手工指定');
    const noEp = await api.be('/api/v1/storyboards/batch-infer-params', {});
    cs.eq('缺 episode_id 400', noEp.status, 400);
  });

  // TC-022 404 契约
  // @test_id STORYBOARD_022_not_found
  await run(meta('TC-STORYBOARD-022', '分镜 404 契约：getOne/PUT/DELETE/insert-before 不存在均 404', 'P2'), async (cs) => {
    cs.eq('getOne 404', (await api.be('/api/v1/storyboards/99999999')).status, 404);
    cs.eq('PUT 404', (await api.beMethod('PUT', '/api/v1/storyboards/99999999', { title: 'x' })).status, 404);
    cs.eq('DELETE 404', (await api.beMethod('DELETE', '/api/v1/storyboards/99999999')).status, 404);
    cs.eq('insert-before 404', (await api.be('/api/v1/storyboards/99999999/insert-before', {})).status, 404);
  });

  console.log('\n[STORYBOARD] 全部用例执行完毕');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
