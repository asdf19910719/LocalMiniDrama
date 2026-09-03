/**
 * 单集制作包(local-mini-drama.episode-package v1.0)预览与原子导入
 *
 * 职责(设计文档 §8、§9,任务 brief Task 6):
 * - sha256Text(text):原始文本的 SHA-256 hex,用于导入哈希一致性校验。
 * - episodeBlankStatus(db, episodeId):空白剧集判定(spec 8.3):
 *   script_content 与 description 均空、无未删分镜、分镜无 image_url/local_path/video_url、
 *   episode_imports 无记录 → blank;集不存在 → not_found。
 * - previewPackageImport(db, {...}):三步预览(§8.2),只读,不写任何表;
 *   返回渲染后的 normalized_package、source_sha256、target_status、asset_matches、
 *   errors、warnings、stats。
 * - importEpisodePackage(db, {...}):正式导入(§8.4),全部写操作在一个 db.transaction 内,
 *   任意一步失败抛错回滚。错误码:
 *   PACKAGE_INVALID / PACKAGE_HASH_MISMATCH / TARGET_NOT_BLANK /
 *   PACKAGE_DECISION_INVALID / CONFLICT_UNRESOLVED。
 *
 * 资产匹配规则(§8.2 第二步):dramaId 范围内 source_key 精确相等 → reuse;
 * 无 source_key 匹配但同名 → conflict(必须由用户显式决策);否则 create。
 * 复用现有资产时不覆盖其任何内容。
 */

'use strict';

const crypto = require('crypto');

const {
  PACKAGE_SCHEMA_NAME,
  PACKAGE_SCHEMA_VERSION,
  validatePackageStructure,
} = require('./episodePackageSchema');
const {
  validateBusinessRules,
  renderAction,
  renderDialogue,
  generateScriptFromStoryboards,
} = require('./episodePackageValidator');
const { createVariant } = require('./characterVariantsService');
const { syncStoryboardVariantLinks } = require('./storyboardVariantService');

