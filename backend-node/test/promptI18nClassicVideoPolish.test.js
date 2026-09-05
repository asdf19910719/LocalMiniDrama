const test = require('node:test');
const assert = require('node:assert/strict');
const promptI18n = require('../src/services/promptI18n');
const { getPromptDefinitions } = require('../src/routes/promptOverrides');

const OVERRIDE_KEY = 'classic_video_polish';

test('getClassicVideoPromptPolishPrompt returns a non-empty system prompt with core duties', () => {
  const p = promptI18n.getClassicVideoPromptPolishPrompt();
  assert.equal(typeof p, 'string');
  assert.ok(p.length > 200, `prompt too short: ${p.length}`);
  // 核心职责契约：信息保真、首帧一致性、输出格式锁定
  assert.ok(p.includes('信息保真'), 'must require information parity');
  assert.ok(p.includes('首帧'), 'must anchor on first frame reference');
  assert.ok(p.includes('=VideoRatio'), 'locked suffix must keep =VideoRatio rule');
});

test('classic video polish prompt is overridable via prompt override cache', () => {
  try {
    promptI18n.setOverrideInMemory(OVERRIDE_KEY, '自定义润色规则正文。');
    const p = promptI18n.getClassicVideoPromptPolishPrompt();
    assert.ok(p.startsWith('自定义润色规则正文。'), 'override body should be used');
    assert.ok(p.includes('=VideoRatio'), 'locked suffix must survive override');
  } finally {
    promptI18n.clearOverrideInMemory(OVERRIDE_KEY);
  }
  const restored = promptI18n.getClassicVideoPromptPolishPrompt();
  assert.ok(!restored.startsWith('自定义润色规则正文。'), 'override should be cleared');
});

test('default body and locked suffix are exposed for the prompt editor', () => {
  const body = promptI18n.getDefaultPromptBody(OVERRIDE_KEY);
  const suffix = promptI18n.getLockedSuffix(OVERRIDE_KEY);
  assert.ok(body && body.length > 100, 'editable default body must exist');
  assert.ok(suffix && suffix.includes('=VideoRatio'), 'locked suffix must exist');
  // 运行时结果 = 默认正文 + 锁定后缀
  const runtime = promptI18n.getClassicVideoPromptPolishPrompt();
  assert.equal(runtime, body + suffix);
});

test('prompt editor definitions include classic video polish', () => {
  const defs = getPromptDefinitions();
  const def = defs.find((d) => d.key === OVERRIDE_KEY);
  assert.ok(def, `PROMPT_META must include ${OVERRIDE_KEY}`);
  assert.ok(def.label && def.label.length > 0);
  assert.equal(def.default_body, promptI18n.getDefaultPromptBody(OVERRIDE_KEY));
  assert.equal(def.locked_suffix, promptI18n.getLockedSuffix(OVERRIDE_KEY));
});
