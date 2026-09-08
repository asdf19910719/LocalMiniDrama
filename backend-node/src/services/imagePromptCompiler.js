const { selectStylePrompt } = require('./promptLanguageResolver');

const MODE_DIRECTIONS = {
  character: {
    TURNAROUND: { zh: '角色设定转面图：同一人物，正面、侧面、背面与三分之四视角，统一服装、五官、发型和比例，纯净背景。', en: 'Character turnaround sheet: the same person shown from front, profile, back, and three-quarter views, with identical face, hair, costume, proportions, and a clean background.' },
    SINGLE: { zh: '单张角色资产图：主体完整清晰，轮廓可读，身份特征稳定。', en: 'Single character asset: complete readable subject, clear silhouette, and stable identity.' },
  },
  character_variant: {
    SINGLE: { zh: '人物状态资产图：保持原人物身份，只改变指定服装、状态或情绪。', en: 'Character variant asset: preserve the original identity and change only the requested costume, state, or emotion.' },
    TURNAROUND: { zh: '人物状态转面图：保持原人物身份与指定状态，展示正面、侧面、背面与三分之四视角，所有视角的五官、发型、服装和比例一致。', en: 'Character variant turnaround sheet: preserve the original identity and requested state across front, profile, back, and three-quarter views with identical face, hair, costume, and proportions.' },
  },
  scene: {
    NORMAL: { zh: '单张场景资产图：空间关系明确，环境完整，无人物抢占主体。', en: 'Single environment asset: clear spatial relationships, complete location design, and no character dominating the scene.' },
    MULTI_VIEW: { zh: '同一场景多视角设定图：保持建筑、陈设、材质和光源位置一致。', en: 'Multi-view environment sheet: preserve identical architecture, furnishings, materials, and light positions across views.' },
    PANORAMA: { zh: '全景场景：宽广建立镜头，展示完整空间层级、前中后景和叙事动线。', en: 'Panoramic environment: a wide establishing view showing complete spatial layers, foreground, midground, background, and narrative paths.' },
    TOP_DOWN: { zh: '俯视场景：高位或正顶视角，清晰展示平面布局、出入口、人物动线和物件位置。', en: 'Top-down environment: high-angle or overhead view clearly showing floor plan, entrances, movement paths, and object placement.' },
  },
  prop: {
    SINGLE: { zh: '道具资产图：单一物件居中，结构、材质、磨损和关键细节清晰，背景干净。', en: 'Prop asset: one centered object with clear construction, material, wear, and key details on a clean background.' },
  },
  storyboard: {
    FRAME: { zh: '电影分镜帧：明确景别、机位、构图、人物调度、动作瞬间和叙事焦点。', en: 'Cinematic storyboard frame: explicit shot size, camera position, composition, blocking, action beat, and narrative focus.' },
  },
};

function clean(value) { return String(value || '').trim(); }
function unique(parts) { return [...new Set(parts.map(clean).filter(Boolean))]; }

function compileImagePrompt({ targetType, mode, basePrompt, negativePrompt, style, language = 'mixed', references } = {}) {
  if (!style?.id || !style?.promptZh || !style?.promptEn) {
    const error = new Error('图片提示词编译缺少有效 StyleSpec');
    error.code = 'PROMPT_COMPILATION_FAILED';
    throw error;
  }
  const normalizedMode = String(mode || (targetType === 'storyboard' ? 'FRAME' : 'SINGLE')).toUpperCase();
  const direction = MODE_DIRECTIONS[targetType]?.[normalizedMode];
  if (!direction) {
    const error = new Error(`不支持的图片目标或模式: ${targetType}/${normalizedMode}`);
    error.code = 'PROMPT_MODE_UNSUPPORTED';
    throw error;
  }
  const stylePrompt = selectStylePrompt(style, language);
  const base = clean(basePrompt)
    .replace(clean(style.promptZh), '')
    .replace(clean(style.promptEn), '')
    .trim();
  const modePrompt = language === 'zh' ? direction.zh : language === 'en' ? direction.en : `${direction.zh}\n${direction.en}`;
  const refEntries = references?.entries || [];
  const referencePrompt = refEntries.length
    ? (language === 'en' ? `Reference bindings: ${refEntries.map((item) => `${item.promptLabel}=${item.name}`).join('; ')}.` : `参考图绑定：${refEntries.map((item) => `${item.promptLabel}=${item.name}`).join('；')}。`)
    : '';
  const sections = { style: stylePrompt, mode: modePrompt, subject: base, references: referencePrompt };
  const finalPrompt = unique([sections.style, sections.mode, sections.subject, sections.references]).join('\n\n');
  const negative = unique([negativePrompt, ...(style.keywords?.negative || [])]).join(', ');
  return { finalPrompt, negativePrompt: negative || null, sections, style: { id: style.id, version: style.version }, language, targetType, mode: normalizedMode };
}

module.exports = { compileImagePrompt, MODE_DIRECTIONS };
