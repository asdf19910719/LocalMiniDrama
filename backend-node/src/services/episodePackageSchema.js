/**
 * 单集制作包(local-mini-drama.episode-package v1.0)结构与类型校验
 *
 * - packageJsonSchema:与 docs/superpowers/specs/episode-package.schema.json 同构的
 *   JSON Schema draft-07 对象,是字段契约的权威文档(供上游 AI 与将来工具使用)。
 * - validatePackageStructure(pkg):纯结构/类型校验,规则为设计文档 §5 的最低门槛;
 *   跨字段引用、唯一性、镜号顺序等业务校验由业务校验器(episodePackageValidator)负责。
 *
 * 设计要点:
 * - 纯函数,无 IO,不依赖数据库;任何输入都不抛异常,违规以 { path, message } 收集返回。
 * - path 采用点路径,数组下标用方括号,如 episode.title、characters[0].variants[1].image_prompt。
 * - characters/scenes/props 缺省视为空数组;出现则必须是数组;storyboards 必填且必须是数组。
 * - 未知字段不报错(前向兼容)。
 */

'use strict';

const PACKAGE_SCHEMA_NAME = 'local-mini-drama.episode-package';
const PACKAGE_SCHEMA_VERSION = '1.0';

const packageJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'local-mini-drama.episode-package',
  title: 'LocalMiniDrama 单集制作包',
  description:
    'LocalMiniDrama 单集制作包协议(schema: local-mini-drama.episode-package, version: 1.0)。' +
    '一个文件只描述一集,必须是 UTF-8 JSON,禁止 Markdown 围栏、注释和尾随逗号。' +
    '结构之外的跨字段引用、唯一性和顺序校验由业务校验器负责(设计文档 §5、§12)。' +
    '未知字段允许存在(前向兼容)。',
  type: 'object',
  required: ['schema', 'version', 'episode', 'storyboards'],
  additionalProperties: true,
  properties: {
    schema: {
      description: '固定字面量,必须是 local-mini-drama.episode-package。',
      const: 'local-mini-drama.episode-package',
    },
    version: {
      description: '协议版本,当前固定为 1.0。',
      const: '1.0',
    },
    generator: {
      description: '可选。生成器元信息,仅用于审计展示。',
      type: 'object',
      additionalProperties: true,
      properties: {
        name: { type: 'string', description: '生成器/工具名称。' },
        model: { type: 'string', description: '模型名称。' },
        generated_at: { type: 'string', description: '生成时间(ISO 8601)。' },
      },
    },
    generation_profile: {
      description: '可选。上游声明的生成画像,导入时仅作参考与一致性警告,不改变导入行为。',
      type: 'object',
      additionalProperties: true,
      properties: {
        video_mode: { type: 'string', description: '视频模式,当前为 multi_reference_r2v。' },
        uses_first_last_frame: {
          type: 'boolean',
          description: '是否首尾帧流程;本协议面向多参考图 Ref2VA,应为 false。',
        },
        max_reference_images: {
          type: 'integer',
          minimum: 1,
          description: '参考图上限;若提供必须是正整数。',
        },
        reference_order: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图顺序,固定为 ["scene", "character_variant", "prop"]。',
        },
      },
    },
    episode: {
      description: '剧集基本信息(设计文档 §5.2)。',
      type: 'object',
      required: ['source_key', 'episode_number', 'title', 'summary'],
      additionalProperties: true,
      properties: {
        source_key: { type: 'string', minLength: 1, description: '必填。文件内稳定标识。' },
        episode_number: {
          type: 'integer',
          minimum: 1,
          description: '必填。正整数;仅用于展示和校验提示,不直接决定落库集号。',
        },
        title: { type: 'string', minLength: 1, description: '必填。剧集标题。' },
        summary: { type: 'string', minLength: 1, description: '必填。故事梗概,导入后写入剧集简介。' },
        script: {
          type: 'string',
          description: '可选。完整剧本文本;缺失时导入器按分镜确定性拼接生成,不调用 AI。',
        },
        duration_target_seconds: { type: 'number', description: '可选。目标时长(秒)。' },
        notes: { type: 'string', description: '可选。备注。' },
      },
    },
    characters: {
      description:
        '人物数组(设计文档 §5.3),缺省视为空数组。人物是剧目级演员表实体,状态(character_variants)挂在其下。',
      type: 'array',
      items: {
        type: 'object',
        required: ['source_key', 'name', 'description', 'variants'],
        additionalProperties: true,
        properties: {
          source_key: {
            type: 'string',
            minLength: 1,
            description: '必填。人物稳定标识,所属项目内唯一。',
          },
          name: { type: 'string', minLength: 1, description: '必填。人物名称。' },
          description: { type: 'string', minLength: 1, description: '必填。人物身份和剧情功能。' },
          voice_profile: { type: 'string', description: '可选。声音特征,当前导入链路忽略。' },
          variants: {
            description: '人物状态数组,至少 1 个。服装、年龄阶段、受伤、伪装等视觉差异都是独立状态。',
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['source_key', 'name', 'description', 'appearance', 'image_prompt'],
              additionalProperties: true,
              properties: {
                source_key: {
                  type: 'string',
                  minLength: 1,
                  description: '必填。状态稳定标识,所属人物内唯一;默认状态建议 char_<人物>_default。',
                },
                name: {
                  type: 'string',
                  minLength: 1,
                  description: '必填。状态名称,如“日常西装”“雨夜受伤”。',
                },
                description: { type: 'string', minLength: 1, description: '必填。状态语义。' },
                appearance: { type: 'string', minLength: 1, description: '必填。稳定外观特征。' },
                image_prompt: {
                  type: 'string',
                  minLength: 1,
                  description: '必填。用于手动生图的提示词;与视频提示词无关。',
                },
                negative_prompt: { type: 'string', description: '可选。负向提示词。' },
                is_default: {
                  type: 'boolean',
                  description: '可选。同一人物最多一个默认状态。',
                },
              },
            },
          },
        },
      },
    },
    scenes: {
      description:
        '场景数组(设计文档 §5.4),缺省视为空数组。昼夜、整洁/破败等差异用不同场景加 state 表达,不设场景变体表;参考图按空镜描述。',
      type: 'array',
      items: {
        type: 'object',
        required: ['source_key', 'name', 'state', 'description', 'image_prompt'],
        additionalProperties: true,
        properties: {
          source_key: {
            type: 'string',
            minLength: 1,
            description: '必填。场景稳定标识,所属项目内唯一。',
          },
          name: { type: 'string', minLength: 1, description: '必填。场景名称。' },
          state: {
            type: 'string',
            minLength: 1,
            description: '必填。场景状态,如“白天营业中”“深夜停电”。',
          },
          description: { type: 'string', minLength: 1, description: '必填。场景描述。' },
          image_prompt: { type: 'string', minLength: 1, description: '必填。生图提示词,空镜、不含剧情人物。' },
          negative_prompt: { type: 'string', description: '可选。负向提示词。' },
        },
      },
    },
    props: {
      description:
        '道具数组(设计文档 §5.5),缺省视为空数组。参考图按主体隔离、无人物、无复杂背景描述。',
      type: 'array',
      items: {
        type: 'object',
        required: ['source_key', 'name', 'description', 'image_prompt'],
        additionalProperties: true,
        properties: {
          source_key: {
            type: 'string',
            minLength: 1,
            description: '必填。道具稳定标识,所属项目内唯一。',
          },
          name: { type: 'string', minLength: 1, description: '必填。道具名称。' },
          description: { type: 'string', minLength: 1, description: '必填。道具描述。' },
          image_prompt: { type: 'string', minLength: 1, description: '必填。生图提示词。' },
          negative_prompt: { type: 'string', description: '可选。负向提示词。' },
        },
      },
    },
    storyboards: {
      description:
        '分镜数组(设计文档 §5.6),必填。字段语义以本 schema 与 episode-package.example.json 为准;' +
        '上游应提供完整动作过程而非静态画面描述,对白保留原语言且不得混入 action。',
      type: 'array',
      items: {
        type: 'object',
        required: [
          'source_key',
          'storyboard_number',
          'title',
          'description',
          'duration_seconds',
          'scene_ref',
          'shot_type',
          'camera_angle',
          'camera_movement',
          'composition',
          'action',
        ],
        additionalProperties: true,
        properties: {
          source_key: {
            type: 'string',
            minLength: 1,
            description: '必填。分镜稳定标识,所属剧集内唯一,建议 sb_01、sb_02 按镜号命名。',
          },
          storyboard_number: {
            type: 'integer',
            minimum: 1,
            description: '必填。镜号,正整数且集内唯一。',
          },
          title: { type: 'string', minLength: 1, description: '必填。分镜标题。' },
          description: { type: 'string', minLength: 1, description: '必填。分镜描述。' },
          duration_seconds: { type: 'number', exclusiveMinimum: 0, description: '必填。时长(秒),正数。' },
          scene_ref: { type: 'string', minLength: 1, description: '必填。引用场景的 source_key。' },
          character_refs: {
            description: '可为空数组。分镜通过它精确关联“人物 + 状态”,不允许只关联人物名称。',
            type: 'array',
            items: {
              type: 'object',
              required: ['character_ref', 'variant_ref', 'sort_order', 'reference_role'],
              additionalProperties: true,
              properties: {
                character_ref: { type: 'string', minLength: 1, description: '必填。人物 source_key。' },
                variant_ref: {
                  type: 'string',
                  minLength: 1,
                  description: '必填。该人物下的状态 source_key,必须属于 character_ref。',
                },
                reference_role: {
                  type: 'string',
                  description: '必填。用途,如 primary、supporting、appearance_only。',
                },
                sort_order: {
                  type: 'number',
                  description: '必填。参考图槽位顺序,同一分镜内唯一。',
                },
                framing_note: {
                  type: 'string',
                  description: '可选。构图说明(如手部特写、背影、侧脸),不属于人物状态。',
                },
              },
            },
          },
          prop_refs: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description: '可为空数组。引用道具 source_key,按参考图顺序排列。',
          },
          shot_type: { type: 'string', description: '必填。景别,如特写、中景、全景。' },
          camera_angle: { type: 'string', description: '必填。镜头角度,如平视、俯视。' },
          camera_movement: { type: 'string', description: '必填。运镜,如固定机位、缓推。' },
          composition: { type: 'string', description: '必填。画面布局与站位。' },
          action: {
            description: '必填。完整动作过程;优先用 start/progression/end 三段表达,而非静态画面描述。',
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                additionalProperties: true,
                properties: {
                  start: { type: 'string', description: '动作开始。' },
                  progression: { type: 'string', description: '动作推进。' },
                  end: { type: 'string', description: '动作结束。' },
                },
              },
            ],
          },
          dialogue: {
            description: '可为空数组。结构化对白,保留原语言;不要把对白混进 action。',
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                speaker: { type: 'string', description: '说话人;缺省视为旁白。' },
                line: { type: 'string', description: '台词原文。' },
                performance: { type: 'string', description: '表演提示。' },
              },
            },
          },
          narration: { type: 'string', description: '可选。旁白。' },
          audio_description: {
            description: '可选。环境音、动作音、人物声和静音要求;字符串或对象均可。',
            oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
          },
          transition: {
            description: '可选。与前后镜头的衔接方式;字符串或对象均可。',
            oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
          },
          image_prompt: { type: 'string', description: '可选。仅用于需要单独生成分镜图时。' },
          universal_segment_text: {
            type: 'string',
            description: '可选。万能提示词草稿,仅作上游建议;生产前需在分镜区域重新生成或确认。',
          },
          notes: { type: 'string', description: '可选。备注。' },
        },
      },
    },
  },
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function pushNonEmptyStringError(errors, path, value) {
  if (!isNonEmptyString(value)) {
    errors.push({ path, message: `${path} 必须为非空字符串` });
  }
}

