// 分镜：create, update, delete；帧提示词 get/save

const { syncStoryboardVariantLinks, listStoryboardVariantLinks } = require('./storyboardVariantService');
const fs = require('node:fs');
const path = require('node:path');
const {
  saveCanonicalStoryboard,
  patchStoryboard,
  projectStoryboardRow,
} = require('./storyboardCanonicalRepository');

function validateAudioStoragePath(value) {
  if (value == null || String(value).trim() === '') return;
  const raw = String(value).trim();
  const error = () => {
    const issue = new Error('音频本地路径必须位于项目 storage 根目录内');
    issue.code = 'AUDIO_PATH_OUTSIDE_STORAGE';
    return issue;
  };
  if (path.isAbsolute(raw)) throw error();
  const cfg = require('../config').loadConfig();
  const configured = cfg.storage?.local_path || './data/storage';
  const root = path.resolve(configured);
  const candidate = path.resolve(root, raw.replace(/^[/\\]+/, ''));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw error();
  if (fs.existsSync(candidate)) {
    const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw error();
  }
}

/**
 * 将分镜勾选的角色（dramas.characters 表 id）同步到 storyboard_characters（角色库 id），
 * 便于帧提示词与图生参考图与 UI 一致；按角色名匹配本剧或全局角色库。
 */
function parseDramaCharacterIds(charactersValue) {
  if (charactersValue === undefined || charactersValue === null) return null;
  if (Array.isArray(charactersValue)) {
    return charactersValue
      .map((x) => Number(typeof x === 'object' && x != null ? x.id : x))
      .filter((n) => Number.isFinite(n));
  }
  if (typeof charactersValue === 'string') {
    try {
      const arr = JSON.parse(charactersValue);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x) => Number(typeof x === 'object' && x != null ? x.id : x))
        .filter((n) => Number.isFinite(n));
    } catch (_) {
      return [];
    }
  }
  return [];
}

/** 解析分镜人物状态关联：数组原样返回，JSON 字符串解析为数组，其余视为空数组 */
function parseVariantLinks(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function syncStoryboardCharacterLinks(db, storyboardId, dramaCharacterIds) {
  const sid = Number(storyboardId);
  db.prepare('DELETE FROM storyboard_characters WHERE storyboard_id = ?').run(sid);
  const ids = Array.isArray(dramaCharacterIds) ? dramaCharacterIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
  if (ids.length === 0) return;
  const sb = db.prepare(
    `SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id WHERE s.id = ? AND s.deleted_at IS NULL`
  ).get(sid);
  const dramaId = sb?.drama_id != null ? Number(sb.drama_id) : null;
  const now = new Date().toISOString();
  const ins = db.prepare('INSERT OR IGNORE INTO storyboard_characters (storyboard_id, character_id, created_at) VALUES (?, ?, ?)');
  for (const cid of ids.slice(0, 20)) {
    const crow = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(cid);
    const name = (crow?.name || '').trim();
    if (!name) continue;
    let lib = null;
    if (dramaId) {
      lib = db.prepare(
        'SELECT id FROM character_libraries WHERE deleted_at IS NULL AND drama_id = ? AND TRIM(name) = ? LIMIT 1'
      ).get(dramaId, name);
    }
    if (!lib) {
      lib = db.prepare(
        'SELECT id FROM character_libraries WHERE deleted_at IS NULL AND drama_id IS NULL AND TRIM(name) = ? LIMIT 1'
      ).get(name);
    }
    if (lib) ins.run(sid, lib.id, now);
  }
}

function createStoryboard(db, log, req) {
  validateAudioStoragePath(req.audio_local_path);
  validateAudioStoragePath(req.narration_audio_local_path);
  const episodeId = Number(req.episode_id);
  const charactersValue = req.character_ids !== undefined ? req.character_ids : req.characters;
  const created = saveCanonicalStoryboard(db, episodeId, {
    ...req,
    ...(charactersValue !== undefined ? { characters: charactersValue } : {}),
  }, { source: 'manual', lock: true });
  if (charactersValue !== undefined) {
    syncStoryboardCharacterLinks(db, created.id, parseDramaCharacterIds(charactersValue) ?? []);
  }
  if (req.character_variant_links !== undefined) {
    syncStoryboardVariantLinks(db, created.id, parseVariantLinks(req.character_variant_links));
  }
  if (req.prop_ids !== undefined) {
    const ins = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
    for (const propId of Array.isArray(req.prop_ids) ? req.prop_ids : []) ins.run(created.id, Number(propId));
  }
  log.info('Storyboard created', { id: created.id, episode_id: episodeId });
  return getStoryboardById(db, created.id);
}

function updateStoryboard(db, log, id, req) {
  const row = db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!row) return null;
  validateAudioStoragePath(req.audio_local_path);
  validateAudioStoragePath(req.narration_audio_local_path);
  // 前端可能传 character_ids，与 characters 统一：存为 JSON 字符串
  const charactersValue = req.character_ids !== undefined ? req.character_ids : req.characters;
  let parsedDramaCharIdsForSync = null;
  const canonicalPatch = { ...req };
  delete canonicalPatch.character_ids;
  delete canonicalPatch.prop_ids;
  delete canonicalPatch.character_variant_links;
  if (charactersValue !== undefined) {
    canonicalPatch.characters = charactersValue;
    parsedDramaCharIdsForSync = parseDramaCharacterIds(charactersValue) ?? [];
  }
  patchStoryboard(db, id, canonicalPatch, {
    source: 'manual',
    lock: true,
    clearFields: req.clear_fields,
    unlockFields: req.unlock_fields,
  });
  // 角色勾选变更：只同步 storyboard_characters，不删除 frame_prompts。
  // 用户手动保存的首/尾帧提示词应保留；图生时 framePromptSanitize 会按当前勾选剔除未出场角色名。
  if (parsedDramaCharIdsForSync !== null) {
    try {
      syncStoryboardCharacterLinks(db, id, parsedDramaCharIdsForSync);
    } catch (e) {
      log.warn('syncStoryboardCharacterLinks failed', { id, message: e.message });
    }
  }
  // 人物状态关联：存在时全删全插 storyboard_character_variants，并同步 characters 投影为 ID 数组
  if (req.character_variant_links !== undefined) {
    try {
      syncStoryboardVariantLinks(db, id, parseVariantLinks(req.character_variant_links));
    } catch (e) {
      log.warn('syncStoryboardVariantLinks failed', { id, message: e.message, code: e.code });
    }
  }
  // 道具关联：写入 storyboard_props 表
  if (req.prop_ids !== undefined) {
    const propIds = Array.isArray(req.prop_ids) ? req.prop_ids : [];
    db.prepare('DELETE FROM storyboard_props WHERE storyboard_id = ?').run(Number(id));
    const ins = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
    for (const pid of propIds) ins.run(Number(id), Number(pid));
  }
  log.info('Storyboard updated', { id });
  return getStoryboardById(db, id);
}

