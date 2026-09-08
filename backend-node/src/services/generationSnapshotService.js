const crypto = require('node:crypto');

function freezeGenerationSnapshot(db, input = {}) {
  if (!input.style?.id || !input.style?.version) {
    const error = new Error('生成快照缺少风格版本');
    error.code = 'SNAPSHOT_STYLE_REQUIRED';
    throw error;
  }
  if (!String(input.finalPrompt || '').trim()) {
    const error = new Error('生成快照缺少最终提示词');
    error.code = 'SNAPSHOT_PROMPT_REQUIRED';
    throw error;
  }
  if (!input.capabilityValidation || input.capabilityValidation.status === 'blocked') {
    const error = new Error('能力校验未通过，不能保存待提交快照');
    error.code = 'CAPABILITY_VALIDATION_FAILED';
    error.details = input.capabilityValidation?.errors || [];
    throw error;
  }
  const id = input.id || crypto.randomUUID();
  const now = input.now || new Date().toISOString();
  db.prepare(`INSERT INTO generation_style_snapshots
    (id, drama_id, target_type, target_id, media_type, style_id, style_version, language,
     final_prompt, negative_prompt, references_json, sections_json, capability_validation_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'compiled', ?)`)
    .run(id, input.dramaId ?? null, input.targetType, String(input.targetId ?? ''), input.mediaType,
      input.style.id, input.style.version, input.language, input.finalPrompt, input.negativePrompt || null,
      JSON.stringify(input.references || []), JSON.stringify(input.sections || {}),
      JSON.stringify(input.capabilityValidation), now);
  return Object.freeze({ id, status: 'compiled', createdAt: now, ...input });
}

function markSnapshotSubmitted(db, id, now = new Date().toISOString()) {
  const result = db.prepare("UPDATE generation_style_snapshots SET status='submitted', submitted_at=? WHERE id=? AND status='compiled'").run(now, id);
  if (!result.changes) {
    const error = new Error('生成快照不存在或已经提交');
    error.code = 'SNAPSHOT_STATE_CONFLICT';
    throw error;
  }
  return db.prepare('SELECT * FROM generation_style_snapshots WHERE id=?').get(id);
}

module.exports = { freezeGenerationSnapshot, markSnapshotSubmitted };
