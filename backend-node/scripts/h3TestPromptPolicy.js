const CRISP_MOTION_POLICY = 'Crisp high-shutter action rendering. Keep the face, eyes, hair, clothing, body contours, and moving objects sharp in every frame. No motion blur, no temporal smearing, no ghosting, and no double edges.';

function enforceCrispMotionPrompt(value) {
  const prompt = String(value || '').trim();
  const withoutNegativeMentions = prompt.replace(
    /\b(?:no|without|zero|avoid(?:ing)?|forbid(?:den)?(?:\s+any)?)\s+motion blur\b/gi,
    '',
  );
  if (/\bmotion blur\b/i.test(withoutNegativeMentions)) {
    throw new Error('Positive motion blur is forbidden in H3 comparison prompts');
  }
  if (!prompt) return CRISP_MOTION_POLICY;
  if (/sharp in every frame/i.test(prompt) && /no motion blur/i.test(prompt)) return prompt;
  return `${prompt} ${CRISP_MOTION_POLICY}`;
}

module.exports = { CRISP_MOTION_POLICY, enforceCrispMotionPrompt };