// 校验“出现则必须是对象”;返回 false 表示已报错、调用方应跳过嵌套校验
function requireObject(errors, path, value) {
  if (!isPlainObject(value)) {
    errors.push({ path, message: `${path} 必须为对象` });
    return false;
  }
  return true;
}

function validateVariant(errors, basePath, variant) {
  if (!requireObject(errors, basePath, variant)) return;
  for (const field of ['source_key', 'name', 'description', 'appearance', 'image_prompt']) {
    pushNonEmptyStringError(errors, `${basePath}.${field}`, variant[field]);
  }
}

function validateCharacter(errors, basePath, character) {
  if (!requireObject(errors, basePath, character)) return;
  for (const field of ['source_key', 'name', 'description']) {
    pushNonEmptyStringError(errors, `${basePath}.${field}`, character[field]);
  }
  if (!Array.isArray(character.variants) || character.variants.length < 1) {
    errors.push({
      path: `${basePath}.variants`,
      message: `${basePath}.variants 必须为至少包含 1 个元素的数组`,
    });
    return;
  }
  character.variants.forEach((variant, index) => {
    validateVariant(errors, `${basePath}.variants[${index}]`, variant);
  });
}

function validateScene(errors, basePath, scene) {
  if (!requireObject(errors, basePath, scene)) return;
  for (const field of ['source_key', 'name', 'state', 'description', 'image_prompt']) {
    pushNonEmptyStringError(errors, `${basePath}.${field}`, scene[field]);
  }
}

