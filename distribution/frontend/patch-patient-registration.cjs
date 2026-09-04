const fs = require('node:fs');
const path = require('node:path');

const version = '11.1.0';
const revision = 'liberia1';
const originalDirName = `openmrs-esm-patient-registration-app-${version}`;
const patchedDirName = `${originalDirName}-${revision}`;
const moduleDir = path.join('/app/spa', originalDirName);
const lock = '__liberiaEmrPatientRegistrationSubmission';
const start = 'onSubmit:function(e,n){var t;return(t=function()';
const guardedStart =
  `onSubmit:function(e,n){var t;if(globalThis.${lock})return globalThis.${lock};` +
  `return globalThis.${lock}=(t=function()`;
const finish = '})})()},validationSchema:eV}';
const guardedFinish =
  `})})().finally(function(){globalThis.${lock}=void 0})},validationSchema:eV}`;

if (!fs.existsSync(moduleDir)) {
  throw new Error(`Patient registration app ${version} was not assembled at ${moduleDir}`);
}

const matches = [];
for (const file of fs.readdirSync(moduleDir).filter((name) => name.endsWith('.js'))) {
  const filePath = path.join(moduleDir, file);
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes(lock)) {
    throw new Error(`${path.basename(filePath)} is already patched`);
  }
  const startCount = source.split(start).length - 1;
  const finishCount = source.split(finish).length - 1;

  if (startCount || finishCount) {
    matches.push({ filePath, source, startCount, finishCount });
  }
}

if (
  matches.length !== 1 ||
  matches[0].startCount !== 1 ||
  matches[0].finishCount !== 1
) {
  throw new Error(
    `Expected one ${version} submit implementation, found ${JSON.stringify(
      matches.map(({ filePath, startCount, finishCount }) => ({
        file: path.basename(filePath),
        startCount,
        finishCount,
      })),
    )}`,
  );
}

const match = matches[0];
const patched = match.source
  .replace(start, guardedStart)
  .replace(finish, guardedFinish)
  .replace(/\/\/# sourceMappingURL=[^\n]+\n?$/, '');
fs.writeFileSync(match.filePath, patched);

const importMapPath = '/app/spa/importmap.json';
const importMap = fs.readFileSync(importMapPath, 'utf8');
if (importMap.split(originalDirName).length - 1 !== 1 || importMap.includes(patchedDirName)) {
  throw new Error(`Expected exactly one unpatched ${originalDirName} import-map entry`);
}
fs.writeFileSync(importMapPath, importMap.replace(originalDirName, patchedDirName));
fs.renameSync(moduleDir, path.join('/app/spa', patchedDirName));

console.log(
  `Patched duplicate patient registration submission in ${patchedDirName}/${path.basename(match.filePath)}`,
);
