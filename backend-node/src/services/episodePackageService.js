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
  validatePackageStructure,
} = require('./episodePackageSchema');
const { normalizePackageForProjection } = require('./episodePackageProjection');
const { sanitizeSourceFilename } = require('./episodeImportProvenanceService');
const { getTaskBundle } = require('./externalAiTaskBundleService');
const { adaptExternalAiResult } = require('./externalAiResultAdapter');
const {
  validateBusinessRules,
  renderAction,
  renderDialogue,
  generateScriptFromStoryboards,
} = require('./episodePackageValidator');
const { createVariant } = require('./characterVariantsService');
const { syncStoryboardVariantLinks } = require('./storyboardVariantService');
const {
  normalizeEpisodeAudioPlan,
  normalizeStoryboardAudioDescription,
  normalizeStoryboardTransition,
  serializeCanonicalJson,
} = require('./storyboardAvContractService');
const {
  saveCanonicalStoryboard,
  projectStoryboardRow,
} = require('./storyboardCanonicalRepository');

const NOW = () => new Date().toISOString();
const EXTERNAL_AI_RESULT_SCHEMA = 'local-mini-drama.external-ai-result';

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

function prepareInputPackage(db, { rawText, dramaId, targetEpisodeId, throwOnError = false } = {}) {
  const parsed = parseRawText(rawText, { throwOnError });
  if (parsed.pkg === null || parsed.pkg?.schema !== EXTERNAL_AI_RESULT_SCHEMA) {
    return {
      pkg: parsed.pkg,
      parseErrors: parsed.errors,
      adapterWarnings: [],
      targetEpisodeId,
      task: null,
      sourceSchema: parsed.pkg?.schema || PACKAGE_SCHEMA_NAME,
      sourceVersion: parsed.pkg?.version || null,
    };
  }

  const task = getTaskBundle(db, parsed.pkg.package_id);
  if (!task || Number(task.drama_id) !== Number(dramaId)) {
    throwCode('PACKAGE_TASK_NOT_FOUND', '找不到属于当前项目的外部 AI 任务，请重新生成任务包');
  }
  const explicitTarget = targetEpisodeId === undefined || targetEpisodeId === null || String(targetEpisodeId).trim() === ''
    ? null
    : Number(targetEpisodeId);
  if (task.target_episode_id && explicitTarget && Number(task.target_episode_id) !== explicitTarget) {
    throwCode('PACKAGE_TARGET_MISMATCH', '所选目标集与结果绑定的任务目标不一致');
  }
  const adapted = adaptExternalAiResult(db, parsed.pkg, task);
  return {
    pkg: adapted.package,
    parseErrors: [],
    adapterWarnings: adapted.warnings,
    targetEpisodeId: task.target_episode_id || targetEpisodeId,
    task,
    sourceSchema: EXTERNAL_AI_RESULT_SCHEMA,
    sourceVersion: parsed.pkg.version,
  };
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
function buildNormalizedProjection(pkg) {
  const { normalizedPackage: normalized, report } = normalizePackageForProjection(pkg);
  if (normalized && Array.isArray(normalized.storyboards)) {
    for (const storyboard of normalized.storyboards) {
      if (!storyboard || typeof storyboard !== 'object' || Array.isArray(storyboard)) continue;
      storyboard.action = renderAction(storyboard.action);
      storyboard.dialogue = renderDialogue(storyboard.dialogue);
    }
  }
  return { normalizedPackage: normalized, report };
}

function buildNormalizedPackage(pkg) {
  return buildNormalizedProjection(pkg).normalizedPackage;
}

function hasExplicitShotMusic(audioDescription) {
  if (!audioDescription || typeof audioDescription !== 'object' || Array.isArray(audioDescription)) return false;
  if (audioDescription.non_diegetic_music != null && String(audioDescription.non_diegetic_music).trim()) return true;
  const mode = audioDescription.music_cue && audioDescription.music_cue.mode;
  return ['inherit', 'override', 'stinger'].includes(mode);
}

function derivePackageAudioPolicy(pkg) {
  const shots = Array.isArray(pkg.storyboards) ? pkg.storyboards : [];
  const explicitMusic = shots.map((shot) => hasExplicitShotMusic(shot && shot.audio_description));
  const legacyMusicCompatibility = pkg.audio_plan == null && explicitMusic.some(Boolean);
  const rawPlan = pkg.audio_plan == null
    ? {
        bgm: {
          mode: legacyMusicCompatibility ? 'per_segment' : 'none',
          planning: 'external',
          source_type: legacyMusicCompatibility ? 'generated' : 'none',
        },
      }
    : {
        ...pkg.audio_plan,
        bgm: {
          ...(pkg.audio_plan.bgm || {}),
          planning: pkg.audio_plan.bgm?.planning || 'external',
        },
      };
  const audioPlan = normalizeEpisodeAudioPlan(rawPlan, { source: 'package_import' });
  const shotAudioDescriptions = shots.map((shot, index) => {
    const source = shot && shot.audio_description;
    let normalized = source == null
      ? null
      : normalizeStoryboardAudioDescription(source, {
          source: 'package_import',
          bgmMode: audioPlan.bgm.mode,
        });
    if (legacyMusicCompatibility && !explicitMusic[index]) {
      normalized = normalized || normalizeStoryboardAudioDescription({}, {
        source: 'package_import',
        bgmMode: 'none',
      });
      normalized.music_cue = {
        ...normalized.music_cue,
        mode: 'mute',
        prompt: null,
        intensity: 0,
      };
    }
    return normalized;
  });
  return {
    audioPlan,
    shotAudioDescriptions,
    report: legacyMusicCompatibility
      ? [{
          path: 'storyboards[].audio_description.non_diegetic_music',
          action: 'legacy_music_to_per_segment',
          severity: 'info',
          message: '检测到制作包逐镜明确配乐，已确定性转换为 per_segment；未声明配乐的镜头保持静音。',
        }]
      : [],
  };
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
  const prepared = prepareInputPackage(db, { rawText, dramaId, targetEpisodeId, throwOnError: false });
  const { pkg, parseErrors } = prepared;
  targetEpisodeId = prepared.targetEpisodeId;
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

  const projection = pkg ? buildNormalizedProjection(pkg) : { normalizedPackage: null, report: null };
  const normalized = projection.normalizedPackage;
  const matches = normalized ? computeAssetMatches(db, normalized, effectiveDramaId) : [];

  return {
    normalized_package: normalized,
    source_sha256: sha256Text(rawText),
    target_status: targetStatus,
    asset_matches: matches,
    errors: [...parseErrors, ...validation.errors],
    warnings: [...prepared.adapterWarnings, ...validation.warnings, ...(projection.report?.warnings || [])],
    stats: computePreviewStats(db, normalized, matches),
    import_report: projection.report,
    package_task: prepared.task ? {
      package_id: prepared.task.package_id,
      target_episode_number: prepared.task.target_episode_number,
      assets_digest: prepared.task.assets_digest,
      created_at: prepared.task.created_at,
    } : null,
  };
}

// —— 正式导入(§8.4) ——

function insertCharacterRow(db, dramaId, item) {
  const available = new Set(db.prepare('PRAGMA table_info(characters)').all().map((column) => column.name));
  const candidate = {
    drama_id: dramaId,
    name: item.name ?? null,
    role: item.role ?? null,
    description: item.description ?? null,
    personality: item.personality ?? null,
    appearance: item.appearance ?? null,
    polished_prompt: item.image_prompt ?? null,
    negative_prompt: item.negative_prompt ?? null,
    voice_style: item.voice_profile ?? null,
    source_key: item.source_key ?? null,
    created_at: NOW(),
    updated_at: NOW(),
  };
  const fields = Object.keys(candidate).filter((field) => available.has(field));
  const info = db.prepare(
    `INSERT INTO characters (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
  ).run(...fields.map((field) => candidate[field]));
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
  const info = db
    .prepare(
      `INSERT INTO scenes (drama_id, episode_id, location, state, description, prompt, atmosphere, negative_prompt, source_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      dramaId,
      episodeId,
      item.name ?? null,
      item.state ?? null,
      item.description ?? null,
      item.image_prompt ?? null,
      item.atmosphere ?? null,
      item.negative_prompt ?? null,
      item.source_key ?? null,
      NOW(),
      NOW(),
    );
  return Number(info.lastInsertRowid);
}

function insertPropRow(db, dramaId, episodeId, item) {
  const info = db
    .prepare(
      `INSERT INTO props (drama_id, episode_id, name, type, description, prompt, negative_prompt, source_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(dramaId, episodeId, item.name ?? null, item.type ?? null, item.description ?? null, item.image_prompt ?? null, item.negative_prompt ?? null, item.source_key ?? null, NOW(), NOW());
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
    const prepared = prepareInputPackage(db, { rawText, dramaId, targetEpisodeId, throwOnError: true });
    let pkg = prepared.pkg;
    targetEpisodeId = prepared.targetEpisodeId;
    const { errors } = validatePackage(pkg);
    if (errors.length > 0) {
      const first = errors.slice(0, 5).map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
      throwCode('PACKAGE_INVALID', `制作包校验失败(${errors.length} 个错误):${first}`);
    }
    const projection = buildNormalizedProjection(pkg);
    pkg = projection.normalizedPackage;
    const importReport = projection.report;

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
    const warnings = [...prepared.adapterWarnings, ...validateBusinessRules(pkg).warnings, ...importReport.warnings];
    const audioPolicy = derivePackageAudioPolicy(pkg);
    warnings.push(...audioPolicy.report);
    const productionProfile = {
      version: 1,
      generation_profile: pkg.generation_profile || {},
      duration_target_seconds: pkg.episode?.duration_target_seconds ?? null,
      notes: pkg.episode?.notes ?? null,
      generator: pkg.generator || null,
      source_key: pkg.episode?.source_key ?? null,
      provenance: { source: 'package_import' },
    };

    // 3. 剧集:填充空白集(集号不变)或新建集(episode_number = max+1)
    let episodeId;
    const episode = pkg.episode || {};
    // 确定性剧本用场景显示名(而非 source_key):按包内 scenes 把 scene_name 注入分镜
    const sceneNameBySourceKey = new Map(
      (Array.isArray(pkg.scenes) ? pkg.scenes : [])
        .filter((s) => s && typeof s === 'object')
        .map((s) => [s.source_key, hasText(s.name) ? s.name : null])
    );
    const storyboardsForScript = (Array.isArray(pkg.storyboards) ? pkg.storyboards : []).map((sb) => ({
      ...sb,
      scene_name: (sb && sceneNameBySourceKey.get(sb.scene_ref)) || null,
    }));
    const scriptContent = hasText(episode.script)
      ? episode.script
      : generateScriptFromStoryboards(storyboardsForScript);
    if (episodeRow) {
      db.prepare(
        'UPDATE episodes SET title = ?, description = ?, script_content = ?, audio_plan = ?, production_profile = ?, updated_at = ? WHERE id = ?'
      ).run(
        episode.title ?? episodeRow.title,
        episode.summary ?? episodeRow.description,
        scriptContent,
        serializeCanonicalJson(audioPolicy.audioPlan),
        serializeCanonicalJson(productionProfile),
        NOW(),
        episodeRow.id,
      );
      episodeId = episodeRow.id;
    } else {
      const maxRow = db
        .prepare('SELECT MAX(episode_number) AS m FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
        .get(effectiveDramaId);
      const episodeNumber = (maxRow && typeof maxRow.m === 'number' ? maxRow.m : 0) + 1;
      episodeId = Number(
        db.prepare(
          `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, audio_plan, production_profile, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
        ).run(
          effectiveDramaId,
          episodeNumber,
          episode.title ?? '',
          scriptContent,
          episode.summary ?? null,
          serializeCanonicalJson(audioPolicy.audioPlan),
          serializeCanonicalJson(productionProfile),
          NOW(),
          NOW(),
        ).lastInsertRowid
      );
    }

    // 4. 人物:按决策建或复用(复用不覆盖)
    const characterIdByKey = new Map();
    const createdCharacterChecks = [];
    for (const entry of plan.characters) {
      const key = entry.item.source_key;
      if (entry.decision === 'reuse') {
        characterIdByKey.set(key, entry.existingId);
        stats.characters_reused += 1;
        importReport.reused.push({ type: 'character', source_key: key, id: entry.existingId });
      } else {
        const characterId = insertCharacterRow(db, effectiveDramaId, entry.item);
        characterIdByKey.set(key, characterId);
        createdCharacterChecks.push({ id: characterId, item: entry.item });
        stats.characters_created += 1;
        importReport.created.push({ type: 'character', source_key: key, id: characterId });
      }
    }

    // 4b. 集-人物关联:制作页角色区按 episode_characters 读取,导入的人物必须挂到本集
    for (const [, characterId] of characterIdByKey) {
      db.prepare('INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)').run(
        episodeId,
        characterId
      );
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
          importReport.reused.push({ type: 'variant', source_key: variant.source_key ?? null, id: Number(before.id) });
        } else {
          const variantId = ensureVariant(db, characterId, variant);
          variantIdByRef.set(refKey, variantId);
          stats.variants_created += 1;
          importReport.created.push({ type: 'variant', source_key: variant.source_key ?? null, id: variantId });
        }
      }
    }

    // 6. 场景与道具:按决策建或复用(复用不覆盖)
    const sceneIdByKey = new Map();
    const createdSceneChecks = [];
    for (const entry of plan.scenes) {
      const key = entry.item.source_key;
      if (entry.decision === 'reuse') {
        sceneIdByKey.set(key, entry.existingId);
        stats.scenes_reused += 1;
        importReport.reused.push({ type: 'scene', source_key: key, id: entry.existingId });
      } else {
        const sceneId = insertSceneRow(db, effectiveDramaId, episodeId, entry.item);
        sceneIdByKey.set(key, sceneId);
        createdSceneChecks.push({ id: sceneId, item: entry.item });
        stats.scenes_created += 1;
        importReport.created.push({ type: 'scene', source_key: key, id: sceneId });
      }
    }
    const propIdByKey = new Map();
    const createdPropChecks = [];
    for (const entry of plan.props) {
      const key = entry.item.source_key;
      if (entry.decision === 'reuse') {
        propIdByKey.set(key, entry.existingId);
        stats.props_reused += 1;
        importReport.reused.push({ type: 'prop', source_key: key, id: entry.existingId });
      } else {
        const propId = insertPropRow(db, effectiveDramaId, episodeId, entry.item);
        propIdByKey.set(key, propId);
        createdPropChecks.push({ id: propId, item: entry.item });
        stats.props_created += 1;
        importReport.created.push({ type: 'prop', source_key: key, id: propId });
      }
    }

    // 7. 分镜(§5.6.1 映射)+ 8. 关联 + 9. 兼容字段同步
    const storyboards = Array.isArray(pkg.storyboards) ? pkg.storyboards : [];
    // 场景显示名写入 storyboards.location(供确定性剧本与页面展示使用,避免出现 source_key)
    const sceneNameByKey = new Map();
    for (const [key, sceneId] of sceneIdByKey) {
      const sceneRow = db.prepare('SELECT location FROM scenes WHERE id = ?').get(sceneId);
      sceneNameByKey.set(key, sceneRow ? sceneRow.location : null);
    }
    const importedStoryboardIds = [];
    for (let storyboardIndex = 0; storyboardIndex < storyboards.length; storyboardIndex += 1) {
        const storyboard = storyboards[storyboardIndex];
        const sceneId = sceneIdByKey.get(storyboard.scene_ref);
        if (!sceneId) {
          throwCode('PACKAGE_INVALID', `分镜 ${storyboard.source_key} 的 scene_ref "${storyboard.scene_ref}" 无法解析为场景`);
        }
        const createdStoryboard = saveCanonicalStoryboard(db, episodeId, {
          scene_id: sceneId,
          storyboard_number: storyboard.storyboard_number ?? 0,
          title: storyboard.title ?? null,
          description: storyboard.description ?? null,
          duration: storyboard.duration_seconds ?? null,
          location: sceneNameByKey.get(storyboard.scene_ref) ?? null,
          dialogue: renderDialogue(storyboard.dialogue),
          action: renderAction(storyboard.action),
          image_prompt: storyboard.image_prompt ?? null,
          narration: storyboard.narration ?? null,
          layout_description: storyboard.composition ?? null,
          universal_segment_text: storyboard.universal_segment_text ?? null,
          shot_type: storyboard.shot_type ?? null,
          angle: storyboard.camera_angle ?? null,
          movement: storyboard.camera_movement ?? null,
          creation_mode: 'universal',
          status: 'draft',
          source_key: storyboard.source_key ?? null,
          audio_description: audioPolicy.shotAudioDescriptions[storyboardIndex],
          transition: storyboard.transition ?? null,
          is_primary: storyboard.is_primary === true,
          production_metadata: storyboard.notes == null ? null : { import_notes: storyboard.notes },
        }, { source: 'package_import', lock: false });
        const sbId = Number(createdStoryboard.id);
        importedStoryboardIds.push(sbId);
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

    const projectedRows = importedStoryboardIds.map((id) => {
      const row = db.prepare('SELECT * FROM storyboards WHERE id = ?').get(id);
      return projectStoryboardRow(row);
    });
    const projectionMismatch = projectedRows.length !== storyboards.length
      || projectedRows.some((row, index) => {
        const source = storyboards[index];
        const expectedAudio = audioPolicy.shotAudioDescriptions[index];
        const expectedTransition = source.transition == null ? null : normalizeStoryboardTransition(source.transition);
        return row.storyboard_number !== source.storyboard_number
          || row.source_key !== (source.source_key ?? null)
          || row.scene_id !== sceneIdByKey.get(source.scene_ref)
          || row.title !== (source.title ?? null)
          || row.description !== (source.description ?? null)
          || row.dialogue !== renderDialogue(source.dialogue)
          || row.action !== renderAction(source.action)
          || row.image_prompt !== (source.image_prompt ?? null)
          || row.narration !== (source.narration ?? null)
          || row.layout_description !== (source.composition ?? null)
          || row.universal_segment_text !== (source.universal_segment_text ?? null)
          || row.shot_type !== (source.shot_type ?? null)
          || row.angle !== (source.camera_angle ?? null)
          || row.movement !== (source.camera_movement ?? null)
          || row.is_primary !== (source.is_primary === true)
          || serializeCanonicalJson(row.audio_description) !== serializeCanonicalJson(expectedAudio)
          || serializeCanonicalJson(row.transition) !== serializeCanonicalJson(expectedTransition);
      });
    const characterColumns = new Set(db.prepare('PRAGMA table_info(characters)').all().map((column) => column.name));
    const characterProjectionMismatch = createdCharacterChecks.some(({ id, item }) => {
      const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
      if (!row) return true;
      const expected = {
        name: item.name ?? null,
        role: item.role ?? null,
        description: item.description ?? null,
        personality: item.personality ?? null,
        appearance: item.appearance ?? null,
        polished_prompt: item.image_prompt ?? null,
        negative_prompt: item.negative_prompt ?? null,
        voice_style: item.voice_profile ?? null,
        source_key: item.source_key ?? null,
      };
      return Object.entries(expected).some(([field, value]) => characterColumns.has(field) && row[field] !== value);
    });
    const sceneProjectionMismatch = createdSceneChecks.some(({ id, item }) => {
      const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id);
      return !row
        || row.location !== (item.name ?? null)
        || row.state !== (item.state ?? null)
        || row.description !== (item.description ?? null)
        || row.prompt !== (item.image_prompt ?? null)
        || row.atmosphere !== (item.atmosphere ?? null)
        || row.negative_prompt !== (item.negative_prompt ?? null)
        || row.source_key !== (item.source_key ?? null);
    });
    const propProjectionMismatch = createdPropChecks.some(({ id, item }) => {
      const row = db.prepare('SELECT * FROM props WHERE id = ?').get(id);
      return !row
        || row.name !== (item.name ?? null)
        || row.type !== (item.type ?? null)
        || row.description !== (item.description ?? null)
        || row.prompt !== (item.image_prompt ?? null)
        || row.negative_prompt !== (item.negative_prompt ?? null)
        || row.source_key !== (item.source_key ?? null);
    });
    const referenceProjectionMismatch = importedStoryboardIds.some((storyboardId, index) => {
      const source = storyboards[index];
      const expectedProps = (source.prop_refs || []).map((key) => propIdByKey.get(key)).filter(Boolean).sort((a, b) => a - b);
      const actualProps = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ? ORDER BY prop_id').all(storyboardId).map((row) => row.prop_id);
      if (serializeCanonicalJson(actualProps) !== serializeCanonicalJson(expectedProps)) return true;
      const expectedLinks = (source.character_refs || [])
        .filter((ref) => characterIdByKey.get(ref.character_ref) && variantIdByRef.get(`${ref.character_ref}/${ref.variant_ref}`))
        .slice()
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map((ref) => ({
          character_id: characterIdByKey.get(ref.character_ref),
          variant_id: variantIdByRef.get(`${ref.character_ref}/${ref.variant_ref}`),
          reference_role: ref.reference_role ?? null,
          sort_order: ref.sort_order ?? null,
          framing_note: ref.framing_note ?? null,
        }));
      const actualLinks = db.prepare(
        'SELECT character_id, variant_id, reference_role, sort_order, framing_note FROM storyboard_character_variants WHERE storyboard_id = ? ORDER BY sort_order, id'
      ).all(storyboardId);
      return serializeCanonicalJson(actualLinks) !== serializeCanonicalJson(expectedLinks);
    });
    if (projectionMismatch || characterProjectionMismatch || sceneProjectionMismatch || propProjectionMismatch || referenceProjectionMismatch) {
      throwCode('PACKAGE_PROJECTION_MISMATCH', '制作包资产或分镜在规范化回读时发生字段丢失');
    }
    importReport.projection = { status: 'verified', verified_at: NOW() };

    // 10. episode_imports 审计快照(normalized_json 存渲染后的归一化包)
    const importColumns = new Set(db.prepare('PRAGMA table_info(episode_imports)').all().map((column) => column.name));
    const importedAt = NOW();
    const importRecord = {
      episode_id: episodeId,
      schema_name: prepared.sourceSchema,
      schema_version: prepared.sourceVersion || pkg.version,
      source_filename: sanitizeSourceFilename(filename),
      source_sha256: sha256Text(rawText),
      raw_json: String(rawText),
      normalized_json: JSON.stringify(buildNormalizedPackage(pkg)),
      match_decisions: JSON.stringify(decisions || {}),
      generator_metadata: pkg.generator !== undefined ? JSON.stringify(pkg.generator) : null,
      import_report: JSON.stringify(importReport),
      imported_at: importedAt,
      task_package_id: prepared.task?.package_id || null,
      task_created_at: prepared.task?.created_at || null,
      task_assets_digest: prepared.task?.assets_digest || null,
    };
    const fields = Object.keys(importRecord).filter((field) => importColumns.has(field));
    db.prepare(
      `INSERT INTO episode_imports (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
    ).run(...fields.map((field) => importRecord[field]));
    if (prepared.task) {
      db.prepare('UPDATE external_ai_package_tasks SET imported_at = ? WHERE package_id = ?').run(
        importedAt,
        prepared.task.package_id,
      );
    }

    return {
      episode_id: episodeId,
      stats,
      warnings,
      import_report: importReport,
      package_task: prepared.task ? {
        package_id: prepared.task.package_id,
        created_at: prepared.task.created_at,
        assets_digest: prepared.task.assets_digest,
      } : null,
    };
  });

  return run();
}

module.exports = {
  sha256Text,
  episodeBlankStatus,
  previewPackageImport,
  importEpisodePackage,
};
