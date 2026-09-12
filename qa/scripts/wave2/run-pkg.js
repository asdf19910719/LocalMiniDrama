// PKG 模块执行（TC-PKG-001..013）：剧集包导入 + 外部 AI 协作包，真实 API
const fs = require('fs');
const path = require('path');
const {
  api, runCase, zipEntries, q1, q, createV1Project, ART_DIR,
} = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'PKG', level: level || 'system', priority });
const uniq = `QA-L3-PKG-${Date.now()}`;

// 合规 episode-package@2.1（本用例集构造的唯一"真实包"，非伪造外部结果）
function makePackage(episodeNumber) {
  return {
    schema: 'local-mini-drama.episode-package',
    version: '2.1',
    episode: {
      episode_number: episodeNumber,
      title: 'QA-L3 包导入集',
      summary: '制作包真实校验与导入',
      script: '内景 咖啡店 日\nQA-L3 制作包剧本正文标记。',
      duration_target_seconds: 90,
      notes: `QA-L3 nonce=${uniq}`, // 保证每次运行内容唯一，sha 幂等检查不受历史运行污染
    },
    assets: {
      characters: [{
        source_key: 'qa_l3_hero',
        name: '林夏QA',
        role: 'main',
        description: '守时人主角',
        personality: '勇敢细心',
        appearance: '短发少女，背旧书包',
        states: [
          { source_key: 'qa_l3_hero_default', name: '默认', description: '日常状态', appearance: '校服', is_default: true },
          { source_key: 'qa_l3_hero_wet', name: '雨夜', description: '淋湿状态', appearance: '湿发外套', is_default: false },
        ],
      }],
      scene_assets: [
        { source_key: 'qa_l3_cafe', name: '街角咖啡店', state: '日', description: '老街转角的小店', atmosphere: '温暖安静' },
      ],
      props: [
        { source_key: 'qa_l3_key', name: '黄铜钥匙', type: '关键道具', description: '开启座钟的钥匙' },
      ],
    },
    story_scenes: [
      { source_key: 'qa_l3_scene_1', scene_number: 1, heading: '内景 咖啡店 日', location_scene_ref: 'qa_l3_cafe', summary: '林夏推门进入咖啡店' },
    ],
    shot_packages: [{
      source_key: 'qa_l3_shot_1',
      shot_number: 1,
      story_scene_refs: ['qa_l3_scene_1'],
      planned_duration_seconds: 4,
      story_intent: '建立场景与主角登场',
      visual: { shot_size: '全景', camera_angle: '平视', camera_movement: '固定', composition: '三分法', lighting: '自然光' },
      timed_segments: [{
        start_seconds: 0,
        end_seconds: 4,
        action: '林夏推门进入，环顾店内',
        scene_asset_refs: ['qa_l3_cafe'],
        character_state_refs: ['qa_l3_hero_default'],
        prop_refs: ['qa_l3_key'],
        dialogue: [{ speaker_ref: 'qa_l3_hero', start_seconds: 1, end_seconds: 3, text: '我回来了。', performance: '平静' }],
      }],
      continuity: { entry: { description: '门外' }, exit: { description: '店内' } },
      audio: { dialogue: [], narration: [], ambience: [], sound_effects: [] },
    }],
  };
}

