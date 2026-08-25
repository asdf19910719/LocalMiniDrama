const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

function timestamp(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  return value.toISOString().replace(/[:.]/g, '-');
}

function backupDatabase(dbPath, backupDir, now) {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  const targetDir = path.resolve(backupDir || path.dirname(dbPath));
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, `${path.basename(dbPath)}.unified-video-${timestamp(now)}.bak`);
  fs.copyFileSync(dbPath, target, fs.constants.COPYFILE_EXCL);
  return target;
}

function historicalRoutingReport(db) {
  const rows = db.prepare(`SELECT id, config_id, config_snapshot, provider, protocol
    FROM video_generations ORDER BY id`).all();
  const linked = [];
  const historicalUnknown = [];
  for (const row of rows) {
    const hasSnapshot = row.config_id != null || Boolean(String(row.config_snapshot || '').trim());
    const item = { id: row.id, provider: row.provider || null, protocol: row.protocol || null };
    if (hasSnapshot) linked.push({ ...item, configId: row.config_id ?? null });
    else historicalUnknown.push(item);
  }
  return { linked, historical_unknown: historicalUnknown };
}

function migrateUnifiedVideo({ db, dbPath, backupDir, now = new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db is required');
  const backupPath = backupDatabase(dbPath, backupDir, now);
  runMigrationsAndEnsure(db);
  const routing = historicalRoutingReport(db);
  return {
    backupPath,
    backupSha256: backupPath ? crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex') : null,
    ...routing,
    total: routing.linked.length + routing.historical_unknown.length,
  };
}

function main() {
  const { loadConfig } = require('../src/config');
  const { getDb } = require('../src/db');
  const config = loadConfig();
  const report = migrateUnifiedVideo({ db: getDb(config.database), dbPath: config.database.path });
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = { migrateUnifiedVideo, historicalRoutingReport, backupDatabase };
