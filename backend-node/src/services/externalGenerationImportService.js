const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const settingsService = require('./settingsService');
const targets = require('./imageGenerationTargetService');
const tasksService = require('./imageGenerationTaskService');

function safeResultId(value) {
  if (value === undefined || value === null || value === '') return crypto.randomUUID();
  const resultId = String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(resultId) || resultId === '.' || resultId === '..') {
    throw new Error('resultId must be a safe identifier');
  }
  return resultId;
}

function markUnifiedTaskNeedsReview(db, attemptId) {
  const hasTasks = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='image_generation_tasks'").get();
  if (!hasTasks) return false;
  const linked = db.prepare(`SELECT job.image_generation_task_id AS task_id
    FROM external_generation_attempts attempt JOIN external_generation_jobs job ON job.id=attempt.job_id
    WHERE attempt.id=?`).get(attemptId);
  if (!linked?.task_id) return false;
  const result = db.prepare(`UPDATE image_generation_tasks SET status='needs_review', updated_at=?
    WHERE id=? AND status IN ('preparing','submitted','generating')`)
    .run(new Date().toISOString(), linked.task_id);
  return result.changes > 0;
}

function autoSelectEnabled(db) {
  return settingsService.getGlobalSetting(db, 'chatgpt_web_auto_select', true) !== false;
}

function keepTaskGenerating(db, taskId, imageGenerationId) {
  let task = tasksService.getTask(db, taskId);
  if (!task || task.status === 'needs_review') return;
  if (task.status === 'preparing') task = tasksService.transitionTask(db, task.id, 'submitted');
  if (task.status === 'submitted') {
    tasksService.transitionTask(db, task.id, 'generating', { imageGenerationId });
  } else if (task.status === 'generating') {
    tasksService.transitionTask(db, task.id, 'generating', { imageGenerationId });
  }
}

// 首张候选自动挂载定稿;后续候选只追加,不抢占主图。任务保持 generating,
// 直到扩展确认候选集合已稳定并发送 COMPLETED,避免队列过早启动下一条任务。
function finalizeImportedResult(db, { attempt, resultId, imageGenerationId }) {
  const taskId = attempt.image_generation_task_id;
  if (!taskId) return;
  const task = db.prepare('SELECT * FROM image_generation_tasks WHERE id=?').get(taskId);
  if (!task || !['preparing', 'submitted', 'generating', 'needs_review'].includes(task.status)) return;
  const selected = db.prepare(`SELECT r.image_generation_id FROM external_generation_results r
    JOIN external_generation_attempts a ON a.id = r.attempt_id
    WHERE a.job_id = ? AND r.id != ? AND r.selected=1
    ORDER BY r.created_at LIMIT 1`).get(attempt.job_id, resultId);
  if (selected?.image_generation_id) {
    keepTaskGenerating(db, task.id, selected.image_generation_id);
    return;
  }
  if (!autoSelectEnabled(db)) { keepTaskGenerating(db, task.id, null); return; }
  try { targets.resolveTarget(db, task); } catch (_) { keepTaskGenerating(db, task.id, null); return; }
  targets.bindResult(db, task, imageGenerationId);
  db.prepare("UPDATE external_generation_results SET selected=1, status='bound', updated_at=? WHERE id=?")
    .run(new Date().toISOString(), resultId);
  keepTaskGenerating(db, task.id, imageGenerationId);
}

