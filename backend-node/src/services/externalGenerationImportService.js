const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function importExternalResult(db, input) {
  const attempt = db.prepare(`SELECT a.*, j.drama_id, j.storyboard_id, j.provider, j.prompt_snapshot
    FROM external_generation_attempts a JOIN external_generation_jobs j ON j.id=a.job_id WHERE a.id=?`).get(input.attemptId);
  if (!attempt) throw new Error('Generation attempt not found');
  if (!input.bytes || !Buffer.isBuffer(input.bytes)) throw new Error('image bytes are required');
  const meta = await sharp(input.bytes).metadata();
  if (!meta.width || !meta.height || !meta.format) throw new Error('invalid image');
  const hash = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const existing = db.prepare('SELECT * FROM external_generation_results WHERE attempt_id=? AND result_index=?').get(input.attemptId, Number(input.resultIndex));
  if (existing) return { resultId: existing.id, imageGenerationId: existing.image_generation_id, assetId: existing.asset_id, status: existing.status, sha256: existing.download_hash, width: existing.source_width, height: existing.source_height, duplicate: true };
  const resultId = input.resultId || crypto.randomUUID();
  const root = path.resolve(input.storageRoot || path.join(process.cwd(), 'data', 'external-web'));
  const dir = path.join(root, String(attempt.drama_id), String(attempt.storyboard_id || 'unassigned'), resultId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
  const localPath = path.join(dir, `original.${ext}`);
  fs.writeFileSync(localPath, input.bytes, { flag: 'wx' });
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const ig = db.prepare(`INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, image_url, local_path, width, height, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`).run(attempt.storyboard_id, attempt.drama_id, `external:${attempt.provider || 'web'}`, attempt.prompt_snapshot, input.sourceUrl || null, localPath, meta.width, meta.height, now, now);
    const asset = db.prepare(`INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type, width, height, image_gen_id, created_at, updated_at)
      VALUES (?, ?, 'image', 'external-web', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(attempt.drama_id, path.basename(localPath), input.sourceUrl || null, localPath, input.bytes.length, input.sourceMime || `image/${meta.format}`, meta.width, meta.height, ig.lastInsertRowid, now, now);
    db.prepare(`INSERT INTO external_generation_results (id, attempt_id, result_set_id, provider_result_id, result_index, source_url, source_mime, source_width, source_height, download_hash, image_generation_id, asset_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)`).run(resultId, input.attemptId, input.resultSetId || null, input.providerResultId || null, Number(input.resultIndex), input.sourceUrl || null, input.sourceMime || `image/${meta.format}`, meta.width, meta.height, hash, ig.lastInsertRowid, asset.lastInsertRowid, now, now);
    return { resultId, imageGenerationId: ig.lastInsertRowid, assetId: asset.lastInsertRowid, status: 'imported', sha256: hash, width: meta.width, height: meta.height };
  });
  return tx();
}

function rebindExternalResult(db, resultId, storyboardId) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM external_generation_results WHERE id=? AND status IN (\'imported\', \'ready\')').get(resultId);
    if (!row) throw new Error('Imported result not found');
    const sb = db.prepare('SELECT id FROM storyboards WHERE id=? AND deleted_at IS NULL').get(storyboardId);
    if (!sb) throw new Error('Storyboard not found');
    const now = new Date().toISOString();
    db.prepare('UPDATE image_generations SET storyboard_id=?, updated_at=? WHERE id=?').run(storyboardId, now, row.image_generation_id);
    db.prepare('UPDATE external_generation_results SET status=\'bound\', updated_at=? WHERE id=?').run(now, resultId);
    return db.prepare('SELECT * FROM external_generation_results WHERE id=?').get(resultId);
  })();
}
module.exports = { importExternalResult, rebindExternalResult };
