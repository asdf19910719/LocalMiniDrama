#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MATRIX = path.resolve(__dirname, '../configs/director-quality-benchmark.json');

function loadBenchmarkMatrix(matrixPath = DEFAULT_MATRIX) {
  const matrix = JSON.parse(fs.readFileSync(path.resolve(matrixPath), 'utf8'));
  if (matrix.version !== 'director_quality_benchmark_v1') throw new Error('Unsupported Director quality benchmark version');
  for (const field of ['resolutions', 'visualVariants', 'scenarios']) {
    if (!Array.isArray(matrix[field]) || matrix[field].length === 0) throw new Error(`Benchmark matrix must declare ${field}`);
  }
  if (!Number.isInteger(matrix.repeatCount) || matrix.repeatCount < 2) throw new Error('Benchmark repeatCount must be at least 2');
  const rubric = matrix.semanticRubric;
  if (!rubric || !Array.isArray(rubric.dimensions) || !Number.isFinite(rubric.scale?.pass)) {
    throw new Error('Benchmark matrix must declare a semantic rubric and pass threshold');
  }
  return matrix;
}

function createBenchmarkRuns(matrix) {
  const runs = [];
  for (const scenario of matrix.scenarios) {
    for (const resolution of matrix.resolutions) {
      for (const variant of matrix.visualVariants) {
        for (let repeat = 1; repeat <= matrix.repeatCount; repeat += 1) {
          runs.push({
            runId: `${scenario.id}__${resolution.label}__${variant.id}__r${repeat}`,
            workflowId: matrix.workflowId,
            scenarioId: scenario.id,
            prompt: scenario.prompt,
            resolution: resolution.label,
            width: resolution.width,
            height: resolution.height,
            visualVariantId: variant.id,
            lighting: variant.lighting,
            style: variant.style,
            repeat,
            machineQc: null,
            semanticReview: null,
          });
        }
      }
    }
  }
  return runs;
}

function summarizeBenchmark(plannedRuns, results, options = {}) {
  const dimensions = options.dimensions || ['identity', 'promptAdherence', 'temporalStability', 'subjectSeparation', 'sceneContinuity'];
  const passScore = Number(options.passScore || 4);
  const byId = new Map((results || []).map((result) => [result.runId, result]));
  const summary = { total: plannedRuns.length, passed: 0, failed: 0, pending: 0, failures: [] };
  for (const run of plannedRuns) {
    const result = byId.get(run.runId);
    const semanticComplete = result && dimensions.every((dimension) => Number.isFinite(Number(result.semanticReview?.[dimension])));
    if (!result || !result.machineQc?.status || !semanticComplete) {
      summary.pending += 1;
      continue;
    }
    const lowScores = dimensions.filter((dimension) => Number(result.semanticReview[dimension]) < passScore);
    if (result.machineQc.status !== 'passed' || lowScores.length > 0) {
      summary.failed += 1;
      summary.failures.push({ runId: run.runId, machineQc: result.machineQc.status, lowScores });
    } else {
      summary.passed += 1;
    }
  }
  return {
    status: summary.failed ? 'failed' : summary.pending ? 'pending' : 'passed',
    ...summary,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--matrix', '--results', '--output'].includes(key) || !value) throw new Error(`Invalid argument: ${key || '(missing)'}`);
    options[key.slice(2)] = value;
  }
  return options;
}

function runCli(options = {}) {
  const matrix = loadBenchmarkMatrix(options.matrix || DEFAULT_MATRIX);
  const runs = createBenchmarkRuns(matrix);
  const results = options.results ? JSON.parse(fs.readFileSync(path.resolve(options.results), 'utf8')) : [];
  const report = {
    version: matrix.version,
    generatedAt: new Date().toISOString(),
    matrix: { plannedRuns: runs.length, repeatCount: matrix.repeatCount },
    summary: summarizeBenchmark(runs, Array.isArray(results) ? results : results.results, {
      dimensions: matrix.semanticRubric.dimensions,
      passScore: matrix.semanticRubric.scale.pass,
    }),
    runs,
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) fs.writeFileSync(path.resolve(options.output), text, 'utf8');
  else process.stdout.write(text);
  return report;
}

if (require.main === module) {
  try { runCli(parseArgs(process.argv.slice(2))); }
  catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { loadBenchmarkMatrix, createBenchmarkRuns, summarizeBenchmark, parseArgs, runCli };
