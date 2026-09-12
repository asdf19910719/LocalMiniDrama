// IMPORT 模块执行（TC-IMPORT-001..012）：导出/导入/示例/小说导入，真实 API
const fs = require('fs');
const path = require('path');
const {
  api, runCase, postMultipart, zipEntries, zipFind, q1, q,
  createV1Project, defaultStyleId, ART_DIR, FIX_DIR,
} = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'IMPORT', level: level || 'system', priority });
const uniq = `QA-L3-IMPORT-${Date.now()}`;

// ---- 最小 ZIP 构造器（stored，无压缩）----
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const chunks = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

const NOVEL_TEXT = [
  'QA-L3 测试小说 卷一',
  '第一章 夜雨入城',
  '雨水顺着屋檐落下，林夏抱着旧书包跑进城隍庙。她不知道，这一夜会改变她的一生。',
  '庙里的老人抬起头：你来了。',
  '第二章 旧钟表店',
  '老街尽头的钟表店已经关了三年，今晚却亮着灯。林夏推门进去，满屋的钟同时敲响。',
  '柜台后的少年说：欢迎回来，守时人。',
  '第三章 第一次校准',
  '少年递给她一枚黄铜钥匙：每座停摆的钟背后，都有一段没人记得的时间。',
  '林夏握紧钥匙，走向第一座钟。',
].join('\n');

