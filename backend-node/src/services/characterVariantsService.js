// 人物状态（角色变体）：CRUD、唯一默认维护与引用计数

/** 解析行内 extra_images JSON 字符串为数组（解析失败时保留原值） */
function parseVariantRow(row) {
  if (!row) return null;
  if (row.extra_images && typeof row.extra_images === 'string') {
    try {
      const parsed = JSON.parse(row.extra_images);
      if (Array.isArray(parsed)) row.extra_images = parsed;
    } catch (_) { /* 保留原字符串 */ }
  }
  return row;
}

function getVariantById(db, id) {
  const row = db.prepare('SELECT * FROM character_variants WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return parseVariantRow(row);
}

/** 列出某人物的全部未删除状态，默认状态在前，其余按 id 升序 */
function listVariants(db, characterId) {
  const rows = db.prepare(
    'SELECT * FROM character_variants WHERE character_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, id ASC'
  ).all(Number(characterId));
  return rows.map(parseVariantRow);
}

/** 计算下一个缺省 source_key：该人物第一个状态为 'default'，否则 variant_(n+1)。
 *  计数包含软删行：唯一索引 (character_id, source_key) 不区分 deleted_at，
 *  复用已删行的 key 会触发唯一约束冲突。 */
function nextSourceKey(db, characterId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM character_variants WHERE character_id = ?').get(characterId).c;
  return count === 0 ? 'default' : `variant_${count + 1}`;
}

/** 创建状态；is_default=1 时先清掉该人物既有默认，保证同一人物只有一个默认 */
function createVariant(db, input = {}) {
  const characterId = Number(input.character_id);
  const cid = Number.isFinite(characterId) ? characterId : null;
  const sourceKey = (input.source_key !== undefined && input.source_key !== null && String(input.source_key).trim() !== '')
    ? String(input.source_key).trim()
    : nextSourceKey(db, cid);
  const isDefault = input.is_default ? 1 : 0;
  if (isDefault) {
    db.prepare('UPDATE character_variants SET is_default = 0 WHERE character_id = ?').run(cid);
  }
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO character_variants (character_id, source_key, name, description, appearance, image_prompt, negative_prompt, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    cid,
    sourceKey,
    input.name ?? null,
    input.description ?? null,
    input.appearance ?? null,
    input.image_prompt ?? null,
    input.negative_prompt ?? null,
    isDefault,
    now,
    now
  );
  return getVariantById(db, info.lastInsertRowid);
}

const VARIANT_UPDATE_FIELDS = [
  'name', 'description', 'appearance', 'image_prompt', 'negative_prompt',
  'is_default', 'image_url', 'local_path', 'extra_images', 'source_key',
];

/** 更新状态；仅接受白名单字段，is_default=1 时先清掉同人物其它默认 */
function updateVariant(db, id, patch = {}) {
  const variantId = Number(id);
  const row = db.prepare('SELECT * FROM character_variants WHERE id = ? AND deleted_at IS NULL').get(variantId);
  if (!row) return null;
  if (patch.is_default !== undefined && patch.is_default) {
    db.prepare('UPDATE character_variants SET is_default = 0 WHERE character_id = ? AND id != ?').run(row.character_id, variantId);
  }
  const updates = [];
  const params = [];
  for (const key of VARIANT_UPDATE_FIELDS) {
    if (patch[key] === undefined) continue;
    if (key === 'is_default') {
      updates.push('is_default = ?');
      params.push(patch.is_default ? 1 : 0);
    } else if (key === 'extra_images') {
      updates.push('extra_images = ?');
      params.push(Array.isArray(patch.extra_images) ? JSON.stringify(patch.extra_images) : patch.extra_images);
    } else {
      updates.push(key + ' = ?');
      params.push(patch[key]);
    }
  }
  if (updates.length > 0) {
    params.push(new Date().toISOString(), variantId);
    db.prepare('UPDATE character_variants SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?').run(...params);
  }
  return getVariantById(db, variantId);
}

/** 删除状态：被分镜引用时抛 VARIANT_IN_USE，否则软删 */
function deleteVariant(db, id) {
  const variantId = Number(id);
  const row = db.prepare('SELECT id FROM character_variants WHERE id = ? AND deleted_at IS NULL').get(variantId);
  if (!row) return null;
  const usage = variantUsageCount(db, variantId);
  if (usage > 0) {
    const e = new Error('该人物状态已被分镜引用，无法删除');
    e.code = 'VARIANT_IN_USE';
    throw e;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE character_variants SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, variantId);
  return { ok: true, id: variantId };
}

/** 状态被分镜引用的次数 */
function variantUsageCount(db, variantId) {
  return db.prepare('SELECT COUNT(*) AS c FROM storyboard_character_variants WHERE variant_id = ?').get(Number(variantId)).c;
}

/** 确保人物有一个默认状态：已有 is_default=1 直接返回；否则从 characters 表复制 description/appearance 创建 */
function ensureDefaultVariant(db, characterId) {
  const cid = Number(characterId);
  const existing = db.prepare(
    'SELECT * FROM character_variants WHERE character_id = ? AND is_default = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1'
  ).get(cid);
  if (existing) return parseVariantRow(existing);
  const char = db.prepare('SELECT description, appearance FROM characters WHERE id = ?').get(cid);
  const now = new Date().toISOString();
  // 复用同 source_key='default' 的已删行，避免触发 (character_id, source_key) 唯一索引冲突
  const reused = db.prepare(
    "SELECT id FROM character_variants WHERE character_id = ? AND source_key = 'default' ORDER BY id LIMIT 1"
  ).get(cid);
  let variantId;
  if (reused) {
    db.prepare('UPDATE character_variants SET is_default = 0 WHERE character_id = ? AND id != ?').run(cid, reused.id);
    db.prepare(
      "UPDATE character_variants SET name = '默认', description = ?, appearance = ?, is_default = 1, deleted_at = NULL, updated_at = ? WHERE id = ?"
    ).run(char?.description ?? null, char?.appearance ?? null, now, reused.id);
    variantId = reused.id;
  } else {
    db.prepare('UPDATE character_variants SET is_default = 0 WHERE character_id = ?').run(cid);
    const info = db.prepare(
      `INSERT INTO character_variants (character_id, source_key, name, description, appearance, is_default, created_at, updated_at)
       VALUES (?, 'default', '默认', ?, ?, 1, ?, ?)`
    ).run(cid, char?.description ?? null, char?.appearance ?? null, now, now);
    variantId = Number(info.lastInsertRowid);
  }
  return getVariantById(db, variantId);
}

module.exports = {
  listVariants,
  createVariant,
  updateVariant,
  deleteVariant,
  ensureDefaultVariant,
  variantUsageCount,
};
