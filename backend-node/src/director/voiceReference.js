const fs = require('node:fs');
const path = require('node:path');

// 可选的角色音色参考：分镜绑定角色（storyboards.characters JSON 数组）中
// 已上传且有效的音色资产，解析为 ComfyUI 可读取的绝对路径，
// 供 MiniMax H3 timeline 的 refAudios 注入（不传则不生效）。
function resolveVoiceReferenceAudios(db, storyboardId, storageRoot) {
  if (!db || !storyboardId) return [];
  const root = storageRoot || path.join(process.cwd(), 'data', 'storage');
  const shot = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(String(storyboardId));
  let characterIds = [];
  try { characterIds = JSON.parse(shot?.characters || '[]'); } catch (_) { characterIds = []; }
  if (!Array.isArray(characterIds) || !characterIds.length) return [];
  const placeholders = characterIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id AS character_id, name, seedance2_voice_asset
    FROM characters
    WHERE id IN (${placeholders}) AND deleted_at IS NULL
  `).all(...characterIds);
  const audios = [];
  for (const row of rows) {
    let asset = {};
    try { asset = row.seedance2_voice_asset ? JSON.parse(row.seedance2_voice_asset) : {}; } catch (_) { asset = {}; }
    if (String(asset.status || '').toLowerCase() !== 'active') continue;
    const relative = String(asset.local_path || '').trim();
    if (!relative) continue;
    const absolute = path.isAbsolute(relative) ? relative : path.resolve(root, relative);
    if (!fs.existsSync(absolute)) continue;
    audios.push({
      characterId: row.character_id,
      characterName: row.name || `character-${row.character_id}`,
      audioFile: absolute,
    });
  }
  return audios;
}

module.exports = { resolveVoiceReferenceAudios };
