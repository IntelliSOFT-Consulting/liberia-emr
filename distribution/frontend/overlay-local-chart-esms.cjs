const fs = require('node:fs');
const path = require('node:path');

/**
 * assemble downloads the npm pins. Those pins do not contain this commit's chart
 * source. Replace the two bundles and their route registrations before `openmrs build`.
 */
const spaDir = process.env.SPA_DIR || '/app/spa';
const importMapPath = path.join(spaDir, 'importmap.json');
const registryPath = path.join(spaDir, 'routes.registry.json');
const importMap = JSON.parse(fs.readFileSync(importMapPath, 'utf8'));
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

const modules = [
  {
    name: '@liberiaemr/esm-liberia-epartograph-app',
    distDir: '/tmp/local-dist/epartograph/dist',
    routes: '/tmp/local-dist/epartograph/routes.json',
  },
  {
    name: '@liberiaemr/esm-liberia-patient-chart-extension',
    distDir: '/tmp/local-dist/chart/dist',
    routes: '/tmp/local-dist/chart/routes.json',
  },
];

for (const mod of modules) {
  const rel = importMap.imports?.[mod.name];
  if (!rel || typeof rel !== 'string') {
    throw new Error(`Import map has no entry for ${mod.name}`);
  }
  const target = path.join(spaDir, rel.replace(/^\.\//, ''));
  if (!fs.existsSync(target)) {
    throw new Error(`Assembled bundle not found at ${target}`);
  }
  if (!fs.existsSync(mod.distDir) || !fs.existsSync(mod.routes)) {
    throw new Error(`Local build for ${mod.name} is missing`);
  }
  const entryName = path.basename(target);
  const entry = path.join(mod.distDir, entryName);
  if (!fs.existsSync(entry)) {
    throw new Error(`Local build for ${mod.name} has no ${entryName}`);
  }
  const targetDir = path.dirname(target);
  let copied = 0;
  for (const name of fs.readdirSync(mod.distDir)) {
    if (!name.endsWith('.js')) {
      continue;
    }
    fs.copyFileSync(path.join(mod.distDir, name), path.join(targetDir, name));
    copied += 1;
  }
  if (copied < 2) {
    throw new Error(`Local build for ${mod.name} did not include its chunks`);
  }
  const routes = JSON.parse(fs.readFileSync(mod.routes, 'utf8'));
  fs.writeFileSync(path.join(path.dirname(target), 'routes.json'), JSON.stringify(routes));
  const previous = registry[mod.name] && typeof registry[mod.name] === 'object' ? registry[mod.name] : {};
  registry[mod.name] = { ...routes, version: previous.version || routes.version };
  console.log(`Overlaid ${mod.name} onto ${path.basename(path.dirname(target))}`);
}

fs.writeFileSync(registryPath, JSON.stringify(registry));
