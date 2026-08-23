const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  probeMedia,
  ensureEvidencePathAvailable,
} = require('../scripts/directorHostAcceptance');

describe('Director host acceptance CLI utilities', () => {
  it('parses required paths and force flag', () => {
    const options = parseArgs([
      '--comfyui', 'http://127.0.0.1:8188',
      '--output-dir', 'E:/out',
      '--evidence', 'evidence.json',
      '--source-artifact', 'source.mp4',
      '--force',
    ]);
    assert.deepEqual(options, {
      comfyui: 'http://127.0.0.1:8188',
      outputDir: 'E:/out',
      evidence: 'evidence.json',
      sourceArtifact: 'source.mp4',
      force: true,
    });
  });

  it('probes an absolute input path through the injected command runner', async () => {
    let received;
    const result = await probeMedia('E:/out/final.mp4', {
      ffprobePath: 'ffprobe.exe',
      runCommand: async (file, args) => {
        received = { file, args };
        return { stdout: JSON.stringify({ streams: [], format: { duration: '4' } }), stderr: '', code: 0 };
      },
    });
    assert.equal(received.file, 'ffprobe.exe');
    assert.equal(received.args.at(-1), 'E:/out/final.mp4');
    assert.deepEqual(result.format, { duration: '4' });
  });

  it('rejects an existing evidence path unless force is enabled', () => {
    assert.throws(() => ensureEvidencePathAvailable(__filename), /already exists/i);
    assert.doesNotThrow(() => ensureEvidencePathAvailable(__filename, { force: true }));
  });
});
