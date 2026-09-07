function sectionContent(prompt, field, orderedFields) {
  const value = String(prompt || '');
  const lower = value.toLowerCase();
  const start = lower.indexOf(field.toLowerCase());
  if (start < 0) return '';
  const contentStart = start + field.length;
  const next = orderedFields
    .map((candidate) => lower.indexOf(candidate.toLowerCase(), contentStart))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return value.slice(contentStart, next == null ? value.length : next).trim();
}

function isNA(value) {
  return /^n\s*\/\s*a[.!]?$/i.test(String(value || '').trim());
}

function dialogueBlocks(prompt) {
  return [...String(prompt || '').matchAll(/<d>\s*\[[^\]]+\]\s*([\s\S]*?)<\/d>/gi)]
    .map((match) => match[1].trim());
}

function spokenUnits(value) {
  if (value == null || !String(value).trim()) return [];
  return String(value).split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    const colon = trimmed.match(/^[^：:]{1,40}[：:]\s*["“]?([\s\S]*?)["”]?$/);
    return (colon ? colon[1] : trimmed).trim();
  }).filter(Boolean);
}

function pushError(errors, code, message, details = {}) {
  if (!errors.some((item) => item.code === code && item.message === message)) {
    errors.push({ code, message, details });
  }
}

function bodyUsesSubjectBoundToPicture(definitions, referenceBody, pictureLabel) {
  return String(definitions || '').split(/\r?\n/).some((line) => {
    if (!line.includes(pictureLabel)) return false;
    const subjectDefinition = line.match(/^\s*(<Subject\s+\d+>)/);
    return Boolean(subjectDefinition && referenceBody.includes(subjectDefinition[1]));
  });
}

