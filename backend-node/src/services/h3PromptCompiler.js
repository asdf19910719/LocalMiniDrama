const aiClient = require('./aiClient');
const { createH3SkillAgent } = require('./h3SkillAgent');
const { loadSkillPackage } = require('./skillRegistry');
const { validateH3PromptSemantics } = require('./h3PromptSemanticValidator');
const { serializeCanonicalJson } = require('./storyboardAvContractService');

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
  const contextRefs = Array.isArray(input.context?.references)
    ? input.context.references.filter((item) => item && item.image_url)
    : [];
  if (refs.length || contextRefs.length) return 'Ref2VA';
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
  const positions = requiredFields.map((field) => value.toLowerCase().indexOf(field.toLowerCase()));
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    throw new H3PromptError('H3_PROMPT_FORMAT_INVALID', 'H3 prompt sections are not in the required order', { order: requiredFields });
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
  const context = input.context && typeof input.context === 'object' ? input.context : null;
  const contextReferences = context?.references || [];
  const audioBindings = contextReferences
    .filter((item) => item.audio_url && item.audio_label)
    .map((item) => `<${item.audio_label}> = ${item.entity_name || item.entity_type || 'audio reference'} (${item.audio_url})`);
  const visualBindings = contextReferences
    .filter((item) => item.image_url)
    .map((item) => `<Picture ${item.slot}> = ${item.entity_name || item.entity_type || 'visual reference'}; role=${item.reference_role || 'reference'}; variant=${serializeCanonicalJson(item.variant)}; framing_note=${item.framing_note || 'none'}`);
  const speech = context?.episode?.audio_plan?.speech || {};
  const dialogueOwner = context?.audio?.speech_override?.dialogue_owner || speech.dialogue_owner;
  const narrationOwner = context?.audio?.speech_override?.narration_owner || speech.narration_owner;
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
    context ? `GENERATION_CONTEXT_V1: ${serializeCanonicalJson(context)}` : null,
    context ? `AUDIO_ENABLED: ${(input.audioEnabled ?? context.audio_enabled ?? true) ? 'true' : 'false'}` : null,
    context && (input.audioEnabled ?? context.audio_enabled ?? true) === false
      ? 'AUDIO_DISABLED_RULE: Generate no audible dialogue, narration, singing, ambience, effects, or music. Set overall_soundscape and non_diegetic_music to N/A.'
      : null,
    context ? `AUDIO_PLAN: ${serializeCanonicalJson(context.episode?.audio_plan || {})}` : null,
    context ? `AUDIO_DESCRIPTION: ${serializeCanonicalJson(context.audio || {})}` : null,
    context ? `TRANSITION_PLAN: ${serializeCanonicalJson(context.transition)}` : null,
    visualBindings.length ? `REFERENCE_VISUAL_BINDINGS:\n${visualBindings.join('\n')}` : null,
    audioBindings.length ? `REFERENCE_AUDIO_BINDINGS:\n${audioBindings.join('\n')}` : null,
    context && dialogueOwner !== 'h3_native' && narrationOwner !== 'h3_native'
      ? 'SPEECH_OWNERSHIP: Do not generate audible dialogue, narration, or singing. Keep mouths closed when the business prompt implies speech; post-production owns language audio.'
      : null,
    context ? 'H3_SECTION_RULES: Preserve the official section order. Every provided <Picture N> or <Audio N> label must appear in subject_definitions and again in the applicable prompt body; never invent a <Picture N>, <Video N>, or <Audio N> label without a supplied asset. Put exact native-owned dialogue/narration in the relevant [Shot N] using <d>[Language] ...</d>. Put synchronized effects and audio bridges in detailed_description; summarize only ambience, physical sounds, and non-verbal vocals in overall_soundscape; put audience-only score exclusively in non_diegetic_music.' : null,
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
        if (input.context) {
          const semantics = validateH3PromptSemantics(output, input.context, {
            durationSeconds,
            audioEnabled: input.audioEnabled,
          });
          if (!semantics.ok) {
            const first = semantics.errors[0];
            throw new H3PromptError(first.code, first.message, { errors: semantics.errors });
          }
        }
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