// 依据任务信息构造合规 external-ai-result@2.1（引用任务真实 package_id/assets_digest/目标集号）
function makeResult(task) {
  const epNum = task.target_episode_number;
  return {
    schema: 'local-mini-drama.external-ai-result',
    version: '2.1',
    package_id: task.package_id,
    assets_digest: task.assets_digest,
    episode: {
      episode_number: epNum,
      title: 'QA-L3 外部AI结果集',
      summary: '外部 AI 返回的合规结果（引用任务冻结上下文构造）',
      script: '外景 老街 夜\nQA-L3 外部AI结果剧本正文标记。',
      duration_target_seconds: 60,
    },
    new_assets: {
      characters: [{
        source_key: 'qa_l3_newchar',
        name: '钟表少年',
        role: 'supporting',
        description: '守钟人',
        personality: '沉默温和',
        appearance: '白衬衫少年',
        base_image_prompt: 'white shirt boy',
        negative_prompt: '',
        voice_profile: null,
        states: [{ source_key: 'qa_l3_newchar_default', name: '默认', description: '柜台后', appearance: '白衬衫', base_image_prompt: '', negative_prompt: '', is_default: true }],
      }],
      scene_assets: [
        { source_key: 'qa_l3_cafe', name: '街角咖啡店', state: '夜', description: '老街转角的小店', atmosphere: '路灯光', base_image_prompt: '', negative_prompt: '' },
      ],
      props: [],
    },
    story_scenes: [
      { source_key: 'qa_l3_r_scene_1', scene_number: 1, heading: '外景 老街 夜', location_scene_ref: 'qa_l3_cafe', summary: '老街夜景' },
    ],
    shot_packages: [{
      source_key: 'qa_l3_r_shot_1',
      shot_number: 1,
      story_scene_refs: ['qa_l3_r_scene_1'],
      planned_duration_seconds: 3,
      story_intent: '结果镜头',
      visual: { shot_size: '中景', camera_angle: '平视', camera_movement: '固定', composition: '居中', lighting: '路灯光' },
      timed_segments: [{
        start_seconds: 0,
        end_seconds: 3,
        action: '少年擦拭座钟',
        scene_asset_refs: ['qa_l3_cafe'],
        character_state_refs: ['qa_l3_newchar_default'],
        prop_refs: [],
        dialogue: [],
      }],
      continuity: { entry: {}, exit: {} },
      audio: { dialogue: [], narration: [], ambience: [], sound_effects: [] },
    }],
  };
}

// 经 getTask 端点获取任务事实（json 下载端点存在缺陷，见 BUG-L3-203，不作为依赖）
async function taskFacts(cs, taskId) {
  const g = await api.be(`/api/v2/external-ai/tasks/${taskId}`);
  const d = g.json?.data || {};
  const facts = { package_id: d.packageId, assets_digest: d.assetsDigest, target_episode_number: d.targetEpisodeNumber };
  cs.log(`任务事实: package_id=${facts.package_id} digest=${String(facts.assets_digest).slice(0, 12)}… target_ep=${facts.target_episode_number}`);
  return facts;
}

