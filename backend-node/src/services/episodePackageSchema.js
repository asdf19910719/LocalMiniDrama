/**
 * 单集制作包(local-mini-drama.episode-package v1.0)结构与类型校验
 *
 * - packageJsonSchema:与 docs/单集制作包导入/制作包schema.json 同构的
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
        contract_profile: {
          enum: ['complete_av_v1'],
          description: '可选。新生成包固定为 complete_av_v1,启用人物与声画字段完整性校验；旧包省略。',
        },
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
    audio_plan: {
      description: '可选仅为兼容旧包；新生成包应始终提供。剧集级声音策略；BGM 只允许关闭、整集后期音轨或逐段生成。',
      type: 'object',
      additionalProperties: true,
      properties: {
        version: { const: 1, description: '声音策略结构版本,当前固定为 1。' },
        bgm: {
          type: 'object',
          additionalProperties: true,
          properties: {
            mode: {
              enum: ['none', 'episode_track', 'per_segment'],
              description: 'none=无 BGM；episode_track=后期整集音轨；per_segment=每段视频由 H3 按 cue 生成。',
            },
            prompt: {
              type: ['string', 'null'],
              minLength: 1,
              description: '剧集统一音乐母题；per_segment 时约束所有分镜的音乐连续性。',
            },
            planning: {
              enum: ['manual', 'ai', 'external'],
              description: '音乐规划来源；外部 AI 已完成规划时使用 external。',
            },
            continuity_key: {
              type: ['string', 'null'],
              minLength: 1,
              description: '跨分镜稳定的音乐连续性键。',
            },
            source_type: {
              enum: ['none', 'local_file', 'media_library', 'generated'],
              description: 'per_segment 通常使用 generated；episode_track 可使用 local_file 或 media_library。',
            },
            local_path: {
              type: ['string', 'null'],
              description: 'episode_track 本地音轨路径；跨机器制作包通常不应依赖此字段。',
            },
            volume_db: { type: 'number', description: 'BGM 基础增益,建议 -22。' },
            ducking_db: { type: 'number', description: '对白/旁白出现时 BGM 压低量,建议 -8。' },
            fade_in_ms: { type: 'number', minimum: 0, description: '整集音轨淡入毫秒数。' },
            fade_out_ms: { type: 'number', minimum: 0, description: '整集音轨淡出毫秒数。' },
            crossfade_ms: {
              type: 'number',
              minimum: 0,
              description: 'per_segment 镜头边界音频交叉淡化毫秒数。',
            },
          },
        },
        mastering: {
          type: 'object',
          additionalProperties: true,
          properties: {
            target_lufs: { type: 'number', description: '最终成片目标综合响度,建议 -14 LUFS。' },
            true_peak_db: { type: 'number', description: '最终成片真峰值上限,建议 -1 dBTP。' },
          },
        },
        speech: {
          type: 'object',
          additionalProperties: true,
          properties: {
            dialogue_owner: {
              enum: ['h3_native', 'post_tts', 'none'],
              description: '对白唯一生产方,防止 H3 与后期 TTS 重复发声。',
            },
            narration_owner: {
              enum: ['h3_native', 'post_tts', 'none'],
              description: '旁白唯一生产方,防止 H3 与后期 TTS 重复发声。',
            },
          },
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
          appearance: { type: 'string', description: '旧包可选,complete_av_v1 新包必填且非空。人物跨状态保持稳定的外观锚点。' },
          image_prompt: { type: 'string', description: '旧包可选,complete_av_v1 新包必填且非空。人物基础生图提示词。' },
          negative_prompt: { type: 'string', description: '旧包可选,complete_av_v1 新包必填且非空。人物级负向提示词。' },
          voice_profile: { type: 'string', description: '旧包可选,complete_av_v1 新包必填且非空。声音特征,导入为角色 voice_style。' },
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
          atmosphere: { type: 'string', description: '可选。场景氛围与声画气质。' },
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
        '分镜数组(设计文档 §5.6),必填。字段语义以本 schema 与 docs/单集制作包导入/制作包示例.json 为准;' +
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
          is_primary: { type: 'boolean', description: '可选。是否为剧情段落主镜头。' },
          audio_description: {
            description: '可选。推荐使用结构化对象；字符串仅用于兼容旧包。旧包对象内部保持宽松，新包由 complete_av_v1 条件校验。',
            oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
          },
          transition: {
            description: '可选。推荐使用结构化对象；字符串仅用于兼容旧包。旧包对象内部保持宽松，新包由 complete_av_v1 条件校验。',
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
  allOf: [
    {
      if: {
        properties: {
          generation_profile: {
            properties: { contract_profile: { const: 'complete_av_v1' } },
            required: ['contract_profile'],
          },
        },
        required: ['generation_profile'],
      },
      then: {
        required: ['audio_plan'],
        properties: {
          audio_plan: {
            required: ['version', 'bgm', 'speech'],
            properties: {
              bgm: {
                required: ['mode', 'planning', 'source_type'],
                allOf: [
                  {
                    if: { properties: { mode: { const: 'per_segment' } }, required: ['mode'] },
                    then: {
                      required: ['prompt', 'continuity_key'],
                      properties: {
                        prompt: { type: 'string', minLength: 1 },
                        continuity_key: { type: 'string', minLength: 1 },
                      },
                    },
                  },
                ],
              },
              speech: { required: ['dialogue_owner', 'narration_owner'] },
            },
          },
          characters: {
            items: {
              required: [
                'source_key', 'name', 'description', 'appearance',
                'image_prompt', 'negative_prompt', 'voice_profile', 'variants',
              ],
              properties: {
                appearance: { type: 'string', minLength: 1 },
                image_prompt: { type: 'string', minLength: 1 },
                negative_prompt: { type: 'string', minLength: 1 },
                voice_profile: { type: 'string', minLength: 1 },
              },
            },
          },
          storyboards: {
            items: {
              required: ['audio_description'],
              properties: {
                audio_description: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    ambience: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                      description: '环境底噪与空间声。',
                    },
                    sound_effects: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } },
                      ],
                      description: '动作音和拟音。',
                    },
                    dialogue_treatment: { type: 'string', description: '对白声学表现和与环境声的层级关系。' },
                    diegetic_music: { description: '画面内有声源的音乐；可用字符串或结构化对象。' },
                    silence: { type: 'boolean', description: '是否要求刻意静音。' },
                    music_cue: {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        mode: {
                          enum: ['inherit', 'override', 'mute', 'stinger'],
                          description: 'inherit=继承剧集母题；override=本镜覆盖；mute=本镜无 BGM；stinger=短促音乐强调。',
                        },
                        prompt: {
                          type: ['string', 'null'],
                          description: 'override 或 stinger 的本镜音乐提示；inherit 可省略。',
                        },
                        intensity: { type: 'number', minimum: 0, maximum: 1 },
                        start: { type: ['string', 'null'], description: '音乐进入方式或时点。' },
                        end: { type: ['string', 'null'], description: '音乐退出方式或时点。' },
                      },
                    },
                    speech_override: {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        dialogue_owner: { enum: ['h3_native', 'post_tts', 'none', null] },
                        narration_owner: { enum: ['h3_native', 'post_tts', 'none', null] },
                      },
                      description: '可选。本镜覆盖剧集级语音归属。',
                    },
                  },
                },
                transition: {
                  oneOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        type: {
                          type: ['string', 'null'],
                          description: '画面转场类型；推荐 cut、dissolve、fade,兼容中文别名。',
                        },
                        duration: { type: 'number', minimum: 0, description: '转场时长(秒)。' },
                        visual_description: { type: ['string', 'null'], description: '额外视觉衔接说明。' },
                        audio_bridge: {
                          type: 'object',
                          additionalProperties: true,
                          properties: {
                            mode: { type: 'string', description: '如 carry、fade、cut。' },
                            duration_ms: { type: 'number', minimum: 0 },
                            description: { type: 'string' },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    {
      if: {
        allOf: [
          {
            properties: {
              generation_profile: {
                properties: { contract_profile: { const: 'complete_av_v1' } },
                required: ['contract_profile'],
              },
            },
            required: ['generation_profile'],
          },
          {
            properties: {
              audio_plan: {
                properties: {
                  bgm: {
                    properties: { mode: { const: 'per_segment' } },
                    required: ['mode'],
                  },
                },
                required: ['bgm'],
              },
            },
            required: ['audio_plan'],
          },
        ],
      },
      then: {
        properties: {
          storyboards: {
            items: {
              properties: {
                audio_description: {
                  type: 'object',
                  required: ['music_cue'],
                  properties: {
                    music_cue: {
                      type: 'object',
                      required: ['mode'],
                      allOf: [
                        {
                          if: { properties: { mode: { enum: ['override', 'stinger'] } }, required: ['mode'] },
                          then: {
                            required: ['prompt'],
                            properties: { prompt: { type: 'string', minLength: 1 } },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
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

function pushOptionalNonEmptyStringError(errors, path, value) {
  if (value !== undefined && !isNonEmptyString(value)) {
    errors.push({ path, message: `${path} 若提供必须为非空字符串` });
  }
}

function pushOptionalNumberError(errors, path, value, { minimum = null } = {}) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || (minimum !== null && value < minimum)) {
    const suffix = minimum === null ? '有限数值' : `不小于 ${minimum} 的有限数值`;
    errors.push({ path, message: `${path} 若提供必须为${suffix}` });
  }
}

function validateStringList(errors, path, value) {
  if (value === undefined) return;
  if (typeof value === 'string') return;
  if (!Array.isArray(value)) {
    errors.push({ path, message: `${path} 必须为字符串或字符串数组` });
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      errors.push({ path: `${path}[${index}]`, message: `${path}[${index}] 必须为字符串` });
    }
  });
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

function validateCharacter(errors, basePath, character, strictNewPackage = false) {
  if (!requireObject(errors, basePath, character)) return;
  for (const field of ['source_key', 'name', 'description']) {
    pushNonEmptyStringError(errors, `${basePath}.${field}`, character[field]);
  }
  for (const field of ['appearance', 'image_prompt', 'negative_prompt', 'voice_profile']) {
    if (strictNewPackage) pushNonEmptyStringError(errors, `${basePath}.${field}`, character[field]);
    else pushOptionalNonEmptyStringError(errors, `${basePath}.${field}`, character[field]);
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

function validateStoryboardAudio(errors, basePath, value, {
  required = false,
  requireMusicCue = false,
  strict = false,
} = {}) {
  if (value === undefined) {
    if (required) errors.push({ path: basePath, message: `${basePath} 必填且必须为对象` });
    return;
  }
  if (typeof value === 'string') {
    if (required) errors.push({ path: basePath, message: `${basePath} 新包必须为结构化对象` });
    return;
  }
  if (!requireObject(errors, basePath, value)) return;
  if (!strict) return;
  validateStringList(errors, `${basePath}.ambience`, value.ambience);
  validateStringList(errors, `${basePath}.sound_effects`, value.sound_effects);
  if (value.dialogue_treatment !== undefined && typeof value.dialogue_treatment !== 'string') {
    errors.push({ path: `${basePath}.dialogue_treatment`, message: `${basePath}.dialogue_treatment 必须为字符串` });
  }
  if (value.silence !== undefined && typeof value.silence !== 'boolean') {
    errors.push({ path: `${basePath}.silence`, message: `${basePath}.silence 必须为 boolean` });
  }
  const cue = value.music_cue;
  if (cue === undefined) {
    if (requireMusicCue) errors.push({ path: `${basePath}.music_cue`, message: `${basePath}.music_cue 必填` });
  } else if (requireObject(errors, `${basePath}.music_cue`, cue)) {
    if (cue.mode === undefined) {
      if (requireMusicCue) errors.push({ path: `${basePath}.music_cue.mode`, message: `${basePath}.music_cue.mode 必填` });
    } else if (!['inherit', 'override', 'mute', 'stinger'].includes(cue.mode)) {
      errors.push({ path: `${basePath}.music_cue.mode`, message: `${basePath}.music_cue.mode 无效` });
    }
    pushOptionalNumberError(errors, `${basePath}.music_cue.intensity`, cue.intensity, { minimum: 0 });
    if (typeof cue.intensity === 'number' && Number.isFinite(cue.intensity) && cue.intensity > 1) {
      const existing = errors.some((item) => item.path === `${basePath}.music_cue.intensity`);
      if (!existing) errors.push({ path: `${basePath}.music_cue.intensity`, message: `${basePath}.music_cue.intensity 不得大于 1` });
    }
    if (requireMusicCue && ['override', 'stinger'].includes(cue.mode)) {
      pushNonEmptyStringError(errors, `${basePath}.music_cue.prompt`, cue.prompt);
    }
    for (const field of ['prompt', 'start', 'end']) {
      if (field === 'prompt' && requireMusicCue && ['override', 'stinger'].includes(cue.mode)) continue;
      const item = cue[field];
      if (item !== undefined && item !== null && typeof item !== 'string') {
        errors.push({ path: `${basePath}.music_cue.${field}`, message: `${basePath}.music_cue.${field} 必须为字符串或 null` });
      }
    }
  }
  if (value.speech_override !== undefined && requireObject(errors, `${basePath}.speech_override`, value.speech_override)) {
    for (const field of ['dialogue_owner', 'narration_owner']) {
      const owner = value.speech_override[field];
      if (owner !== undefined && owner !== null && !['h3_native', 'post_tts', 'none'].includes(owner)) {
        errors.push({ path: `${basePath}.speech_override.${field}`, message: `${basePath}.speech_override.${field} 无效` });
      }
    }
  }
}

function validateStoryboardTransition(errors, basePath, value, { strict = false } = {}) {
  if (value === undefined || typeof value === 'string') return;
  if (!requireObject(errors, basePath, value)) return;
  if (!strict) return;
  if (value.type !== undefined && value.type !== null && typeof value.type !== 'string') {
    errors.push({ path: `${basePath}.type`, message: `${basePath}.type 必须为字符串或 null` });
  }
  pushOptionalNumberError(errors, `${basePath}.duration`, value.duration, { minimum: 0 });
  if (value.visual_description !== undefined && value.visual_description !== null
      && typeof value.visual_description !== 'string') {
    errors.push({ path: `${basePath}.visual_description`, message: `${basePath}.visual_description 必须为字符串或 null` });
  }
  if (value.audio_bridge !== undefined && requireObject(errors, `${basePath}.audio_bridge`, value.audio_bridge)) {
    if (value.audio_bridge.mode !== undefined && typeof value.audio_bridge.mode !== 'string') {
      errors.push({ path: `${basePath}.audio_bridge.mode`, message: `${basePath}.audio_bridge.mode 必须为字符串` });
    }
    pushOptionalNumberError(errors, `${basePath}.audio_bridge.duration_ms`, value.audio_bridge.duration_ms, { minimum: 0 });
    if (value.audio_bridge.description !== undefined && typeof value.audio_bridge.description !== 'string') {
      errors.push({ path: `${basePath}.audio_bridge.description`, message: `${basePath}.audio_bridge.description 必须为字符串` });
    }
  }
}

function validateStoryboard(errors, basePath, storyboard, options = {}) {
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
  if (storyboard.is_primary !== undefined && typeof storyboard.is_primary !== 'boolean') {
    errors.push({ path: `${basePath}.is_primary`, message: `${basePath}.is_primary 必须为 boolean` });
  }
  // 历史协议始终约束外层为 string/object；对象内部由 AV normalizer 宽松归一化。
  // 细粒度类型检查仅属于 complete_av_v1,避免旧包因 null/别名/宽松值被回归拒绝。
  validateStoryboardAudio(errors, `${basePath}.audio_description`, storyboard.audio_description, {
    required: options.strictNewPackage,
    requireMusicCue: options.requireMusicCue,
    strict: options.strictNewPackage,
  });
  validateStoryboardTransition(errors, `${basePath}.transition`, storyboard.transition, {
    strict: options.strictNewPackage,
  });
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

  const strictNewPackage = pkg.generation_profile?.contract_profile === 'complete_av_v1';

  if (pkg.generator !== undefined) {
    requireObject(errors, 'generator', pkg.generator);
  }

  if (pkg.generation_profile !== undefined) {
    if (requireObject(errors, 'generation_profile', pkg.generation_profile)) {
      const contractProfile = pkg.generation_profile.contract_profile;
      if (contractProfile !== undefined && contractProfile !== 'complete_av_v1') {
        errors.push({ path: 'generation_profile.contract_profile', message: 'generation_profile.contract_profile 无效' });
      }
      const maxRef = pkg.generation_profile.max_reference_images;
      if (maxRef !== undefined && !isPositiveInteger(maxRef)) {
        errors.push({
          path: 'generation_profile.max_reference_images',
          message: 'generation_profile.max_reference_images 若提供必须为正整数',
        });
      }
    }
  }

  if (pkg.audio_plan === undefined) {
    if (strictNewPackage) errors.push({ path: 'audio_plan', message: 'complete_av_v1 新包必须提供 audio_plan' });
  } else {
    if (requireObject(errors, 'audio_plan', pkg.audio_plan)) {
      if ((strictNewPackage && pkg.audio_plan.version !== 1)
          || (!strictNewPackage && pkg.audio_plan.version !== undefined && pkg.audio_plan.version !== 1)) {
        errors.push({ path: 'audio_plan.version', message: 'audio_plan.version 必须为 1' });
      }
      const bgm = pkg.audio_plan.bgm;
      if (bgm === undefined) {
        if (strictNewPackage) errors.push({ path: 'audio_plan.bgm', message: 'audio_plan.bgm 必须为对象' });
      } else if (requireObject(errors, 'audio_plan.bgm', bgm)) {
        if ((strictNewPackage || bgm.mode !== undefined)
            && !['none', 'episode_track', 'per_segment'].includes(bgm.mode)) {
          errors.push({ path: 'audio_plan.bgm.mode', message: 'audio_plan.bgm.mode 无效' });
        }
        if ((strictNewPackage || bgm.planning !== undefined)
            && !['manual', 'ai', 'external'].includes(bgm.planning)) {
          errors.push({ path: 'audio_plan.bgm.planning', message: 'audio_plan.bgm.planning 无效' });
        }
        if ((strictNewPackage || bgm.source_type !== undefined)
            && !['none', 'local_file', 'media_library', 'generated'].includes(bgm.source_type)) {
          errors.push({ path: 'audio_plan.bgm.source_type', message: 'audio_plan.bgm.source_type 无效' });
        }
        if (strictNewPackage && bgm.mode === 'per_segment') {
          pushNonEmptyStringError(errors, 'audio_plan.bgm.prompt', bgm.prompt);
          pushNonEmptyStringError(errors, 'audio_plan.bgm.continuity_key', bgm.continuity_key);
        } else {
          for (const field of ['prompt', 'continuity_key']) {
            if (bgm[field] !== undefined && bgm[field] !== null && typeof bgm[field] !== 'string') {
              errors.push({ path: `audio_plan.bgm.${field}`, message: `audio_plan.bgm.${field} 必须为字符串或 null` });
            }
          }
        }
        if (bgm.local_path !== undefined && bgm.local_path !== null && typeof bgm.local_path !== 'string') {
          errors.push({ path: 'audio_plan.bgm.local_path', message: 'audio_plan.bgm.local_path 必须为字符串或 null' });
        }
        for (const field of ['volume_db', 'ducking_db']) {
          pushOptionalNumberError(errors, `audio_plan.bgm.${field}`, bgm[field]);
        }
        for (const field of ['fade_in_ms', 'fade_out_ms', 'crossfade_ms']) {
          pushOptionalNumberError(errors, `audio_plan.bgm.${field}`, bgm[field], { minimum: 0 });
        }
      }
      if (pkg.audio_plan.mastering !== undefined
          && requireObject(errors, 'audio_plan.mastering', pkg.audio_plan.mastering)) {
        for (const field of ['target_lufs', 'true_peak_db']) {
          pushOptionalNumberError(errors, `audio_plan.mastering.${field}`, pkg.audio_plan.mastering[field]);
        }
      }
      const speech = pkg.audio_plan.speech;
      if (speech === undefined) {
        if (strictNewPackage) errors.push({ path: 'audio_plan.speech', message: 'audio_plan.speech 必须为对象' });
      } else if (requireObject(errors, 'audio_plan.speech', speech)) {
        for (const field of ['dialogue_owner', 'narration_owner']) {
          if ((strictNewPackage || speech[field] !== undefined)
              && !['h3_native', 'post_tts', 'none'].includes(speech[field])) {
            errors.push({ path: `audio_plan.speech.${field}`, message: `audio_plan.speech.${field} 无效` });
          }
        }
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
      if (field === 'characters') {
        validateCharacter(errors, `${field}[${index}]`, item, strictNewPackage);
      } else {
        ASSET_ARRAY_VALIDATORS[field](errors, `${field}[${index}]`, item);
      }
    });
  }

  if (!Array.isArray(pkg.storyboards)) {
    errors.push({ path: 'storyboards', message: 'storyboards 必填且必须为数组' });
  } else {
    pkg.storyboards.forEach((storyboard, index) => {
      validateStoryboard(errors, `storyboards[${index}]`, storyboard, {
        strictNewPackage,
        requireMusicCue: strictNewPackage && pkg.audio_plan?.bgm?.mode === 'per_segment',
      });
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
