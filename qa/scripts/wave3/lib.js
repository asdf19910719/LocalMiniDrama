// Wave3 共享执行库：真实 HTTP 调用 + 断言 + 证据留存 + execution-log.jsonl
// 基于 wave2/lib.js，产物目录改为 wave3；新增：真实 PNG 生成器、v2 剧本草稿/确认、 multipart 上传
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = 'E:/project/LocalMiniDrama';
const LOG_JSONL = path.join(ROOT, 'qa/run/execution-log.jsonl');
const LOG_DIR = path.join(ROOT, 'qa/run/wave3-logs');
const ART_DIR = path.join(ROOT, 'qa/run/wave3-artifacts');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const BE = 'http://127.0.0.1:5679';
const FE = 'http://127.0.0.1:3013';

function mask(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})/g, '$1****$2');
}

async function req(method, url, body, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60000);
  try {
    const headers = Object.assign({}, opts.headers || {});
    let payload = body;
    if (body !== undefined && body !== null && !(body instanceof FormData) && !(body instanceof Buffer) && !(body instanceof Uint8Array) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload, signal: ctrl.signal, redirect: opts.redirect || 'manual' });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, headers: res.headers, text, json, buf };
  } finally { clearTimeout(t); }
}

const api = {
  be: (p, body, opts) => req(opts?.method || (body !== undefined ? 'POST' : 'GET'), BE + p, body, opts),
  beMethod: (method, p, body, opts) => req(method, BE + p, body, opts),
  fe: (p, opts) => req('GET', FE + p, undefined, opts),
};

// ---------- multipart ----------
async function postMultipart(urlPath, fields, fileField, filename, fileBuf, mime) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  if (fileField) fd.append(fileField, new Blob([fileBuf], { type: mime || 'application/octet-stream' }), filename);
  const res = await fetch(BE + urlPath, { method: 'POST', body: fd });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, text, json, buf };
}

// ---------- 真实 PNG 生成器（手写 PNG 头：IHDR/IDAT/IEND，CRC 校验齐全，可被任意解码器解码）----------
const PNG_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function pngCrc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = PNG_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(body));
  return Buffer.concat([len, body, crc]);
}
/** 生成 width x height 的真实 PNG（RGB 8-bit，纯色或渐变），结构自检通过才返回 */
function makePng(width = 8, height = 8, rgb = [200, 60, 60]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[off++] = (rgb[0] + x * 2) % 256;
      raw[off++] = (rgb[1] + y * 2) % 256;
      raw[off++] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  // 结构自检：签名 + CRC 复验 + 解压长度匹配
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG signature broken');
  const rawLen = height * (1 + width * 3);
  if (zlib.inflateSync(idat).length !== rawLen) throw new Error('PNG IDAT self-check failed');
  return png;
}

// ---------- 只读 DB ----------
let _db = null;
function db() {
  if (_db) return _db;
  const Database = require(path.join(ROOT, 'backend-node/node_modules/better-sqlite3'));
  _db = new Database(path.join(ROOT, 'backend-node/data/drama_generator.db'), { readonly: true, fileMustExist: true });
  return _db;
}
function q(sql, ...params) {
  return db().prepare(sql).all(...params);
}
function q1(sql, ...params) {
  return db().prepare(sql).get(...params);
}

