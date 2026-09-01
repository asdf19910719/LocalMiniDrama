const crypto = require('node:crypto');

function id() {
  return crypto.randomUUID();
}

function now(value) {
  if (value === undefined || value === null) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`);
  return date.toISOString();
}

// Hashing structured prompts must not depend on object insertion order.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function promptText(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return stableStringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function value(input, camel, snake, fallback = null) {
  if (input && input[camel] !== undefined) return input[camel];
  if (input && input[snake] !== undefined) return input[snake];
  return fallback;
}

function getExternalJob(db, jobId) {
  const job = db.prepare('SELECT * FROM external_generation_jobs WHERE id = ?').get(jobId) || null;
  if (!job) return null;
  job.attempts = db.prepare('SELECT * FROM external_generation_attempts WHERE job_id = ? ORDER BY sequence').all(jobId);
  for (const attempt of job.attempts) {
    attempt.results = db.prepare('SELECT * FROM external_generation_results WHERE attempt_id = ? ORDER BY result_index').all(attempt.id);
    for (const result of attempt.results) {
      if (result.status === 'imported' || result.status === 'bound') {
        result.preview_url = `/api/v1/external-generation/results/${encodeURIComponent(result.id)}/content`;
      }
    }
  }
  return job;
}

const idempotencyLocks = new WeakMap();

function runIdempotent(db, idempotencyKey, operation, callback) {
  const key = String(idempotencyKey || '').trim();
  if (!key) throw new Error('Idempotency-Key is required');
  const readExisting = () => db.prepare('SELECT operation, response_json FROM external_generation_idempotency WHERE idempotency_key = ?').get(key);
  const existing = readExisting();
  if (existing) {
    if (existing.operation !== operation) throw new Error('Idempotency-Key was already used for another operation');
    return JSON.parse(existing.response_json);
  }
  let locks = idempotencyLocks.get(db);
  if (!locks) { locks = new Map(); idempotencyLocks.set(db, locks); }
  const lockKey = `${key}\u0000${operation}`;
  const prior = locks.get(lockKey);
  if (prior) return prior.then(() => {
    const replay = readExisting();
    if (!replay) throw new Error('Idempotent operation did not persist a response');
    if (replay.operation !== operation) throw new Error('Idempotency-Key was already used for another operation');
    return JSON.parse(replay.response_json);
  });
  const save = (value) => {
    const responseJson = JSON.stringify(value);
    if (responseJson === undefined) throw new Error('Idempotent operation must return a value');
    try {
      db.prepare('INSERT INTO external_generation_idempotency (idempotency_key, operation, response_json, created_at) VALUES (?, ?, ?, ?)')
        .run(key, operation, responseJson, new Date().toISOString());
      return value;
    } catch (error) {
      if (!String(error.code || '').includes('CONSTRAINT')) throw error;
      const replay = readExisting();
      if (!replay || replay.operation !== operation) throw error;
      return JSON.parse(replay.response_json);
    }
  };
  let result;
  let persistedSynchronously = false;
  try {
    db.transaction(() => {
      result = callback();
      if (!result || typeof result.then !== 'function') {
        save(result);
        persistedSynchronously = true;
      }
    })();
  } catch (error) {
    locks.delete(lockKey);
    throw error;
  }
  if (persistedSynchronously) {
    locks.delete(lockKey);
    return result;
  }
  const pending = Promise.resolve(result).then(save).finally(() => locks.delete(lockKey));
  locks.set(lockKey, pending);
  return pending;
}

function createExternalJob(db, input = {}) {
  const dramaId = value(input, 'dramaId', 'drama_id');
  const site = String(value(input, 'site', 'site', '') || '').trim();
  if (dramaId === undefined || dramaId === null || dramaId === '') throw new Error('dramaId is required');
  if (!site) throw new Error('site is required');

  const promptSnapshot = promptText(value(input, 'promptSnapshot', 'prompt_snapshot', value(input, 'prompt', 'prompt')));
  const promptHash = sha256(promptSnapshot);
  const suppliedPromptHash = value(input, 'promptHash', 'prompt_hash');
  if (suppliedPromptHash && String(suppliedPromptHash).toLowerCase() !== promptHash) {
    throw new Error('promptHash does not match promptSnapshot');
  }
  const createdAt = now(value(input, 'now', 'created_at'));
  const jobId = value(input, 'id', 'id', id());
  const insert = db.prepare(`
    INSERT INTO external_generation_jobs
      (id, drama_id, storyboard_id, asset_type, provider, site, conversation_id,
       prompt_snapshot, prompt_hash, reference_manifest_hash, status, created_at, updated_at,
       image_generation_task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    jobId,
    dramaId,
    value(input, 'storyboardId', 'storyboard_id'),
    String(value(input, 'assetType', 'asset_type', 'image') || 'image'),
    String(value(input, 'provider', 'provider', '') || ''),
    site,
    value(input, 'conversationId', 'conversation_id'),
    promptSnapshot,
    promptHash,
    value(input, 'referenceManifestHash', 'reference_manifest_hash'),
    String(value(input, 'status', 'status', 'pending') || 'pending'),
    createdAt,
    createdAt,
    value(input, 'imageGenerationTaskId', 'image_generation_task_id'),
  );
  return getExternalJob(db, jobId);
}

