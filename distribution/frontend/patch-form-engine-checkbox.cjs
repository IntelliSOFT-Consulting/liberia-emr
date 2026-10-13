'use strict';

/**
 * patch-form-engine-checkbox.cjs
 *
 * Problem (upstream bug in @openmrs/esm-form-engine-lib, bundled into
 * @openmrs/esm-form-engine-app 12.3.4):
 *   MultiSelect renders ordinary checkbox groups with Carbon CheckboxGroup, but
 *   that branch ignores the errors and warnings already passed into the
 *   component. Save is blocked by the built-in "Field is mandatory" validator,
 *   and the message is never painted. The radio control and the searchable
 *   checkbox branch (FilterableMultiSelect) both surface those same props.
 *
 * Fix:
 *   Pass invalid, invalidText, warn and warnText through on the non-searchable
 *   CheckboxGroup call. In chunk 5708.js of 12.3.4 the call is unique:
 *
 *     b().createElement(B.$QX,{legendText:b().createElement(Sh,{field:e}),readOnly:(0,nI.H)(e.readonly)}
 *
 *   B.$QX is CheckboxGroup. n and S are the errors and warnings parameters of
 *   that component (not the map callback, which starts after this props object).
 *   Carbon CheckboxGroup  already renders invalidText in
 *   `.cds--form-requirement` and sets `.cds--checkbox-group--invalid` when
 *   invalid is true and the group is not read-only.
 *
 * The searchable branch is a different createElement and is not rewritten.
 */

const fs = require('node:fs');
const path = require('node:path');

const version = '12.3.4';
const revision = 'liberia1';
const originalDirName = `openmrs-esm-form-engine-app-${version}`;
const patchedDirName = `${originalDirName}-${revision}`;
const lock = '__liberiaEmrCheckboxRequired';

// Unique across the 12.3.4 bundle (chunk 5708.js). The closing brace ends the
// props object; children follow as the next createElement argument.
const anchor =
  'b().createElement(B.$QX,{legendText:b().createElement(Sh,{field:e}),readOnly:(0,nI.H)(e.readonly)}';

const replacement =
  'b().createElement(B.$QX,{legendText:b().createElement(Sh,{field:e}),readOnly:(0,nI.H)(e.readonly),' +
  'invalid:n.length>0,invalidText:n[0]?.message,warn:S.length>0,warnText:S[0]?.message' +
  '/* ' +
  lock +
  ' */}';

function listJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function patchSource(source) {
  if (source.includes(lock)) {
    throw new Error('form-engine checkbox bundle is already patched');
  }
  const anchorCount = source.split(anchor).length - 1;
  if (anchorCount !== 1) {
    throw new Error(`Expected exactly one CheckboxGroup anchor, found ${anchorCount}`);
  }
  return source.replace(anchor, replacement).replace(/\/\/# sourceMappingURL=[^\n]+\n?$/, '');
}

function patchAssembledSpa(spaDir) {
  const moduleDir = path.join(spaDir, originalDirName);
  if (!fs.existsSync(moduleDir)) {
    throw new Error(`Form engine app ${version} was not assembled at ${moduleDir}`);
  }

  const matches = [];
  for (const filePath of listJsFiles(moduleDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes(lock)) {
      throw new Error(`${path.basename(filePath)} is already patched`);
    }
    const anchorCount = source.split(anchor).length - 1;
    if (anchorCount > 0) {
      matches.push({ filePath, anchorCount });
    }
  }

  if (matches.length !== 1 || matches[0].anchorCount !== 1) {
    throw new Error(
      `Expected exactly one CheckboxGroup anchor in ${originalDirName}, found: ${JSON.stringify(
        matches.map(({ filePath, anchorCount }) => ({
          file: path.relative(moduleDir, filePath),
          anchorCount,
        })),
      )}`,
    );
  }

  const match = matches[0];
  const source = fs.readFileSync(match.filePath, 'utf8');
  fs.writeFileSync(match.filePath, patchSource(source));

  const importMapPath = path.join(spaDir, 'importmap.json');
  const importMap = fs.readFileSync(importMapPath, 'utf8');
  if (importMap.split(originalDirName).length - 1 !== 1 || importMap.includes(patchedDirName)) {
    throw new Error(`Expected exactly one unpatched ${originalDirName} import-map entry`);
  }
  fs.writeFileSync(importMapPath, importMap.replace(originalDirName, patchedDirName));

  const targetDir = path.join(spaDir, patchedDirName);
  try {
    fs.renameSync(moduleDir, targetDir);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      fs.cpSync(moduleDir, targetDir, { recursive: true });
      fs.rmSync(moduleDir, { recursive: true, force: true });
    } else {
      throw error;
    }
  }

  console.log(
    `Patched form-engine checkbox validation in ${patchedDirName}/${path.relative(moduleDir, match.filePath)}`,
  );
}

if (require.main === module) {
  patchAssembledSpa('/app/spa');
}

module.exports = {
  anchor,
  replacement,
  lock,
  version,
  patchSource,
  patchAssembledSpa,
};
