// 可选的角色音色参考：分镜绑定角色中已上传且未失效的音色资产，
// 作为 MiniMax H3 timeline 的 refAudios 注入（不传则不生效）。
function resolveVoiceReferenceAudios(db, storyboardId) {
  if (!db || !storyboardId) return [];
  const rows = db.prepare(`
    SELECT DISTINCT c.id AS character_id, c.name,
      c.seedance2_voice_local_path, c.seedance2_voice_asset
    FROM storyboard_characters sc
    JOIN characters c ON c.id = sc.character_id
    WHERE sc.storyboard_id = ? AND c.deleted_at IS NULL
  `).all(String(storyboardId));
  return rows
    .map((row) => {
      let asset = {};
      try { asset = row.seedance2_voice_asset ? JSON.parse(row.seedance2_voice_asset) : {}; } catch (_) { asset = {}; }
      return {
        characterId: row.character_id,
        characterName: row.name || `character-${row.character_id}`,
        audioFile: String(row.seedance2_voice_local_path || '').trim(),
        status: String(asset.status || '').toLowerCase(),
      };
    })
    .filter((item) => item.audioFile && item.status !== 'stale')
    .map(({ characterId, characterName, audioFile }) => ({ characterId, characterName, audioFile }));
}

module.exports = { resolveVoiceReferenceAudios };
