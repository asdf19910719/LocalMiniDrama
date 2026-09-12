// EPSET 模块执行（TC-EPSET-001..009）：本集设定（v2.1 本集引用投影/就绪状态/进入分镜/音色抽屉），真实 API
// 零模型调用：全部走结构创建/上传 URL 绑定路径
const { api, runCase, q1, q, createV1Project, createEpisode, saveDraft, confirmScript, saveCharacters } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'EPSET', level: level || 'system', priority });
const uniq = `QA-L3-EPSET-${Date.now()}`;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (m, fn) => { if (!ONLY || ONLY.includes(m.id)) return runCase(m, fn); return Promise.resolve('skipped-by-filter'); };

const SCRIPT_BODY = (heroName, extraLine) =>
  `内景 钟表店 日\n${heroName}低头修表，齿轮声细密。\n${extraLine || ''}`;

async function makeConfirmedEpisode(cs, heroName, opts = {}) {
  const p = await createV1Project(cs, `${uniq}-${opts.tag || 'EP'}`);
  const epId = await createEpisode(cs, p.id, '第一集');
  const chars = await saveCharacters(p.id, [
    { name: heroName, appearance: opts.heroLook || '黑色短发，红色外套' },
    ...(opts.extraChars || []),
  ]);
  if (!opts.skipDraft) {
    const d = await saveDraft(epId, SCRIPT_BODY(heroName, opts.extraScriptLine));
    if (d.status !== 200) throw new Error('saveDraft failed: ' + d.status + ' ' + d.text.slice(0, 150));
    const c = await confirmScript(epId);
    if (c.status !== 200) throw new Error('confirm failed: ' + c.status + ' ' + c.text.slice(0, 150));
  }
  return { projectId: p.id, episodeId: epId, chars };
}

async function getAssets(episodeId) {
  const r = await api.be(`/api/v2/episodes/${episodeId}/assets`);
  return { status: r.status, body: r.json?.data || {}, text: r.text };
}