function deleteStoryboard(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE storyboards SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  if (result.changes === 0) return false;
  log.info('Storyboard deleted', { id });
  return true;
}

function getStoryboardById(db, id) {
  const r = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!r) return null;
  let propIds = [];
  try {
    const propLinks = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(Number(id));
    propIds = propLinks.map((p) => p.prop_id);
  } catch (_) {}
  let links = [];
  try { links = listStoryboardVariantLinks(db, Number(id)); } catch (_) {}
  return {
    ...projectStoryboardRow(r, links),
    prop_ids: propIds,
  };
}

function getFramePrompts(db, storyboardId) {
  const rows = db.prepare(
    'SELECT * FROM frame_prompts WHERE storyboard_id = ? ORDER BY created_at ASC'
  ).all(Number(storyboardId));
  return rows.map((r) => ({
    id: r.id,
    storyboard_id: r.storyboard_id,
    frame_type: r.frame_type,
    prompt: r.prompt,
    description: r.description,
    layout: r.layout,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function saveFramePrompt(db, log, storyboardId, frameType, prompt, description, layout) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM frame_prompts WHERE storyboard_id = ? AND frame_type = ?').get(Number(storyboardId), frameType);
  if (existing) {
    db.prepare('UPDATE frame_prompts SET prompt = ?, description = ?, layout = ?, updated_at = ? WHERE id = ?').run(
      prompt,
      description ?? null,
      layout ?? null,
      now,
      existing.id
    );
    return getFramePrompts(db, storyboardId);
  }
  db.prepare(
    `INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(storyboardId), frameType, prompt, description ?? null, layout ?? null, now, now);
  log.info('Frame prompt saved', { storyboard_id: storyboardId, frame_type: frameType });
  return getFramePrompts(db, storyboardId);
}

/** 在指定分镜前插入一个空白分镜：先把同 episode 中 number >= target 的全部 +1，再创建新分镜 */
function insertBeforeStoryboard(db, log, targetId) {
  const target = db.prepare(
    'SELECT id, episode_id, storyboard_number, segment_index, segment_title FROM storyboards WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(targetId));
  if (!target) return null;

  db.prepare(
    'UPDATE storyboards SET storyboard_number = storyboard_number + 1, updated_at = ? WHERE episode_id = ? AND storyboard_number >= ? AND deleted_at IS NULL'
  ).run(new Date().toISOString(), target.episode_id, target.storyboard_number);

  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO storyboards (episode_id, storyboard_number, segment_index, segment_title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).run(target.episode_id, target.storyboard_number, target.segment_index ?? null, target.segment_title ?? null, now, now);

  log.info('Storyboard inserted before', { new_id: info.lastInsertRowid, before_id: targetId });
  return getStoryboardById(db, info.lastInsertRowid);
}

module.exports = {
  createStoryboard,
  insertBeforeStoryboard,
  updateStoryboard,
  deleteStoryboard,
  getStoryboardById,
  getFramePrompts,
  saveFramePrompt,
  validateAudioStoragePath,
};
