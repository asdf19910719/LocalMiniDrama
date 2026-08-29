const aiClient = require('./aiClient');
const { createH3SkillAgent } = require('./h3SkillAgent');
const { loadSkillPackage } = require('./skillRegistry');

const COMPILER_VERSION = 'h3-skill-agent-v1';
const BASE_REQUIRED_FIELDS = ['integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:'];
const REF_REQUIRED_FIELDS = [
  'subject_definitions:',
  'summary:',
  'retention_analysis:',
  'detailed_description:',
  'overall_soundscape:',
  'non_diegetic_music:',
];

class H3PromptError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'H3PromptError';
    this.code = code;
    this.details = details;
  }
}

function h3Mode(input = {}) {
  const first = String(input.firstFrameUrl || input.first_frame_url || '').trim();
  const last = String(input.lastFrameUrl || input.last_frame_url || '').trim();
  const refs = Array.isArray(input.referenceUrls || input.reference_urls || input.referenceImageUrls || input.reference_image_urls)
    ? (input.referenceUrls || input.reference_urls || input.referenceImageUrls || input.reference_image_urls).filter(Boolean)
    : [];
  if (refs.length) return 'Ref2VA';
  if (first && last) return 'FL2VA';
  if (first) return 'I2VA';
  if (last) return 'L2VA';
  return 'T2VA';
}

function stripCodeFence(value) {
  return String(value || '').trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function fieldContent(value, field, fields) {
  const lower = value.toLowerCase();
  const start = lower.indexOf(field.toLowerCase());
  if (start < 0) return '';
  const contentStart = start + field.length;
  const next = fields
    .map((candidate) => lower.indexOf(candidate.toLowerCase(), contentStart))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return value.slice(contentStart, next == null ? value.length : next).trim();
}

function validateH3Prompt(prompt, { durationSeconds, mode } = {}) {
  const value = stripCodeFence(prompt);
  if (!value) throw new H3PromptError('H3_PROMPT_EMPTY', 'H3 prompt is empty');
  const requiredFields = mode === 'Ref2VA' ? REF_REQUIRED_FIELDS : BASE_REQUIRED_FIELDS;
  const missing = requiredFields.filter((field) => !value.toLowerCase().includes(field.toLowerCase()));
  const empty = requiredFields.filter((field) => !missing.includes(field) && !fieldContent(value, field, requiredFields));
  if (missing.length || empty.length) {
    throw new H3PromptError('H3_PROMPT_FORMAT_INVALID', `H3 prompt has invalid required fields: ${[...missing, ...empty].join(', ')}`, { missing, empty });
  }
  if (durationSeconds != null && !/\[Shot 1\]/i.test(value)) {
    throw new H3PromptError('H3_PROMPT_TIMELINE_INVALID', 'H3 prompt must contain a [Shot 1] timeline');
  }
  if (mode === 'Ref2VA' && !/<(?:Subject|Picture|Video|Audio)\s+\d+>/i.test(value)) {
    throw new H3PromptError('H3_PROMPT_REFERENCE_INVALID', 'Ref2VA prompt must define at least one reference label');
  }
  return value;
}

function sourceBundle(input, mode) {
  return [
    `MODE: ${mode}`,
    `DURATION_SECONDS: ${Number(input.durationSeconds ?? input.duration) || 5}`,
    `PROMPT: ${String(input.prompt || '').trim()}`,
    input.negativePrompt || input.negative_prompt ? `NEGATIVE_PROMPT: ${input.negativePrompt || input.negative_prompt}` : null,
    input.firstFrameUrl || input.first_frame_url ? `FIRST_FRAME_REFERENCE: ${input.firstFrameUrl || input.first_frame_url}` : null,
    input.lastFrameUrl || input.last_frame_url ? `LAST_FRAME_REFERENCE: ${input.lastFrameUrl || input.last_frame_url}` : null,
    Array.isArray(input.referenceUrls || input.reference_urls || input.referenceImageUrls || input.reference_image_urls)
      && (input.referenceUrls || input.reference_urls || input.referenceImageUrls || input.reference_image_urls).length
      ? `REFERENCE_ASSETS: ${(input.referenceUrls || input.reference_urls || input.referenceImageUrls || input.reference_image_urls).join(', ')}` : null,
    Array.isArray(input.referenceAudios ?? input.reference_audios) && (input.referenceAudios ?? input.reference_audios).length
      ? `REFERENCE_AUDIO: ${(input.referenceAudios ?? input.reference_audios).map((item) => typeof item === 'object' ? (item.characterName || item.audioFile) : item).join(', ')}. The character voice must match the reference audio; lip-sync to the audio when speaking` : null,
  ].filter(Boolean).join('\n');
}

const defaultSkillAgent = createH3SkillAgent({
  createChatCompletion: aiClient.createChatCompletion,
  loadSkillPackage,
});

function createH3PromptCompiler({ skillAgent = defaultSkillAgent } = {}) {
  if (!skillAgent || typeof skillAgent.run !== 'function') throw new Error('H3 prompt compiler requires skillAgent');
  return {
    version: COMPILER_VERSION,
    async compile(db, log, input = {}) {
      const source = String(input.prompt || '').trim();
      if (!source) throw new H3PromptError('H3_SOURCE_PROMPT_EMPTY', 'H3 source prompt is empty');
      const durationSeconds = Number(input.durationSeconds ?? input.duration) || 5;
      const mode = h3Mode(input);
      try {
        const generated = await skillAgent.run(db, log, {
          mode,
          durationSeconds,
          sourceBundle: sourceBundle(input, mode),
        });
        const output = validateH3Prompt(generated?.prompt, { durationSeconds, mode });
        return {
          sourcePrompt: source,
          compiledPrompt: output,
          promptFormat: mode,
          compilerVersion: COMPILER_VERSION,
          skillProvenance: generated?.provenance || null,
        };
      } catch (error) {
        if (error instanceof H3PromptError) throw error;
        if (typeof error?.code === 'string'
          && (error.code.startsWith('H3_SKILL_') || error.code.startsWith('SKILL_'))) {
          throw new H3PromptError(error.code, error.message, error.details || {});
        }
        throw new H3PromptError('H3_PROMPT_COMPILE_FAILED', `H3 prompt compilation failed: ${error.message}`, { cause: error.code || error.message });
      }
    },
    validate(prompt, options) {
      return validateH3Prompt(prompt, options);
    },
  };
}

module.exports = {
  sourceBundle,
  COMPILER_VERSION,
  H3PromptError,
  h3Mode,
  validateH3Prompt,
  createH3PromptCompiler,
};
