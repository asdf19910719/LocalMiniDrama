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

/**
 * V2.1 为外部 AI 任务包表补充向导字段（幂等）：
 * - task_note：本次任务唯一可编辑的补充说明（EXT-201）
 * - context_version：上下文冻结版本（sha256(context_markdown + assets_digest)）
 * - cancelled_at：任务取消时间（等待中可取消，记录保留）
 */
function ensureExternalAiTaskV21Columns(db) {
  const existing = new Set(
    db.prepare('PRAGMA table_info(external_ai_package_tasks)').all().map((r) => r.name)
  );
  const wanted = [['task_note', 'TEXT'], ['context_version', 'TEXT'], ['cancelled_at', 'TEXT']];
  for (const [name, type] of wanted) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE external_ai_package_tasks ADD COLUMN ${name} ${type}`);
    }
  }
}

/**
 * V2.1 为分镜表补充列（幂等）：
 * - structure_revision：镜头结构修订号（SHOT_REVISION_CONFLICT 乐观锁）
 * - image_prompt_manual：分镜图提示词手工覆盖标记
 * - script_revision_id：来源剧本版本（更新结构/导入溯源）
 */
function ensureStoryboardV21Columns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(storyboards)').all().map((r) => r.name));
  const wanted = [
    ['structure_revision', 'INTEGER DEFAULT 1'],
    ['image_prompt_manual', 'INTEGER DEFAULT 0'],
    ['script_revision_id', 'INTEGER'],
  ];
  for (const [name, type] of wanted) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE storyboards ADD COLUMN ${name} ${type}`);
    }
  }
}

module.exports = {
  ensureV21Domain,
  getAppSchemaVersion,
  ensureAsyncTaskV21Columns,
  ensureExternalAiTaskV21Columns,
  ensureStoryboardV21Columns,
  V21_SCHEMA_VERSION,
};
