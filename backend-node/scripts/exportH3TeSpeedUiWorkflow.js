#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const CRISP_MOTION_POLICY = 'Crisp high-shutter action rendering. Keep faces, eyes, hair, clothing, body contours, and moving objects sharp in every frame. No motion blur, no temporal smearing, no ghosting, and no double edges.';
const MOTION_BLUR_NEGATIVES = [
  'motion blur',
  'temporal smearing',
  'ghosting',
  'double edges',
  'smeared face',
];

function enforceCrispMotionPrompt(value) {
  const prompt = String(value ?? '').trim();
  const cleaned = prompt
    .replace(/\b(?:natural|cinematic|realistic|strong|heavy|pronounced)\s+motion blur\b[,.]?/gi, 'crisp high-shutter motion')
    .replace(/\bwith\s+motion blur\b[,.]?/gi, 'with crisp high-shutter motion')
    .trim();
  if (/sharp in every frame/i.test(cleaned) && /no motion blur/i.test(cleaned)) return cleaned;
  return cleaned ? `${cleaned} ${CRISP_MOTION_POLICY}` : CRISP_MOTION_POLICY;
}

function appendMotionBlurNegatives(value) {
  const terms = String(value ?? '').split(',').map((term) => term.trim()).filter(Boolean);
  const lowered = new Set(terms.map((term) => term.toLowerCase()));
  for (const term of MOTION_BLUR_NEGATIVES) {
    if (!lowered.has(term.toLowerCase())) terms.push(term);
  }
  return terms.join(', ');
}

function sanitizeDirectorPrompts(director) {
  if (!Array.isArray(director.widgets_values)) return;
  if (typeof director.widgets_values[1] === 'string') {
    director.widgets_values[1] = enforceCrispMotionPrompt(director.widgets_values[1]);
  }

  const timelineIndex = director.widgets_values.findIndex((value) => {
    if (typeof value !== 'string' || !value.trim().startsWith('{')) return false;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && Array.isArray(parsed.segments);
    } catch (_) {
      return false;
    }
  });
  if (timelineIndex < 0) return;

  const timeline = JSON.parse(director.widgets_values[timelineIndex]);
  if (timeline.global && typeof timeline.global.prompt === 'string') {
    timeline.global.prompt = enforceCrispMotionPrompt(timeline.global.prompt);
  }
  for (const segment of timeline.segments) {
    segment.prompt = enforceCrispMotionPrompt(segment.prompt);
    segment.negativePrompt = appendMotionBlurNegatives(segment.negativePrompt);
  }
  director.widgets_values[timelineIndex] = JSON.stringify(timeline);
}

function requireSingle(nodes, type) {
  const matches = nodes.filter((node) => node.type === type);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${type} node, found ${matches.length}`);
  }
  return matches[0];
}

function exportH3TeSpeedUiWorkflow(sourcePath, destinationPath) {
  const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const unet = requireSingle(workflow.nodes, 'UNETLoader');
  const sage = requireSingle(
    workflow.nodes,
    'MiniMaxH3MemoryEfficientSageAttentionPatch',
  );
  const director = requireSingle(workflow.nodes, 'MiniMaxH3Director');

  sanitizeDirectorPrompts(director);

  if (workflow.nodes.some((node) => node.type === 'TESpeedMiniMaxH3')) {
    throw new Error('Source workflow already contains TESpeedMiniMaxH3');
  }

  const unetToSage = workflow.links.find(
    (link) => link[1] === unet.id && link[3] === sage.id && link[5] === 'MODEL',
  );
  const sageToDirector = workflow.links.find(
    (link) => link[1] === sage.id && link[3] === director.id && link[5] === 'MODEL',
  );
  if (!unetToSage || !sageToDirector) {
    throw new Error('Source workflow MODEL chain is not UNET -> Sage -> Director');
  }

  const teNodeId = Math.max(workflow.last_node_id, ...workflow.nodes.map((node) => node.id)) + 1;
  const sageToTeLinkId = Math.max(workflow.last_link_id, ...workflow.links.map((link) => link[0])) + 1;
  const teToDirectorLinkId = sageToTeLinkId + 1;

  workflow.links = workflow.links.filter((link) => link[0] !== sageToDirector[0]);
  workflow.links.push(
    [sageToTeLinkId, sage.id, 0, teNodeId, 0, 'MODEL'],
    [teToDirectorLinkId, teNodeId, 0, director.id, 0, 'MODEL'],
  );

  sage.outputs[0].links = [sageToTeLinkId];
  const directorModelInput = director.inputs.find((input) => input.name === 'model');
  if (!directorModelInput) {
    throw new Error('MiniMaxH3Director has no model input');
  }
  directorModelInput.link = teToDirectorLinkId;

  for (const node of workflow.nodes) {
    if (node.order >= 2) node.order += 1;
  }

  workflow.nodes.push({
    id: teNodeId,
    type: 'TESpeedMiniMaxH3',
    title: 'TE-Speed 开关（默认开启；Ctrl+B 切换启用/旁路）',
    pos: [600, 40],
    size: [340, 174],
    flags: {},
    order: 2,
    mode: 0,
    inputs: [
      {
        localized_name: 'model',
        name: 'model',
        type: 'MODEL',
        link: sageToTeLinkId,
      },
    ],
    outputs: [
      {
        localized_name: 'MODEL',
        name: 'MODEL',
        type: 'MODEL',
        links: [teToDirectorLinkId],
      },
    ],
    properties: {
      'Node name for S&R': 'TESpeedMiniMaxH3',
    },
    widgets_values: [0.08, 0.1, 0.9, 2, 'auto', 'standard'],
  });

  workflow.last_node_id = teNodeId;
  workflow.last_link_id = teToDirectorLinkId;
  workflow.revision = Number.isInteger(workflow.revision) ? workflow.revision + 1 : 1;
  workflow.extra = {
    ...(workflow.extra || {}),
    note: 'MiniMax H3 Director · r2v · SageAttention · original TE-Speed 3.3 · default enabled; select TE-Speed and press Ctrl+B to toggle bypass',
  };

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  return workflow;
}

if (require.main === module) {
  const [sourcePath, destinationPath] = process.argv.slice(2);
  if (!sourcePath || !destinationPath) {
    console.error('Usage: node exportH3TeSpeedUiWorkflow.js <source.json> <destination.json>');
    process.exitCode = 2;
  } else {
    const workflow = exportH3TeSpeedUiWorkflow(sourcePath, destinationPath);
    console.log(JSON.stringify({
      destinationPath: path.resolve(destinationPath),
      lastNodeId: workflow.last_node_id,
      lastLinkId: workflow.last_link_id,
    }));
  }
}

module.exports = {
  CRISP_MOTION_POLICY,
  MOTION_BLUR_NEGATIVES,
  appendMotionBlurNegatives,
  enforceCrispMotionPrompt,
  exportH3TeSpeedUiWorkflow,
};
