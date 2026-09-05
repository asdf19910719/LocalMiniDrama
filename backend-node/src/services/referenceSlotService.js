// 统一参考图槽位解析器(spec §7):分镜参考槽位规则的唯一来源。
// 固定顺序:① 场景 → ② 人物状态(按关联 sort_order;存量分镜无任何关联时按旧版
// sb.characters JSON 序懒加载 default 状态合成,见 §13)→ ③ 道具(按关联插入顺序)。
// 缺图不跳过不重排(image_available=false 仍占编号);超过 maxSlots(默认 9)的槽位进 overflow。
// 本模块作用于数据库行(id 引用),与 episodePackageValidator.logicalSlots(制作包 JSON 域,
// source_key 引用)的顺序语义保持一致:场景 → 状态按 sort_order 升序(空值靠后)→ 道具按关联序。

const crypto = require('crypto');

const { listStoryboardVariantLinks } = require('./storyboardVariantService');

const DEFAULT_MAX_SLOTS = 9;

function textOf(value) {
  return value == null ? '' : String(value);
}

function hasColumn(db, table, column) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column); } catch (_) { return false; }
}

function parseVoiceAsset(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || String(parsed.status || '').toLowerCase() !== 'active') return null;
    const url = textOf(parsed.local_path || parsed.audio_url || parsed.url).trim();
    return url ? { url, version: parsed.updated_at || parsed.version || null } : null;
  } catch (_) {
    return null;
  }
}

/** 与图生链路一致:local_path 优先,其次 image_url;为空(含空白串)返回 null */
function resolveImageUrl(localPath, imageUrl) {
  const local = textOf(localPath);
  if (local.trim()) return local;
  const remote = textOf(imageUrl);
  return remote.trim() ? remote : null;
}

/** 旧版 sb.characters JSON → 有序去重的 character id 列表(兼容 [{id}] 与纯数字两种格式) */
function legacyCharacterIdsFromJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    const ids = [];
    const seen = new Set();
    for (const item of parsed) {
      const cid = typeof item === 'object' && item != null ? item.id : item;
      const idNum = Number(cid);
      if (!Number.isFinite(idNum) || seen.has(idNum)) continue;
      seen.add(idNum);
      ids.push(idNum);
    }
    return ids;
  } catch (_) {
    return [];
  }
}

/** 场景业务名:location 与 state 都有则 "location·state",否则取其一 */
function sceneDisplayName(sceneRow) {
  const location = textOf(sceneRow.location).trim();
  const state = textOf(sceneRow.state).trim();
  if (location && state) return `${location}·${state}`;
  return location || state || null;
}

/**
 * 解析分镜的参考图逻辑槽位。
 * spec §13:存量分镜只有旧版 sb.characters JSON 绑定、无任何状态关联时,按 JSON 序为每个人物
 * 懒加载 default 状态(ensureDefaultVariant,复用现有人物图片/提示词),并只读合成 character_variant
 * 槽(不写 storyboard_character_variants 关联);有正式关联的分镜行为不变。
 * @param {*} db better-sqlite3 实例
 * @param {number|string} storyboardId 分镜 id
 * @param {{ maxSlots?: number }} [options] 上限(默认 9),超出部分进 overflow
 * @returns {{ slots: Array, total: number, overflow: Array }}
 * slot: { index(1-based), type: 'scene'|'character_variant'|'prop',
 *         asset_id(scenes/characters/props.id), variant_id(仅 character_variant),
 *         name, reference_role/framing_note(仅 character_variant),
 *         local_path, remote_image_url, image_url(local_path 优先),
 *         image_available, image_version(资产行 updated_at) }
 */
