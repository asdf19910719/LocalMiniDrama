const test = require('node:test');
const assert = require('node:assert/strict');

const { validateH3PromptSemantics } = require('../src/services/h3PromptSemanticValidator');
const {
  buildCoverageEvents,
  createH3PromptSemanticReviewService,
} = require('../src/services/h3PromptSemanticReviewService');
const { normalizeStoryboardTransition } = require('../src/services/storyboardAvContractService');

function makeContext({
  bgmMode = 'none',
  cueMode = 'mute',
  episodePrompt = null,
  cuePrompt = null,
  audioEnabled = true,
  dialogue = null,
  narration = null,
  dialogueOwner = 'h3_native',
  narrationOwner = 'post_tts',
  references = [],
  sounds = [],
} = {}) {
  return {
    version: 1,
    audio_enabled: audioEnabled,
    storyboard: { duration: 6, dialogue, narration, visual_prompt: 'A door opens.' },
    episode: {
      audio_plan: {
        bgm: { mode: bgmMode, prompt: episodePrompt },
        speech: { dialogue_owner: dialogueOwner, narration_owner: narrationOwner },
      },
    },
    audio: {
      ambience: [],
      sound_effects: sounds.map((item) => item.source_text),
      music_cue: { mode: cueMode, prompt: cuePrompt },
      events: sounds,
    },
    transition: null,
    references,
  };
}

function validH3Prompt({ body = '[Shot 1] A door opens.', soundscape = 'Quiet room tone.', music = 'N/A' } = {}) {
  return [
    'subject_definitions:',
    '<Subject 1> is a doorway.',
    'summary:',
    '[reference generation] The target video follows <Subject 1>.',
    'retention_analysis:',
    '<Subject 1>: fully_preserved - the doorway remains visible.',
    'detailed_description:',
    body,
    `overall_soundscape: ${soundscape}`,
    `non_diegetic_music: ${music}`,
  ].join('\n');
}

test('none and episode_track reject invented non-diegetic music', () => {
  for (const mode of ['none', 'episode_track']) {
    const context = makeContext({ bgmMode: mode });
    const result = validateH3PromptSemantics(validH3Prompt({ music: 'A tense string score.' }), context);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((item) => item.code === 'H3_AUDIO_POLICY_MISMATCH'), true);
  }
});

test('per_segment inherit requires a concrete music description', () => {
  const context = makeContext({ bgmMode: 'per_segment', cueMode: 'inherit', episodePrompt: 'low strings' });
  assert.equal(validateH3PromptSemantics(validH3Prompt({ music: 'N/A' }), context).ok, false);
  assert.equal(validateH3PromptSemantics(validH3Prompt({ music: 'Low strings with a restrained rise.' }), context).ok, true);
});

test('audio disabled requires N/A soundscape and music', () => {
  const context = makeContext({ audioEnabled: false });
  const result = validateH3PromptSemantics(validH3Prompt({ soundscape: 'Rain.', music: 'N/A' }), context);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === 'H3_AUDIO_POLICY_MISMATCH'), true);
});

test('audio disabled overrides native speech ownership without making a silent prompt impossible', () => {
  const context = makeContext({ audioEnabled: false, dialogue: '有人在里面吗？', dialogueOwner: 'h3_native' });
  assert.equal(validateH3PromptSemantics(validH3Prompt({ soundscape: 'N/A', music: 'N/A' }), context).ok, true);
  const audible = validateH3PromptSemantics(validH3Prompt({
    body: '[Shot 1] (S1) says <d>[Chinese] 有人在里面吗？</d>.',
    soundscape: 'N/A', music: 'N/A',
  }), context);
  assert.equal(audible.ok, false);
  assert.equal(audible.errors.some((item) => item.code === 'H3_AUDIO_POLICY_MISMATCH'), true);
});

test('deterministic validator rejects missing native dialogue and reference semantics', () => {
  const context = makeContext({
    dialogue: '有人在里面吗？',
    dialogueOwner: 'h3_native',
    references: [{ slot: 1, entity_name: 'Lin Xia', reference_role: 'character_identity', image_url: '/lin.png' }],
  });
  const result = validateH3PromptSemantics(validH3Prompt({ body: '[Shot 1] A door opens.' }), context);
  const codes = new Set(result.errors.map((item) => item.code));
  assert.equal(codes.has('H3_DIALOGUE_MISMATCH'), true);
  assert.equal(codes.has('H3_REFERENCE_SEMANTICS_INVALID'), true);
});