function validateH3PromptSemantics(compiledPrompt, context = {}, options = {}) {
  const errors = [];
  const prompt = String(compiledPrompt || '');
  const fields = [
    'subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:',
    'integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:',
  ];
  const soundscape = sectionContent(prompt, 'overall_soundscape:', fields);
  const music = sectionContent(prompt, 'non_diegetic_music:', fields);
  const definitions = sectionContent(prompt, 'subject_definitions:', fields);
  const detailed = sectionContent(prompt, 'detailed_description:', fields);
  const integrated = sectionContent(prompt, 'integrated_multimodal_description:', fields);
  const referenceBody = [detailed, integrated, soundscape, music].filter(Boolean).join('\n');
  const audioEnabled = options.audioEnabled ?? context.audio_enabled ?? true;
  const plan = context.episode?.audio_plan || {};
  const bgmMode = plan.bgm?.mode || 'none';
  const cueMode = context.audio?.music_cue?.mode || (bgmMode === 'per_segment' ? 'inherit' : 'mute');

  if (!audioEnabled) {
    if (!isNA(soundscape) || !isNA(music)) {
      pushError(errors, 'H3_AUDIO_POLICY_MISMATCH', 'audio is disabled, so soundscape and music must both be N/A');
    }
  } else if (bgmMode === 'none' || bgmMode === 'episode_track' || cueMode === 'mute') {
    if (!isNA(music)) {
      pushError(errors, 'H3_AUDIO_POLICY_MISMATCH', `${bgmMode}/${cueMode} forbids non-diegetic music inside this generated clip`);
    }
  } else if (bgmMode === 'per_segment' && !isNA(cueMode) && isNA(music)) {
    pushError(errors, 'H3_AUDIO_POLICY_MISMATCH', `per_segment cue mode ${cueMode} requires a concrete non-diegetic music description`);
  }

  const blocks = dialogueBlocks(prompt);
  const dialogueOwner = context.audio?.speech_override?.dialogue_owner || plan.speech?.dialogue_owner || 'h3_native';
  const narrationOwner = context.audio?.speech_override?.narration_owner || plan.speech?.narration_owner || 'post_tts';
  const dialogue = spokenUnits(context.storyboard?.dialogue);
  const narration = spokenUnits(context.storyboard?.narration);
  if (!audioEnabled && blocks.length) {
    pushError(errors, 'H3_AUDIO_POLICY_MISMATCH', 'audio is disabled, so the H3 prompt cannot contain audible dialogue or narration');
  } else if (audioEnabled && dialogueOwner === 'h3_native') {
    const missing = dialogue.filter((unit) => !blocks.some((block) => block.includes(unit)));
    if (missing.length) pushError(errors, 'H3_DIALOGUE_MISMATCH', 'native H3 dialogue must preserve every owned line in its original language', { missing });
  } else if (audioEnabled && dialogue.length && blocks.some((block) => dialogue.some((unit) => block.includes(unit)))) {
    pushError(errors, 'H3_SPEECH_OWNERSHIP_MISMATCH', `dialogue owner ${dialogueOwner} forbids audible H3 dialogue`, { owner: dialogueOwner });
  }
  if (audioEnabled && narrationOwner === 'h3_native') {
    const missing = narration.filter((unit) => !blocks.some((block) => block.includes(unit)));
    if (missing.length) pushError(errors, 'H3_DIALOGUE_MISMATCH', 'native H3 narration must preserve every owned line in its original language', { missing });
  } else if (audioEnabled && narration.length && blocks.some((block) => narration.some((unit) => block.includes(unit)))) {
    pushError(errors, 'H3_SPEECH_OWNERSHIP_MISMATCH', `narration owner ${narrationOwner} forbids audible H3 narration`, { owner: narrationOwner });
  }

  const referenceProblems = [];
  const allowedPictureLabels = new Set();
  const allowedAudioLabels = new Set();
  for (const reference of context.references || []) {
    if (reference.image_url) allowedPictureLabels.add(`Picture ${Number(reference.slot)}`);
    if (reference.audio_url && reference.audio_label) allowedAudioLabels.add(String(reference.audio_label).trim());
  }
  for (const match of prompt.matchAll(/<(Picture|Video|Audio)\s+(\d+)>/gi)) {
    const label = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${Number(match[2])}`;
    const allowed = label.startsWith('Picture ') ? allowedPictureLabels : (label.startsWith('Audio ') ? allowedAudioLabels : new Set());
    if (!allowed.has(label)) referenceProblems.push(`<${label}> has no matching provided reference asset`);
  }
  for (const reference of context.references || []) {
    if (reference.image_url) {
      const pictureLabel = `<Picture ${reference.slot}>`;
      if (!definitions.includes(pictureLabel)) referenceProblems.push(`${pictureLabel} is missing from subject_definitions`);
      if (!referenceBody.includes(pictureLabel)
        && !bodyUsesSubjectBoundToPicture(definitions, referenceBody, pictureLabel)) {
        referenceProblems.push(`${pictureLabel} is missing from the prompt body`);
      }
    }
    if (reference.audio_url && reference.audio_label) {
      const audioLabel = `<${reference.audio_label}>`;
      if (!definitions.includes(audioLabel)) referenceProblems.push(`${audioLabel} is missing from subject_definitions`);
      if (!referenceBody.includes(audioLabel)) referenceProblems.push(`${audioLabel} is missing from the prompt body`);
    }
  }
  if (referenceProblems.length) {
    pushError(errors, 'H3_REFERENCE_SEMANTICS_INVALID', 'reference labels or their semantic bindings are incomplete', { problems: referenceProblems });
  }

  const duration = Number(options.durationSeconds ?? context.storyboard?.duration);
  const times = [...prompt.matchAll(/\[Shot\s+(\d+)\]\s+At\s+(\d{2}):(\d{2}(?:\.\d{1,3})?)/gi)]
    .map((match) => Number(match[2]) * 60 + Number(match[3]));
  if (Number.isFinite(duration) && (times.some((time) => time <= 0 || time >= duration) || times.some((time, index) => index > 0 && time <= times[index - 1]))) {
    pushError(errors, 'H3_TIMELINE_INVALID', 'shot cut times must be strictly increasing and inside the clip duration', { times, duration });
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  dialogueBlocks,
  sectionContent,
  validateH3PromptSemantics,
};