const NOW = () => new Date().toISOString();

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function throwCode(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

/** 计数统计模板 */
function zeroStats() {
  return {
    characters_created: 0,
    characters_reused: 0,
    variants_created: 0,
    variants_reused: 0,
    scenes_created: 0,
    scenes_reused: 0,
    props_created: 0,
    props_reused: 0,
    storyboards_created: 0,
  };
}

/**
 * 空白剧集判定(spec 8.3)。集号、标题占位和创建时间不影响判定。
 * @returns {{ status: 'blank'|'non_blank'|'not_found', reasons: string[] }}
 */
function episodeBlankStatus(db, episodeId) {
  const episode = db
    .prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL')
    .get(Number(episodeId));
  if (!episode) return { status: 'not_found', reasons: [] };

  const reasons = [];
  if (hasText(episode.script_content)) reasons.push('script_content_not_empty');
  if (hasText(episode.description)) reasons.push('description_not_empty');

  const storyboardCount = db
    .prepare('SELECT COUNT(*) AS c FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
    .get(episode.id).c;
  if (storyboardCount > 0) reasons.push('has_storyboards');

  const mediaCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM storyboards
       WHERE episode_id = ? AND deleted_at IS NULL
         AND ((image_url IS NOT NULL AND image_url != '')
           OR (local_path IS NOT NULL AND local_path != '')
           OR (video_url IS NOT NULL AND video_url != ''))`
    )
    .get(episode.id).c;
  if (mediaCount > 0) reasons.push('storyboard_has_media');

  const importCount = db
    .prepare('SELECT COUNT(*) AS c FROM episode_imports WHERE episode_id = ?')
    .get(episode.id).c;
  if (importCount > 0) reasons.push('has_import_record');

  return { status: reasons.length === 0 ? 'blank' : 'non_blank', reasons };
}

/** 解析原始文本;失败时返回 null 并收集 PACKAGE_INVALID 错误(preview)或抛错(import) */
function parseRawText(rawText, { throwOnError }) {
  let pkg = null;
  const errors = [];
  try {
    pkg = JSON.parse(String(rawText));
  } catch (err) {
    const message = `制作包不是合法 JSON:${err.message}`;
    if (throwOnError) throwCode('PACKAGE_INVALID', message);
    errors.push({ code: 'PACKAGE_INVALID', path: '', message });
  }
  return { pkg, errors };
}

/** 结构 + 业务双重校验;返回统一为 { code, path, message } 的错误/警告列表 */
function validatePackage(pkg) {
  const structure = validatePackageStructure(pkg);
  const errors = structure.errors.map((e) => ({ code: 'PACKAGE_INVALID', path: e.path, message: e.message }));
  if (structure.ok) {
    const business = validateBusinessRules(pkg);
    errors.push(...business.errors);
    return { errors, warnings: business.warnings };
  }
  return { errors, warnings: [] };
}

/**
 * 归一化包:深拷贝后把每个分镜的 action/dialogue 替换为确定性渲染文本(落库形态),
 * 其余字段不动。同时被 preview 与 episode_imports.normalized_json 使用(§14.1 同一输入
 * 逐字节相同)。
 */
function buildNormalizedPackage(pkg) {
  const normalized = JSON.parse(JSON.stringify(pkg));
  if (normalized && Array.isArray(normalized.storyboards)) {
    for (const storyboard of normalized.storyboards) {
      if (!storyboard || typeof storyboard !== 'object' || Array.isArray(storyboard)) continue;
      storyboard.action = renderAction(storyboard.action);
      storyboard.dialogue = renderDialogue(storyboard.dialogue);
    }
  }
  return normalized;
}

// —— 资产匹配(dramaId 范围内) ——

// nameColumn:各表的"名称"列。协议字段 name 在 scenes 落到 location(§6.3 映射)。
const ASSET_GROUPS = [
  { type: 'character', key: 'characters', table: 'characters', nameColumn: 'name' },
  { type: 'scene', key: 'scenes', table: 'scenes', nameColumn: 'location' },
  { type: 'prop', key: 'props', table: 'props', nameColumn: 'name' },
];

function findAssetByKey(db, group, dramaId, sourceKey) {
  return (
    db
      .prepare(`SELECT id, ${group.nameColumn} AS name FROM ${group.table} WHERE drama_id = ? AND source_key = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`)
      .get(dramaId, sourceKey) || null
  );
}

function findAssetByName(db, group, dramaId, name) {
  return db
    .prepare(`SELECT id, ${group.nameColumn} AS name FROM ${group.table} WHERE drama_id = ? AND ${group.nameColumn} = ? AND deleted_at IS NULL ORDER BY id`)
    .all(dramaId, name);
}

/**
 * 预览用资产匹配:每项 { type, source_key, name, decision, existing_id, candidates }。
 * decision:'reuse'(source_key 精确相等)| 'conflict'(键不匹配但同名)| 'create'。
 */
function computeAssetMatches(db, pkg, dramaId) {
  const matches = [];
  if (!pkg || typeof pkg !== 'object') return matches;
  for (const group of ASSET_GROUPS) {
    const list = Array.isArray(pkg[group.key]) ? pkg[group.key] : [];
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const sourceKey = hasText(item.source_key) ? item.source_key : null;
      const name = hasText(item.name) ? item.name : null;
      const byKey = sourceKey ? findAssetByKey(db, group, dramaId, sourceKey) : null;
      const byName = name ? findAssetByName(db, group, dramaId, name) : [];
      if (byKey) {
        matches.push({
          type: group.type,
          source_key: sourceKey,
          name,
          decision: 'reuse',
          existing_id: byKey.id,
          candidates: [{ id: byKey.id, name: byKey.name }],
        });
      } else if (byName.length > 0) {
        matches.push({
          type: group.type,
          source_key: sourceKey,
          name,
          decision: 'conflict',
          existing_id: null,
          candidates: byName.map((r) => ({ id: r.id, name: r.name })),
        });
      } else {
        matches.push({
          type: group.type,
          source_key: sourceKey,
          name,
          decision: 'create',
          existing_id: null,
          candidates: [],
        });
      }
    }
  }
  return matches;
}

/**
 * 导入前决策解析(全部校验通过后才动库,保证 CONFLICT_UNRESOLVED /
 * PACKAGE_DECISION_INVALID 在任何写入前抛出)。
 * decisions 形如 { characters: { [source_key]: 'create'|'reuse' }, scenes: {...}, props: {...} }。
 * 返回 { characters: [{ item, decision, existingId }], scenes: [...], props: [...] }。
 */
function planAssetDecisions(db, pkg, dramaId, decisions) {
  const plan = {};
  for (const group of ASSET_GROUPS) {
    const list = Array.isArray(pkg[group.key]) ? pkg[group.key] : [];
    const decisionMap = (decisions && decisions[group.key]) || {};
    plan[group.key] = list.map((item) => {
      const sourceKey = hasText(item.source_key) ? item.source_key : null;
      const name = hasText(item.name) ? item.name : null;
      const byKey = sourceKey ? findAssetByKey(db, group, dramaId, sourceKey) : null;
      const byName = name ? findAssetByName(db, group, dramaId, name) : [];

      let choice = decisionMap[sourceKey];
      if (choice !== undefined && choice !== 'create' && choice !== 'reuse') {
        throwCode('PACKAGE_DECISION_INVALID', `资产 ${group.key}.${sourceKey} 的决策非法:${JSON.stringify(choice)},只允许 create 或 reuse`);
      }
      if (choice === undefined) {
        // 未显式决策:键匹配 → 复用;键不匹配但同名 → 冲突必须显式决策;否则创建
        if (byKey) {
          choice = 'reuse';
        } else if (byName.length > 0) {
          throwCode('CONFLICT_UNRESOLVED', `资产 ${group.key} "${name}"(source_key: ${sourceKey})与现有同名资产冲突,必须显式决策 create 或 reuse`);
        } else {
          choice = 'create';
        }
      }
      if (choice === 'reuse') {
        // 复用要求目标存在:优先 source_key,其次同名(conflict + reuse 语义)
        const target = byKey || byName[0];
        if (!target) {
          throwCode('PACKAGE_DECISION_INVALID', `资产 ${group.key}.${sourceKey} 决策为 reuse,但库内不存在匹配的 source_key 或同名资产`);
        }
        return { item, decision: 'reuse', existingId: target.id };
      }
      return { item, decision: 'create', existingId: null };
    });
  }
  return plan;
}

/** 预览统计:按 asset_matches 与库内已有状态推断 create/reuse 数量(只读) */
function computePreviewStats(db, pkg, matches) {
  const stats = zeroStats();
  if (!pkg || typeof pkg !== 'object') return stats;
  for (const group of ASSET_GROUPS) {
    const groupMatches = matches.filter((m) => m.type === group.type);
    stats[`${group.key}_created`] = groupMatches.filter((m) => m.decision === 'create' || m.decision === 'conflict').length;
    stats[`${group.key}_reused`] = groupMatches.filter((m) => m.decision === 'reuse').length;
  }
  const characters = Array.isArray(pkg.characters) ? pkg.characters : [];
  for (const character of characters) {
    if (!character || typeof character !== 'object') continue;
    const match = matches.find((m) => m.type === 'character' && m.source_key === character.source_key);
    const variants = Array.isArray(character.variants) ? character.variants : [];
    for (const variant of variants) {
      let reused = false;
      if (match && match.decision === 'reuse' && match.existing_id && hasText(variant.source_key)) {
        const row = db
          .prepare('SELECT id FROM character_variants WHERE character_id = ? AND source_key = ?')
          .get(match.existing_id, variant.source_key);
        reused = !!row;
      }
      if (reused) stats.variants_reused += 1;
      else stats.variants_created += 1;
    }
  }
  stats.storyboards_created = Array.isArray(pkg.storyboards) ? pkg.storyboards.length : 0;
  return stats;
}

/**
 * 三步预览(§8.2/§9.1)。只读:除 SELECT 外不做任何数据库写操作。
 * @param {object} db better-sqlite3 实例
 * @param {object} options { rawText, filename, dramaId, targetEpisodeId }
 */
function previewPackageImport(db, { rawText, filename, dramaId, targetEpisodeId } = {}) {
  const { pkg, errors: parseErrors } = parseRawText(rawText, { throwOnError: false });
  let validation = { errors: [], warnings: [] };
  if (pkg !== null) {
    validation = validatePackage(pkg);
  }

  // target_status:给定目标集 → blank 判定;仅 dramaId → 新建集
  const targetStatus = targetEpisodeId !== undefined && targetEpisodeId !== null
    ? episodeBlankStatus(db, targetEpisodeId)
    : { status: 'new_episode' };

  // 有效 dramaId:填充模式下以目标集所属剧为准
  let effectiveDramaId = dramaId;
  if ((effectiveDramaId === undefined || effectiveDramaId === null) && targetEpisodeId != null) {
    const row = db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(Number(targetEpisodeId));
    effectiveDramaId = row ? row.drama_id : null;
  }

  const matches = pkg ? computeAssetMatches(db, pkg, effectiveDramaId) : [];
  const normalized = pkg ? buildNormalizedPackage(pkg) : null;

  return {
    normalized_package: normalized,
    source_sha256: sha256Text(rawText),
    target_status: targetStatus,
    asset_matches: matches,
    errors: [...parseErrors, ...validation.errors],
    warnings: validation.warnings,
    stats: computePreviewStats(db, pkg, matches),
  };
}

// —— 正式导入(§8.4) ——

function insertCharacterRow(db, dramaId, item) {
  const info = db
    .prepare(
      `INSERT INTO characters (drama_id, name, description, source_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(dramaId, item.name ?? null, item.description ?? null, item.source_key ?? null, NOW(), NOW());
  return Number(info.lastInsertRowid);
}

/** 人物状态 create-if-absent:(character_id, source_key) 已存在则复用不覆盖,否则 create */
function ensureVariant(db, characterId, item) {
  const existing = db
    .prepare('SELECT id FROM character_variants WHERE character_id = ? AND source_key = ?')
    .get(characterId, item.source_key ?? null);
  if (existing) return Number(existing.id);
  const created = createVariant(db, {
    character_id: characterId,
    source_key: item.source_key,
    name: item.name,
    description: item.description,
    appearance: item.appearance,
    image_prompt: item.image_prompt,
    negative_prompt: item.negative_prompt,
    is_default: item.is_default,
  });
  return Number(created.id);
}

function insertSceneRow(db, dramaId, episodeId, item) {
  const description = hasText(item.description) ? item.description : '';
  // spec §6.3:description 非空时拼接为 "{description}。{image_prompt}",为空只写 image_prompt
  const prompt = description ? `${description}。${item.image_prompt}` : item.image_prompt;
  const info = db
    .prepare(
      `INSERT INTO scenes (drama_id, episode_id, location, state, prompt, source_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(dramaId, episodeId, item.name ?? null, item.state ?? null, prompt, item.source_key ?? null, NOW(), NOW());
  return Number(info.lastInsertRowid);
}

function insertPropRow(db, dramaId, episodeId, item) {
  const info = db
    .prepare(
      `INSERT INTO props (drama_id, episode_id, name, description, prompt, source_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(dramaId, episodeId, item.name ?? null, item.description ?? null, item.image_prompt ?? null, item.source_key ?? null, NOW(), NOW());
  return Number(info.lastInsertRowid);
}

/**
 * 正式导入。全部写操作在一个 db.transaction 内,失败抛错回滚。
 * @param {object} db better-sqlite3 实例
 * @param {object} options { rawText, sourceSha256, dramaId, targetEpisodeId, filename, decisions }
 * @returns {{ episode_id: number, stats: object, warnings: Array }}
 */
function importEpisodePackage(db, { rawText, sourceSha256, dramaId, targetEpisodeId, filename, decisions } = {}) {
  const run = db.transaction(() => {
    // 1. 重解析 + 结构 + 业务校验(§8.4 步骤 1)
    let pkg;
    try {
      pkg = JSON.parse(String(rawText));
    } catch (err) {
      throwCode('PACKAGE_INVALID', `制作包不是合法 JSON:${err.message}`);
    }
    const { errors } = validatePackage(pkg);
    if (errors.length > 0) {
      const first = errors.slice(0, 5).map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
      throwCode('PACKAGE_INVALID', `制作包校验失败(${errors.length} 个错误):${first}`);
    }

    // 哈希一致性
    if (sha256Text(rawText) !== sourceSha256) {
      throwCode('PACKAGE_HASH_MISMATCH', '制作包内容与预览时不一致(sha256 不匹配),请重新预览');
    }

    // 2. 目标集空白重查(spec 8.3:预览后目标被写入则拒绝)
    let episodeRow = null;
    let effectiveDramaId = dramaId;
    if (targetEpisodeId !== undefined && targetEpisodeId !== null) {
      const blank = episodeBlankStatus(db, targetEpisodeId);
      if (blank.status === 'not_found') {
        throwCode('TARGET_NOT_BLANK', `目标剧集 ${targetEpisodeId} 不存在或已删除`);
      }
      if (blank.status !== 'blank') {
        throwCode('TARGET_NOT_BLANK', `目标剧集 ${targetEpisodeId} 不是空白集(${blank.reasons.join(', ')}),拒绝导入`);
      }
      episodeRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(Number(targetEpisodeId));
      effectiveDramaId = episodeRow.drama_id;
    }
    if (effectiveDramaId === undefined || effectiveDramaId === null) {
      throwCode('PACKAGE_INVALID', '缺少 dramaId,无法确定导入目标剧');
    }

    // 决策解析(conflict 未决策 / 非法决策在任何写入前抛出)
    const plan = planAssetDecisions(db, pkg, effectiveDramaId, decisions || {});

    const stats = zeroStats();
    const warnings = validateBusinessRules(pkg).warnings;

    // 3. 剧集:填充空白集(集号不变)或新建集(episode_number = max+1)
    let episodeId;
    const episode = pkg.episode || {};
    const scriptContent = hasText(episode.script)
      ? episode.script
      : generateScriptFromStoryboards(pkg.storyboards);
    if (episodeRow) {
      db.prepare(
        'UPDATE episodes SET title = ?, description = ?, script_content = ?, updated_at = ? WHERE id = ?'
      ).run(episode.title ?? episodeRow.title, episode.summary ?? episodeRow.description, scriptContent, NOW(), episodeRow.id);
      episodeId = episodeRow.id;
    } else {
      const maxRow = db
        .prepare('SELECT MAX(episode_number) AS m FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
        .get(effectiveDramaId);
      const episodeNumber = (maxRow && typeof maxRow.m === 'number' ? maxRow.m : 0) + 1;
      episodeId = Number(
        db.prepare(
          `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`
        ).run(effectiveDramaId, episodeNumber, episode.title ?? '', scriptContent, episode.summary ?? null, NOW(), NOW()).lastInsertRowid
      );
    }

    // 4. 人物:按决策建或复用(复用不覆盖)
    const characterIdByKey = new Map();
    for (const entry of plan.characters) {
      const key = entry.item.source_key;
      if (entry.decision === 'reuse') {
        characterIdByKey.set(key, entry.existingId);
        stats.characters_reused += 1;
      } else {
        characterIdByKey.set(key, insertCharacterRow(db, effectiveDramaId, entry.item));
        stats.characters_created += 1;
      }
    }

    // 5. 人物状态:create-if-absent((character_id, source_key) 已存在则复用)
    const variantIdByRef = new Map(); // `${character_key}/${variant_key}` → id
    for (const character of Array.isArray(pkg.characters) ? pkg.characters : []) {
      const characterId = characterIdByKey.get(character.source_key);
      if (!characterId) continue;
      for (const variant of Array.isArray(character.variants) ? character.variants : []) {
        const refKey = `${character.source_key}/${variant.source_key}`;
        const before = db
          .prepare('SELECT id FROM character_variants WHERE character_id = ? AND source_key = ?')
          .get(characterId, variant.source_key ?? null);
        if (before) {
          variantIdByRef.set(refKey, Number(before.id));
          stats.variants_reused += 1;
        } else {
          variantIdByRef.set(refKey, ensureVariant(db, characterId, variant));
          stats.variants_created += 1;
        }
      }
    }

    // 6. 场景与道具:按决策建或复用(复用不覆盖)
    const sceneIdByKey = new Map();
    for (const entry of plan.scenes) {
      const key = entry.item.source_key;
      if (entry.decision === 'reuse') {
        sceneIdByKey.set(key, entry.existingId);
        stats.scenes_reused += 1;
      } else {
        sceneIdByKey.set(key, insertSceneRow(db, effectiveDramaId, episodeId, entry.item));
        stats.scenes_created += 1;
      }
    }
    const propIdByKey = new Map();
    for (const entry of plan.props) {
      const key = entry.item.source_key;
      if (entry.decision === 'reuse') {
        propIdByKey.set(key, entry.existingId);
        stats.props_reused += 1;
      } else {
        propIdByKey.set(key, insertPropRow(db, effectiveDramaId, episodeId, entry.item));
        stats.props_created += 1;
      }
    }

    // 7. 分镜(§5.6.1 映射)+ 8. 关联 + 9. 兼容字段同步
    const storyboards = Array.isArray(pkg.storyboards) ? pkg.storyboards : [];
    for (const storyboard of storyboards) {
      const sceneId = sceneIdByKey.get(storyboard.scene_ref);
      if (!sceneId) {
        throwCode('PACKAGE_INVALID', `分镜 ${storyboard.source_key} 的 scene_ref "${storyboard.scene_ref}" 无法解析为场景`);
      }
      const sbId = Number(
        db.prepare(
          `INSERT INTO storyboards (
             episode_id, scene_id, storyboard_number, title, description, duration,
             dialogue, action, image_prompt, narration, layout_description,
             universal_segment_text, shot_type, angle, movement,
             creation_mode, status, source_key, audio_description, transition,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'universal', 'draft', ?, ?, ?, ?, ?)`
        ).run(
          episodeId,
          sceneId,
          storyboard.storyboard_number ?? 0,
          storyboard.title ?? null,
          storyboard.description ?? null,
          storyboard.duration_seconds ?? null,
          renderDialogue(storyboard.dialogue),
          renderAction(storyboard.action),
          storyboard.image_prompt ?? null,
          storyboard.narration ?? null,
          storyboard.composition ?? null,
          storyboard.universal_segment_text ?? null,
          storyboard.shot_type ?? null,
          storyboard.camera_angle ?? null,
          storyboard.camera_movement ?? null,
          storyboard.source_key ?? null,
          storyboard.audio_description !== undefined && storyboard.audio_description !== null
            ? JSON.stringify(storyboard.audio_description)
            : null,
          storyboard.transition !== undefined && storyboard.transition !== null
            ? JSON.stringify(storyboard.transition)
            : null,
          NOW(),
          NOW()
        ).lastInsertRowid
      );
      stats.storyboards_created += 1;

      // storyboard_props(经 props.source_key 解析,按参考图顺序)
      const propRefs = Array.isArray(storyboard.prop_refs) ? storyboard.prop_refs : [];
      for (const propRef of propRefs) {
        const propId = propIdByKey.get(propRef);
        if (!propId) continue;
        db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)').run(sbId, propId);
      }

      // storyboard_character_variants + storyboards.characters 投影(全删全插同步)
      const refs = Array.isArray(storyboard.character_refs) ? storyboard.character_refs.filter((r) => r && typeof r === 'object') : [];
      const orderedRefs = refs
        .slice()
        .sort((a, b) => (typeof a.sort_order === 'number' ? a.sort_order : Infinity) - (typeof b.sort_order === 'number' ? b.sort_order : Infinity));
      const links = [];
      for (const ref of orderedRefs) {
        const characterId = characterIdByKey.get(ref.character_ref);
        const variantId = variantIdByRef.get(`${ref.character_ref}/${ref.variant_ref}`);
        if (!characterId || !variantId) continue;
        links.push({
          character_id: characterId,
          variant_id: variantId,
          reference_role: ref.reference_role ?? null,
          sort_order: ref.sort_order,
          framing_note: ref.framing_note ?? null,
        });
      }
      syncStoryboardVariantLinks(db, sbId, links);
    }

    // 10. episode_imports 审计快照(normalized_json 存渲染后的归一化包)
    db.prepare(
      `INSERT INTO episode_imports (
         episode_id, schema_name, schema_version, source_filename, source_sha256,
         raw_json, normalized_json, match_decisions, generator_metadata, imported_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      episodeId,
      PACKAGE_SCHEMA_NAME,
      PACKAGE_SCHEMA_VERSION,
      filename ?? null,
      sha256Text(rawText),
      String(rawText),
      JSON.stringify(buildNormalizedPackage(pkg)),
      JSON.stringify(decisions || {}),
      pkg.generator !== undefined ? JSON.stringify(pkg.generator) : null,
      NOW()
    );

    return { episode_id: episodeId, stats, warnings };
  });

  return run();
}

module.exports = {
  sha256Text,
  episodeBlankStatus,
  previewPackageImport,
  importEpisodePackage,
};