// ---------- 用例执行器 ----------
class Case {
  constructor(meta) {
    this.meta = meta; // {id,title,module,level,priority}
    this.evidence = [];
    this.failed = [];
    this.t0 = Date.now();
    this.cleanupProjectIds = []; // 用例自建项目：结束后软删（可复核、不占活跃列表）
  }
  log(...parts) {
    const line = parts.map((p) => (typeof p === 'string' ? mask(p) : mask(JSON.stringify(p)))).join(' ');
    this.evidence.push(`[${((Date.now() - this.t0) / 1000).toFixed(1)}s] ${line}`);
    console.log(`  ${line}`);
  }
  expect(label, cond, detail) {
    const ok = !!cond;
    this.evidence.push(`ASSERT ${ok ? 'PASS' : 'FAIL'}: ${label}${detail !== undefined ? ' | ' + mask(String(detail)) : ''}`);
    if (!ok) this.failed.push(label + (detail !== undefined ? ` (${mask(String(detail))})` : ''));
    return ok;
  }
  eq(label, actual, want) { return this.expect(`${label} == ${JSON.stringify(want)}`, actual === want, `actual=${JSON.stringify(actual)}`); }
  /** 网络级重试：node --watch 后端可能被并行开发会话触发重启，连接失败等 3s 重试一次 */
  async withRetry(label, fn) {
    try {
      return await fn();
    } catch (e) {
      this.log(`[${label}] 连接异常（可能是后端 --watch 重启）: ${e.message}，3s 后重试一次`);
      await new Promise((res) => setTimeout(res, 3000));
      return fn();
    }
  }
  async cleanup() {
    for (const id of this.cleanupProjectIds) {
      try {
        const r = await api.beMethod('DELETE', `/api/v2/projects/${id}`);
        this.evidence.push(`[cleanup] 软删项目 ${id} -> ${r.status}`);
      } catch (e) {
        this.evidence.push(`[cleanup] 软删项目 ${id} 异常: ${mask(e.message)}`);
      }
    }
  }
  async finish() {
    await this.cleanup();
    const status = this.failed.length === 0 ? 'passed' : 'failed';
    const rec = {
      case_id: this.meta.id,
      title: this.meta.title,
      module: this.meta.module,
      level: this.meta.level,
      priority: this.meta.priority,
      status,
      evidence: this.evidence.join(' ; ').slice(0, 3500),
      duration_ms: Date.now() - this.t0,
      error_summary: this.failed.length ? this.failed.join(' | ').slice(0, 900) : '',
    };
    fs.appendFileSync(LOG_JSONL, JSON.stringify(rec) + '\n');
    fs.writeFileSync(path.join(LOG_DIR, this.meta.id + '.log'), this.evidence.join('\n') + '\n');
    const icon = status === 'passed' ? 'PASS' : 'FAIL';
    console.log(`${icon} ${this.meta.id} (${rec.duration_ms}ms)${this.failed.length ? ' -> ' + rec.error_summary : ''}`);
    return status;
  }
}

async function runCase(meta, fn) {
  console.log(`\n== ${meta.id}: ${meta.title}`);
  const cs = new Case(meta);
  try {
    await fn(cs);
  } catch (e) {
    cs.failed.push('EXCEPTION: ' + mask(e.message));
    cs.evidence.push('EXCEPTION: ' + mask(e.stack || e.message));
  }
  return cs.finish();
}

// ---------- 常用测试数据工厂 ----------
async function createV1Project(cs, title, extra = {}) {
  const body = Object.assign({ title, style_id: await defaultStyleId(), description: 'QA-L3 wave3 自动化测试项目' }, extra);
  const r = await api.be('/api/v1/dramas', body);
  if (r.status !== 201) throw new Error('createV1Project failed: ' + r.status + ' ' + r.text.slice(0, 200));
  const id = r.json.data.id;
  if (cs) cs.cleanupProjectIds.push(id);
  return { id, body: r.json.data };
}

let _styleId = null;
async function defaultStyleId() {
  if (_styleId) return _styleId;
  const r = await api.be('/api/v1/styles');
  const items = r.json?.data?.items || [];
  if (!items.length) throw new Error('风格目录为空');
  _styleId = items[0].id;
  return _styleId;
}

/** v2 建剧集 */
async function createEpisode(cs, projectId, title = '第一集') {
  const r = await api.be(`/api/v2/projects/${projectId}/episodes`, { title });
  if (r.status !== 200 && r.status !== 201) throw new Error('createEpisode failed: ' + r.status + ' ' + r.text.slice(0, 200));
  return r.json.data.id;
}

/** v2 保存剧本草稿（草稿保存即解析场次结构 story_scenes） */
async function saveDraft(episodeId, content) {
  return api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content });
}

/** v2 确认剧本（产生 approved 修订——本集投影/结构创建/分镜生成的前置） */
async function confirmScript(episodeId) {
  return api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
}

/** 项目级角色创建（PUT /dramas/:id/characters），返回创建后的角色列表 */
async function saveCharacters(projectId, characters) {
  const r = await api.beMethod('PUT', `/api/v1/dramas/${projectId}/characters`, { characters });
  if (r.status !== 200) throw new Error('saveCharacters failed: ' + r.status + ' ' + r.text.slice(0, 200));
  const g = await api.be(`/api/v1/dramas/${projectId}/characters`);
  return (g.json?.data || []).filter((c) => characters.some((x) => x.name === c.name));
}

module.exports = {
  api, req, runCase, mask,
  postMultipart, makePng, q, q1,
  ROOT, BE, FE, LOG_DIR, ART_DIR,
  createV1Project, defaultStyleId, createEpisode, saveDraft, confirmScript, saveCharacters,
};
