'use strict';
const fs = require('fs');
const path = require('path');

// V2.1 目标 schema 版本（一次性迁移与 journal 判定的权威值）
const V21_SCHEMA_VERSION = '2.1.0';

const MIGRATION_FILE = path.join(__dirname, '..', '..', 'migrations', '36_v21_domain.sql');

function stripLeadingComments(sql) {
  return sql
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('--');
    })
    .join('\n')
    .trim();
}

/**
 * 确保 V2.1 领域表与应用 schema 版本存在。
 * 幂等：全部使用 CREATE TABLE IF NOT EXISTS，可重复执行。
 */
function ensureV21Domain(db) {
  const sql = stripLeadingComments(fs.readFileSync(MIGRATION_FILE, 'utf8'));
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    db.exec(stmt + ';');
  }
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES ('app_schema_version', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(V21_SCHEMA_VERSION);
  return { schemaVersion: V21_SCHEMA_VERSION };
}

function getAppSchemaVersion(db) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'app_schema_version'").get();
  return row ? row.value : null;
}

/**
 * V2.1 为统一任务表 async_tasks 补充列（幂等）：
 * - input_json：不可变输入快照（含 prompt/引用/规格）
 * - cost_json：费用快照（预计/实际/计费口径）
 * - owner_type/owner_id：任务业务归属（asset/shot/episode）
 * - idempotency_key：幂等键（同键重复提交去重；重试产生的新 attempt 为空）
 * - cancel_state：取消语义（cancel-requested → cancelled）
 */
function ensureAsyncTaskV21Columns(db) {
  const existing = new Set(
    db.prepare('PRAGMA table_info(async_tasks)').all().map((r) => r.name)
  );
  const wanted = [
    ['input_json', 'TEXT'],
    ['cost_json', 'TEXT'],
    ['owner_type', 'TEXT'],
    ['owner_id', 'TEXT'],
    ['idempotency_key', 'TEXT'],
    ['cancel_state', 'TEXT'],
  ];
  for (const [name, type] of wanted) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE async_tasks ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_v21_async_tasks_idem ON async_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL'
  );
}

module.exports = {
  ensureV21Domain,
  getAppSchemaVersion,
  ensureAsyncTaskV21Columns,
  V21_SCHEMA_VERSION,
};
