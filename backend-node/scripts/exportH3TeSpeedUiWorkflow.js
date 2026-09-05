#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

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
    note: 'MiniMax H3 Director · r2v · SageAttention · original TE-Speed 3.3 experimental',
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

module.exports = { exportH3TeSpeedUiWorkflow };