async function importExternalResult(db, input) {
  const attempt = db.prepare(`SELECT a.*, j.drama_id, j.storyboard_id, j.provider, j.prompt_snapshot, j.image_generation_task_id
    FROM external_generation_attempts a JOIN external_generation_jobs j ON j.id=a.job_id WHERE a.id=?`).get(input.attemptId);
  if (!attempt) throw new Error('Generation attempt not found');
  // needs_review attempts are exactly what result recovery re-imports; keep
  // them importable and restore the attempt once a result lands.
  if (!['submitted', 'generating', 'completed', 'needs_review'].includes(String(attempt.status || '').toLowerCase())) throw new Error('Attempt is not importable');
  if (!input.assistantMessageId) throw new Error('NEEDS_REVIEW: assistant message identity is required');
  if (attempt.conversation_id && input.conversationId && attempt.conversation_id !== input.conversationId) throw new Error('NEEDS_REVIEW: conversation identity mismatch');
  if (attempt.assistant_message_id && attempt.assistant_message_id !== input.assistantMessageId) throw new Error('UNBOUND_RESULT: assistant message identity mismatch');
  if (!input.bytes || !Buffer.isBuffer(input.bytes)) throw new Error('image bytes are required');
  const resultIndex = Number(input.resultIndex);
  if (!Number.isInteger(resultIndex) || resultIndex < 0) throw new Error('resultIndex must be a non-negative integer');
  let meta;
  try { meta = await sharp(input.bytes).metadata(); } catch (_) { throw new Error('invalid image'); }
  if (!meta.width || !meta.height || !meta.format) throw new Error('invalid image');
  const hash = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const existing = db.prepare('SELECT * FROM external_generation_results WHERE attempt_id=? AND result_index=?').get(input.attemptId, resultIndex);
  if (existing) {
    if (existing.download_hash !== hash) throw new Error('Result index already contains different image bytes');
    return { resultId: existing.id, imageGenerationId: existing.image_generation_id, assetId: existing.asset_id, status: existing.status, sha256: existing.download_hash, width: existing.source_width, height: existing.source_height, duplicate: true };
  }
  const resultId = safeResultId(input.resultId);
  const root = path.resolve(input.storageRoot || path.join(process.cwd(), 'data', 'external-web'));
  const dir = path.join(root, String(attempt.drama_id), String(attempt.storyboard_id || 'unassigned'), resultId);
  if (!dir.startsWith(`${root}${path.sep}`)) throw new Error('storage path escapes external generation root');
  fs.mkdirSync(dir, { recursive: true });
  const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
  const localPath = path.join(dir, `original.${ext}`);
  let createdFile = false;
  if (fs.existsSync(localPath)) {
    const existingHash = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex');
    if (existingHash !== hash) throw new Error('Existing result file contains different image bytes');
  } else {
    fs.writeFileSync(localPath, input.bytes, { flag: 'wx' });
    createdFile = true;
  }
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (!attempt.assistant_message_id) db.prepare('UPDATE external_generation_attempts SET assistant_message_id=?, conversation_id=COALESCE(conversation_id,?), updated_at=? WHERE id=?')
      .run(input.assistantMessageId, input.conversationId || null, now, attempt.id);
    const ig = db.prepare(`INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, width, height, status, created_at, updated_at,
      external_job_id, external_attempt_id, external_result_id, source_hash, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`).run(attempt.storyboard_id, attempt.drama_id, `external:${attempt.provider || 'web'}`, attempt.prompt_snapshot, input.sourceUrl || null, localPath, meta.width, meta.height, now, now,
      attempt.job_id, attempt.id, resultId, hash, input.sourceUrl || null);
    const asset = db.prepare(`INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type, width, height, image_gen_id, created_at, updated_at)
      VALUES (?, ?, 'image', 'external-web', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(attempt.drama_id, path.basename(localPath), input.sourceUrl || null, localPath, input.bytes.length, input.sourceMime || `image/${meta.format}`, meta.width, meta.height, ig.lastInsertRowid, now, now);
    db.prepare(`INSERT INTO external_generation_results (id, attempt_id, result_set_id, provider_result_id, result_index, candidate_index, selected, source_url, source_mime, source_width, source_height, download_hash, image_generation_id, asset_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)`).run(resultId, input.attemptId, input.resultSetId || null, input.providerResultId || null, resultIndex, resultIndex, input.sourceUrl || null, input.sourceMime || `image/${meta.format}`, meta.width, meta.height, hash, ig.lastInsertRowid, asset.lastInsertRowid, now, now);
    finalizeImportedResult(db, { attempt, resultId, imageGenerationId: ig.lastInsertRowid });
    if (String(attempt.status || '').toLowerCase() === 'needs_review') {
      db.prepare("UPDATE external_generation_attempts SET status='submitted', updated_at=? WHERE id=?").run(now, attempt.id);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='image_generation_tasks'").get() && attempt.image_generation_task_id) {
      db.prepare('UPDATE image_generation_tasks SET error_code=NULL, error_message=NULL, updated_at=? WHERE id=?')
        .run(now, attempt.image_generation_task_id);
    }
    return { resultId, imageGenerationId: ig.lastInsertRowid, assetId: asset.lastInsertRowid, status: 'imported', sha256: hash, width: meta.width, height: meta.height };
  });
  try {
    return tx();
  } catch (error) {
    if (createdFile) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
    throw error;
  }
}

function rebindExternalResult(db, resultId, storyboardId) {
  return db.transaction(() => {
    if (storyboardId === undefined || storyboardId === null || storyboardId === '') throw new Error('storyboardId is required');
    const row = db.prepare(`SELECT result.*, attempt.job_id, job.drama_id AS job_drama_id, job.storyboard_id AS job_storyboard_id,
      image.image_url, image.local_path FROM external_generation_results result
      JOIN external_generation_attempts attempt ON attempt.id = result.attempt_id
      JOIN external_generation_jobs job ON job.id = attempt.job_id
      JOIN image_generations image ON image.id = result.image_generation_id
      WHERE result.id=? AND result.status IN ('imported', 'ready', 'bound')`).get(resultId);
    if (!row) throw new Error('Imported result not found');
    const sb = db.prepare(`SELECT sb.id, ep.drama_id FROM storyboards sb
      JOIN episodes ep ON ep.id = sb.episode_id WHERE sb.id=? AND sb.deleted_at IS NULL`).get(storyboardId);
    if (!sb) throw new Error('Storyboard not found');
    if (Number(sb.drama_id) !== Number(row.job_drama_id)) throw new Error('Storyboard belongs to another drama');
    const now = new Date().toISOString();
    db.prepare(`UPDATE external_generation_results SET selected=0, updated_at=?
      WHERE image_generation_id IN (SELECT id FROM image_generations WHERE storyboard_id=?)`).run(now, storyboardId);
    db.prepare('UPDATE external_generation_results SET status=\'bound\', selected=1, updated_at=? WHERE id=?').run(now, resultId);
    db.prepare('UPDATE image_generations SET storyboard_id=?, updated_at=? WHERE id=?').run(storyboardId, now, row.image_generation_id);
    db.prepare(`UPDATE storyboards SET image_url=?, local_path=?, status='generated', updated_at=? WHERE id=?`)
      .run(row.image_url, row.local_path, now, storyboardId);
    return db.prepare('SELECT * FROM external_generation_results WHERE id=?').get(resultId);
  })();
}
module.exports = { importExternalResult, rebindExternalResult, markUnifiedTaskNeedsReview };
