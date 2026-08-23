const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPaths = [
  path.join(process.cwd(), 'configs', 'config.yaml'),
  path.join(process.cwd(), 'config.yaml'),
  path.join(__dirname, '..', '..', 'configs', 'config.yaml'),
];

function loadConfig() {
  let raw = null;
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, 'utf8');
      break;
    }
  }
  if (!raw) {
    throw new Error('Config file not found: configs/config.yaml');
  }
  const parsed = yaml.load(raw);
  if (!parsed?.app?.name) {
    throw new Error('Invalid config: missing app section');
  }
  parsed.director = {
    workflow_registry_path: parsed.director?.workflow_registry_path || './configs/director-workflows.json',
    allow_experimental: parsed.director?.allow_experimental === true,
  };
  return parsed;
}

module.exports = { loadConfig };
