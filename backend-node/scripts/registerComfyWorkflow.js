'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('../src/director/workflowRegistry');

const MODEL_FILE_PATTERN = /\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i;

function analysisError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function promptFromParsed(parsed, filePath) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw analysisError(`workflow JSON must be an object: ${filePath}`, 'WORKFLOW_TEMPLATE_INVALID');
  }
  const prompt = parsed.prompt && typeof parsed.prompt === 'object' && !Array.isArray(parsed.prompt)
    ? parsed.prompt
    : parsed;
  const nodes = Object.values(prompt);
  if (!nodes.length || nodes.some((node) => !node || typeof node !== 'object' || typeof node.class_type !== 'string')) {
    throw analysisError(`workflow must use ComfyUI API format with class_type nodes: ${filePath}`, 'WORKFLOW_TEMPLATE_INVALID');
  }
  return prompt;
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function adapterMetadata(options) {
  const values = ['family', 'adapter', 'adapterVersion', 'variant'].map((field) => String(options[field] || '').trim());
  const supplied = values.filter(Boolean).length;
  if (supplied > 0 && supplied < values.length) {
    throw analysisError(
      'family, adapter, adapterVersion, and variant must be supplied together',
      'WORKFLOW_ADAPTER_METADATA_INCOMPLETE',
    );
  }
  return supplied === values.length
    ? { family: values[0], adapter: values[1], adapterVersion: values[2], variant: values[3] }
    : {};
}

function executionDraft(options) {
  const supplied = options.execution && typeof options.execution === 'object' && !Array.isArray(options.execution)
    ? options.execution
    : {};
  return {
    promptContract: supplied.promptContract ?? options.promptContract ?? null,
    requiresPromptDraft: supplied.requiresPromptDraft ?? options.requiresPromptDraft ?? null,
    dimensions: supplied.dimensions ?? null,
    references: supplied.references ?? null,
    vramPolicy: supplied.vramPolicy ?? null,
    defaults: supplied.defaults ?? null,
  };
}

function analyzeWorkflowFile(filePath, options = {}) {
  const resolvedPath = path.resolve(String(filePath || ''));
  let source;
  try {
    source = fs.readFileSync(resolvedPath);
  } catch (error) {
    throw analysisError(`cannot read workflow file: ${resolvedPath}: ${error.message}`, 'WORKFLOW_FILE_UNREADABLE');
  }

  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw analysisError(`workflow JSON cannot be parsed: ${resolvedPath}: ${error.message}`, 'WORKFLOW_JSON_INVALID');
  }
  const prompt = promptFromParsed(parsed, resolvedPath);
  const requiredNodes = [...new Set(Object.values(prompt).map((node) => node.class_type.trim()).filter(Boolean))].sort();
  const modelFiles = [...new Set(
    collectStrings(Object.values(prompt).map((node) => node.inputs || {}))
      .map((value) => value.trim())
      .filter((value) => MODEL_FILE_PATTERN.test(value))
      .map((value) => path.basename(value)),
  )].sort();
  const metadata = adapterMetadata(options);
  const execution = executionDraft(options);
  const id = String(options.id || path.basename(resolvedPath, path.extname(resolvedPath))).trim();
  if (!id) throw analysisError('workflow id is required', 'WORKFLOW_ID_REQUIRED');
  const missingExecution = Object.entries(execution)
    .filter(([, value]) => value == null)
    .map(([field]) => `execution.${field}`);

  return {
    entryDraft: {
      draft: true,
      id,
      status: 'draft',
      workflowPath: resolvedPath,
      workflowSha256: sha256File(resolvedPath),
      workflowFormat: 'api',
      requiredNodes,
      modelFiles,
      ...metadata,
      execution,
    },
    diagnostics: {
      draft: true,
      sourceByteLength: source.length,
      nodeCount: Object.keys(prompt).length,
      missingGovernance: [
        'customNodes',
        'capabilities',
        'inputSchema',
        'provenance',
        'runtimeLock',
        'verifiedEvidence',
        ...missingExecution,
      ],
      warnings: [
        'requiredNodes is an extracted class_type inventory; classify third-party class types into customNodes manually.',
        'modelFiles is a filename heuristic only; verify paths, hashes, sizes, licenses, and runtime locks before registration.',
        'This draft is intentionally not accepted by the production registry loader.',
      ],
    },
  };
}

function parseCli(argv) {
  if (!argv.length) throw analysisError('workflow file path is required', 'WORKFLOW_FILE_REQUIRED');
  const filePath = argv[0];
  const options = {};
  const valueFlags = new Map([
    ['--id', 'id'],
    ['--family', 'family'],
    ['--adapter', 'adapter'],
    ['--adapter-version', 'adapterVersion'],
    ['--variant', 'variant'],
    ['--prompt-contract', 'promptContract'],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--requires-prompt-draft') {
      const value = argv[index + 1];
      if (!['true', 'false'].includes(value)) {
        throw analysisError('--requires-prompt-draft must be true or false', 'CLI_ARGUMENT_INVALID');
      }
      options.requiresPromptDraft = value === 'true';
      index += 1;
      continue;
    }
    const field = valueFlags.get(flag);
    if (!field || argv[index + 1] == null) throw analysisError(`unsupported or incomplete argument: ${flag}`, 'CLI_ARGUMENT_INVALID');
    options[field] = argv[index + 1];
    index += 1;
  }
  return { filePath, options };
}

if (require.main === module) {
  try {
    const { filePath, options } = parseCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(analyzeWorkflowFile(filePath, options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code || 'WORKFLOW_ANALYSIS_FAILED', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  analyzeWorkflowFile,
  parseCli,
};
