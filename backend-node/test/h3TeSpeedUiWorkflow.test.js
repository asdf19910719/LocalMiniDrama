const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  exportH3TeSpeedUiWorkflow,
} = require('../scripts/exportH3TeSpeedUiWorkflow');

function sourceWorkflow() {
  const timeline = {
    version: 4,
    global: { prompt: 'A cinematic chase with natural motion blur.' },
    segments: [{
      prompt: 'A fast sword swing with cinematic motion blur.',
      negativePrompt: 'identity drift',
    }],
  };
  return {
    last_node_id: 11,
    last_link_id: 13,
    revision: 1,
    nodes: [
      {
        id: 1, type: 'UNETLoader', order: 0, outputs: [{ name: 'MODEL', type: 'MODEL', links: [12] }],
      },
      {
        id: 11, type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', order: 1,
        inputs: [{ name: 'model', type: 'MODEL', link: 12 }],
        outputs: [{ name: 'MODEL', type: 'MODEL', links: [13] }],
      },
      {
        id: 5, type: 'MiniMaxH3Director', order: 2,
        inputs: [{ name: 'model', type: 'MODEL', link: 13 }],
        outputs: [],
        widgets_values: [
          'r2v',
          'A cinematic chase with natural motion blur.',
          'sampling',
          1,
          42,
          'fixed',
          24,
          1280,
          736,
          1280,
          123,
          JSON.stringify(timeline),
        ],
      },
    ],
    links: [
      [12, 1, 0, 11, 0, 'MODEL'],
      [13, 11, 0, 5, 0, 'MODEL'],
    ],
  };
}

describe('H3 TE-Speed UI workflow exporter', () => {
  test('adds a default-on native bypass switch and bans motion blur in every prompt', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-te-ui-'));
    const sourcePath = path.join(directory, 'source.json');
    const destinationPath = path.join(directory, 'destination.json');
    fs.writeFileSync(sourcePath, JSON.stringify(sourceWorkflow()), 'utf8');

    const workflow = exportH3TeSpeedUiWorkflow(sourcePath, destinationPath);
    const teNode = workflow.nodes.find((node) => node.type === 'TESpeedMiniMaxH3');
    const director = workflow.nodes.find((node) => node.type === 'MiniMaxH3Director');
    const timeline = JSON.parse(director.widgets_values[11]);
    const serialized = JSON.stringify(workflow);

    assert.equal(teNode.mode, 0);
    assert.match(teNode.title, /TE-Speed.*开关.*Ctrl\+B/i);
    assert.equal(director.inputs.find((input) => input.name === 'model').link, teNode.outputs[0].links[0]);
    assert.doesNotMatch(serialized, /(?:natural|cinematic) motion blur/i);
    assert.match(director.widgets_values[1], /No motion blur/i);
    assert.match(timeline.global.prompt, /sharp in every frame/i);
    assert.match(timeline.segments[0].prompt, /No motion blur/i);
    for (const term of ['motion blur', 'temporal smearing', 'ghosting', 'double edges', 'smeared face']) {
      assert.match(timeline.segments[0].negativePrompt, new RegExp(term, 'i'));
    }
  });
});