test('post_tts forbids audible H3 dialogue and prevents duplicate ownership', () => {
  const context = makeContext({ dialogue: '有人在里面吗？', dialogueOwner: 'post_tts' });
  const result = validateH3PromptSemantics(validH3Prompt({
    body: '[Shot 1] (S1) says <d>[Chinese] 有人在里面吗？</d>.',
  }), context);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === 'H3_SPEECH_OWNERSHIP_MISMATCH'), true);
});

test('cross-language sound coverage is reviewed through a manifest, not substring matching', async () => {
  const service = createH3PromptSemanticReviewService({
    generateText: async (_db, _log, input) => {
      assert.match(input, /金属门摩擦声/);
      return JSON.stringify({
        events: [{
          id: 'sfx_1',
          target_field: 'detailed_description',
          canonical_en: 'harsh metallic door scrape',
          status: 'covered',
          evidence: 'harsh metallic scrape',
        }],
      });
    },
  });
  const context = makeContext({ sounds: [{ id: 'sfx_1', source_text: '金属门摩擦声', target_shot: 1 }] });
  const review = await service.reviewH3AudioCoverage({}, {}, {
    context,
    compiledPrompt: validH3Prompt({ body: '[Shot 1] The rusty door produces a harsh metallic scrape.' }),
  });
  assert.equal(review.status, 'covered');
  assert.deepEqual(review.manifest.events[0], {
    id: 'sfx_1',
    source_text: '金属门摩擦声',
    canonical_en: 'harsh metallic door scrape',
    target_shot: 1,
    target_field: 'detailed_description',
    status: 'covered',
    evidence: 'harsh metallic scrape',
  });
});

test('per-segment music intent participates in cross-language coverage review', async () => {
  const service = createH3PromptSemanticReviewService({
    generateText: async (_db, _log, input) => {
      assert.match(input, /克制的低音弦乐/);
      assert.match(input, /non_diegetic_music/);
      return JSON.stringify({ events: [{
        id: 'non_diegetic_music_1', target_field: 'non_diegetic_music', canonical_en: 'restrained low strings', status: 'covered', evidence: 'Low strings',
      }] });
    },
  });
  const context = makeContext({ bgmMode: 'per_segment', cueMode: 'inherit', episodePrompt: '克制的低音弦乐' });
  const review = await service.reviewH3AudioCoverage({}, {}, {
    context,
    compiledPrompt: validH3Prompt({ music: 'Restrained low strings.' }),
  });
  assert.equal(review.status, 'covered');
  assert.equal(review.manifest.events[0].target_field, 'non_diegetic_music');
});

test('zero-duration default transition bridge does not require H3 semantic coverage', () => {
  const context = makeContext();
  context.transition = normalizeStoryboardTransition('硬切');

  assert.deepEqual(buildCoverageEvents(context), []);
});

test('positive-duration transition bridge remains an H3 semantic coverage event', () => {
  const context = makeContext();
  context.transition = {
    audio_bridge: { mode: 'carry', duration_ms: 300 },
  };

  assert.equal(
    buildCoverageEvents(context).some((event) => event.id === 'transition_audio_bridge_1'),
    true,
  );
});

test('positive-duration transition bridge remains covered beside structured audio events', () => {
  const context = makeContext({
    sounds: [{ id: 'sfx_1', source_text: '三下敲门声', target_shot: 1 }],
  });
  context.transition = {
    audio_bridge: { mode: 'carry', duration_ms: 300 },
  };

  assert.deepEqual(
    buildCoverageEvents(context).map((event) => event.id),
    ['sfx_1', 'transition_audio_bridge_1'],
  );
});

test('derived transition bridge does not duplicate an explicit event with the same id', () => {
  const context = makeContext({
    sounds: [{ id: 'transition_audio_bridge_1', source_text: '房间底噪延续', target_shot: 1 }],
  });
  context.transition = {
    audio_bridge: { mode: 'carry', duration_ms: 300 },
  };

  assert.equal(
    buildCoverageEvents(context).filter((event) => event.id === 'transition_audio_bridge_1').length,
    1,
  );
});

