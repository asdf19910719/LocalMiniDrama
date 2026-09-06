'use strict';

const PACKAGE_PROJECTION_REGISTRY = Object.freeze({
  root: Object.freeze({
    schema: 'audit_only', version: 'audit_only', generator: 'persisted', generation_profile: 'persisted',
    audio_plan: 'persisted', episode: 'persisted', characters: 'persisted', scenes: 'persisted', props: 'persisted', storyboards: 'persisted',
  }),
  episode: Object.freeze({
    source_key: 'persisted', episode_number: 'audit_only', title: 'persisted', summary: 'persisted', script: 'persisted',
    duration_target_seconds: 'persisted', notes: 'persisted',
  }),
  character: Object.freeze({
    source_key: 'persisted', name: 'persisted', role: 'persisted', description: 'persisted', personality: 'persisted',
    appearance: 'derived', image_prompt: 'derived', negative_prompt: 'derived', voice_profile: 'persisted', variants: 'persisted',
  }),
  variant: Object.freeze({
    source_key: 'persisted', name: 'persisted', description: 'persisted', appearance: 'persisted', image_prompt: 'persisted',
    negative_prompt: 'persisted', is_default: 'persisted',
  }),
  scene: Object.freeze({
    source_key: 'persisted', name: 'persisted', state: 'persisted', description: 'persisted', atmosphere: 'persisted',
    image_prompt: 'persisted', negative_prompt: 'persisted',
  }),
  prop: Object.freeze({
    source_key: 'persisted', name: 'persisted', type: 'persisted', description: 'persisted', image_prompt: 'persisted', negative_prompt: 'persisted',
  }),
  storyboard: Object.freeze({
    source_key: 'persisted', storyboard_number: 'persisted', title: 'persisted', description: 'persisted', duration_seconds: 'persisted',
    scene_ref: 'persisted', character_refs: 'persisted', prop_refs: 'persisted', shot_type: 'persisted', camera_angle: 'persisted',
    camera_movement: 'persisted', composition: 'persisted', action: 'persisted', dialogue: 'persisted', narration: 'persisted',
    is_primary: 'persisted', audio_description: 'persisted', transition: 'persisted', image_prompt: 'persisted',
    universal_segment_text: 'persisted', notes: 'persisted',
  }),
  characterRef: Object.freeze({
    character_ref: 'persisted', variant_ref: 'persisted', reference_role: 'persisted', sort_order: 'persisted', framing_note: 'persisted',
  }),
});

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createProjectionReport() {
  return {
    version: 1,
    created: [],
    reused: [],
    derived_fields: [],
    missing_fields: [],
    audit_only_fields: [],
    warnings: [],
    projection: { status: 'pending' },
  };
}

function recordMissing(report, path, code, message) {
  report.missing_fields.push({ path, code });
  report.warnings.push({ code, path, message });
}

function recordUnknownFields(report, value, registry, basePath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(registry, key)) {
      report.audit_only_fields.push({ path: basePath ? `${basePath}.${key}` : key, value: fieldValue });
    }
  }
}

function collectAuditOnlyFields(pkg, report) {
  recordUnknownFields(report, pkg, PACKAGE_PROJECTION_REGISTRY.root, '');
  recordUnknownFields(report, pkg.episode, PACKAGE_PROJECTION_REGISTRY.episode, 'episode');
  (pkg.characters || []).forEach((item, index) => {
    recordUnknownFields(report, item, PACKAGE_PROJECTION_REGISTRY.character, `characters[${index}]`);
    (item.variants || []).forEach((variant, variantIndex) => {
      recordUnknownFields(report, variant, PACKAGE_PROJECTION_REGISTRY.variant, `characters[${index}].variants[${variantIndex}]`);
    });
  });
  (pkg.scenes || []).forEach((item, index) => recordUnknownFields(report, item, PACKAGE_PROJECTION_REGISTRY.scene, `scenes[${index}]`));
  (pkg.props || []).forEach((item, index) => recordUnknownFields(report, item, PACKAGE_PROJECTION_REGISTRY.prop, `props[${index}]`));
  (pkg.storyboards || []).forEach((item, index) => {
    recordUnknownFields(report, item, PACKAGE_PROJECTION_REGISTRY.storyboard, `storyboards[${index}]`);
    (item.character_refs || []).forEach((ref, refIndex) => {
      recordUnknownFields(report, ref, PACKAGE_PROJECTION_REGISTRY.characterRef, `storyboards[${index}].character_refs[${refIndex}]`);
    });
  });
  report.audit_only_fields.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function normalizePackageForProjection(pkg) {
  const normalizedPackage = JSON.parse(JSON.stringify(pkg || {}));
  const report = createProjectionReport();

  (normalizedPackage.characters || []).forEach((character, index) => {
    const variants = Array.isArray(character.variants) ? character.variants : [];
    const defaultVariant = variants.find((item) => item && item.is_default === true) || variants[0] || null;
    const variantIndex = defaultVariant ? variants.indexOf(defaultVariant) : -1;
    for (const field of ['appearance', 'image_prompt', 'negative_prompt']) {
      if (!hasText(character[field]) && hasText(defaultVariant?.[field])) {
        character[field] = defaultVariant[field];
        report.derived_fields.push({
          source: `characters[${index}].variants[${variantIndex}].${field}`,
          target: `characters[${index}].${field}`,
          rule: 'default_variant_fallback',
        });
      }
    }
    if (!hasText(character.role)) {
      character.role = null;
      recordMissing(report, `characters[${index}].role`, 'CHARACTER_ROLE_MISSING', '源文件未提供角色类型，未进行推断');
    }
    if (!hasText(character.personality)) {
      character.personality = null;
      recordMissing(report, `characters[${index}].personality`, 'CHARACTER_PERSONALITY_MISSING', '源文件未提供人物性格，未进行推断');
    }
  });

  (normalizedPackage.props || []).forEach((prop, index) => {
    if (!hasText(prop.type)) {
      prop.type = null;
      recordMissing(report, `props[${index}].type`, 'PROP_TYPE_MISSING', '源文件未提供道具类型，未进行推断');
    }
  });

  collectAuditOnlyFields(normalizedPackage, report);
  return { normalizedPackage, report };
}

module.exports = {
  PACKAGE_PROJECTION_REGISTRY,
  createProjectionReport,
  normalizePackageForProjection,
};
