const aiClient = require('./aiClient');
const { safeParseAIJSON } = require('../utils/safeJson');

function buildCoverageEvents(context = {}) {
  const explicitEvents = Array.isArray(context.audio?.events) && context.audio.events.length
    ? context.audio.events.map((event, index) => ({
      id: event.id || `audio_${index + 1}`,
      source_text: String(event.source_text || ''),
      target_shot: Number(event.target_shot || 1),
      target_field: event.target_field || 'detailed_description',
    }))
    : null;
  const events = explicitEvents || [];
  const eventIds = new Set(events.map((event) => String(event.id)));
  const appendUnique = (event) => {
    const eventId = String(event.id);
    if (eventIds.has(eventId)) return;
    eventIds.add(eventId);
    events.push(event);
  };

  if (!explicitEvents) {
    for (const [index, value] of (context.audio?.ambience || []).entries()) {
      appendUnique({ id: `ambience_${index + 1}`, source_text: String(value), target_shot: 1, target_field: 'overall_soundscape' });
    }
    for (const [index, value] of (context.audio?.sound_effects || []).entries()) {
      appendUnique({ id: `sfx_${index + 1}`, source_text: String(value), target_shot: 1, target_field: 'detailed_description+overall_soundscape' });
    }
    if (context.audio?.diegetic_music) {
      appendUnique({ id: 'diegetic_music_1', source_text: JSON.stringify(context.audio.diegetic_music), target_shot: 1, target_field: 'detailed_description' });
    }
  }
  const audioBridge = context.transition?.audio_bridge;
  const audioBridgeMode = String(audioBridge?.mode || 'none').trim().toLowerCase();
  const bridgeDurationMs = Number(audioBridge?.duration_ms);
  const hasBridgeDuration = Number.isFinite(bridgeDurationMs) && bridgeDurationMs > 0;
  const hasBridgeDescription = Boolean(String(audioBridge?.description || '').trim());
  if (audioBridge && audioBridgeMode !== 'none' && (hasBridgeDuration || hasBridgeDescription)) {
    appendUnique({ id: 'transition_audio_bridge_1', source_text: JSON.stringify(audioBridge), target_shot: 1, target_field: 'detailed_description' });
  }
  const plan = context.episode?.audio_plan || {};
  const cue = context.audio?.music_cue || {};
  if (plan.bgm?.mode === 'per_segment' && cue.mode !== 'mute') {
    const prompt = cue.mode === 'override' || cue.mode === 'stinger'
      ? cue.prompt
      : plan.bgm.prompt;
    if (prompt) {
      appendUnique({
        id: 'non_diegetic_music_1',
        source_text: String(prompt),
        target_shot: 1,
        target_field: 'non_diegetic_music',
      });
    }
  }
  return events;
}

function createH3PromptSemanticReviewService(dependencies = {}) {
  const generateText = dependencies.generateText || (async (db, log, input) => aiClient.generateText(
    db,
    log,
    'text',
    input,
    'Review semantic audio-event coverage across languages. Return strict JSON only and never infer coverage by literal substring matching.',
    { scene_key: 'h3_audio_semantic_review', temperature: 0.1, max_tokens: 1600 },
  ));

  async function reviewH3AudioCoverage(db, log, { compiledPrompt, context } = {}) {
    const sourceEvents = buildCoverageEvents(context);
    if (sourceEvents.length === 0) {
      return { status: 'covered', manifest: { version: 1, events: [] } };
    }
    const input = [
      'For each source event, decide whether the H3 prompt semantically covers it, even when source and prompt use different languages.',
      'Inspect evidence only inside each event\'s target_field. Text elsewhere does not count as coverage. For a compound target_field separated by +, evidence in either named field is acceptable.',
      'Return JSON: {"events":[{"id":"...","target_field":"copy the requested field exactly","canonical_en":"...","status":"covered|missing|uncertain","evidence":"exact evidence from that target field"}]}.',
      `SOURCE_EVENTS: ${JSON.stringify(sourceEvents)}`,
      `H3_PROMPT:\n${String(compiledPrompt || '')}`,
    ].join('\n\n');
    const raw = await generateText(db, log, input);
    const parsed = typeof raw === 'string' ? safeParseAIJSON(raw) : raw;
    const reviewed = Array.isArray(parsed?.events) ? parsed.events : [];
    const byId = new Map(reviewed.map((event) => [String(event.id), event]));
    const events = sourceEvents.map((source) => {
      const result = byId.get(String(source.id));
      const targetFieldMatches = result?.target_field === source.target_field;
      const requestedStatus = ['covered', 'missing', 'uncertain'].includes(result?.status) ? result.status : 'uncertain';
      const status = requestedStatus === 'covered' && (!targetFieldMatches || !String(result?.evidence || '').trim())
        ? 'uncertain'
        : requestedStatus;
      return {
        ...source,
        canonical_en: String(result?.canonical_en || ''),
        status,
        evidence: String(result?.evidence || ''),
      };
    });
    const status = events.some((event) => event.status === 'missing')
      ? 'missing'
      : (events.some((event) => event.status === 'uncertain') ? 'uncertain' : 'covered');
    return { status, manifest: { version: 1, events } };
  }

  return { reviewH3AudioCoverage };
}

const defaultService = createH3PromptSemanticReviewService();

module.exports = {
  buildCoverageEvents,
  createH3PromptSemanticReviewService,
  reviewH3AudioCoverage: defaultService.reviewH3AudioCoverage,
};
