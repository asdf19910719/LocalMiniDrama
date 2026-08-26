const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_ROOT = path.resolve(__dirname, '../../skills');
const MAX_RESOURCE_BYTES = 512 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const BASE_MODES = new Set(['T2VA', 'I2VA', 'FL2VA', 'L2VA']);
const ALLOWLIST = Object.freeze({
  'h3-prompt-writing': Object.freeze({
    directory: 'h3-prompt-writing',
  }),
});

class SkillRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'SkillRegistryError';
    this.code = code;
    this.details = details;
  }
}

function safeResourcePath(skillDirectory, resourceName) {
  const root = path.resolve(SKILL_ROOT);
  const resolved = path.resolve(root, skillDirectory, resourceName);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new SkillRegistryError('SKILL_RESOURCE_INVALID', 'Skill resource escapes the configured root');
  }
  return resolved;
}

function readResource(skillDirectory, resourceName) {
  const filePath = safeResourcePath(skillDirectory, resourceName);
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (error) {
    throw new SkillRegistryError('SKILL_RESOURCE_MISSING', `Skill resource is unavailable: ${resourceName}`, {
      resourceName,
      cause: error.code || error.message,
    });
  }
  if (buffer.byteLength > MAX_RESOURCE_BYTES) {
    throw new SkillRegistryError('SKILL_PACKAGE_TOO_LARGE', `Skill resource exceeds the byte limit: ${resourceName}`);
  }
  return Object.freeze({ name: resourceName, content: buffer.toString('utf8') });
}

function loadSkillPackage(skillName, { mode } = {}) {
  const entry = Object.prototype.hasOwnProperty.call(ALLOWLIST, skillName) ? ALLOWLIST[skillName] : null;
  if (!entry) {
    throw new SkillRegistryError('SKILL_NOT_ALLOWLISTED', `Skill is not allowlisted: ${String(skillName)}`);
  }
  const guide = mode === 'Ref2VA'
    ? 'references/ref-en.txt'
    : BASE_MODES.has(mode) ? 'references/base-en.txt' : null;
  if (!guide) {
    throw new SkillRegistryError('SKILL_RESOURCE_INVALID', `Unsupported H3 skill mode: ${String(mode)}`);
  }
  const resources = Object.freeze([
    readResource(entry.directory, 'SKILL.md'),
    readResource(entry.directory, guide),
  ]);
  const canonical = resources
    .map(({ name, content }) => `${name}\n${Buffer.byteLength(content, 'utf8')}\n${content}`)
    .join('\n');
  if (Buffer.byteLength(canonical, 'utf8') > MAX_PACKAGE_BYTES) {
    throw new SkillRegistryError('SKILL_PACKAGE_TOO_LARGE', 'Skill package exceeds the byte limit');
  }
  return Object.freeze({
    skillName,
    sha256: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'),
    resources,
  });
}

module.exports = {
  SkillRegistryError,
  loadSkillPackage,
};
