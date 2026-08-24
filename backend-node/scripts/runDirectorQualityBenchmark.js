#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createBenchmarkRuns, loadBenchmarkMatrix } = require('./directorQualityBenchmark');
const { createComfyUIClient } = require('../src/director/comfyuiClient');
const { analyzeArtifact } = require('../src/director/directorQualityService');
const { buildStructuredWorkflowPrompt, loadRegistry, readWorkflowTemplate } = require('../src/director/workflowRegistry');

const SCENES = {
  'cross-scene-continuity': 'A medium tracking shot follows the same young East Asian woman in a beige trench coat carrying a red umbrella as she leaves a warm amber apartment hallway, opens the door, and steps into a cool blue rainy street. Her face, tied-back black hair, coat, shoulder bag, and umbrella remain unchanged through the lighting transition.',
  'close-up-face': 'A tight close-up frames a young East Asian woman with tied-back black hair and a small mole below her left eye. She listens, blinks naturally, says one short sentence with restrained lip motion, then shifts from concern to relief while her facial proportions and skin details remain stable.',
  'multi-person-occlusion': 'A medium-wide static shot frames three distinct adults: a woman in a beige coat, a man in a navy jacket, and a woman in a red sweater. They cross paths, briefly occlude one another, pass a small green notebook from the navy-jacketed man to the beige-coated woman, and separate without swapping faces, clothing, or positions.',
  'fast-camera-motion': 'A fast lateral tracking shot follows an athletic man in a yellow windbreaker running from left to right through a market aisle. Hanging fabric and passing shoppers briefly occlude him while his face, clothing, limbs, and direction of travel remain stable without tearing.',
  'fine-prop-interaction': 'A close shot frames a woman in a dark green blouse holding a small oval silver locket engraved with a leaf. She opens the hinge with both hands, reveals one portrait photograph, studies it, and closes it while fingers, hinge, engraving, and object geometry remain coherent.',
};

function buildH3BenchmarkPrompt(run) {
  const scene = SCENES[run.scenarioId] || String(run.prompt || '').trim();
  return [
    `integrated_multimodal_description: [Shot 1] ${run.style || 'Live-action cinematic'}, ${run.lighting || 'soft natural daylight'}. ${scene} The camera preserves a continuous five-second take with physically coherent motion and no cut.`,
    'overall_soundscape: Low room or street ambience remains continuous beneath synchronized footsteps, fabric movement, breathing, and object handling appropriate to the visible action.',
    'non_diegetic_music: N/A',
  ].join('\n\n');
}

function seedFor(runId) {
  return Number.parseInt(crypto.createHash('sha256').update(String(runId)).digest('hex').slice(0, 8), 16) & 0x7fffffff;
}

function applyBenchmarkOutputSpec(run, quality) {
  const result = { ...quality, issues: [...(quality?.issues || [])].filter((issue) => issue.code !== 'OUTPUT_SPEC_MISMATCH') };
  const media = result.media || {};
  const mismatches = [];
  if (Number(media.width) !== Number(run.width)) mismatches.push(`width expected ${run.width}, got ${media.width || 'missing'}`);
  if (Number(media.height) !== Number(run.height)) mismatches.push(`height expected ${run.height}, got ${media.height || 'missing'}`);
  if (Math.abs(Number(media.fps || 0) - 24) > 0.01) mismatches.push(`fps expected 24, got ${media.fps || 'missing'}`);
  if (mismatches.length) {
    result.status = 'failed';
    result.issues.push({ code: 'OUTPUT_SPEC_MISMATCH', severity: 'error', message: mismatches.join('; ') });
  }
  return result;
}

function writeCheckpoint(resultsPath, checkpoint) {
  const absolute = path.resolve(resultsPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, absolute);
}

function loadCheckpoint(resultsPath) {
  if (!fs.existsSync(resultsPath)) return { version: 'director_quality_benchmark_results_v1', results: [] };
  const value = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  if (!Array.isArray(value.results)) throw new Error('Benchmark checkpoint must contain results[]');
  return value;
}

