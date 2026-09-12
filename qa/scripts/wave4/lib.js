// Wave4 共享执行库：真实 HTTP 调用 + 断言 + 证据留存 + execution-log.jsonl
// 基于 wave3/lib.js；新增：ffprobe 校验、真实 mp4/wav 合成、轮询器、sim-upscale 专用 DB 写连接（用户已授权模拟）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = 'E:/project/LocalMiniDrama';
const LOG_JSONL = path.join(ROOT, 'qa/run/execution-log.jsonl');
const LOG_DIR = path.join(ROOT, 'qa/run/wave4-logs');
const ART_DIR = path.join(ROOT, 'qa/run/wave4-artifacts');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const BE = 'http://127.0.0.1:5679';
const FE = 'http://127.0.0.1:3013';

function mask(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})/g, '$1****$2');
}

async function req(method, url, body, opts = {}) {
  const maxAttempts = opts.retries === undefined ? 2 : opts.retries; // 网络级重试（后端 --watch 重启窗口）
  for (let attempt = 1; ; attempt++) {
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
    } catch (e) {
      const isNetwork = /fetch failed|ECONNREFUSED|ECONNRESET|aborted|socket/i.test(`${e.message}${e.cause?.code || ''}`);
      if (isNetwork && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    } finally { clearTimeout(t); }
  }
}

const api = {
  be: (p, body, opts) => req(opts?.method || (body !== undefined ? 'POST' : 'GET'), BE + p, body, opts),
  beMethod: (method, p, body, opts) => req(method, BE + p, body, opts),
  fe: (p, opts) => req('GET', FE + p, undefined, opts),
};

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

// ---------- 真实文件合成 ----------
/** 手写真实 WAV（PCM 16bit 单声道，可被任意解码器解码） */
function makeWav(seconds = 1, sampleRate = 8000) {
  const n = seconds * sampleRate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    // 440Hz 正弦 + 包络，保证非静音
    const env = Math.min(1, i / (sampleRate * 0.05), (n - i) / (sampleRate * 0.05));
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000 * env);
    data.writeInt16LE(v, i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + data.length, 4);
  hdr.write('WAVE', 8);
  hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20); // PCM
  hdr.writeUInt16LE(1, 22); // mono
  hdr.writeUInt32LE(sampleRate, 24);
  hdr.writeUInt32LE(sampleRate * 2, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(data.length, 40);
  return Buffer.concat([hdr, data]);
}

/** 用系统 ffmpeg 合成真实 mp4（H.264 + AAC 音轨），返回 Buffer；失败返回 null */
function makeMp4ViaFfmpeg(seconds = 2, withAudio = true) {
  const out = path.join(ART_DIR, `synth_${Date.now()}_${seconds}s${withAudio ? '_aud' : '_mute'}.mp4`);
  const args = [
    '-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x240:rate=15`,
  ];
  if (withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (withAudio) args.push('-c:a', 'aac', '-shortest');
  args.push(out);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0 || !fs.existsSync(out)) return null;
  return { file: out, buf: fs.readFileSync(out) };
}

// ---------- ffprobe ----------
function ffprobe(file) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', String(file),
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || '').slice(-300) };
  try { return { ok: true, data: JSON.parse(r.stdout) }; }
  catch (e) { return { ok: false, error: 'ffprobe JSON parse: ' + e.message }; }
}
function ffprobeDuration(file) {
  const p = ffprobe(file);
  if (!p.ok) return { ok: false, error: p.error };
  const dur = Number(p.data?.format?.duration);
  const hasVideo = (p.data.streams || []).some((s) => s.codec_type === 'video');
  const hasAudio = (p.data.streams || []).some((s) => s.codec_type === 'audio');
  return { ok: Number.isFinite(dur) && dur > 0, duration: dur, hasVideo, hasAudio, data: p.data };
}

// ---------- PNG 生成器（继承 wave3：手写 PNG 头，CRC 自检）----------
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
function makePng(width = 8, height = 8, rgb = [200, 60, 60]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0;
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
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG signature broken');
  const rawLen = height * (1 + width * 3);
  if (zlib.inflateSync(idat).length !== rawLen) throw new Error('PNG IDAT self-check failed');
  return png;
}

// ---------- DB（默认只读；sim-upscale 专用写连接须显式 openWriteDb）----------
let _db = null;
let _wdb = null;
function db() {
  if (_db) return _db;
  const Database = require(path.join(ROOT, 'backend-node/node_modules/better-sqlite3'));
  _db = new Database(path.join(ROOT, 'backend-node/data/drama_generator.db'), { readonly: true, fileMustExist: true });
  return _db;
}
function q(sql, ...params) { return db().prepare(sql).all(...params); }
function q1(sql, ...params) { return db().prepare(sql).get(...params); }
/** 仅限 UPSCALE 模块模拟用（用户已授权）：写连接，5s busy timeout */
function openWriteDb() {
  if (_wdb) return _wdb;
  const Database = require(path.join(ROOT, 'backend-node/node_modules/better-sqlite3'));
  _wdb = new Database(path.join(ROOT, 'backend-node/data/drama_generator.db'), { fileMustExist: true, timeout: 5000 });
  return _wdb;
}
function wq(sql, ...params) { return openWriteDb().prepare(sql).all(...params); }

