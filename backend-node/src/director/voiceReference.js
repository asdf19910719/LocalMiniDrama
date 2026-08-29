const fs = require('node:fs');
const path = require('node:path');

// 可选的角色音色参考：分镜绑定角色中已上传且有效的音色资产（seedance2_voice_asset），
// 解析为 ComfyUI 可读取的绝对路径，供 MiniMax H3 timeline 的 refAudios 注入。
function resolveVoiceReferenceAudios(db, storyboardId, storageRoot) {
  if (!db || !storyboardId) return [];
  const root = storageRoot || path.join(process.cwd(), 'data', 'storage');
  const rows = db.prepare(`
    SELECT DISTINCT c.id AS character_id, c.name,
      c.seedance2_voice_asset
    FROM storyboard_characters sc
    JOIN characters c ON c.id = sc.character_id
    WHERE sc.storyboard_id = ? AND c.deleted_at IS NULL
  `).all(String(storyboardId));
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
