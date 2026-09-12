// Wave1 共享执行库：真实 HTTP 调用 + 断言 + 证据留存 + execution-log.jsonl
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/project/LocalMiniDrama';
const LOG_JSONL = path.join(ROOT, 'qa/run/execution-log.jsonl');
const LOG_DIR = path.join(ROOT, 'qa/run/wave1-logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

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
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      redirect: opts.redirect || 'manual',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, headers: res.headers, text, json, buf };
  } finally { clearTimeout(t); }
}

const api = {
  be: (p, body, opts) => req(opts?.method || (body ? 'POST' : 'GET'), BE + p, body, opts),
  fe: (p, opts) => req('GET', FE + p, undefined, opts),
};

class Case {
  constructor(meta) {
    this.meta = meta; // {id,title,module,level,priority}
    this.evidence = [];
    this.failed = [];
    this.t0 = Date.now();
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
  async finish() {
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

module.exports = { api, req, runCase, readRel, ROOT, BE, FE };