// ---------- 轮询器 ----------
async function pollUntil(fn, { timeoutMs = 30000, intervalMs = 1000, label = 'poll' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let out;
    try { out = await fn(); } catch (e) { out = { done: false, error: e.message }; }
    if (out && out.done) return out;
    if (Date.now() - t0 > timeoutMs) return Object.assign({}, out, { done: false, timeout: true });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------- 用例执行器 ----------
class Case {
  constructor(meta) {
    this.meta = meta;
    this.evidence = [];
    this.failed = [];
    this.t0 = Date.now();
    this.cleanupProjectIds = [];
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
  async finish(extraStatus = null) {
    if (this._finished) return this._finishedStatus; // 防止 runCase 与用例内部双写日志
    this._finished = true;
    await this.cleanup();
    let status;
    if (extraStatus) status = extraStatus;
    else status = this.failed.length === 0 ? 'passed' : 'failed';
    const rec = {
      case_id: this.meta.id,
      title: this.meta.title,
      module: this.meta.module,
      level: this.meta.level,
      priority: this.meta.priority,
      status,
      evidence: this.evidence.join(' ; ').slice(0, 3500),
      duration_ms: Date.now() - this.t0,
      error_summary: status === 'failed' ? this.failed.join(' | ').slice(0, 900) : '',
    };
    fs.appendFileSync(LOG_JSONL, JSON.stringify(rec) + '\n');
    fs.writeFileSync(path.join(LOG_DIR, this.meta.id + '.log'), this.evidence.join('\n') + '\n');
    const icon = status === 'passed' ? 'PASS' : status === 'blocked' ? 'BLOCKED' : 'FAIL';
    console.log(`${icon} ${this.meta.id} (${rec.duration_ms}ms)${rec.error_summary ? ' -> ' + rec.error_summary : ''}`);
    this._finishedStatus = status;
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
  const body = Object.assign({ title, style_id: await defaultStyleId(), description: 'QA-L3 wave4 自动化测试项目' }, extra);
  const r = await api.be('/api/v1/dramas', body);
  if (r.status !== 201) throw new Error('createV1Project failed: ' + r.status + ' ' + r.text.slice(0, 200));
  const id = r.json.data.id;
  if (cs) cs.cleanupProjectIds.push(id);
  return { id, body: r.json.data };
}

/** 共享链路项目豁免单用例清理（由模块脚本结尾统一软删） */
function keepProject(cs, id) {
  if (cs) cs.cleanupProjectIds = cs.cleanupProjectIds.filter((x) => x !== id);
  return id;
}

/** 模块结尾统一软删共享项目 */
async function softDeleteProject(id) {
  try { return (await api.beMethod('DELETE', `/api/v2/projects/${id}`)).status; } catch (_) { return 0; }
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

async function createEpisode(cs, projectId, title = '第一集') {
  const r = await api.be(`/api/v2/projects/${projectId}/episodes`, { title });
  if (r.status !== 200 && r.status !== 201) throw new Error('createEpisode failed: ' + r.status + ' ' + r.text.slice(0, 200));
  return r.json.data.id;
}

async function saveDraft(episodeId, content) {
  return api.beMethod('PUT', `/api/v2/episodes/${episodeId}/script/draft`, { content });
}

async function confirmScript(episodeId) {
  return api.be(`/api/v2/episodes/${episodeId}/script/confirm`, {});
}

/** 上传真实 PNG 到项目 uploads/，返回 {url, local_path} */
async function uploadPng(cs, dramaId, filename, width = 256, height = 144) {
  const png = makePng(width, height);
  const r = await postMultipart('/api/v1/upload/image', dramaId ? { drama_id: String(dramaId) } : {}, 'file', filename, png, 'image/png');
  if (r.status !== 200 && r.status !== 201) throw new Error('uploadPng failed: ' + r.status + ' ' + r.text.slice(0, 200));
  const d = r.json?.data || {};
  return { url: d.url || d.full_url, local_path: d.local_path, id: d.id, status: r.status };
}

module.exports = {
  api, req, runCase, mask,
  postMultipart, makePng, makeWav, makeMp4ViaFfmpeg, ffprobe, ffprobeDuration,
  q, q1, openWriteDb, wq, pollUntil,
  ROOT, BE, FE, LOG_DIR, ART_DIR,
  createV1Project, defaultStyleId, createEpisode, saveDraft, confirmScript, uploadPng,
  keepProject, softDeleteProject,
};