function resolveStoryboardSlots(db, storyboardId, { maxSlots = DEFAULT_MAX_SLOTS } = {}) {
  const sid = Number(storyboardId);
  const sb = Number.isFinite(sid)
    ? db.prepare('SELECT id, scene_id, characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sid)
    : null;
  if (!sb) {
    const e = new Error('分镜不存在');
    e.code = 'STORYBOARD_NOT_FOUND';
    throw e;
  }

  const slots = [];

  // ① 场景:无 scene_id 跳过;场景不存在或软删跳过
  if (sb.scene_id != null) {
    const scene = db.prepare(
      'SELECT id, location, state, image_url, local_path, updated_at FROM scenes WHERE id = ? AND deleted_at IS NULL'
    ).get(sb.scene_id);
    if (scene) {
      const imageUrl = resolveImageUrl(scene.local_path, scene.image_url);
      slots.push({
        index: slots.length + 1,
        type: 'scene',
        asset_id: scene.id,
        variant_id: null,
        name: sceneDisplayName(scene),
        reference_role: null,
        framing_note: null,
        local_path: scene.local_path ?? null,
        remote_image_url: scene.image_url ?? null,
        image_url: imageUrl,
        image_available: Boolean(imageUrl),
        image_version: scene.updated_at ?? null,
      });
    }
  }

  // ② 人物状态:复用 listStoryboardVariantLinks(按 sort_order 升序,空值靠后,同序按 id),
  //    每条关联一行一个槽位。关联查询不携带 variant 的 deleted_at/updated_at,补查判断软删:
  //    软删状态仍占位,但图不可用(image_available=false)。
  const links = listStoryboardVariantLinks(db, sid);
  let slotLinks = links;
  if (links.length === 0) {
    // spec §13 存量兜底:无任何状态关联时,按旧版 sb.characters JSON 序懒加载 default 状态。
    // 只读合成(不写 storyboard_character_variants);不存在或软删的人物跳过。
    const legacyIds = legacyCharacterIdsFromJson(sb.characters);
    if (legacyIds.length > 0) {
      const { ensureDefaultVariant } = require('./characterVariantsService'); // 函数内 require,避免模块加载环
      const selectCharName = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL');
      const synthesized = [];
      for (const cid of legacyIds) {
        const charRow = selectCharName.get(cid);
        if (!charRow) continue;
        let variant = null;
        try {
          variant = ensureDefaultVariant(db, cid);
        } catch (_) {
          variant = null;
        }
        if (!variant) continue;
        const charName = textOf(charRow.name).trim();
        const variantName = textOf(variant.name).trim() || '默认';
        synthesized.push({
          character_id: cid,
          variant_id: variant.id,
          variant_name: charName ? `${charName}·${variantName}` : variantName,
          reference_role: null,
          framing_note: null,
          image_url: variant.image_url ?? null,
          local_path: variant.local_path ?? null,
        });
      }
      slotLinks = synthesized;
    }
  }
  const selectVariantMeta = db.prepare('SELECT deleted_at, updated_at, source_key, name FROM character_variants WHERE id = ?');
  const selectCharacterVoice = hasColumn(db, 'characters', 'seedance2_voice_asset')
    ? db.prepare('SELECT name, seedance2_voice_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
    : null;
  for (const link of slotLinks) {
    const variantMeta = link.variant_id != null ? selectVariantMeta.get(link.variant_id) : null;
    const variantDeleted = Boolean(variantMeta && variantMeta.deleted_at);
    const imageUrl = resolveImageUrl(link.local_path, link.image_url);
    const characterVoice = selectCharacterVoice ? selectCharacterVoice.get(link.character_id) : null;
    const voiceAsset = parseVoiceAsset(characterVoice?.seedance2_voice_asset);
    slots.push({
      index: slots.length + 1,
      type: 'character_variant',
      asset_id: link.character_id,
      variant_id: link.variant_id,
      name: link.variant_name ?? null,
      reference_role: link.reference_role ?? null,
      framing_note: link.framing_note ?? null,
      local_path: link.local_path ?? null,
      remote_image_url: link.image_url ?? null,
      image_url: imageUrl,
      image_available: !variantDeleted && Boolean(imageUrl),
      image_version: variantMeta?.updated_at ?? null,
      audio_url: voiceAsset?.url ?? null,
      audio_version: voiceAsset?.version ?? null,
      variant: link.variant_id == null ? null : {
        id: link.variant_id,
        source_key: variantMeta?.source_key ?? null,
        name: variantMeta?.name ?? link.variant_name ?? null,
        updated_at: variantMeta?.updated_at ?? null,
      },
    });
  }

  // ③ 道具:按 storyboard_props.rowid(关联插入顺序);软删道具跳过
  const propRows = db.prepare(
    `SELECT p.id, p.name, p.image_url, p.local_path, p.updated_at
     FROM storyboard_props sp
     JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
     WHERE sp.storyboard_id = ?
     ORDER BY sp.rowid`
  ).all(sid);
  for (const propRow of propRows) {
    const imageUrl = resolveImageUrl(propRow.local_path, propRow.image_url);
    slots.push({
      index: slots.length + 1,
      type: 'prop',
      asset_id: propRow.id,
      variant_id: null,
      name: propRow.name ?? null,
      reference_role: null,
      framing_note: null,
      local_path: propRow.local_path ?? null,
      remote_image_url: propRow.image_url ?? null,
      image_url: imageUrl,
      image_available: Boolean(imageUrl),
      image_version: propRow.updated_at ?? null,
    });
  }

  let audioIndex = 0;
  for (const slot of slots) {
    slot.entity_type = slot.type;
    slot.entity_id = slot.asset_id;
    slot.entity_name = slot.type === 'character_variant' && slot.name && slotLinks.length
      ? (() => {
          const match = slotLinks.find((item) => Number(item.variant_id) === Number(slot.variant_id));
          const characterName = textOf(match?.character_name).trim();
          const variantName = textOf(slot.name).trim();
          return characterName && variantName && !variantName.startsWith(`${characterName}·`)
            ? `${characterName}·${variantName}`
            : (variantName || characterName || null);
        })()
      : slot.name;
    if (slot.audio_url) {
      audioIndex += 1;
      slot.audio_index = audioIndex;
      slot.audio_label = `Audio ${audioIndex}`;
    } else {
      slot.audio_index = null;
      slot.audio_label = null;
      slot.audio_url = null;
      slot.audio_version = null;
    }
    if (slot.variant === undefined) slot.variant = null;
  }

  const total = slots.length;
  const overflow = total > maxSlots ? slots.filter((s) => s.index > maxSlots) : [];
  return { slots, total, overflow };
}

/** 键排序后的 canonical JSON(数组保序,对象键递归排序) */
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalJson(value[key]);
    return out;
  }
  return value;
}

/**
 * 槽位指纹覆盖引用的媒体和语义元数据；任何绑定含义变化都必须使草稿失效。
 */
function slotsFingerprint(slots) {
  const list = Array.isArray(slots) ? slots : [];
  const picked = list.map((s) => ({
    index: s.index,
    type: s.type,
    asset_id: s.asset_id === undefined ? null : s.asset_id,
    variant_id: s.variant_id === undefined ? null : s.variant_id,
    image_url: s.image_url == null ? null : String(s.image_url).trim().split('?')[0],
    image_version: s.image_version === undefined ? null : s.image_version,
    entity_type: s.entity_type ?? s.type ?? null,
    entity_id: s.entity_id ?? s.asset_id ?? null,
    entity_name: s.entity_name ?? s.name ?? null,
    reference_role: s.reference_role ?? null,
    framing_note: s.framing_note ?? null,
    variant: s.variant ?? null,
    audio_index: s.audio_index ?? null,
    audio_url: s.audio_url == null ? null : String(s.audio_url).trim().split('?')[0],
    audio_version: s.audio_version ?? null,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canonicalJson(picked))).digest('hex');
}

module.exports = {
  resolveStoryboardSlots,
  slotsFingerprint,
};
