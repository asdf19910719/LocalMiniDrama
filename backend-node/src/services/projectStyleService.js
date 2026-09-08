const { createStyleRegistryService, styleError } = require('./styleRegistryService');

const REQUEST_STYLE_OVERRIDE_KEYS = Object.freeze([
  'style', 'style_id', 'styleId', 'style_prompt', 'style_prompt_zh', 'style_prompt_en',
  'style_prompt_image', 'style_prompt_video', 'style_prompt_negative', 'style_override',
  'style_snapshot', 'styleSnapshot',
]);

function hasProjectStyleOverride(input) {
  if (!input || typeof input !== 'object') return false;
  return REQUEST_STYLE_OVERRIDE_KEYS.some((field) => Object.prototype.hasOwnProperty.call(input, field));
}

function assertNoStyleOverride(input = {}) {
  const present = REQUEST_STYLE_OVERRIDE_KEYS.filter((field) => Object.prototype.hasOwnProperty.call(input, field));
  if (present.length) throw styleError('PROJECT_STYLE_OVERRIDE_FORBIDDEN', '项目内生成请求不能覆盖项目风格', { fields: present });
}

function requireProjectStyle(db, dramaId) {
  const row = db.prepare('SELECT id, style_id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
  if (!row) throw styleError('PROJECT_NOT_FOUND', '项目不存在', { drama_id: dramaId });
  if (!row.style_id) throw styleError('PROJECT_STYLE_REQUIRED', '项目尚未选择风格', { drama_id: dramaId });
  return createStyleRegistryService({ db }).requireStyle(row.style_id);
}

function resolveEntityProjectStyle(db, targetType, targetId) {
  const queries = {
    character: 'SELECT drama_id FROM characters WHERE id = ? AND deleted_at IS NULL',
    character_variant: 'SELECT c.drama_id FROM character_variants v JOIN characters c ON c.id=v.character_id WHERE v.id = ? AND v.deleted_at IS NULL AND c.deleted_at IS NULL',
    scene: 'SELECT drama_id FROM scenes WHERE id = ? AND deleted_at IS NULL',
    prop: 'SELECT drama_id FROM props WHERE id = ? AND deleted_at IS NULL',
    storyboard: 'SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id=s.episode_id WHERE s.id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL',
    episode: 'SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL',
  };
  const sql = queries[targetType];
  if (!sql) throw styleError('STYLE_TARGET_INVALID', '不支持的风格目标类型', { target_type: targetType });
  const row = db.prepare(sql).get(Number(targetId));
  if (!row) throw styleError('STYLE_TARGET_NOT_FOUND', '风格目标不存在', { target_type: targetType, target_id: targetId });
  return requireProjectStyle(db, row.drama_id);
}

module.exports = { assertNoStyleOverride, hasProjectStyleOverride, requireProjectStyle, resolveEntityProjectStyle };
