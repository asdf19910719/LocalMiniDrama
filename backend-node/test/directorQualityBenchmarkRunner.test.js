const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildH3BenchmarkPrompt, executeBenchmarkRuns } = require('../scripts/runDirectorQualityBenchmark');

describe('Director quality benchmark runner', () => {
  it('builds the required H3 T2VA prompt sections in order', () => {
    const prompt = buildH3BenchmarkPrompt({
      scenarioId: 'close-up-face', prompt: 'Close-up dialogue performance.',
      lighting: 'soft natural daylight', style: 'live action cinematic',
    });
    assert.match(prompt, /^integrated_multimodal_description:/);
    assert.ok(prompt.indexOf('overall_soundscape:') > prompt.indexOf('integrated_multimodal_description:'));
    assert.ok(prompt.indexOf('non_diegetic_music:') > prompt.indexOf('overall_soundscape:'));
  });

  it('checkpoints each real result and resumes without rerunning completed runs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-benchmark-runner-'));
    const resultsPath = path.join(root, 'results.json');
    const calls = [];
    const runs = [
      { runId: 'run-1', scenarioId: 'close-up-face', prompt: 'face', width: 1280, height: 720, lighting: 'day', style: 'live action', repeat: 1 },
      { runId: 'run-2', scenarioId: 'fine-prop-interaction', prompt: 'prop', width: 1280, height: 720, lighting: 'day', style: 'live action', repeat: 1 },
    ];
    const dependencies = {
      resultsPath,
      outputDir: root,
      runtimeLock: { models: [{ fileName: 'model', sha256: 'a'.repeat(64) }] },
      runWorkflow: async (input) => {
        calls.push(input.run.runId);
        const artifactPath = path.join(root, `${input.run.runId}.mp4`);
        fs.writeFileSync(artifactPath, input.run.runId);
        return { artifactPath, sha256: input.run.runId, promptId: `prompt-${input.run.runId}`, queue: { number: 1 }, ffprobe: { streams: [] } };
      },
      analyzeQuality: async () => ({ status: 'passed', issues: [] }),
    };

    await executeBenchmarkRuns(runs, dependencies);
    await executeBenchmarkRuns(runs, dependencies);

    const checkpoint = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    assert.deepEqual(calls, ['run-1', 'run-2']);
    assert.equal(checkpoint.results.length, 2);
    assert.ok(checkpoint.results.every((result) => result.executionStatus === 'completed'));
    assert.ok(checkpoint.results.every((result) => result.machineQc.status === 'failed'));
    assert.ok(checkpoint.results.every((result) => result.machineQc.issues.some((issue) => issue.code === 'OUTPUT_SPEC_MISMATCH')));
    fs.rmSync(root, { recursive: true, force: true });
  });
});