(async () => {
  // TC-001 QA-006 修复路径：剧本按名匹配人物并入投影
  // @test_id EPSET_001_projection_name_match
  await run(meta('TC-EPSET-001', '本集引用投影：已确认剧本按名匹配项目人物并入投影（QA-006 修复路径），未引用人物不出现', 'P0'), async (cs) => {
    const hero = `${uniq}-林小海`;
    const { projectId, episodeId, chars } = await makeConfirmedEpisode(cs, hero, {
      extraChars: [{ name: `${uniq}-路人甲`, appearance: '无关人物' }],
      tag: 'MATCH',
    });
    const heroRow = chars.find((c) => c.name === hero);
    const strayRow = chars.find((c) => c.name !== hero);
    const dbLinks = q1('SELECT COUNT(*) AS n FROM episode_characters WHERE episode_id = ?', episodeId);
    cs.eq('前置：V2.1 原生流程未写 episode_characters（匹配纯按名）', dbLinks.n, 0);
    const { status, body } = await getAssets(episodeId);
    cs.eq('GET /episodes/:id/assets', status, 200);
    const charNames = (body.referenced?.characters || []).map((c) => c.name);
    cs.expect('投影包含剧本引用的人物（按名命中）', charNames.includes(hero), JSON.stringify(charNames));
    cs.expect('未在剧本出现的人物不入投影', !charNames.includes(`${uniq}-路人甲`), JSON.stringify(charNames));
    const heroProj = (body.referenced?.characters || []).find((c) => c.name === hero) || {};
    cs.expect('投影字段完整（assetId/stateId/required/blocked）', heroProj.assetId === heroRow.id && heroProj.required === true && heroProj.blocked === true, JSON.stringify(heroProj));
    cs.expect('blocked=true 因无 image_url', heroProj.currentImage == null && heroProj.mediaVersionId == null, JSON.stringify({ img: heroProj.currentImage }));
    void projectId; void strayRow;
  });

  // TC-002 场景/道具投影
  // @test_id EPSET_002_projection_scene_prop
  await run(meta('TC-EPSET-002', '本集引用投影：episode_id 场景入 scenes Tab、storyboard_props 绑定道具入 props Tab', 'P1'), async (cs) => {
    const hero = `${uniq}-投影女主`;
    const { projectId, episodeId } = await makeConfirmedEpisode(cs, hero, { tag: 'SP' });
    const sc = await api.be('/api/v1/scenes', { drama_id: projectId, episode_id: episodeId, location: `QA-L3-投影场景-${Date.now()}`, time: '夜', prompt: '测试' });
    cs.expect('前置：场景已建（绑定本集）', sc.status === 200 || sc.status === 201, sc.status);
    const prop = await api.be('/api/v1/props', { drama_id: projectId, episode_id: episodeId, name: `${uniq}-投影道具`, image_url: '/static/props/x.png' });
    const propId = prop.json?.data?.id;
    const sb = await api.be('/api/v1/storyboards', { episode_id: episodeId, title: 'QA-L3 投影镜', prop_ids: [propId], duration: 5 });
    cs.expect('前置：分镜已建并绑定道具', sb.status === 201, sb.text.slice(0, 140));
    const { status, body } = await getAssets(episodeId);
    cs.eq('GET assets 200', status, 200);
    const sceneNames = (body.referenced?.scenes || []).map((s) => s.name || s.location);
    cs.expect('scenes Tab 含本集场景（location 为名）', sceneNames.some((n) => String(n).includes('投影场景')), JSON.stringify(sceneNames));
    const propIds = (body.referenced?.props || []).map((p) => p.assetId);
    cs.expect('props Tab 含分镜绑定道具', propIds.includes(propId), JSON.stringify(propIds));
    const proj = (body.referenced?.props || []).find((p) => p.assetId === propId) || {};
    cs.eq('道具 required=false（可稍后处理）', proj.required, false);
  });

  // TC-003 就绪状态流转
  // @test_id EPSET_003_readiness_flow
  await run(meta('TC-EPSET-003', '就绪状态流转：script-unapproved → needs-attention（缺图）→ ready（全部必需项有图）', 'P0'), async (cs) => {
    const hero = `${uniq}-流转主角`;
    const p = await createV1Project(cs, `${uniq}-FLOW`);
    const epId = await createEpisode(cs, p.id, '第一集');
    await saveCharacters(p.id, [{ name: hero, appearance: '白衬衫' }]);
    let r = await api.be(`/api/v2/episodes/${epId}/media-guard`);
    cs.eq('未确认剧本 readiness=script-unapproved', r.json?.data?.readiness, 'script-unapproved');
    cs.eq('守卫未启用', r.json?.data?.enabled, false);
    await saveDraft(epId, SCRIPT_BODY(hero));
    await confirmScript(epId);
    const sc = await api.be('/api/v1/scenes', { drama_id: p.id, episode_id: epId, location: `QA-L3-流转场景-${Date.now()}`, time: '日', prompt: '测试' });
    void sc;
    let assets = await getAssets(epId);
    cs.eq('确认剧本后 readiness=needs-attention', assets.body.readiness?.status, 'needs-attention');
    const missing = assets.body.readiness?.missing || [];
    cs.expect('missing 列出全部无图必需项（人物+场景）', missing.length >= 2, JSON.stringify(missing.map((m) => `${m.assetType}:${m.assetId}`)));
    cs.expect('recovery 入口=去处理', assets.body.readiness?.recovery?.id === 'resolve-episode-assets', JSON.stringify(assets.body.readiness?.recovery || {}));
    // 逐项补图
    for (const item of assets.body.referenced.characters || []) {
      await api.beMethod('PUT', `/api/v1/characters/${item.assetId}/image`, { image_url: `/static/characters/qa-l3-${item.assetId}.png` });
    }
    for (const item of assets.body.referenced.scenes || []) {
      await api.beMethod('PUT', `/api/v1/scenes/${item.assetId}`, { image_url: `/static/scenes/qa-l3-${item.assetId}.png` });
    }
    assets = await getAssets(epId);
    cs.eq('全部必需项有图后 readiness=ready', assets.body.readiness?.status, 'ready');
    cs.expect('readyCount == totalCount', assets.body.readiness?.readyCount === assets.body.readiness?.totalCount, JSON.stringify(assets.body.readiness));
    const blocked = [...(assets.body.referenced.characters || []), ...(assets.body.referenced.scenes || [])].filter((x) => x.blocked);
    cs.eq('无 blocked 项', blocked.length, 0);
  });

  // TC-004 进入分镜前置条件与不可变快照
  // @test_id EPSET_004_enter_storyboard_gate
  await run(meta('TC-EPSET-004', '进入分镜：needs-attention 放行但不写快照；ready 时事务写入 active 快照与指纹', 'P0'), async (cs) => {
    const hero = `${uniq}-门禁主角`;
    const p = await createV1Project(cs, `${uniq}-GATE`);
    const epId = await createEpisode(cs, p.id, '第一集');
    await saveCharacters(p.id, [{ name: hero, appearance: '灰大衣' }]);
    await saveDraft(epId, SCRIPT_BODY(hero));
    await confirmScript(epId);
    let enter = await api.be(`/api/v2/episodes/${epId}/enter-storyboard`, {});
    cs.eq('needs-attention 也立即放行 navigation=immediate', enter.json?.data?.navigation, 'immediate');
    cs.eq('但快照为 null（必需项缺失不写快照）', enter.json?.data?.snapshot, null);
    const before = q1('SELECT COUNT(*) AS n FROM episode_asset_set_snapshots WHERE episode_id = ?', epId);
    cs.eq('DB 无快照行（零部分写入）', before.n, 0);
    // 补图至 ready
    const assets = await getAssets(epId);
    for (const item of assets.body.referenced.characters || []) {
      await api.beMethod('PUT', `/api/v1/characters/${item.assetId}/image`, { image_url: `/static/characters/qa-l3-g-${item.assetId}.png` });
    }
    for (const item of assets.body.referenced.scenes || []) {
      await api.beMethod('PUT', `/api/v1/scenes/${item.assetId}`, { image_url: `/static/scenes/qa-l3-g-${item.assetId}.png` });
    }
    enter = await api.be(`/api/v2/episodes/${epId}/enter-storyboard`, {});
    cs.eq('ready 时进入分镜 200', enter.status, 200);
    cs.eq('navigation=immediate', enter.json?.data?.navigation, 'immediate');
    const snap = enter.json?.data?.snapshot || {};
    cs.eq('快照状态 active', snap.status, 'active');
    cs.expect('返回快照 id 与 64 位指纹', Number(snap.id) > 0 && /^[0-9a-f]{64}$/.test(String(snap.fingerprint)), JSON.stringify(snap));
    const row = q1('SELECT * FROM episode_asset_set_snapshots WHERE id = ?', snap.id);
    cs.expect('DB 快照行落库（fingerprint/script_revision 一致）', row && row.fingerprint === snap.fingerprint && row.status === 'active', JSON.stringify({ fp: row?.fingerprint, st: row?.status }).slice(0, 120));
    const items = JSON.parse(row.items_json || '[]');
    cs.expect('快照 items 含全部必需引用（不可变副本）', items.length >= 1 && items.every((i) => i.mediaFingerprint && i.mediaVersionId), JSON.stringify(items).slice(0, 160));
  });

  // TC-005 媒体生成守卫
  // @test_id EPSET_005_media_guard
  await run(meta('TC-EPSET-005', '媒体生成守卫：未 ready 时 enabled=false 并给恢复入口；ready 后 enabled=true', 'P1'), async (cs) => {
    const hero = `${uniq}-守卫主角`;
    const { projectId, episodeId } = await makeConfirmedEpisode(cs, hero, { tag: 'GUARD' });
    let g = await api.be(`/api/v2/episodes/${episodeId}/media-guard`);
    cs.eq('未 ready enabled=false', g.json?.data?.enabled, false);
    cs.eq('readiness=needs-attention', g.json?.data?.readiness, 'needs-attention');
    cs.eq('恢复入口指向 studio-assets', g.json?.data?.recoveryTarget?.routeId, 'studio-assets');
    cs.eq('恢复入口带 projectId', g.json?.data?.recoveryTarget?.params?.projectId, projectId);
    const assets = await getAssets(episodeId);
    for (const item of assets.body.referenced.characters || []) {
      await api.beMethod('PUT', `/api/v1/characters/${item.assetId}/image`, { image_url: `/static/characters/qa-l3-gd-${item.assetId}.png` });
    }
    for (const item of assets.body.referenced.scenes || []) {
      await api.beMethod('PUT', `/api/v1/scenes/${item.assetId}`, { image_url: `/static/scenes/qa-l3-gd-${item.assetId}.png` });
    }
    g = await api.be(`/api/v2/episodes/${episodeId}/media-guard`);
    cs.eq('ready 后 enabled=true', g.json?.data?.enabled, true);
    cs.eq('recoveryTarget 清空', g.json?.data?.recoveryTarget ?? null, null);
  });

  // TC-006 音色抽屉数据（B4 音色指针）
  // @test_id EPSET_006_voice_drawer
  await run(meta('TC-EPSET-006', '音色抽屉：selection 保存音色指针→投影 voice 回显→清除置空', 'P1'), async (cs) => {
    const hero = `${uniq}-音色主角`;
    const { episodeId, chars } = await makeConfirmedEpisode(cs, hero, { tag: 'VOICE' });
    const heroId = chars[0].id;
    const save = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/assets/selection`, {
      assetType: 'character', assetId: heroId,
      voice: { type: 'preset', presetId: 'male-calm', name: '沉稳男声' },
    });
    cs.log(`save voice -> ${save.status} ${save.text.slice(0, 120)}`);
    cs.eq('保存音色指针 200', save.status, 200);
    const assets = await getAssets(episodeId);
    const proj = (assets.body.referenced?.characters || []).find((c) => c.assetId === heroId) || {};
    cs.expect('投影回显音色（抽屉预选数据源）', proj.voice && proj.voice.type === 'preset' && proj.voice.name === '沉稳男声', JSON.stringify(proj.voice));
    const dbRow = q1('SELECT voice_json FROM episode_asset_selections WHERE episode_id = ? AND asset_type = ? AND asset_id = ?', episodeId, 'character', heroId);
    cs.expect('DB voice_json 落库', dbRow && String(dbRow.voice_json).includes('male-calm'), dbRow?.voice_json);
    const clear = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/assets/selection`, {
      assetType: 'character', assetId: heroId, voice: null,
    });
    cs.eq('清除音色 200', clear.status, 200);
    const assets2 = await getAssets(episodeId);
    const proj2 = (assets2.body.referenced?.characters || []).find((c) => c.assetId === heroId) || {};
    cs.eq('投影 voice 已清空', proj2.voice ?? null, null);
  });

  // TC-007 本集选择指针（stateId/mediaVersionId）
  // @test_id EPSET_007_selection_pointer
  await run(meta('TC-EPSET-007', '本集选择指针：stateId+mediaVersionId 保存→投影覆盖默认值（状态/版本语义）', 'P1'), async (cs) => {
    const hero = `${uniq}-指针主角`;
    const { episodeId, chars } = await makeConfirmedEpisode(cs, hero, { tag: 'SEL' });
    const heroId = chars[0].id;
    const v = await api.be(`/api/v1/characters/${heroId}/variants`, { name: '傷后', source_key: `${uniq}-injured`, appearance: '左颊淤青' });
    cs.expect('前置：变体已建', v.status === 201, v.status);
    const mediaVersion = `/static/characters/qa-l3-sel-${heroId}.png`;
    const save = await api.beMethod('PUT', `/api/v2/episodes/${episodeId}/assets/selection`, {
      assetType: 'character', assetId: heroId, stateId: v.json?.data?.id, mediaVersionId: mediaVersion,
    });
    cs.eq('保存选择指针 200', save.status, 200);
    const assets = await getAssets(episodeId);
    const proj = (assets.body.referenced?.characters || []).find((c) => c.assetId === heroId) || {};
    cs.eq('投影 stateId 指向所选变体', String(proj.stateId), String(v.json?.data?.id));
    cs.eq('投影 mediaVersionId 指向所选媒体版本', proj.mediaVersionId, mediaVersion);
    const dbRow = q1('SELECT state_id, media_version_id FROM episode_asset_selections WHERE episode_id = ? AND asset_type = ? AND asset_id = ?', episodeId, 'character', heroId);
    cs.expect('DB 选择行一致', String(dbRow.state_id) === String(v.json?.data?.id) && dbRow.media_version_id === mediaVersion, JSON.stringify(dbRow));
  });

  // TC-008 边界：不存在剧集
  // @test_id EPSET_008_not_found
  await run(meta('TC-EPSET-008', '边界：不存在剧集的投影/进入分镜/守卫均 404', 'P2'), async (cs) => {
    const a = await api.be('/api/v2/episodes/99999999/assets');
    cs.eq('assets 404', a.status, 404);
    const e = await api.be(`/api/v2/episodes/99999999/enter-storyboard`, {});
    cs.eq('enter-storyboard 404', e.status, 404);
    const g = await api.be('/api/v2/episodes/99999999/media-guard');
    cs.eq('media-guard 404', g.status, 404);
  });

  // TC-009 软删角色退出投影
  // @test_id EPSET_009_deleted_character_exits
  await run(meta('TC-EPSET-009', '软删角色退出本集投影：删除后按名匹配不再命中', 'P1'), async (cs) => {
    const hero = `${uniq}-退场主角`;
    const { episodeId, chars } = await makeConfirmedEpisode(cs, hero, { tag: 'BYE' });
    const heroId = chars[0].id;
    let assets = await getAssets(episodeId);
    cs.expect('删除前投影包含', (assets.body.referenced?.characters || []).some((c) => c.assetId === heroId), '');
    const del = await api.beMethod('DELETE', `/api/v1/characters/${heroId}`);
    cs.eq('删除角色 200', del.status, 200);
    assets = await getAssets(episodeId);
    cs.expect('删除后投影不再包含（deleted_at 过滤）', !((assets.body.referenced?.characters || []).some((c) => c.assetId === heroId)), JSON.stringify((assets.body.referenced?.characters || []).map((c) => c.assetId)));
    const readiness = assets.body.readiness || {};
    cs.log(`[记录] 删除后 readiness=${readiness.status}（无引用时为 ready 或 script-unapproved 均属合理降级）`);
  });

  console.log('\n[EPSET] 全部用例执行完毕');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