function validateProp(errors, basePath, prop) {
  if (!requireObject(errors, basePath, prop)) return;
  for (const field of ['source_key', 'name', 'description', 'image_prompt']) {
    pushNonEmptyStringError(errors, `${basePath}.${field}`, prop[field]);
  }
}

function validateCharacterRef(errors, basePath, ref) {
  if (!requireObject(errors, basePath, ref)) return;
  pushNonEmptyStringError(errors, `${basePath}.character_ref`, ref.character_ref);
  pushNonEmptyStringError(errors, `${basePath}.variant_ref`, ref.variant_ref);
  // sort_order 必须是 number:非法即报错,不做默认值兜底
  if (typeof ref.sort_order !== 'number' || !Number.isFinite(ref.sort_order)) {
    errors.push({ path: `${basePath}.sort_order`, message: `${basePath}.sort_order 必须为 number` });
  }
}

function validateStoryboard(errors, basePath, storyboard) {
  if (!requireObject(errors, basePath, storyboard)) return;
  for (const field of ['source_key', 'title', 'description', 'scene_ref']) {
    pushNonEmptyStringError(errors, `${basePath}.${field}`, storyboard[field]);
  }
  if (!isPositiveInteger(storyboard.storyboard_number)) {
    errors.push({
      path: `${basePath}.storyboard_number`,
      message: `${basePath}.storyboard_number 必须为正整数`,
    });
  }
  if (!isPositiveNumber(storyboard.duration_seconds)) {
    errors.push({
      path: `${basePath}.duration_seconds`,
      message: `${basePath}.duration_seconds 必须为正数`,
    });
  }
  const refs = storyboard.character_refs;
  if (refs === undefined) return; // 缺省视为 []
  if (!Array.isArray(refs)) {
    errors.push({
      path: `${basePath}.character_refs`,
      message: `${basePath}.character_refs 必须为数组`,
    });
    return;
  }
  refs.forEach((ref, index) => {
    validateCharacterRef(errors, `${basePath}.character_refs[${index}]`, ref);
  });
}