(async () => {
  // TC-001 合规包结构校验（preview）
  await runCase(meta('TC-PKG-001', 'episode-package@2.1 合规包 preview：结构校验通过并给出导入计划', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-PRE`);
    const pkg = makePackage(1);
    const r = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/preview`, { pkg, sourceFilename: 'qa-l3-pkg.json' });
    cs.log(`preview -> ${r.status} ${r.text.slice(0, 300)}`);
    cs.eq('preview status', r.status, 200);
    const d = r.json?.data || {};
    cs.expect('返回导入计划', Boolean(d) && typeof d === 'object', Object.keys(d).join(','));
    cs.expect('计划含目标剧集/集信息', JSON.stringify(d).includes('episode') || d.target || d.episode, JSON.stringify(d).slice(0, 200));
    fs.writeFileSync(path.join(ART_DIR, 'TC-PKG-001-package.json'), JSON.stringify(pkg, null, 2));
  });

  // TC-002 合规包真实导入 + 溯源
  await runCase(meta('TC-PKG-002', 'episode-package confirm：真实导入落库（剧集/人物/场景/道具/分镜）+ episode_imports 溯源', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-IMP`);
    const pkg = makePackage(1);
    const r = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/confirm`, { pkg, sourceFilename: 'qa-l3-pkg.json' });
    cs.log(`confirm -> ${r.status} ${r.text.slice(0, 220)}`);
    cs.eq('confirm status', r.status, 201);
    const list = await api.be(`/api/v2/projects/${p.id}/episodes`);
    const items = list.json?.data?.items || [];
    cs.expect('新剧集出现在项目列表', items.some((e) => e.title === 'QA-L3 包导入集'), JSON.stringify(items.map((e) => e.title)));
    const eid = (items.find((e) => e.title === 'QA-L3 包导入集') || {}).id;
    const chr = q1("SELECT COUNT(*) AS n FROM characters WHERE drama_id = ? AND source_key = 'qa_l3_hero'", p.id);
    cs.expect('人物落库（source_key 可溯源）', chr.n === 1, `characters=${chr.n}`);
    const scn = q1("SELECT COUNT(*) AS n FROM scenes WHERE drama_id = ? AND source_key = 'qa_l3_cafe'", p.id);
    cs.expect('场景落库', scn.n === 1, `scenes=${scn.n}`);
    const prp = q1("SELECT COUNT(*) AS n FROM props WHERE drama_id = ? AND source_key = 'qa_l3_key'", p.id);
    cs.expect('道具落库', prp.n === 1, `props=${prp.n}`);
    const sb = q1('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND storyboard_number = 1', eid);
    cs.expect('分镜落库', sb.n === 1, `storyboards=${sb.n}`);
    const sbKey = q1('SELECT source_key FROM storyboards WHERE episode_id = ? AND storyboard_number = 1', eid);
    cs.log(`[缺陷记录 BUG-L3-204] 导入分镜 source_key=${JSON.stringify(sbKey?.source_key)}（characters/scenes/props 均保留 source_key，仅 storyboards 丢弃）`);
    const imp = q1('SELECT id, schema_name, schema_version, import_report FROM episode_imports WHERE episode_id = ?', eid);
    cs.expect('episode_imports 审计记录（schema/version/report）', imp && imp.schema_name === 'local-mini-drama.episode-package' && imp.schema_version === '2.1' && String(imp.import_report).includes('"shots":1'), JSON.stringify(imp).slice(0, 180));
    const src = await api.be(`/api/v2/episodes/${eid}/import-source`);
    cs.log(`import-source -> ${src.status} ${src.text.slice(0, 220)}`);
    cs.expect('import-source 返回制作包来源', src.status === 200 && /episode-package|qa-l3-pkg/.test(src.text), src.text.slice(0, 200));
  });

  // TC-003 非法包结构校验（preview 返回 ok:false + 错误码；confirm 400 PACKAGE_INVALID）
  await runCase(meta('TC-PKG-003', '非法包逐项拒绝：未知协议/错误版本/数值版本/未知字段/缺数组', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-BAD`);
    const cases = [
      ['未知协议', { ...makePackage(1), schema: 'some-other.package' }, 'PACKAGE_SCHEMA_UNSUPPORTED'],
      ['版本 2.0', { ...makePackage(1), version: '2.0' }, 'PACKAGE_VERSION_UNSUPPORTED'],
      ['数值版本', { ...makePackage(1), version: 2.1 }, 'PACKAGE_SCHEMA_INVALID'],
      ['未知字段', { ...makePackage(1), hacked_field: 1 }, 'PACKAGE_SCHEMA_INVALID'],
      ['缺 shot_packages', (() => { const x = makePackage(1); delete x.shot_packages; return x; })(), 'PACKAGE_SCHEMA_INVALID'],
    ];
    for (const [label, badPkg, wantCode] of cases) {
      const r = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/preview`, { pkg: badPkg });
      const errs = r.json?.data?.errors || [];
      const codes = errs.map((e) => e.code);
      cs.log(`${label} -> preview ok=${r.json?.data?.ok} codes=${codes.slice(0, 3).join(',')}`);
      cs.expect(`${label} 校验不通过且含 ${wantCode}`, r.json?.data?.ok === false && codes.includes(wantCode), `ok=${r.json?.data?.ok} codes=${codes.join(',')}`);
    }
    const cf = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/confirm`, { pkg: { ...makePackage(1), schema: 'nope' } });
    cs.log(`confirm 非法包 -> ${cf.status} ${cf.json?.error?.code || ''}`);
    cs.expect('confirm 非法包 400 PACKAGE_INVALID', cf.status === 400 && cf.json?.error?.code === 'PACKAGE_INVALID', `${cf.status} ${cf.json?.error?.code}`);
  });

  // TC-004 重复导入与目标占用
  await runCase(meta('TC-PKG-004', '重复导入防护：同 source_sha256 幂等拒绝 + 目标集占用 409', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-DUP`);
    const pkg = makePackage(1);
    const crypto = require('crypto');
    const sha = crypto.createHash('sha256').update(JSON.stringify(pkg)).digest('hex');
    const r1 = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/confirm`, { pkg, sourceFilename: 'a.json', sourceSha256: sha });
    cs.log(`first confirm -> ${r1.status}`);
    cs.eq('首次导入 201', r1.status, 201);
    const r2 = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/confirm`, { pkg, sourceFilename: 'a.json', sourceSha256: sha });
    cs.log(`re-confirm same sha -> ${r2.status} ${r2.json?.error?.code || ''}`);
    cs.expect('同 sha 重复导入 409 PACKAGE_ALREADY_IMPORTED', r2.status === 409 && r2.json?.error?.code === 'PACKAGE_ALREADY_IMPORTED', `${r2.status} ${r2.json?.error?.code}`);
    const pkg2 = makePackage(1); // 同集号新内容（不同 sha）
    const r3 = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/confirm`, { pkg: pkg2, sourceFilename: 'b.json' });
    cs.log(`confirm same episode number -> ${r3.status} ${r3.text.slice(0, 160)}`);
    cs.expect('create_new 自动落位下一空闲集（201，不写死包内集号）', r3.status === 201, `${r3.status} ${r3.json?.error?.code || ''}`);
    const list = await api.be(`/api/v2/projects/${p.id}/episodes`);
    const items = list.json?.data?.items || [];
    cs.eq('项目内共 2 集（第2集来自第二次导入）', items.length, 2);
    // 直连导入的 fill_blank 保护：非空白目标集 409
    const nonBlank = items[0];
    await api.beMethod('PUT', `/api/v2/episodes/${nonBlank.id}/script/draft`, { content: '预填充内容，使目标非空白。' });
    const r4 = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/confirm`, { pkg: makePackage(9), targetEpisodeId: nonBlank.id, sourceFilename: 'c.json' });
    cs.log(`fill_blank on non-blank -> ${r4.status} ${r4.json?.error?.code || ''}`);
    cs.expect('非空白目标集 409 TARGET_NOT_BLANK', r4.status === 409 && r4.json?.error?.code === 'TARGET_NOT_BLANK', `${r4.status} ${r4.json?.error?.code}`);
  });

  // TC-005 人物状态与变体关联导入
  await runCase(meta('TC-PKG-005', '包导入的人物状态 → character_variants + 分镜变体关联（storyboard_character_variants）', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-VAR`);
    const r = await api.be(`/api/v2/projects/${p.id}/episodes/import-v21/confirm`, { pkg: makePackage(1) });
    cs.eq('confirm status', r.status, 201);
    const chRow = q1("SELECT id FROM characters WHERE drama_id = ? AND source_key = 'qa_l3_hero'", p.id);
    cs.expect('人物存在', Boolean(chRow), JSON.stringify(chRow));
    const variants = q('SELECT id, source_key, is_default FROM character_variants WHERE character_id = ? ORDER BY id', chRow.id);
    cs.log(`variants: ${JSON.stringify(variants)}`);
    cs.eq('2 个人物状态变体落库', variants.length, 2);
    cs.expect('含默认状态', variants.some((v) => v.is_default === 1), JSON.stringify(variants));
    const sbRow = q1('SELECT id, source_key FROM storyboards WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?) AND storyboard_number = 1', p.id);
    cs.expect('导入分镜存在', Boolean(sbRow), JSON.stringify(sbRow));
    const links = q('SELECT * FROM storyboard_character_variants WHERE storyboard_id = ?', sbRow.id);
    cs.log(`storyboard_character_variants: ${JSON.stringify(links)}`);
    cs.expect('分镜与人物状态变体已关联（引用 qa_l3_hero_default）', links.length >= 1 && links.some((l) => l.variant_id === variants.find((v) => v.source_key === 'qa_l3_hero_default').id), `links=${links.length}`);
  });

  // TC-006 外部 AI 任务包创建（两种目标模式）
  await runCase(meta('TC-PKG-006', '外部 AI 任务包创建：create_new 与 fill_blank 两种模式真实生成', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-WIZ`);
    const blank = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '空白待填集' });
    const blankId = blank.json.data.id;
    const tNew = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'create_new', taskNote: 'QA-L3 create_new 包' });
    cs.log(`create_new -> ${tNew.status} ${tNew.text.slice(0, 220)}`);
    cs.eq('create_new status', tNew.status, 201);
    cs.expect('返回 taskId/packageId', Boolean(tNew.json?.data?.taskId) && Boolean(tNew.json?.data?.packageId), tNew.text.slice(0, 160));
    cs.expect('assetsDigest 非空', String(tNew.json?.data?.assetsDigest || '').length >= 8, String(tNew.json?.data?.assetsDigest).slice(0, 20));
    cs.expect('contextVersion 非空', Boolean(tNew.json?.data?.contextVersion), '');
    const tFill = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'fill_blank', episodeId: blankId, taskNote: 'QA-L3 fill_blank 包' });
    cs.eq('fill_blank status', tFill.status, 201);
    cs.eq('fill_blank 绑定目标集', tFill.json?.data?.targetEpisodeId, blankId);
    const badMode = await api.be(`/api/v2/projects/${p.id}/external-ai/target`, { mode: 'bogus' });
    cs.eq('非法模式 400', badMode.status, 400);
    const projTasks = await api.be(`/api/v2/projects/${p.id}/external-ai/tasks`);
    cs.expect('项目任务列表含 2 个任务', (projTasks.json?.data || []).length === 2, JSON.stringify(projTasks.json?.data).slice(0, 200));
  });

  // TC-007 任务包详情
  await runCase(meta('TC-PKG-007', '任务包详情：上下文/说明/素材摘要/状态字段完整', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-TASK`);
    await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '空白集-详情' });
    const t = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'create_new' });
    const taskId = t.json.data.taskId;
    const g = await api.be(`/api/v2/external-ai/tasks/${taskId}`);
    cs.log(`getTask -> ${g.status} ${g.text.slice(0, 260)}`);
    cs.eq('getTask status', g.status, 200);
    const d = g.json?.data || {};
    cs.eq('packageId 回读', d.packageId, taskId);
    cs.expect('context 上下文非空', String(d.context || '').length > 50, `len=${String(d.context || '').length}`);
    cs.expect('instructions 说明非空', String(d.instructions || '').length > 20, `len=${String(d.instructions || '').length}`);
    cs.expect('status 字段存在（waiting 类）', /waiting|pending/i.test(String(d.status)), String(d.status));
    cs.expect('downloadFormats 双格式', Array.isArray(d.downloadFormats) && d.downloadFormats.length === 2, JSON.stringify(d.downloadFormats));
    const miss = await api.be('/api/v2/external-ai/tasks/qa-l3-not-exist-task');
    cs.eq('不存在任务 404', miss.status, 404);
  });

  // TC-008 任务包下载 zip/json
  await runCase(meta('TC-PKG-008', '任务包下载：ZIP 可解析含上下文文件，JSON 协议头与 schema 完整', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-DL`);
    const t = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'create_new' });
    const taskId = t.json.data.taskId;
    const zipRes = await api.beMethod('GET', `/api/v2/external-ai/tasks/${taskId}/download?format=zip`);
    cs.log(`zip download -> ${zipRes.status} ct=${zipRes.headers.get('content-type')} bytes=${zipRes.buf.length}`);
    cs.eq('zip status', zipRes.status, 200);
    cs.expect('content-type application/zip', (zipRes.headers.get('content-type') || '').includes('zip'), zipRes.headers.get('content-type'));
    const entries = zipEntries(zipRes.buf);
    cs.log(`zip 条目: ${entries.map((e) => e.name).join(', ')}`);
    cs.expect('zip 至少 2 个文件', entries.length >= 2, `entries=${entries.length}`);
    cs.expect('zip 含任务说明或上下文内容', entries.some((e) => /instruction|context|任务|\.md/i.test(e.name) || /外部 AI|任务/.test(e.text)), entries.map((e) => e.name).join(','));
    fs.writeFileSync(path.join(ART_DIR, 'TC-PKG-008-task.zip'), zipRes.buf);
    const jsonRes = await api.beMethod('GET', `/api/v2/external-ai/tasks/${taskId}/download?format=json`);
    cs.log(`json download -> ${jsonRes.status} ct=${jsonRes.headers.get('content-type')} bytes=${jsonRes.buf.length} body=${jsonRes.text.slice(0, 120)}`);
    if (jsonRes.status === 200) {
      cs.eq('json status', jsonRes.status, 200);
      const tj = JSON.parse(jsonRes.buf.toString('utf8'));
      cs.eq('json schema=external-ai-task', tj.schema, 'local-mini-drama.external-ai-task');
      cs.eq('json version=2.1', tj.version, '2.1');
      cs.eq('json package_id 匹配', tj.package_id, taskId);
      cs.expect('json assets_digest 非空', String(tj.assets_digest || '').length >= 8, '');
      cs.expect('json response_schema 存在', Boolean(tj.response_schema), JSON.stringify(tj.response_schema).slice(0, 120));
      fs.writeFileSync(path.join(ART_DIR, 'TC-PKG-008-task.json'), jsonRes.buf.toString('utf8'));
    } else {
      cs.expect('单文件 JSON 下载可用（downloadFormats 宣称的第二种格式）', jsonRes.status === 200, `${jsonRes.status} ${jsonRes.text.slice(0, 100)} —— [缺陷 BUG-L3-203] buildDownload json 分支 getTaskBundle 漏传 db 参数`);
    }
    const badFmt = await api.beMethod('GET', `/api/v2/external-ai/tasks/${taskId}/download?format=xml`);
    cs.eq('非法 format 400', badFmt.status, 400);
  });

  // TC-009 任务备注与取消
  await runCase(meta('TC-PKG-009', '任务备注保存回读 + 任务取消后拒绝导入', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-NOTE`);
    const t = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'create_new' });
    const taskId = t.json.data.taskId;
    const note = await api.be(`/api/v2/external-ai/tasks/${taskId}/task-note`, { note: 'QA-L3 备注补充：注意第二场的光线' });
    cs.log(`task-note -> ${note.status} ${note.text.slice(0, 120)}`);
    cs.eq('task-note status', note.status, 200);
    const g = await api.be(`/api/v2/external-ai/tasks/${taskId}`);
    cs.expect('备注回读一致', (g.json?.data?.taskNote || '').includes('注意第二场的光线'), String(g.json?.data?.taskNote));
    const cancel = await api.be(`/api/v2/external-ai/tasks/${taskId}/cancel`, { reason: 'QA-L3 取消' });
    cs.log(`cancel -> ${cancel.status} ${cancel.text.slice(0, 120)}`);
    cs.eq('cancel status', cancel.status, 200);
    const g2 = await api.be(`/api/v2/external-ai/tasks/${taskId}`);
    cs.expect('cancelledAt 已标记', Boolean(g2.json?.data?.cancelledAt), String(g2.json?.data?.cancelledAt));
    // 取消后导入被拒
    const resultJson = JSON.stringify({ schema: 'local-mini-drama.external-ai-result', version: '2.1', package_id: taskId, assets_digest: t.json.data.assetsDigest, episode: { episode_number: t.json.data.targetEpisodeNumber }, new_assets: {}, story_scenes: [], shot_packages: [] });
    const imp = await api.be(`/api/v2/external-ai/tasks/${taskId}/import/confirm`, { resultJson });
    cs.log(`import after cancel -> ${imp.status} ${imp.json?.error?.code || ''}`);
    cs.expect('取消后导入 409 TASK_CANCELLED', imp.status === 409 && imp.json?.error?.code === 'TASK_CANCELLED', `${imp.status} ${imp.json?.error?.code}`);
  });

  // TC-010 外部 AI 结果校验（合规结果 → 全项通过）
  await runCase(meta('TC-PKG-010', '外部 AI 结果 validate：合规构造结果（真实 package_id/assets_digest）全项通过', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-VAL`);
    await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '已占用第1集-校验', episodeNumber: 1 });
    const t = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'create_new' });
    const taskId = t.json.data.taskId;
    const facts = await taskFacts(cs, taskId);
    const result = makeResult(facts);
    const r = await api.be(`/api/v2/external-ai/tasks/${taskId}/result/validate`, { resultJson: JSON.stringify(result) });
    cs.log(`validate -> ${r.status} ${r.text.slice(0, 400)}`);
    cs.eq('validate status', r.status, 200);
    cs.eq('ok=true', r.json?.data?.ok, true);
    const checks = r.json?.data?.checks || [];
    cs.expect('全部检查项通过', checks.length >= 5 && checks.every((c) => c.ok), JSON.stringify(checks.map((c) => [c.id, c.ok])));
  });

  // TC-011 外部 AI 结果校验失败路径
  await runCase(meta('TC-PKG-011', '结果校验失败路径：package_id / assets_digest / 集号不匹配逐项暴露', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-VALBAD`);
    const t = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'create_new' });
    const taskId = t.json.data.taskId;
    const facts = await taskFacts(cs, taskId);
    const base = makeResult(facts);
    const badPkgId = { ...base, package_id: 'qa-l3-wrong-package' };
    const r1 = await api.be(`/api/v2/external-ai/tasks/${taskId}/result/validate`, { resultJson: JSON.stringify(badPkgId) });
    cs.log(`wrong package_id -> ok=${r1.json?.data?.ok} checks=${JSON.stringify((r1.json?.data?.checks || []).filter((c) => !c.ok).map((c) => c.id))}`);
    cs.expect('package_id 检查失败', r1.json?.data?.ok === false && (r1.json.data.checks || []).some((c) => c.id === 'package_id' && !c.ok), '');
    const badDigest = { ...base, assets_digest: 'qa-l3-wrong-digest' };
    const r2 = await api.be(`/api/v2/external-ai/tasks/${taskId}/result/validate`, { resultJson: JSON.stringify(badDigest) });
    cs.expect('assets_digest 检查失败', r2.json?.data?.ok === false && (r2.json.data.checks || []).some((c) => c.id === 'assets_digest' && !c.ok), JSON.stringify((r2.json?.data?.checks || []).filter((c) => !c.ok).map((c) => c.id)));
    const badEp = { ...base, episode: { ...base.episode, episode_number: 99 } };
    const r3 = await api.be(`/api/v2/external-ai/tasks/${taskId}/result/validate`, { resultJson: JSON.stringify(badEp) });
    cs.expect('集号不匹配检查失败', r3.json?.data?.ok === false && (r3.json.data.checks || []).some((c) => c.id === 'episode' && !c.ok), JSON.stringify((r3.json?.data?.checks || []).filter((c) => !c.ok).map((c) => c.id)));
    const r4 = await api.be(`/api/v2/external-ai/tasks/${taskId}/result/validate`, { resultJson: 'not-json-at-all' });
    cs.log(`非 JSON -> ${r4.status} ${r4.json?.data?.ok}`);
    cs.expect('非 JSON 结果 ok=false（schema 检查失败）', r4.status === 200 && r4.json?.data?.ok === false, r4.text.slice(0, 140));
  });

  // TC-012 合规结果真实导入（preview+confirm）+ 不可变保护
  await runCase(meta('TC-PKG-012', '合规结果 import preview→confirm：剧集落库 + 任务不可变保护（重复导入/改备注均 409）', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-CFM`);
    const t = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'create_new', taskNote: 'QA-L3 将被导入' });
    const taskId = t.json.data.taskId;
    const targetNum = t.json.data.targetEpisodeNumber;
    const facts = await taskFacts(cs, taskId);
    const result = makeResult(facts);
    const pv = await api.be(`/api/v2/external-ai/tasks/${taskId}/import/preview`, { resultJson: JSON.stringify(result) });
    cs.log(`preview -> ${pv.status} ${pv.text.slice(0, 200)}`);
    cs.eq('preview status', pv.status, 200);
    const cf = await api.be(`/api/v2/external-ai/tasks/${taskId}/import/confirm`, { resultJson: JSON.stringify(result) });
    cs.log(`confirm -> ${cf.status} ${cf.text.slice(0, 200)}`);
    cs.eq('confirm status', cf.status, 201);
    const list = await api.be(`/api/v2/projects/${p.id}/episodes`);
    const items = list.json?.data?.items || [];
    const created = items.find((e) => e.title === 'QA-L3 外部AI结果集');
    cs.expect(`目标第 ${targetNum} 集已创建（数据流：外部结果→剧集）`, Boolean(created), JSON.stringify(items.map((e) => e.title)));
    const rev = q1('SELECT content FROM episode_script_revisions WHERE episode_id = ? ORDER BY revision DESC', created?.id);
    cs.expect('结果剧本正文落库', String(rev?.content || '').includes('QA-L3 外部AI结果剧本正文标记'), String(rev?.content || '').slice(0, 60));
    const chRow = q1("SELECT id FROM characters WHERE drama_id = ? AND source_key = 'qa_l3_newchar'", p.id);
    cs.expect('new_assets 人物落库', Boolean(chRow), JSON.stringify(chRow));
    const row = q1('SELECT imported_at FROM external_ai_package_tasks WHERE package_id = ?', taskId);
    cs.expect('任务 imported_at 已标记', Boolean(row?.imported_at), JSON.stringify(row));
    const cf2 = await api.be(`/api/v2/external-ai/tasks/${taskId}/import/confirm`, { resultJson: JSON.stringify(result) });
    cs.log(`re-confirm -> ${cf2.status} ${cf2.json?.error?.code || ''}`);
    cs.expect('重复导入 409 PACKAGE_ALREADY_IMPORTED', cf2.status === 409 && cf2.json?.error?.code === 'PACKAGE_ALREADY_IMPORTED', `${cf2.status} ${cf2.json?.error?.code}`);
    const noteAfter = await api.be(`/api/v2/external-ai/tasks/${taskId}/task-note`, { note: '导入后修改' });
    cs.expect('导入后改备注 409 TASK_IMMUTABLE', noteAfter.status === 409 && noteAfter.json?.error?.code === 'TASK_IMMUTABLE', `${noteAfter.status} ${noteAfter.json?.error?.code}`);
    const cancelAfter = await api.be(`/api/v2/external-ai/tasks/${taskId}/cancel`, {});
    cs.expect('导入后取消 409 TASK_IMMUTABLE', cancelAfter.status === 409 && cancelAfter.json?.error?.code === 'TASK_IMMUTABLE', `${cancelAfter.status} ${cancelAfter.json?.error?.code}`);
  });

  // TC-013 非空白集保护
  await runCase(meta('TC-PKG-013', 'fill_blank 目标保护：非空白剧集选为目标 409 TARGET_NOT_BLANK', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-GUARD`);
    const ep = await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '非空白集' });
    const eid = ep.json.data.id;
    await api.beMethod('PUT', `/api/v2/episodes/${eid}/script/draft`, { content: '这个剧集已经有内容，不允许被填充。' });
    const r = await api.be(`/api/v2/projects/${p.id}/external-ai/target`, { mode: 'fill_blank', episodeId: eid });
    cs.log(`fill_blank on non-blank -> ${r.status} ${r.json?.error?.code || ''}`);
    cs.expect('409 TARGET_NOT_BLANK', r.status === 409 && r.json?.error?.code === 'TARGET_NOT_BLANK', `${r.status} ${r.json?.error?.code}`);
    const pkg = await api.be(`/api/v2/projects/${p.id}/external-ai/package`, { mode: 'fill_blank', episodeId: eid });
    cs.log(`package fill_blank on non-blank -> ${pkg.status} ${pkg.json?.error?.code || ''}`);
    cs.expect('直接建包同样被拒', pkg.status === 409 && pkg.json?.error?.code === 'TARGET_NOT_BLANK', `${pkg.status} ${pkg.json?.error?.code}`);
  });
})();