async function executeBenchmarkRuns(runs, {
  resultsPath,
  outputDir,
  runtimeLock,
  runWorkflow,
  analyzeQuality = analyzeArtifact,
  limit = Infinity,
  now = () => new Date().toISOString(),
} = {}) {
  if (!resultsPath || !outputDir || typeof runWorkflow !== 'function') throw new Error('resultsPath, outputDir, and runWorkflow are required');
  const checkpoint = loadCheckpoint(path.resolve(resultsPath));
  const byId = new Map(checkpoint.results.map((result) => [result.runId, result]));
  let attempted = 0;
  for (const run of runs) {
    const existing = byId.get(run.runId);
    if (existing?.executionStatus === 'completed') {
      byId.set(run.runId, { ...existing, machineQc: applyBenchmarkOutputSpec(run, existing.machineQc) });
      continue;
    }
    if (attempted >= Number(limit)) continue;
    attempted += 1;
    const startedAt = now();
    const prompt = buildH3BenchmarkPrompt(run);
    const seed = seedFor(run.runId);
    let record;
    try {
      const generated = await runWorkflow({ run, prompt, seed, outputFileName: `${run.runId}.mp4` });
      const machineQc = applyBenchmarkOutputSpec(run, await analyzeQuality({ artifactPath: generated.artifactPath, ffprobe: generated.ffprobe || {} }));
      record = {
        ...run, prompt, seed, executionStatus: 'completed', startedAt, completedAt: now(),
        artifactPath: generated.artifactPath, artifactSha256: generated.sha256,
        promptId: generated.promptId, queue: generated.queue, workflowId: generated.workflowId,
        workflowSha256: generated.workflowSha256, ffprobe: generated.ffprobe,
        runtimeLock, machineQc, semanticReview: null,
      };
    } catch (error) {
      record = {
        ...run, prompt, seed, executionStatus: 'failed', startedAt, completedAt: now(), runtimeLock,
        error: { code: error.code || 'BENCHMARK_RUN_FAILED', message: error.message || String(error), details: error.details || null },
        machineQc: null, semanticReview: null,
      };
    }
    byId.set(run.runId, record);
    checkpoint.results = [...byId.values()];
    checkpoint.updatedAt = now();
    writeCheckpoint(resultsPath, checkpoint);
  }
  checkpoint.results = [...byId.values()];
  checkpoint.updatedAt = now();
  writeCheckpoint(resultsPath, checkpoint);
  return checkpoint;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${key || '(missing)'}`);
    options[key.slice(2)] = value;
  }
  return options;
}

async function runCli(options) {
  const matrixPath = path.resolve(options.matrix || path.join(__dirname, '../configs/director-quality-benchmark.json'));
  const registryPath = path.resolve(options.registry || path.join(__dirname, '../configs/director-workflows.json'));
  const resultsPath = path.resolve(options.results || path.join(process.cwd(), 'data/director-quality-benchmark/results.json'));
  const outputDir = path.resolve(options['output-dir'] || path.join(path.dirname(resultsPath), 'artifacts'));
  const matrix = loadBenchmarkMatrix(matrixPath);
  const registry = loadRegistry(registryPath);
  const selected = registry.workflows.find((workflow) => workflow.id === matrix.workflowId);
  if (!selected) throw new Error(`Benchmark workflow not found: ${matrix.workflowId}`);
  const template = readWorkflowTemplate(selected.workflowPath);
  const client = createComfyUIClient({ baseUrl: options['comfy-url'] || 'http://127.0.0.1:8188', outputDir, timeoutMs: 60 * 60 * 1000 });
  return executeBenchmarkRuns(createBenchmarkRuns(matrix), {
    resultsPath, outputDir, runtimeLock: selected.runtimeLock, limit: options.limit ? Number(options.limit) : Infinity,
    runWorkflow: ({ run, prompt, seed, outputFileName }) => client.runWorkflow({
      registry, workflowId: matrix.workflowId, outputFileName,
      prompt: buildStructuredWorkflowPrompt(template, {
        prompt, seed, width: run.width, height: run.height, durationSeconds: 5,
        frameRate: 24, continuityMode: 'none', overlapFrames: 0,
      }),
      inputs: { benchmarkRunId: run.runId, seed, width: run.width, height: run.height },
    }),
  });
}

if (require.main === module) {
  runCli(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { applyBenchmarkOutputSpec, buildH3BenchmarkPrompt, executeBenchmarkRuns, parseArgs, runCli, seedFor };
