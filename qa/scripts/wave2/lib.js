// Wave2 共享执行库：真实 HTTP 调用 + 断言 + 证据留存 + execution-log.jsonl
// 在 wave1/lib.js 基础上补充：multipart 上传、ZIP 解析/构造、只读 DB 查询、残留项目登记清理
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = 'E:/project/LocalMiniDrama';
const LOG_JSONL = path.join(ROOT, 'qa/run/execution-log.jsonl');
const LOG_DIR = path.join(ROOT, 'qa/run/wave2-logs');
const ART_DIR = path.join(ROOT, 'qa/scripts/wave2/artifacts');
const FIX_DIR = path.join(ROOT, 'qa/scripts/wave2/fixtures');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(ART_DIR, { recursive: true });
fs.mkdirSync(FIX_DIR, { recursive: true });

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

// ---------- 最小 ZIP 读取（central directory）----------
function zipEntries(buf) {
  const EOCD = 0x06054b50;
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error('not a zip (EOCD not found)');
  const count = buf.readUInt16LE(eocdPos + 10);
  let off = buf.readUInt32LE(eocdPos + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory at ' + off);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, localHeaderOffset: lho });
    off += 46 + nameLen + extraLen + commentLen;
  }
  for (const e of entries) {
    const lho = e.localHeaderOffset;
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('bad local header for ' + e.name);
    const nameLen = buf.readUInt16LE(lho + 26);
    const extraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + nameLen + extraLen;
    const raw = buf.slice(dataStart, dataStart + e.compSize);
    e.data = e.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    e.text = e.data.toString('utf8');
  }
  return entries;
}

function zipFind(entries, name) {
  return entries.find((e) => e.name === name || e.name.endsWith('/' + name)) || null;
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

function readRel(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ---------- 常用测试数据工厂 ----------
async function createV1Project(cs, title, extra = {}) {
  const body = Object.assign({ title, style_id: await defaultStyleId(), description: 'QA-L3 wave2 自动化测试项目' }, extra);
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

module.exports = {
  api, req, runCase, readRel, mask,
  postMultipart, zipEntries, zipFind, q, q1,
  ROOT, BE, FE, LOG_DIR, ART_DIR, FIX_DIR,
  createV1Project, defaultStyleId,
};
