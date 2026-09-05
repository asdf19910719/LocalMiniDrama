'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const probePath = path.resolve(__dirname, '../scripts/probeH3TeSpeedRuntime.js');

function pluginFixture() {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-te-speed-plugin-'));
  fs.writeFileSync(path.join(pluginDir, 'nodes.pyd'), Buffer.from('native-test-binary'));
  fs.writeFileSync(path.join(pluginDir, '__init__.py'), 'NODE_CLASS_MAPPINGS = {}\n');
  return pluginDir;
}

function response(json, ok = true, status = 200) {
  return { ok, status, async json() { return json; } };
}

function validNode() {
  return {
    TESpeedMiniMaxH3: {
      input: {
        required: {
          model: ['MODEL'],
          mode: [['Standard / 20-Step', '4-step LoRA']],
          device: [['auto', 'cpu']],
        },
      },
      output: ['MODEL'],
      output_name: ['MODEL'],
      name: 'TESpeedMiniMaxH3',
      display_name: 'TE-Speed-MiniMaxH3',
    },
  };
}

describe('H3 TE-Speed runtime probe', () => {
  it('captures hashes and the real ComfyUI node schema without URL secrets', async () => {
    assert.equal(fs.existsSync(probePath), true, `missing implementation: ${probePath}`);
    const { probeRuntime } = require(probePath);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith('/object_info/TESpeedMiniMaxH3')) return response(validNode());
      if (url.endsWith('/system_stats')) return response({
        system: { comfyui_version: '0.33.1', pytorch_version: '2.13.0+cu130', python_version: '3.13.14' },
        devices: [{ name: 'NVIDIA GeForce RTX 5070 Ti', vram_total: 17179869184 }],
      });
      throw new Error(`unexpected URL: ${url}`);
    };

    const manifest = await probeRuntime({
      baseUrl: 'http://user:secret@127.0.0.1:8191/?token=hidden',
      pluginDir: pluginFixture(),
      fetchImpl,
      now: () => '2026-09-05T00:00:00.000Z',
    });

    assert.equal(manifest.compatible, true);
    assert.equal(manifest.baseUrl, 'http://127.0.0.1:8191/');
    assert.equal(manifest.node.classType, 'TESpeedMiniMaxH3');
    assert.deepEqual(manifest.node.outputs, ['MODEL']);
    assert.equal(manifest.plugin.files.nodesPyd.sha256.length, 64);
    assert.equal(manifest.plugin.files.initPy.sha256.length, 64);
    assert.equal(manifest.runtime.device.name, 'NVIDIA GeForce RTX 5070 Ti');
    assert.deepEqual(calls, [
      'http://user:secret@127.0.0.1:8191/object_info/TESpeedMiniMaxH3',
      'http://user:secret@127.0.0.1:8191/system_stats',
    ]);
    assert.equal(JSON.stringify(manifest).includes('secret'), false);
    assert.equal(JSON.stringify(manifest).includes('hidden'), false);
  });

  it('fails closed when the node is missing', async () => {
    assert.equal(fs.existsSync(probePath), true, `missing implementation: ${probePath}`);
    const { probeRuntime } = require(probePath);
    const fetchImpl = async (url) => response(url.includes('object_info') ? {} : { system: {}, devices: [] });
    await assert.rejects(
      probeRuntime({ baseUrl: 'http://127.0.0.1:8191', pluginDir: pluginFixture(), fetchImpl }),
      (error) => error.code === 'TE_SPEED_NODE_MISSING',
    );
  });

  it('fails closed on an invalid MODEL contract or an unavailable endpoint', async () => {
    assert.equal(fs.existsSync(probePath), true, `missing implementation: ${probePath}`);
    const { probeRuntime } = require(probePath);
    const badSchema = { TESpeedMiniMaxH3: { input: { required: { image: ['IMAGE'] } }, output: ['IMAGE'] } };
    await assert.rejects(
      probeRuntime({
        baseUrl: 'http://127.0.0.1:8191', pluginDir: pluginFixture(),
        fetchImpl: async (url) => response(url.includes('object_info') ? badSchema : { system: {}, devices: [] }),
      }),
      (error) => error.code === 'TE_SPEED_SCHEMA_INVALID',
    );
    await assert.rejects(
      probeRuntime({
        baseUrl: 'http://127.0.0.1:8191', pluginDir: pluginFixture(),
        fetchImpl: async () => response({ message: 'offline' }, false, 503),
      }),
      (error) => error.code === 'TE_SPEED_RUNTIME_UNAVAILABLE',
    );
  });
});
