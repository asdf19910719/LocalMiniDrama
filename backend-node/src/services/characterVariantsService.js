// 人物状态（角色变体）：CRUD、唯一默认维护、引用计数与生图
const path = require('path');
const storageLayout = require('./storageLayout');
const { aspectRatioToSize } = require('./imageService');
const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
const { buildModePrompt, normalizeAssetMode } = require('./assetGenerationModes');

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

/** 创建状态；is_default=1 时先清掉该人物既有默认，保证同一人物只有一个默认。
 *  清默认 + INSERT 包在事务里:唯一键冲突回滚时不会丢掉旧默认。 */
function createVariant(db, input = {}) {
  return db.transaction(() => {
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
      `INSERT INTO character_variants (character_id, source_key, name, description, appearance, image_prompt, negative_prompt, asset_mode, use_identity_reference, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cid,
      sourceKey,
      input.name ?? null,
      input.description ?? null,
      input.appearance ?? null,
      input.image_prompt ?? null,
      input.negative_prompt ?? null,
      input.asset_mode || 'SINGLE',
      input.use_identity_reference === false || input.use_identity_reference === 0 ? 0 : 1,
      isDefault,
      now,
      now
    );
    return getVariantById(db, info.lastInsertRowid);
  })();
}

const VARIANT_UPDATE_FIELDS = [
  'name', 'description', 'appearance', 'image_prompt', 'negative_prompt',
  'is_default', 'image_url', 'local_path', 'extra_images', 'source_key',
  'asset_mode', 'use_identity_reference',
];

/** 更新状态；仅接受白名单字段，is_default=1 时先清掉同人物其它默认。
 *  清默认 + UPDATE 包在事务里:更新失败(如 source_key 唯一冲突)时不会丢掉旧默认。 */
function updateVariant(db, id, patch = {}) {
  return db.transaction(() => {
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
      } else if (key === 'use_identity_reference') {
        updates.push('use_identity_reference = ?');
        params.push(patch.use_identity_reference ? 1 : 0);
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
  })();
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

/**
 * spec §13：从 characters 行提取 default 状态的复制字段。
 * image_prompt 优先 characters.polished_prompt，为空回退 appearance+description 拼接。
 */
function defaultVariantCopyFromCharacter(char) {
  const text = (v) => (v != null && String(v).trim() !== '' ? String(v).trim() : null);
  const imagePrompt = text(char?.polished_prompt)
    || [text(char?.appearance), text(char?.description)].filter(Boolean).join(', ')
    || null;
  return {
    description: char?.description ?? null,
    appearance: char?.appearance ?? null,
    image_url: text(char?.image_url),
    local_path: text(char?.local_path),
    extra_images: char?.extra_images != null && String(char.extra_images).trim() !== '' ? char.extra_images : null,
    image_prompt: imagePrompt,
  };
}

/** 空值判定：null / 空白串视为空（复活分支只对空字段补齐，不覆盖用户改过的值） */
function isBlank(value) {
  return value == null || String(value).trim() === '';
}

/** 确保人物有一个默认状态：已有 is_default=1 直接返回；否则从 characters 表复制 description/appearance 创建。
 *  spec §13：default 状态复用现有人物图片（image_url/local_path/extra_images）与提示词字段
 *  （polished_prompt 优先，回退 appearance+description）；复活已删行时仅填空字段，不覆盖用户改过的值。
 *  清默认 + 写入包在事务里:写入失败时不会丢掉人物既有默认。 */
function ensureDefaultVariant(db, characterId) {
  return db.transaction(() => {
    const cid = Number(characterId);
    const existing = db.prepare(
      'SELECT * FROM character_variants WHERE character_id = ? AND is_default = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1'
    ).get(cid);
    if (existing) return parseVariantRow(existing);
    // SELECT * 以兼容裁剪 schema(测试库 characters 未必有 image/extra/polished 列)
    const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(cid);
    const copy = defaultVariantCopyFromCharacter(char);
    const now = new Date().toISOString();
    // 复用同 source_key='default' 的已删行，避免触发 (character_id, source_key) 唯一索引冲突
    const reused = db.prepare(
      "SELECT * FROM character_variants WHERE character_id = ? AND source_key = 'default' ORDER BY id LIMIT 1"
    ).get(cid);
    let variantId;
    if (reused) {
      db.prepare('UPDATE character_variants SET is_default = 0 WHERE character_id = ? AND id != ?').run(cid, reused.id);
      const fillIfBlank = (current, incoming) => (isBlank(current) ? incoming : current);
      db.prepare(
        `UPDATE character_variants SET
           name = '默认', description = ?, appearance = ?,
           image_url = ?, local_path = ?, extra_images = ?, image_prompt = ?,
           is_default = 1, deleted_at = NULL, updated_at = ? WHERE id = ?`
      ).run(
        char?.description ?? null,
        char?.appearance ?? null,
        fillIfBlank(reused.image_url, copy.image_url),
        fillIfBlank(reused.local_path, copy.local_path),
        fillIfBlank(reused.extra_images, copy.extra_images),
        fillIfBlank(reused.image_prompt, copy.image_prompt),
        now,
        reused.id
      );
      variantId = reused.id;
    } else {
      db.prepare('UPDATE character_variants SET is_default = 0 WHERE character_id = ?').run(cid);
      const info = db.prepare(
        `INSERT INTO character_variants (character_id, source_key, name, description, appearance, image_prompt, image_url, local_path, extra_images, is_default, created_at, updated_at)
         VALUES (?, 'default', '默认', ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        cid,
        copy.description,
        copy.appearance,
        copy.image_prompt,
        copy.image_url,
        copy.local_path,
        copy.extra_images,
        now,
        now
      );
      variantId = Number(info.lastInsertRowid);
    }
    return getVariantById(db, variantId);
  })();
}

