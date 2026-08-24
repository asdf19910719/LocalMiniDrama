const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadBenchmarkMatrix, createBenchmarkRuns, summarizeBenchmark } = require('../scripts/directorQualityBenchmark');

describe('Director quality benchmark matrix', () => {
  it('covers scene continuity, faces, occlusion, resolutions, visual variants, and repeats', () => {
    const matrix = loadBenchmarkMatrix(path.resolve(__dirname, '../configs/director-quality-benchmark.json'));
    const runs = createBenchmarkRuns(matrix);
    assert.equal(runs.length, 90);
    assert.deepEqual(new Set(runs.map((run) => run.resolution)), new Set(['1280x720', '1920x1080']));
    assert.ok(runs.some((run) => run.scenarioId === 'cross-scene-continuity'));
    assert.ok(runs.some((run) => run.scenarioId === 'close-up-face'));
    assert.ok(runs.some((run) => run.scenarioId === 'multi-person-occlusion'));
    assert.deepEqual(new Set(runs.map((run) => run.repeat)), new Set([1, 2, 3]));
  });

  it('keeps incomplete semantic review pending and requires both QC and rubric thresholds', () => {
    const planned = [{ runId: 'run-1' }, { runId: 'run-2' }];
    assert.equal(summarizeBenchmark(planned, [{ runId: 'run-1', machineQc: { status: 'passed' } }]).status, 'pending');
    const rubric = { identity: 4, promptAdherence: 4, temporalStability: 4, subjectSeparation: 4, sceneContinuity: 4 };
    assert.equal(summarizeBenchmark(planned, planned.map((run) => ({ ...run, machineQc: { status: 'passed' }, semanticReview: rubric }))).status, 'passed');
    assert.equal(summarizeBenchmark(planned, planned.map((run, index) => ({
      ...run, machineQc: { status: index ? 'passed' : 'failed' }, semanticReview: rubric,
    }))).status, 'failed');
  });
});
