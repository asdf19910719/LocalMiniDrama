'use strict';

const str = (required = false) => ({ type: 'string', ...(required ? { minLength: 1 } : {}) });
const nullableStr = { type: ['string', 'null'] };
const num = (minimum) => ({ type: 'number', ...(minimum === undefined ? {} : { minimum }) });
const integer = (minimum) => ({ type: 'integer', ...(minimum === undefined ? {} : { minimum }) });
const bool = { type: 'boolean' };
const arrayOf = (items, options = {}) => ({ type: 'array', items, ...options });
const strictObject = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const localRef = { type: 'string', minLength: 1, pattern: '^[A-Za-z][A-Za-z0-9_.:-]*$' };
const assetRef = { type: 'string', minLength: 1 };

const variantSchema = strictObject({
  local_ref: localRef,
  name: str(true),
  description: str(true),
  appearance: str(true),
  image_prompt: str(true),
  negative_prompt: str(true),
  is_default: bool,
}, ['local_ref', 'name', 'description', 'appearance', 'image_prompt', 'negative_prompt', 'is_default']);

const characterSchema = strictObject({
  local_ref: localRef,
  name: str(true),
  role: { enum: ['main', 'supporting', 'minor'] },
  description: str(true),
  personality: str(true),
  appearance: str(true),
  image_prompt: str(true),
  negative_prompt: str(true),
  voice_profile: str(true),
  variants: arrayOf(variantSchema, { minItems: 1 }),
}, [
  'local_ref', 'name', 'role', 'description', 'personality', 'appearance',
  'image_prompt', 'negative_prompt', 'voice_profile', 'variants',
]);

const existingCharacterVariantSchema = strictObject({
  local_ref: localRef,
  character_ref: assetRef,
  name: str(true),
  description: str(true),
  appearance: str(true),
  image_prompt: str(true),
  negative_prompt: str(true),
  is_default: bool,
}, [
  'local_ref', 'character_ref', 'name', 'description', 'appearance',
  'image_prompt', 'negative_prompt', 'is_default',
]);

const sceneSchema = strictObject({
  local_ref: localRef,
  name: str(true),
  state: str(true),
  description: str(true),
  atmosphere: str(true),
  image_prompt: str(true),
  negative_prompt: str(true),
}, ['local_ref', 'name', 'state', 'description', 'atmosphere', 'image_prompt', 'negative_prompt']);

const propSchema = strictObject({
  local_ref: localRef,
  name: str(true),
  type: str(true),
  description: str(true),
  image_prompt: str(true),
  negative_prompt: str(true),
}, ['local_ref', 'name', 'type', 'description', 'image_prompt', 'negative_prompt']);

const characterRefSchema = strictObject({
  character_ref: assetRef,
  variant_ref: assetRef,
  reference_role: { enum: ['primary', 'supporting', 'background'] },
  sort_order: integer(1),
  framing_note: str(true),
}, ['character_ref', 'variant_ref', 'reference_role', 'sort_order', 'framing_note']);

const actionSchema = strictObject({
  start: str(true),
  progression: str(true),
  end: str(true),
}, ['start', 'progression', 'end']);

const dialogueSchema = strictObject({
  speaker: str(true),
  line: str(true),
  performance: str(true),
}, ['speaker', 'line', 'performance']);

const musicCueSchema = strictObject({
  mode: { enum: ['inherit', 'override', 'mute', 'stinger'] },
  prompt: nullableStr,
  intensity: num(0),
  start: nullableStr,
  end: nullableStr,
}, ['mode', 'intensity', 'start', 'end']);

const audioDescriptionSchema = strictObject({
  ambience: arrayOf(str(true)),
  sound_effects: arrayOf(str(true)),
  dialogue_treatment: str(true),
  silence: bool,
  music_cue: musicCueSchema,
}, ['ambience', 'sound_effects', 'dialogue_treatment', 'silence', 'music_cue']);

const audioBridgeSchema = strictObject({
  mode: { enum: ['none', 'carry', 'fade', 'crossfade'] },
  duration_ms: num(0),
  description: str(true),
}, ['mode', 'duration_ms', 'description']);