function createGenerationAttempt(db, jobId, input = {}) {
  const job = getExternalJob(db, jobId);
  if (!job) throw new Error(`External generation job not found: ${jobId}`);
  const timestamp = now(value(input, 'now', 'created_at'));
  const attemptId = value(input, 'id', 'id', id());
  let result;
  const create = db.transaction(() => {
    const next = db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM external_generation_attempts WHERE job_id = ?').get(jobId).sequence;
    db.prepare(`
      INSERT INTO external_generation_attempts
        (id, job_id, conversation_id, user_message_id, assistant_message_id, request_id,
         sent_prompt_hash, sent_reference_manifest_hash, status, sequence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attemptId,
      jobId,
      value(input, 'conversationId', 'conversation_id', job.conversation_id),
      value(input, 'userMessageId', 'user_message_id'),
      value(input, 'assistantMessageId', 'assistant_message_id'),
      value(input, 'requestId', 'request_id'),
      value(input, 'sentPromptHash', 'sent_prompt_hash', job.prompt_hash),
      value(input, 'sentReferenceManifestHash', 'sent_reference_manifest_hash', job.reference_manifest_hash),
      String(value(input, 'status', 'status', 'pending') || 'pending'),
      next,
      timestamp,
      timestamp,
    );
    result = db.prepare('SELECT * FROM external_generation_attempts WHERE id = ?').get(attemptId);
  });
  create();
  return result;
}

function recordAttemptEvent(db, attemptId, event = {}) {
  const attempt = db.prepare('SELECT id FROM external_generation_attempts WHERE id = ?').get(attemptId);
  if (!attempt) throw new Error(`Generation attempt not found: ${attemptId}`);
  const idempotencyKey = String(value(event, 'idempotencyKey', 'idempotency_key', '') || '').trim();
  if (!idempotencyKey) throw new Error('idempotencyKey is required');
  const eventType = String(value(event, 'eventType', 'event_type', '') || '').trim();
  if (!eventType) throw new Error('eventType is required');
  const timestamp = now(value(event, 'now', 'created_at'));
  const payload = value(event, 'payload', 'payload_json', {});
  const payloadJson = typeof payload === 'string' ? payload : stableStringify(payload);
  const eventId = value(event, 'id', 'id', id());
  let result;
  const record = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM external_generation_events WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) {
      if (existing.attempt_id !== attemptId) throw new Error(`idempotencyKey already belongs to attempt ${existing.attempt_id}`);
      result = existing;
      return;
    }
    const sequence = db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM external_generation_events WHERE attempt_id = ?').get(attemptId).sequence;
    db.prepare(`
      INSERT INTO external_generation_events
        (id, attempt_id, idempotency_key, sequence, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, attemptId, idempotencyKey, sequence, eventType, payloadJson, timestamp);
    const nextStatus = { SUBMITTED: 'submitted', GENERATING: 'generating', RESULT_READY: 'completed', COMPLETED: 'completed', ADAPTER_ERROR: 'needs_review' }[eventType];
    if (nextStatus) db.prepare('UPDATE external_generation_attempts SET status=?, updated_at=? WHERE id=?').run(nextStatus, timestamp, attemptId);
    // Surface capture errors on the unified task so the workbench drawer can
    // show them; healthy lifecycle events clear any previously stored error.
    if (nextStatus) {
      const hasTasks = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='image_generation_tasks'").get();
      const linked = hasTasks ? db.prepare(`SELECT job.image_generation_task_id AS task_id
        FROM external_generation_attempts attempt JOIN external_generation_jobs job ON job.id=attempt.job_id
        WHERE attempt.id=?`).get(attemptId) : null;
      if (linked?.task_id) {
        if (eventType === 'ADAPTER_ERROR') {
          const errorCode = String(value(payload, 'code', 'error_code', '') || 'ADAPTER_ERROR').slice(0, 120);
          const errorMessage = String(value(payload, 'message', 'error_message', '') || '生成过程出现错误，请重试或恢复捕获').slice(0, 500);
          // 只影响进行中的任务:迟到错误(如重复抓取被拒)不得污染已完成的任务
          db.prepare(`UPDATE image_generation_tasks SET status='needs_review',
              error_code=?, error_message=?, updated_at=? WHERE id=?
              AND status IN ('preparing', 'submitted', 'generating')`)
            .run(errorCode, errorMessage, timestamp, linked.task_id);
        } else {
          db.prepare('UPDATE image_generation_tasks SET error_code=NULL, error_message=NULL, updated_at=? WHERE id=?')
            .run(timestamp, linked.task_id);
        }
      }
    }
    result = db.prepare('SELECT * FROM external_generation_events WHERE id = ?').get(eventId);
  });
  record();
  return result;
}

function getProjectSession(db, dramaId, site) {
  return db.prepare('SELECT * FROM external_generation_sessions WHERE drama_id = ? AND site = ?').get(dramaId, site) || null;
}

function attachProjectSession(db, dramaId, session = {}) {
  const site = String(value(session, 'site', 'site', '') || '').trim();
  if (dramaId === undefined || dramaId === null || dramaId === '') throw new Error('dramaId is required');
  if (!site) throw new Error('site is required');
  const timestamp = now(value(session, 'now', 'updated_at'));
  const existing = getProjectSession(db, dramaId, site);
  const sessionId = existing?.id || value(session, 'id', 'id', id());
  db.prepare(`
    INSERT INTO external_generation_sessions
      (id, drama_id, site, browser_profile_id, tab_id, conversation_id, status,
       last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (drama_id, site) DO UPDATE SET
      browser_profile_id = excluded.browser_profile_id,
      tab_id = excluded.tab_id,
      conversation_id = excluded.conversation_id,
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run(
    sessionId,
    dramaId,
    site,
    value(session, 'browserProfileId', 'browser_profile_id', existing?.browser_profile_id || null),
    value(session, 'tabId', 'tab_id', existing?.tab_id || null),
    value(session, 'conversationId', 'conversation_id', existing?.conversation_id || null),
    String(value(session, 'status', 'status', existing?.status || 'active') || 'active'),
    value(session, 'lastSeenAt', 'last_seen_at', timestamp),
    existing?.created_at || timestamp,
    timestamp,
  );
  return getProjectSession(db, dramaId, site);
}

module.exports = {
  stableStringify,
  sha256,
  createExternalJob,
  getExternalJob,
  createGenerationAttempt,
  recordAttemptEvent,
  getProjectSession,
  attachProjectSession,
  runIdempotent,
};