function appendPrompt(base, extra) {
  const add = (extra || '').toString().trim();
  if (!add) return (base || '').toString().trim();
  const current = (base || '').toString().trim();
  if (!current) return add;
  const lowerCurrent = current.toLowerCase();
  const lowerAdd = add.toLowerCase();
  if (lowerCurrent.includes(lowerAdd)) return current;
  return current + ', ' + add;
}

/**
 * 变体生图：与 propImageGenerationService.generatePropImage 同通道
 * （imageClient.callImageApi 生成 + uploadService.downloadImageToLocal 落盘）。
 * prompt 主路径为 variant.image_prompt；为空时回退角色 appearance/description，
 * 仍为空抛 e.code='VARIANT_PROMPT_MISSING'。
 * options: { model, style }（与道具生图参数面一致）；deps 供测试注入 imageClient/uploadService 替身。
 * 成功后写回 variant 行 image_url/local_path/extra_images（旧图追加），返回更新后的行。
 */
async function generateVariantImage(db, cfg, log, variantId, options = {}, deps = {}) {
  const imageClient = deps.imageClient || require('./imageClient');
  const uploadService = deps.uploadService || require('./uploadService');
  const variant = getVariantById(db, variantId);
  if (!variant) {
    const e = new Error('人物状态不存在');
    e.code = 'VARIANT_NOT_FOUND';
    throw e;
  }
  // SELECT * 以兼容裁剪 schema(测试库 characters 未必有 negative_prompt 列)
  const char = db.prepare(
    'SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(variant.character_id);
  if (!char) {
    const e = new Error('角色不存在');
    e.code = 'CHARACTER_NOT_FOUND';
    throw e;
  }

  let prompt = String(variant.image_prompt || '').trim();
  if (!prompt) prompt = String(char.appearance || '').trim();
  if (!prompt) prompt = String(char.description || '').trim();
  if (!prompt) {
    const e = new Error('该人物状态缺少图片提示词，请先填写 image_prompt');
    e.code = 'VARIANT_PROMPT_MISSING';
    throw e;
  }

  // 画风与尺寸：与道具生图一致（剧集画风合并 → style 追加；aspect_ratio 推导尺寸，兜底 1920x1920）
  let effectiveCfg = cfg || {};
  let drama = null;
  if (char.drama_id) {
    try {
      drama = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(char.drama_id) || null;
    } catch (_) { drama = null; }
    if (drama) effectiveCfg = mergeCfgStyleWithDrama(effectiveCfg, drama);
  }
  const styleOverride = options.style ? String(options.style).trim() : '';
  const baseStyle = styleOverride || (effectiveCfg?.style?.default_style_en || effectiveCfg?.style?.default_style || '');
  let style = appendPrompt('', baseStyle);
  if (!styleOverride) {
    style = appendPrompt(style, effectiveCfg?.style?.default_role_style || '');
  }
  let imageSize = null;
  try {
    if (drama && drama.metadata) {
      const meta = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
      if (meta && meta.aspect_ratio) imageSize = aspectRatioToSize(meta.aspect_ratio);
    }
  } catch (_) {}
  if (!imageSize) imageSize = effectiveCfg?.style?.default_image_size || '1920x1920';

  const assetMode = normalizeAssetMode('character_variant', options.assetMode ?? variant.asset_mode);
  const fullPrompt = appendPrompt(buildModePrompt('character_variant', assetMode, prompt), style);
  const model = options.model ? String(options.model).trim() || null : null;
  const preferredProvider = !model && effectiveCfg?.ai?.default_image_provider ? effectiveCfg.ai.default_image_provider : null;
  const userNeg = imageClient.resolveAssetUserNegativeForApi(model, variant.negative_prompt || char.negative_prompt);
  const useIdentityReference = options.useIdentityReference == null
    ? variant.use_identity_reference !== 0
    : options.useIdentityReference === true;
  const identityReference = useIdentityReference
    ? String(char.local_path || char.image_url || '').trim()
    : '';
  const rawStorage = cfg?.storage?.local_path;
  const storagePath = rawStorage
    ? (path.isAbsolute(rawStorage) ? rawStorage : path.join(process.cwd(), rawStorage))
    : path.join(process.cwd(), './data/storage');

  let result;
  try {
    result = await imageClient.callImageApi(db, log, {
      prompt: fullPrompt,
      size: imageSize,
      drama_id: char.drama_id,
      model: model || undefined,
      preferred_provider: preferredProvider || undefined,
      user_negative_prompt: userNeg || undefined,
      reference_image_urls: identityReference ? [identityReference] : undefined,
      files_base_url: cfg?.storage?.base_url || undefined,
      storage_local_path: storagePath,
      system_prompt: identityReference
        ? 'Image 1: base character identity reference. Preserve face, age and body shape only; follow the state prompt for clothing, hair condition and pose.'
        : undefined,
    });
  } catch (err) {
    log.error('Variant image API failed', { variant_id: variantId, error: err.message });
    const e = new Error('图片生成请求失败: ' + (err.message || '未知错误'));
    e.code = 'VARIANT_IMAGE_FAILED';
    throw e;
  }
  if (result && result.error) {
    const e = new Error(String(result.error));
    e.code = 'VARIANT_IMAGE_FAILED';
    throw e;
  }
  if (!result || !result.image_url) {
    const e = new Error('图片生成未返回地址');
    e.code = 'VARIANT_IMAGE_FAILED';
    throw e;
  }

  let localPath = null;
  try {
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, char.drama_id);
    localPath = await uploadService.downloadImageToLocal(
      storagePath,
      result.image_url,
      'characters',
      log,
      'char_variant_' + variantId,
      projectSubdir
    );
  } catch (_) {}

  // 旧图追加到 extra_images（与道具生图/上传逻辑一致）
  const oldPath = variant.local_path || variant.image_url || '';
  let extras = Array.isArray(variant.extra_images) ? variant.extra_images.slice() : [];
  if (oldPath && !extras.includes(oldPath)) extras.push(oldPath);
  const updated = updateVariant(db, variantId, {
    image_url: result.image_url,
    local_path: localPath,
    extra_images: extras.length ? extras : null,
  });
  log.info('Variant image generation completed', { variant_id: variantId, image_url: result.image_url, local_path: localPath });
  return updated;
}

module.exports = {
  listVariants,
  createVariant,
  updateVariant,
  deleteVariant,
  ensureDefaultVariant,
  variantUsageCount,
  generateVariantImage,
};