(async () => {
  // TC-001 导出 ZIP 结构
  await runCase(meta('TC-IMPORT-001', '导出项目 ZIP：结构可解析、含 project.json 与剧集/剧本内容', 'P0'), async (cs) => {
    const styleId = await defaultStyleId();
    const c = await api.be('/api/v1/dramas', { title: `${uniq}-EXP`, description: '导出结构验证项目', genre: '奇幻', style_id: styleId });
    const id = c.json.data.id;
    cs.cleanupProjectIds.push(id);
    await api.beMethod('PUT', `/api/v1/dramas/${id}/outline`, { tags: ['QA-L3-导出'] });
    await api.beMethod('PUT', `/api/v1/dramas/${id}/episodes`, {
      episodes: [
        { episode_number: 1, title: '第一集-QA', script_content: 'QA-L3 导出剧本正文标记一。' },
        { episode_number: 2, title: '第二集-QA', script_content: 'QA-L3 导出剧本正文标记二。' },
      ],
    });
    const exp = await api.be(`/api/v1/dramas/${id}/export`);
    cs.log(`export -> ${exp.status} ct=${exp.headers.get('content-type')} bytes=${exp.buf.length}`);
    cs.eq('export status', exp.status, 200);
    cs.expect('content-type application/zip', (exp.headers.get('content-type') || '').includes('zip'), exp.headers.get('content-type'));
    fs.writeFileSync(path.join(ART_DIR, 'TC-IMPORT-001-export.zip'), exp.buf);
    const entries = zipEntries(exp.buf);
    cs.log(`zip 条目: ${entries.map((e) => e.name).join(', ')}`);
    const pj = zipFind(entries, 'project.json');
    cs.expect('含 project.json', Boolean(pj), entries.map((e) => e.name).join(','));
    const data = JSON.parse(pj.text);
    cs.eq('project.json drama.title', data.drama?.title, `${uniq}-EXP`);
    cs.expect('project.json 含 style_id', Boolean(data.drama?.style_id), String(data.drama?.style_id));
    cs.expect('project.json 含 2 集数据', (data.episodes || data.drama?.episodes || []).length >= 2, `keys=${Object.keys(data)}`);
    const allText = entries.map((e) => e.text).join('');
    cs.expect('剧本正文进入导出包', allText.includes('QA-L3 导出剧本正文标记一'), 'episode script content');
    cs.expect('导出版本号存在', Boolean(data.version || data.export_version), JSON.stringify({ version: data.version, export_version: data.export_version }).slice(0, 80));
  });

  // TC-002 导出→导入往返 round-trip
  await runCase(meta('TC-IMPORT-002', 'ZIP 往返 round-trip：导出→导入→项目/剧集字段逐项比对', 'P0'), async (cs) => {
    const styleId = await defaultStyleId();
    const c = await api.be('/api/v1/dramas', { title: `${uniq}-RT`, description: '往返测试简介', genre: '悬疑', style_id: styleId, metadata: { aspect_ratio: '9:16' } });
    const srcId = c.json.data.id;
    cs.cleanupProjectIds.push(srcId);
    await api.beMethod('PUT', `/api/v1/dramas/${srcId}/episodes`, {
      episodes: [
        { episode_number: 1, title: 'RT一', script_content: '内景 钟表店 夜\n往返第一集正文。' },
        { episode_number: 2, title: 'RT二', script_content: '外景 老街 夜\n往返第二集正文。' },
      ],
    });
    const exp = await api.be(`/api/v1/dramas/${srcId}/export`);
    cs.eq('export status', exp.status, 200);
    fs.writeFileSync(path.join(ART_DIR, 'TC-IMPORT-002-roundtrip.zip'), exp.buf);
    const imp = await postMultipart('/api/v1/dramas/import', {}, 'file', 'TC-IMPORT-002-roundtrip.zip', exp.buf, 'application/zip');
    cs.log(`import -> ${imp.status} ${imp.text.slice(0, 160)}`);
    cs.eq('import status', imp.status, 201);
    const newId = imp.json?.data?.drama_id || imp.json?.data?.id || imp.json?.data?.drama?.id;
    cs.expect('返回新项目 id 且不同于源', newId && Number(newId) !== srcId, `new=${newId} src=${srcId}`);
    cs.cleanupProjectIds.push(Number(newId));
    const g = await api.be(`/api/v1/dramas/${newId}`);
    const d = g.json?.data || {};
    cs.expect('往返 title 保留（导入端追加 去重后缀）', String(d.title || '').startsWith(`${uniq}-RT`), String(d.title));
    cs.log(`导入后标题: ${d.title}（导入器对同名标题追加 " 导入N" 后缀）`);
    cs.eq('往返 description 一致', d.description, '往返测试简介');
    cs.eq('往返 genre 一致', d.genre, '悬疑');
    const eps = d.episodes || [];
    cs.eq('往返剧集数 = 2', eps.length, 2);
    const e1 = eps.find((x) => x.episode_number === 1) || {};
    cs.expect('往返第 1 集正文一致（数据流闭合）', String(e1.script_content || '').includes('往返第一集正文'), String(e1.script_content).slice(0, 50));
    cs.expect('往返 style_id 一致', d.style_id === styleId, `src=${styleId} dst=${d.style_id}`);
  });

  // TC-003 导入损坏/非法 ZIP
  await runCase(meta('TC-IMPORT-003', '导入非法 ZIP：损坏字节与缺 project.json 均 400 且信息明确', 'P1'), async (cs) => {
    const junk = await postMultipart('/api/v1/dramas/import', {}, 'file', 'junk.zip', Buffer.from('QA-L3 this is not a zip'), 'application/zip');
    cs.log(`非 ZIP 字节 -> ${junk.status} ${junk.text.slice(0, 120)}`);
    cs.eq('非 ZIP 400', junk.status, 400);
    cs.expect('错误信息含 损坏/格式', /损坏|格式/.test(junk.text), junk.text.slice(0, 120));
    const noManifest = makeZip([{ name: 'readme.txt', data: 'no manifest here' }]);
    fs.writeFileSync(path.join(FIX_DIR, 'no-manifest.zip'), noManifest);
    const r2 = await postMultipart('/api/v1/dramas/import', {}, 'file', 'no-manifest.zip', noManifest, 'application/zip');
    cs.log(`缺 project.json -> ${r2.status} ${r2.text.slice(0, 120)}`);
    cs.eq('缺 project.json 400', r2.status, 400);
    cs.expect('错误信息提到 project.json 缺少', r2.text.includes('project.json'), r2.text.slice(0, 140));
    const badManifest = makeZip([{ name: 'project.json', data: JSON.stringify({ version: '1.7', drama: {} }) }]);
    const r3 = await postMultipart('/api/v1/dramas/import', {}, 'file', 'bad-manifest.zip', badManifest, 'application/zip');
    cs.log(`缺 drama.title -> ${r3.status} ${r3.text.slice(0, 120)}`);
    cs.eq('缺 drama.title 400', r3.status, 400);
  });

  // TC-004 归档校验矩阵（v2 archive/validate 对 v1 导出包）
  await runCase(meta('TC-IMPORT-004', 'archive/validate：对 v1 导出 ZIP 的真实校验矩阵与版本标注', 'P1'), async (cs) => {
    const styleId = await defaultStyleId();
    const c = await api.be('/api/v1/dramas', { title: `${uniq}-ARCH`, style_id: styleId });
    const id = c.json.data.id;
    cs.cleanupProjectIds.push(id);
    const exp = await api.be(`/api/v1/dramas/${id}/export`);
    const zipPath = path.join(ART_DIR, 'TC-IMPORT-004-v1export.zip').replace(/\\/g, '/');
    fs.writeFileSync(zipPath, exp.buf);
    const v = await api.be('/api/v2/archive/validate', { path: zipPath });
    cs.log(`validate -> ${v.status} ${v.text.slice(0, 260)}`);
    cs.eq('validate status', v.status, 200);
    const d = v.json?.data || {};
    cs.expect('返回检查矩阵', Array.isArray(d.checks) && d.checks.length >= 5, `checks=${(d.checks || []).length}`);
    cs.eq('overall=unsupported', d.overall, 'unsupported');
    cs.eq('archiveVersion=1.7（如实识别）', d.archiveVersion, '1.7');
    cs.eq('supportedVersion=2.1', d.supportedVersion, '2.1');
    const versionCheck = (d.checks || []).find((x) => x.id === 'version' || /version|版本/i.test(String(x.label || '')));
    cs.expect('版本检查项 status=unsupported（不冒充可用）', versionCheck && versionCheck.status === 'unsupported', JSON.stringify(versionCheck));
    const miss = await api.be('/api/v2/archive/validate', { path: zipPath + '.not-exist' });
    cs.log(`不存在路径 -> ${miss.status} ${miss.text.slice(0, 100)}`);
    cs.expect('不存在路径 4xx', miss.status >= 400 && miss.status < 500, String(miss.status));
    const noPath = await api.be('/api/v2/archive/validate', {});
    cs.expect('缺 path 参数 4xx', noPath.status >= 400 && noPath.status < 500, String(noPath.status));
  });

  // TC-005 示例项目列表与导入
  await runCase(meta('TC-IMPORT-005', '示例项目：列表真实可见且可导入为独立项目', 'P0'), async (cs) => {
    const list = await api.be('/api/v1/dramas/examples');
    cs.log(`examples -> ${list.status} ${list.text.slice(0, 160)}`);
    cs.eq('examples status', list.status, 200);
    const items = list.json?.data || [];
    cs.expect('示例列表非空（example_drama 目录存在）', Array.isArray(items) && items.length >= 1, JSON.stringify(items).slice(0, 120));
    const target = items[0];
    const imp = await api.be('/api/v1/dramas/import-example', { filename: target.filename });
    cs.log(`import-example -> ${imp.status} ${imp.text.slice(0, 160)}`);
    // 附：直接核验示例文件字节（证据固定）
    const fsMod = require('fs');
    const exPath = require('path').join(__dirname, '../../../example_drama', target.filename);
    const head = fsMod.readFileSync(exPath).subarray(0, 16);
    cs.log(`示例文件头 16 字节: ${head.toString('hex')} (${JSON.stringify(head.toString('utf8').slice(0, 12))})`);
    cs.expect('示例文件为真实 ZIP（PK 头）', head[0] === 0x50 && head[1] === 0x4b, head.toString('hex'));
    if (imp.status === 201) {
      const newId = imp.json?.data?.drama_id || imp.json?.data?.id || imp.json?.data?.drama?.id;
      cs.expect('返回新项目 id', Boolean(newId), imp.text.slice(0, 120));
      cs.cleanupProjectIds.push(Number(newId));
      const g = await api.be(`/api/v1/dramas/${newId}`);
      cs.eq('导入示例可读取详情', g.status, 200);
      cs.expect('示例项目标题非空', Boolean(g.json?.data?.title), String(g.json?.data?.title));
    } else {
      cs.expect('示例项目导入成功（当前：随包示例文件损坏 → 500 失败）', imp.status === 201, `${imp.status} ${imp.json?.error?.message}`);
    }
  });

  // TC-006 import-example 路径穿越防护
  await runCase(meta('TC-IMPORT-006', '示例导入路径安全：穿越/缺失/未指定文件名的拒绝', 'P2'), async (cs) => {
    const trav = await api.be('/api/v1/dramas/import-example', { filename: '../../package.json' });
    cs.log(`路径穿越 -> ${trav.status} ${trav.text.slice(0, 100)}`);
    cs.eq('路径穿越 400', trav.status, 400);
    cs.expect('提示文件名不合法', trav.text.includes('不合法'), trav.text.slice(0, 100));
    const noFile = await api.be('/api/v1/dramas/import-example', {});
    cs.eq('未指定文件名 400', noFile.status, 400);
    const missing = await api.be('/api/v1/dramas/import-example', { filename: 'qa-l3-no-such-example.zip' });
    cs.eq('不存在示例 404', missing.status, 404);
  });

  // TC-007 小说导入 preview
  await runCase(meta('TC-IMPORT-007', '小说导入 preview：章节拆分、字数与集号冲突标注', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-NOVEL-PV`);
    const pv = await api.be(`/api/v2/projects/${p.id}/episodes/import-novel/preview`, { text: NOVEL_TEXT, maxChapters: 20 });
    cs.log(`preview -> ${pv.status} ${pv.text.slice(0, 260)}`);
    cs.eq('preview status', pv.status, 200);
    const chapters = pv.json?.data?.preview || [];
    cs.log(`章节数=${pv.json?.data?.chapterCount} 首章=${JSON.stringify(chapters[0]).slice(0, 140)}`);
    cs.eq('拆出 3 章', pv.json?.data?.chapterCount, 3);
    cs.expect('章节带标题', String(chapters[0]?.title || '').includes('第一章'), String(chapters[0]?.title));
    cs.expect('章节带字数', Number(chapters[0]?.chars) > 0, JSON.stringify(chapters[0]).slice(0, 120));
    // 冲突标注：预占第 1 集
    await api.be(`/api/v2/projects/${p.id}/episodes`, { title: '已占用集', episodeNumber: 1 });
    const pv2 = await api.be(`/api/v2/projects/${p.id}/episodes/import-novel/preview`, { text: NOVEL_TEXT, maxChapters: 20 });
    const ch2 = pv2.json?.data?.preview || [];
    const first = ch2[0] || {};
    cs.expect('已占用集号在 preview 中标注 conflict=true', first.conflict === true, JSON.stringify(first).slice(0, 180));
    cs.log(`冲突标注字段: ${JSON.stringify(first).slice(0, 200)}`);
  });

  // TC-008 小说导入 confirm
  await runCase(meta('TC-IMPORT-008', '小说导入 confirm：真实创建剧集草稿 + 剧本版本，零媒体任务', 'P0'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-NOVEL-CF`);
    const cf = await api.be(`/api/v2/projects/${p.id}/episodes/import-novel/confirm`, { text: NOVEL_TEXT, title: 'QA-L3 小说名', maxChapters: 20 });
    cs.log(`confirm -> ${cf.status} ${cf.text.slice(0, 200)}`);
    cs.eq('confirm status', cf.status, 201);
    const created = cf.json?.data?.episodes || cf.json?.data?.created || [];
    cs.log(`created=${created.length} skipped=${JSON.stringify(cf.json?.data?.skipped)}`);
    cs.eq('创建 3 集', created.length, 3);
    const list = await api.be(`/api/v2/projects/${p.id}/episodes`);
    const items = list.json?.data?.items || [];
    cs.eq('项目剧集列表 3 条', items.length, 3);
    cs.expect('第 1 集标题来自章节', String(items[0]?.title || '').includes('第一章'), String(items[0]?.title));
    const firstId = items[0]?.id;
    const rev = q1('SELECT COUNT(*) AS n FROM episode_script_revisions WHERE episode_id = ?', firstId);
    cs.expect('剧集有剧本草稿版本（≥1）', rev.n >= 1, `revisions=${rev.n}`);
    const sb = q1('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ?', firstId);
    cs.eq('零媒体：无分镜任务', sb.n, 0);
    const tasks = q1("SELECT COUNT(*) AS n FROM async_tasks WHERE resource_id = ? AND type != 'story_generation'", String(p.id));
    cs.log(`async_tasks 关联项目数=${tasks.n}`);
    const src = await api.be(`/api/v2/episodes/${firstId}/import-source`);
    cs.log(`import-source -> ${src.status} ${src.text.slice(0, 160)}`);
    cs.eq('import-source 可用', src.status, 200);
    cs.log('[观察] 小说拆集导入未写入 episode_imports 溯源记录（import-source 返回 null），溯源仅覆盖制作包导入路径——记录为真实行为。');
  });

  // TC-009 小说导入边界
  await runCase(meta('TC-IMPORT-009', '小说导入边界：空文本 400、maxChapters 截断、startNumber 生效', 'P1'), async (cs) => {
    const p = await createV1Project(cs, `${uniq}-NOVEL-EDGE`);
    const empty = await api.be(`/api/v2/projects/${p.id}/episodes/import-novel/preview`, { text: '   ' });
    cs.log(`空文本 -> ${empty.status} ${empty.text.slice(0, 120)}`);
    cs.eq('空文本 400', empty.status, 400);
    const pv = await api.be(`/api/v2/projects/${p.id}/episodes/import-novel/preview`, { text: NOVEL_TEXT, maxChapters: 2 });
    const chapters = pv.json?.data?.preview || [];
    cs.eq('maxChapters=2 截断为 2', chapters.length, 2);
    cs.eq('suggestedEpisodes 同步截断', pv.json?.data?.suggestedEpisodes, 2);
    const pv2 = await api.be(`/api/v2/projects/${p.id}/episodes/import-novel/preview`, { text: NOVEL_TEXT, maxChapters: 20, startNumber: 5 });
    const ch2 = pv2.json?.data?.preview || [];
    const nums = ch2.map((c) => Number(c.suggestedEpisodeNumber));
    cs.log(`startNumber=5 建议集号: ${JSON.stringify(nums)}`);
    cs.expect('建议集号从 5 起', nums[0] === 5 && nums[1] === 6, JSON.stringify(nums));
    const noText = await api.be(`/api/v2/projects/${p.id}/episodes/import-novel/confirm`, {});
    cs.eq('confirm 无文本 400', noText.status, 400);
  });

  // TC-010 v1 小说导入（multipart）
  await runCase(meta('TC-IMPORT-010', 'v1 import-novel：真实文本文件解析为章节/剧本（纯解析端点，不落库——与 inventory 措辞差异记录）', 'P1'), async (cs) => {
    const before = q1('SELECT COUNT(*) AS n FROM dramas').n;
    const novelBuf = Buffer.from(NOVEL_TEXT, 'utf8');
    const r = await postMultipart('/api/v1/dramas/import-novel', { title: `${uniq}-NOVEL-V1`, max_chapters: '10' }, 'file', 'qa-l3-novel.txt', novelBuf, 'text/plain');
    cs.log(`import-novel -> ${r.status} ${r.text.slice(0, 220)}`);
    cs.eq('import-novel status', r.status, 200);
    const data = r.json?.data || {};
    const chapters = data.chapters || [];
    cs.eq('解析出 3 章', chapters.length, 3);
    cs.expect('章节标题来自正文', String(chapters[0]?.title || '').includes('第一章'), String(chapters[0]?.title));
    cs.expect('章节含剧本化内容', String(chapters[0]?.script || chapters[0]?.content || '').includes('林夏'), String(chapters[0]?.script || '').slice(0, 60));
    const after = q1('SELECT COUNT(*) AS n FROM dramas').n;
    cs.eq(' dramas 总数不变（纯解析、不创建项目）', after, before);
    cs.log('[观察 INV-2.7] inventory 称「小说导入 COMPLETE：后端支持从文本建立项目/内容」。实际 v1 端点仅解析返回章节、不落任何库；')
    cs.log('v2 import-novel/confirm 也只向「已存在项目」（或回退第一个项目，无项目时 404）创建剧集——后端不存在"从文本直接建立新项目"的路径，"建项目"由前端拼装。记录为文档与实现的口径差异。');
  });

  // TC-011 导入无文件
  await runCase(meta('TC-IMPORT-011', '导入 ZIP 未附文件 → 400 提示上传', 'P2'), async (cs) => {
    const r = await postMultipart('/api/v1/dramas/import', {}, null, null, null);
    cs.log(`no file -> ${r.status} ${r.text.slice(0, 100)}`);
    cs.eq('400', r.status, 400);
    cs.expect('提示请上传 ZIP 文件', r.text.includes('ZIP'), r.text.slice(0, 100));
  });

  // TC-012 重复导入语义
  await runCase(meta('TC-IMPORT-012', '同一 ZIP 重复导入：生成两个独立项目（不合并不去重，记录真实行为）', 'P1'), async (cs) => {
    const styleId = await defaultStyleId();
    const c = await api.be('/api/v1/dramas', { title: `${uniq}-DUP`, style_id: styleId });
    const srcId = c.json.data.id;
    cs.cleanupProjectIds.push(srcId);
    await api.beMethod('PUT', `/api/v1/dramas/${srcId}/episodes`, { episodes: [{ episode_number: 1, title: '唯一集', script_content: 'QA-L3 重复导入正文。' }] });
    const exp = await api.be(`/api/v1/dramas/${srcId}/export`);
    fs.writeFileSync(path.join(ART_DIR, 'TC-IMPORT-012-dup.zip'), exp.buf);
    const i1 = await postMultipart('/api/v1/dramas/import', {}, 'file', 'dup.zip', exp.buf, 'application/zip');
    const i2 = await postMultipart('/api/v1/dramas/import', {}, 'file', 'dup.zip', exp.buf, 'application/zip');
    cs.log(`import#1 -> ${i1.status}, import#2 -> ${i2.status}`);
    cs.eq('第一次导入 201', i1.status, 201);
    cs.eq('第二次导入 201', i2.status, 201);
    const id1 = i1.json?.data?.drama_id || i1.json?.data?.id;
    const id2 = i2.json?.data?.drama_id || i2.json?.data?.id;
    cs.expect('两次导入产生不同项目', Number(id1) !== Number(id2), `${id1} vs ${id2}`);
    cs.cleanupProjectIds.push(Number(id1), Number(id2));
    const g1 = await api.be(`/api/v1/dramas/${id1}`);
    const g2 = await api.be(`/api/v1/dramas/${id2}`);
    cs.expect('两次导入标题可区分（追加 导入N 后缀，不互相覆盖）', g1.json?.data?.title !== g2.json?.data?.title && String(g1.json?.data?.title).startsWith(`${uniq}-DUP`), `${g1.json?.data?.title} vs ${g2.json?.data?.title}`);
    cs.log('[观察] 重复导入产生独立项目，导入器以 " 导入N" 后缀区分同名标题——无合并、无去重提示但也不会静默覆盖，记录为真实行为。');
  });
})();