const transitionSchema = strictObject({
  type: str(true),
  duration: num(0),
  visual_description: nullableStr,
  audio_bridge: audioBridgeSchema,
}, ['type', 'duration', 'visual_description', 'audio_bridge']);

const storyboardSchema = strictObject({
  local_ref: localRef,
  storyboard_number: integer(1),
  title: str(true),
  description: str(true),
  duration_seconds: num(0.01),
  scene_ref: assetRef,
  character_refs: arrayOf(characterRefSchema),
  prop_refs: arrayOf(assetRef),
  shot_type: str(true),
  camera_angle: str(true),
  camera_movement: str(true),
  composition: str(true),
  action: actionSchema,
  dialogue: arrayOf(dialogueSchema),
  narration: str(false),
  audio_description: audioDescriptionSchema,
  transition: transitionSchema,
  image_prompt: str(true),
  universal_segment_text: {
    ...str(true),
    description: '万能提示词草稿。参考图必须使用规范槽位 @图片1、@图片2……：@图片1 为场景，随后按 character_refs.sort_order 为人物状态，最后为 prop_refs；禁止用 @场景/@人物/@道具或资产名称代替槽位。',
  },
  is_primary: bool,
  notes: str(false),
}, [
  'local_ref', 'storyboard_number', 'title', 'description', 'duration_seconds',
  'scene_ref', 'character_refs', 'prop_refs', 'shot_type', 'camera_angle',
  'camera_movement', 'composition', 'action', 'dialogue', 'narration',
  'audio_description', 'transition', 'image_prompt', 'universal_segment_text', 'is_primary',
]);

const bgmSchema = strictObject({
  mode: { enum: ['none', 'episode_track', 'per_segment'] },
  prompt: nullableStr,
  planning: { enum: ['manual', 'ai', 'external'] },
  continuity_key: nullableStr,
  source_type: { enum: ['none', 'local_file', 'media_library', 'generated'] },
  local_path: nullableStr,
  volume_db: num(),
  ducking_db: num(),
  fade_in_ms: num(0),
  fade_out_ms: num(0),
  crossfade_ms: num(0),
}, ['mode', 'planning', 'source_type']);

const audioPlanSchema = strictObject({
  version: { const: 1 },
  bgm: bgmSchema,
  mastering: strictObject({
    target_lufs: num(),
    true_peak_db: num(),
  }, ['target_lufs', 'true_peak_db']),
  speech: strictObject({
    dialogue_owner: { enum: ['h3_native', 'post_tts', 'none'] },
    narration_owner: { enum: ['h3_native', 'post_tts', 'none'] },
  }, ['dialogue_owner', 'narration_owner']),
}, ['version', 'bgm', 'mastering', 'speech']);

const EXTERNAL_AI_RESULT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'local-mini-drama.external-ai-result',
  title: 'LocalMiniDrama 外部 AI 单集增量结果',
  description: '由项目任务包约束的严格增量结果。已有资产只引用，新资产只在 new_assets 中声明。',
  type: 'object',
  required: ['schema', 'version', 'package_id', 'episode', 'new_assets', 'storyboards'],
  additionalProperties: false,
  properties: {
    schema: { const: 'local-mini-drama.external-ai-result' },
    version: { const: '1' },
    package_id: str(true),
    generator: strictObject({
      name: str(true),
      model: str(false),
      generated_at: str(false),
    }, ['name']),
    audio_plan: audioPlanSchema,
    episode: strictObject({
      episode_number: integer(1),
      title: str(true),
      summary: str(true),
      script: str(true),
      duration_target_seconds: num(0.01),
      notes: str(false),
    }, ['episode_number', 'title', 'summary', 'script', 'duration_target_seconds']),
    new_assets: strictObject({
      characters: arrayOf(characterSchema),
      character_variants: arrayOf(existingCharacterVariantSchema),
      scenes: arrayOf(sceneSchema),
      props: arrayOf(propSchema),
    }, ['characters', 'character_variants', 'scenes', 'props']),
    storyboards: arrayOf(storyboardSchema, { minItems: 1 }),
  },
};

