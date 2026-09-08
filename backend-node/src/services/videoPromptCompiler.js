const { selectStylePrompt } = require('./promptLanguageResolver');

function clean(value) { return String(value || '').trim(); }
function joinUnique(parts, separator = '\n\n') { return [...new Set(parts.map(clean).filter(Boolean))].join(separator); }

function compileVideoPrompt({ storyboard = {}, basePrompt, negativePrompt, style, language = 'mixed', references, audio = {}, duration } = {}) {
  if (!style?.id || !style?.promptZh || !style?.promptEn) {
    const error = new Error('视频提示词编译缺少有效 StyleSpec');
    error.code = 'PROMPT_COMPILATION_FAILED';
    throw error;
  }
  const seconds = Number(duration || storyboard.duration || 5);
  const refs = references?.entries || [];
  const styleSection = selectStylePrompt(style, language);
  const shotSection = joinUnique([
    basePrompt,
    storyboard.description,
    storyboard.action && `Action: ${storyboard.action}`,
    storyboard.shot_type && `Shot size: ${storyboard.shot_type}`,
    storyboard.angle && `Camera angle: ${storyboard.angle}`,
    storyboard.movement && `Camera movement: ${storyboard.movement}`,
    storyboard.lighting_style && `Lighting: ${storyboard.lighting_style}`,
    storyboard.depth_of_field && `Depth of field: ${storyboard.depth_of_field}`,
  ], '. ');
  const continuitySection = refs.length ? `Reference continuity: ${refs.map((item) => `${item.promptLabel} is ${item.name} (${item.role})`).join('; ')}. Preserve identity, costume, geometry, and color relationships.` : '';
  const timelineSection = joinUnique([
    `[00:00-${String(seconds).padStart(2, '0')}:00] ${shotSection}`,
    storyboard.dialogue && `Dialogue (keep the original language and exact wording): ${storyboard.dialogue}`,
    storyboard.narration && `Narration: ${storyboard.narration}`,
    audio.environment && `Environment sound: ${audio.environment}`,
    audio.effects && `Sound effects: ${audio.effects}`,
    audio.music && `Music direction: ${audio.music}`,
  ]);
  const sections = {
    style: styleSection,
    continuity: continuitySection,
    timeline: timelineSection,
    output: `Duration: ${seconds} seconds. Maintain temporal continuity, physically coherent motion, stable subject identity, and cinematic shot discipline.`,
  };
  const finalPrompt = joinUnique(Object.values(sections));
  const finalNegative = joinUnique([negativePrompt, ...(style.keywords?.negative || []), 'identity drift, costume drift, geometry warping, temporal flicker, duplicated subjects, text, logo, watermark'], ', ');
  return { finalPrompt, negativePrompt: finalNegative, sections, style: { id: style.id, version: style.version }, language, duration: seconds };
}

module.exports = { compileVideoPrompt };