const ASSET_ARRAY_VALIDATORS = {
  characters: validateCharacter,
  scenes: validateScene,
  props: validateProp,
};

/**
 * 结构校验:任何输入都不抛异常。
 * @param {*} pkg 待校验的制作包(通常为 JSON.parse 结果)
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string }> }}
 */
function validatePackageStructure(pkg) {
  const errors = [];

  if (!isPlainObject(pkg)) {
    errors.push({ path: '', message: '制作包必须是一个 JSON 对象' });
    return { ok: false, errors };
  }

  if (pkg.schema !== PACKAGE_SCHEMA_NAME) {
    errors.push({ path: 'schema', message: `schema 必须为 "${PACKAGE_SCHEMA_NAME}"` });
  }
  if (pkg.version !== PACKAGE_SCHEMA_VERSION) {
    errors.push({ path: 'version', message: `version 必须为 "${PACKAGE_SCHEMA_VERSION}"` });
  }

  if (pkg.generator !== undefined) {
    requireObject(errors, 'generator', pkg.generator);
  }

  if (pkg.generation_profile !== undefined) {
    if (requireObject(errors, 'generation_profile', pkg.generation_profile)) {
      const maxRef = pkg.generation_profile.max_reference_images;
      if (maxRef !== undefined && !isPositiveInteger(maxRef)) {
        errors.push({
          path: 'generation_profile.max_reference_images',
          message: 'generation_profile.max_reference_images 若提供必须为正整数',
        });
      }
    }
  }

  if (pkg.episode === undefined) {
    errors.push({ path: 'episode', message: 'episode 必填' });
  } else if (requireObject(errors, 'episode', pkg.episode)) {
    const episode = pkg.episode;
    for (const field of ['source_key', 'title', 'summary']) {
      pushNonEmptyStringError(errors, `episode.${field}`, episode[field]);
    }
    if (!isPositiveInteger(episode.episode_number)) {
      errors.push({
        path: 'episode.episode_number',
        message: 'episode.episode_number 必须为正整数',
      });
    }
  }

  // characters/scenes/props 缺省视为空数组;出现则必须是数组,逐项校验
  for (const field of ['characters', 'scenes', 'props']) {
    const list = pkg[field];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push({ path: field, message: `${field} 必须为数组` });
      continue;
    }
    list.forEach((item, index) => {
      ASSET_ARRAY_VALIDATORS[field](errors, `${field}[${index}]`, item);
    });
  }

  if (!Array.isArray(pkg.storyboards)) {
    errors.push({ path: 'storyboards', message: 'storyboards 必填且必须为数组' });
  } else {
    pkg.storyboards.forEach((storyboard, index) => {
      validateStoryboard(errors, `storyboards[${index}]`, storyboard);
    });
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  PACKAGE_SCHEMA_NAME,
  PACKAGE_SCHEMA_VERSION,
  packageJsonSchema,
  validatePackageStructure,
};