function joinPath(base, key) {
  if (!base) return String(key);
  return typeof key === 'number' ? `${base}[${key}]` : `${base}.${key}`;
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateSchemaValue(value, schema, path, errors) {
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push({ code: 'PACKAGE_INVALID', path, message: `${path || '根对象'} 必须为 ${JSON.stringify(schema.const)}` });
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ code: 'PACKAGE_INVALID', path, message: `${path} 必须为 ${schema.enum.join('、')} 之一` });
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push({ code: 'PACKAGE_INVALID', path, message: `${path || '根对象'} 类型必须为 ${types.join(' 或 ')}` });
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength && value.trim().length < schema.minLength) {
      errors.push({ code: 'PACKAGE_INVALID', path, message: `${path} 必须为非空字符串` });
    } else if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) {
      errors.push({ code: 'PACKAGE_INVALID', path, message: `${path} 格式无效` });
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push({ code: 'PACKAGE_INVALID', path, message: `${path} 必须不小于 ${schema.minimum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ code: 'PACKAGE_INVALID', path, message: `${path} 至少需要 ${schema.minItems} 项` });
    }
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, joinPath(path, index), errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push({ code: 'PACKAGE_INVALID', path: joinPath(path, key), message: `${joinPath(path, key)} 是未定义字段` });
        }
      }
    }
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({ code: 'PACKAGE_INVALID', path: joinPath(path, key), message: `${joinPath(path, key)} 必填` });
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateSchemaValue(value[key], childSchema, joinPath(path, key), errors);
      }
    }
  }
}

function collectLocalRefs(result, errors) {
  const seen = new Map();
  const add = (value, path) => {
    if (typeof value !== 'string' || !value) return;
    if (seen.has(value)) {
      errors.push({
        code: 'LOCAL_REF_DUPLICATE',
        path,
        message: `local_ref "${value}" 重复，首次出现于 ${seen.get(value)}`,
      });
    } else {
      seen.set(value, path);
    }
  };
  const assets = result?.new_assets || {};
  (assets.characters || []).forEach((character, index) => {
    add(character?.local_ref, `new_assets.characters[${index}].local_ref`);
    (character?.variants || []).forEach((variant, variantIndex) => {
      add(variant?.local_ref, `new_assets.characters[${index}].variants[${variantIndex}].local_ref`);
    });
  });
  for (const group of ['character_variants', 'scenes', 'props']) {
    (assets[group] || []).forEach((item, index) => add(item?.local_ref, `new_assets.${group}[${index}].local_ref`));
  }
  (result?.storyboards || []).forEach((item, index) => add(item?.local_ref, `storyboards[${index}].local_ref`));
}

function validateExternalAiResult(value) {
  const errors = [];
  validateSchemaValue(value, EXTERNAL_AI_RESULT_SCHEMA, '', errors);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    collectLocalRefs(value, errors);
    if (Array.isArray(value.storyboards)) {
      value.storyboards.forEach((storyboard, index) => {
        if (storyboard && storyboard.storyboard_number !== index + 1) {
          errors.push({
            code: 'STORYBOARD_NUMBER_INVALID',
            path: `storyboards[${index}].storyboard_number`,
            message: `分镜编号必须从 1 连续递增，当前应为 ${index + 1}`,
          });
        }
      });
    }
    for (let index = 0; index < (value.new_assets?.characters || []).length; index += 1) {
      const character = value.new_assets.characters[index];
      if (Array.isArray(character?.variants) && !character.variants.some((variant) => variant?.is_default === true)) {
        errors.push({
          code: 'DEFAULT_VARIANT_REQUIRED',
          path: `new_assets.characters[${index}].variants`,
          message: '新人物至少需要一个 is_default=true 的状态',
        });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  EXTERNAL_AI_RESULT_SCHEMA,
  validateExternalAiResult,
};