test('case-insensitive none transition bridge never creates a coverage event', () => {
  const context = makeContext();
  context.transition = {
    audio_bridge: { mode: ' NONE ', duration_ms: 300 },
  };

  assert.equal(
    buildCoverageEvents(context).some((event) => event.id === 'transition_audio_bridge_1'),
    false,
  );
});

test('reference labels must be supplied and appear in definitions plus body', () => {
  const context = makeContext({
    references: [{ slot: 1, entity_name: 'Lin Xia', reference_role: 'character_identity', image_url: '/lin.png' }],
  });
  const valid = validH3Prompt({ body: '[Shot 1] <Picture 1> anchors Lin Xia character identity.' })
    .replace('<Subject 1> is a doorway.', '<Subject 1> is Lin Xia from <Picture 1>; role character identity.');
  assert.equal(validateH3PromptSemantics(valid, context).ok, true);
  const dangling = `${valid}\n<Video 9> performs a camera move.`;
  const result = validateH3PromptSemantics(dangling, context);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.errors), /Video 9.*no matching provided reference asset/);
});

test('reference labels remain valid when Chinese metadata is described semantically in English', () => {
  const context = makeContext({
    references: [{
      slot: 1,
      entity_name: '酒店走廊·凌晨安静状态',
      reference_role: '环境定性参考',
      image_url: '/hotel-corridor.png',
    }],
  });
  const prompt = validH3Prompt({
    body: '[Shot 1] <Picture 1> anchors the dim hotel corridor environment and warm wall lighting.',
  }).replace(
    '<Subject 1> is a doorway.',
    '<Subject 1> is the dim hotel corridor environment defined by <Picture 1>.',
  );

  assert.equal(validateH3PromptSemantics(prompt, context).ok, true);
});

test('picture reference remains valid when its bound subject is used in the prompt body', () => {
  const context = makeContext({
    references: [{
      slot: 1,
      entity_name: '酒店走廊',
      reference_role: 'environment_reference',
      image_url: '/hotel-corridor.png',
    }],
  });
  const prompt = validH3Prompt({
    body: '[Shot 1] <Subject 1> is shown as a dim hotel corridor while the camera slowly pushes forward.',
  }).replace(
    '<Subject 1> is a doorway.',
    '<Subject 1> is the dim hotel corridor environment defined by <Picture 1>.',
  );

  assert.equal(validateH3PromptSemantics(prompt, context).ok, true);
});

test('picture reference remains invalid when neither it nor its bound subject is used in the prompt body', () => {
  const context = makeContext({
    references: [{ slot: 1, entity_name: '酒店走廊', image_url: '/hotel-corridor.png' }],
  });
  const prompt = validH3Prompt({
    body: '[Shot 1] An unrelated <Subject 2> crosses the frame.',
  }).replace(
    '<Subject 1> is a doorway.',
    '<Subject 1> is the dim hotel corridor environment defined by <Picture 1>.',
  );

  const result = validateH3PromptSemantics(prompt, context);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.errors), /Picture 1.*missing from the prompt body/);
});

test('picture mention outside a subject definition cannot create an indirect binding', () => {
  const context = makeContext({
    references: [{ slot: 1, entity_name: '酒店走廊', image_url: '/hotel-corridor.png' }],
  });
  const prompt = validH3Prompt({
    body: '[Shot 1] <Subject 1> fills the frame.',
  }).replace(
    '<Subject 1> is a doorway.',
    'Note: <Picture 1> maps to <Subject 1>, but this is not a subject definition.',
  );

  const result = validateH3PromptSemantics(prompt, context);

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.errors), /Picture 1.*missing from the prompt body/);
});

test('semantic review cannot claim coverage from the wrong section', async () => {
  const service = createH3PromptSemanticReviewService({
    generateText: async () => JSON.stringify({ events: [{
      id: 'sfx_1', target_field: 'overall_soundscape', canonical_en: 'door scrape', status: 'covered', evidence: 'door scrape',
    }] }),
  });
  const review = await service.reviewH3AudioCoverage({}, {}, {
    context: makeContext({ sounds: [{ id: 'sfx_1', source_text: '门响', target_field: 'detailed_description' }] }),
    compiledPrompt: validH3Prompt({ body: '[Shot 1] The door scrapes.' }),
  });
  assert.equal(review.status, 'uncertain');
});
