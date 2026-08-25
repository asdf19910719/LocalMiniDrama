const http = require('node:http');
const crypto = require('node:crypto');
const { JobPackageStore } = require('./jobPackageStore');
const { EventOutbox } = require('./eventOutbox');

function json(res, status, body) { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json', 'content-length': data.length }); res.end(data); }
function tokenFrom(req) { const auth = req.headers.authorization || ''; return req.headers['x-bridge-token'] || (auth.startsWith('Bearer ') ? auth.slice(7) : ''); }
function sameToken(a, b) { return typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function body(req) { return new Promise((resolve, reject) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(new Error('invalid JSON')); } }); req.on('error', reject); }); }
function createBridgeServer(options = {}) {
  const pairingToken = options.pairingToken || crypto.randomBytes(24).toString('hex');
  const accessToken = options.accessToken || crypto.randomBytes(32).toString('hex');
  const store = options.store || new JobPackageStore(options.jobsRoot || require('node:path').join(process.cwd(), 'jobs'));
  const outbox = options.outbox || new EventOutbox(options.outboxPath || require('node:path').join(process.cwd(), 'events.json'));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      if (req.method === 'POST' && url.pathname === '/v1/session/pair') { const b = await body(req); const supplied = b.pairingToken || tokenFrom(req); if (!sameToken(supplied, pairingToken)) return json(res, 401, { error: 'invalid pairing token' }); return json(res, 200, { accessToken }); }
      if (!sameToken(tokenFrom(req), accessToken)) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'jobs' && parts[3] === 'manifest') return json(res, 200, await store.manifest(parts[2]));
      if (req.method === 'GET' && parts.length === 5 && parts[0] === 'v1' && parts[1] === 'jobs' && parts[3] === 'references') { const data = await store.readReference(parts[2], decodeURIComponent(parts[4])); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length }); return res.end(data); }
      if (req.method === 'POST' && url.pathname === '/v1/events') { const event = await body(req); const saved = await outbox.enqueue(event); return json(res, 202, saved); }
      if (req.method === 'GET' && url.pathname === '/v1/events') return json(res, 200, await outbox.pending());
      if (req.method === 'POST' && url.pathname === '/v1/events/ack') { const b = await body(req); return json(res, 200, { pending: await outbox.ack(b.sequence) }); }
      return json(res, 404, { error: 'not found' });
    } catch (error) { return json(res, error.message.includes('not found') ? 404 : 400, { error: error.message }); }
  });
  return { server, pairingToken, accessToken, store, outbox };
}
if (require.main === module) { const bridge = createBridgeServer(); bridge.server.listen(Number(process.env.BRIDGE_PORT || 0), '127.0.0.1', () => { const address = bridge.server.address(); console.log(JSON.stringify({ port: address.port, pairingToken: bridge.pairingToken })); }); }
module.exports = { createBridgeServer };
