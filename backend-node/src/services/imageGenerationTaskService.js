const crypto = require('node:crypto');

const CHANNELS = new Set(['api', 'chatgpt_web']);
const TARGET_TYPES = new Set([
  'character',
  'scene',
  'prop',
  'storyboard_main',
  'storyboard_first',
  'storyboard_last',
]);
const STATUSES = new Set([
  'draft',
  'queued',
  'preparing',
  'submitted',
  'generating',
  'needs_review',
  'completed',
  'failed',
  'cancelled',
]);
const TERMINAL = new Set(['completed', 'cancelled']);
const TRANSITIONS = {
  draft: new Set(['queued', 'preparing', 'cancelled']),
  queued: new Set(['preparing', 'cancelled']),
  preparing: new Set(['queued', 'submitted', 'failed', 'cancelled']),
  submitted: new Set(['generating', 'needs_review', 'completed', 'failed', 'cancelled']),
  generating: new Set(['needs_review', 'completed', 'failed', 'cancelled']),
  needs_review: new Set(['completed', 'failed', 'cancelled']),
  failed: new Set(['queued', 'preparing', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

function now() {
  return new Date().toISOString();
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function assertChannel(channel) {
  if (!CHANNELS.has(channel)) throw new Error(`Unsupported image generation channel: ${channel}`);
}

function assertTargetType(targetType) {
  if (!TARGET_TYPES.has(targetType)) throw new Error(`Unsupported image generation target type: ${targetType}`);
}

function getDefaultChannel(db, dramaId) {
  const row = db.prepare('SELECT metadata FROM dramas WHERE id=? AND deleted_at IS NULL').get(Number(dramaId));
  if (!row) throw new Error('Drama not found');
  const channel = parseMetadata(row.metadata).default_image_generation_channel || 'api';
  return CHANNELS.has(channel) ? channel : 'api';
}

function setDefaultChannel(db, dramaId, channel) {
  assertChannel(channel);
  const row = db.prepare('SELECT metadata FROM dramas WHERE id=? AND deleted_at IS NULL').get(Number(dramaId));
  if (!row) throw new Error('Drama not found');
  const metadata = parseMetadata(row.metadata);
  metadata.default_image_generation_channel = channel;
  db.prepare('UPDATE dramas SET metadata=?, updated_at=? WHERE id=?').run(JSON.stringify(metadata), now(), Number(dramaId));
  return channel;
}

function getTask(db, id) {
  return db.prepare('SELECT * FROM image_generation_tasks WHERE id=?').get(String(id)) || null;
}

function insertTask(db, input) {
  const dramaId = Number(input.dramaId ?? input.drama_id);
  const targetType = String(input.targetType ?? input.target_type ?? '');
  const targetId = Number(input.targetId ?? input.target_id);
  if (!Number.isFinite(dramaId)) throw new Error('dramaId is required');
  if (!Number.isFinite(targetId)) throw new Error('targetId is required');
  assertTargetType(targetType);
  const channel = input.generationChannel ?? input.generation_channel ?? getDefaultChannel(db, dramaId);
  assertChannel(channel);
  const status = input.status || 'draft';
  if (!STATUSES.has(status)) throw new Error(`Unsupported image generation status: ${status}`);
  const timestamp = input.now || now();
  const id = input.id || crypto.randomUUID();
  db.prepare(`INSERT INTO image_generation_tasks
    (id, drama_id, target_type, target_id, generation_channel, provider, model,
     prompt_snapshot, reference_manifest, aspect_ratio, frame_type, status,
     batch_id, queue_position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, dramaId, targetType, targetId, channel, input.provider || null, input.model || null,
      input.promptSnapshot ?? input.prompt_snapshot ?? null,
      input.referenceManifest ? JSON.stringify(input.referenceManifest) : (input.reference_manifest || null),
      input.aspectRatio ?? input.aspect_ratio ?? null,
      input.frameType ?? input.frame_type ?? null,
      status, input.batchId ?? input.batch_id ?? null,
      input.queuePosition ?? input.queue_position ?? null, timestamp, timestamp,
    );
  return getTask(db, id);
}

function createTask(db, input) {
  return insertTask(db, input || {});
}

function transitionTask(db, id, next, patch = {}) {
  if (!STATUSES.has(next)) throw new Error(`Unsupported image generation status: ${next}`);
  const current = getTask(db, id);
  if (!current) throw new Error('Image generation task not found');
  if (current.status !== next && (!TRANSITIONS[current.status] || !TRANSITIONS[current.status].has(next))) {
    throw new Error(`Invalid image generation transition: ${current.status} -> ${next}`);
  }
  if (TERMINAL.has(current.status) && current.status !== next) {
    throw new Error(`Invalid image generation transition from terminal status: ${current.status}`);
  }
  const timestamp = now();
  db.prepare(`UPDATE image_generation_tasks SET status=?, image_generation_id=COALESCE(?, image_generation_id),
    external_job_id=COALESCE(?, external_job_id), error_code=?, error_message=?,
    completed_at=?, updated_at=? WHERE id=?`)
    .run(
      next,
      patch.imageGenerationId ?? patch.image_generation_id ?? null,
      patch.externalJobId ?? patch.external_job_id ?? null,
      patch.errorCode ?? patch.error_code ?? null,
      patch.errorMessage ?? patch.error_message ?? null,
      next === 'completed' ? timestamp : current.completed_at,
      timestamp,
      String(id),
    );
  return getTask(db, id);
}

function createBatch(db, input) {
  const targets = Array.isArray(input.targets) ? input.targets : [];
  if (!targets.length) throw new Error('Batch targets are required');
  const dramaId = Number(input.dramaId ?? input.drama_id);
  const channel = input.generationChannel ?? input.generation_channel ?? getDefaultChannel(db, dramaId);
  assertChannel(channel);
  const id = input.id || crypto.randomUUID();
  const timestamp = input.now || now();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO image_generation_batches
      (id, drama_id, resource_scope, generation_channel, status, total_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`)
      .run(id, dramaId, input.resourceScope ?? input.resource_scope ?? 'mixed', channel, targets.length, timestamp, timestamp);
    targets.forEach((target, index) => insertTask(db, {
      ...target,
      dramaId,
      generationChannel: channel,
      batchId: id,
      queuePosition: index,
      status: 'queued',
      now: timestamp,
    }));
  });
  tx();
  return db.prepare('SELECT * FROM image_generation_batches WHERE id=?').get(id);
}

function getSummary(db, dramaId) {
  const rows = db.prepare('SELECT id, status, batch_id, queue_position, created_at FROM image_generation_tasks WHERE drama_id=? ORDER BY created_at, queue_position').all(Number(dramaId));
  const summary = {
    drama_id: Number(dramaId), total: rows.length, draft: 0, queued: 0, preparing: 0,
    submitted: 0, generating: 0, needs_review: 0, completed: 0, failed: 0, cancelled: 0,
    active_task_id: null,
  };
  for (const row of rows) {
    summary[row.status] += 1;
    if (!summary.active_task_id && !TERMINAL.has(row.status) && row.status !== 'failed') summary.active_task_id = row.id;
  }
  return summary;
}

module.exports = {
  CHANNELS,
  TARGET_TYPES,
  STATUSES,
  createTask,
  getTask,
  createBatch,
  getSummary,
  transitionTask,
  getDefaultChannel,
  setDefaultChannel,
};
