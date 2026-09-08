function normalizeLanguage(value) {
  const language = String(value || '').trim().toLowerCase();
  return ['zh', 'en', 'mixed'].includes(language) ? language : null;
}

function resolvePromptLanguage({ modelConfig = {}, modelCapabilities = {}, style = {} } = {}) {
  return normalizeLanguage(modelConfig.prompt_language)
    || normalizeLanguage(modelCapabilities.promptLanguage)
    || normalizeLanguage(modelCapabilities.prompt_language)
    || normalizeLanguage(style.recommendedCapabilities?.preferredPromptLanguage)
    || 'mixed';
}

function selectStylePrompt(style, language) {
  if (language === 'zh') return style.promptZh;
  if (language === 'en') return style.promptEn;
  return `${style.promptZh}\n\nEnglish style direction: ${style.promptEn}`;
}

module.exports = { resolvePromptLanguage, selectStylePrompt };
