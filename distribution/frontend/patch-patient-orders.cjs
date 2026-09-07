const fs = require('node:fs');
const path = require('node:path');

const version = '12.3.4';
const originalDirName = `openmrs-esm-patient-orders-app-${version}`;
const moduleDir = path.join('/app/spa', originalDirName);

if (!fs.existsSync(moduleDir)) {
  throw new Error(`Patient orders app ${version} was not assembled at ${moduleDir}`);
}

const start1 = `(null==(o=t.responseBody)||null==(r=o.error)?void 0:r.message)||T("tryReopeningTheWorkspaceAgain","Please try launching the workspace again")`;
const start2 = `(null==(p=c.responseBody)||null==(s=p.error)?void 0:s.message)||T("tryReopeningTheWorkspaceAgain","Please try launching the workspace again")`;

const replacement = `(function(err){var msgs=[];if(err&&err.responseBody&&err.responseBody.error){var e=err.responseBody.error;if(e.globalErrors)e.globalErrors.forEach(function(ge){msgs.push(ge.message)});if(e.fieldErrors)for(var f in e.fieldErrors)e.fieldErrors[f].forEach(function(fe){msgs.push(fe.message)});return msgs.length>0?msgs.join(', '):e.message}return null})`;

const rep1 = `${replacement}(t)||T("tryReopeningTheWorkspaceAgain","Please try launching the workspace again")`;
const rep2 = `${replacement}(c)||T("tryReopeningTheWorkspaceAgain","Please try launching the workspace again")`;

let matchCount1 = 0;
let matchCount2 = 0;

for (const file of fs.readdirSync(moduleDir).filter((name) => name.endsWith('.js'))) {
  const filePath = path.join(moduleDir, file);
  const source = fs.readFileSync(filePath, 'utf8');

  const occurrences1 = source.split(start1).length - 1;
  const occurrences2 = source.split(start2).length - 1;
  matchCount1 += occurrences1;
  matchCount2 += occurrences2;

  if (occurrences1 > 0 || occurrences2 > 0) {
    if (source.includes(replacement)) {
      throw new Error(`${path.basename(filePath)} is already patched`);
    }
    const patched = source.replace(start1, rep1).replace(start2, rep2);
    fs.writeFileSync(filePath, patched);
    console.log(`Patched validation error messages in ${file}`);
  }
}

if (matchCount1 !== 1) {
  throw new Error(
    `Expected exactly 1 occurrence of start1 across all JS files, found ${matchCount1}. ` +
    `The minified variable names may have shifted in a future build of ${version}. ` +
    `Update start1 in this script to match the new output.`
  );
}
if (matchCount2 !== 1) {
  throw new Error(
    `Expected exactly 1 occurrence of start2 across all JS files, found ${matchCount2}. ` +
    `The minified variable names may have shifted in a future build of ${version}. ` +
    `Update start2 in this script to match the new output.`
  );
}


const patchedDirName = `${originalDirName}-liberia1`;
const importMapPath = '/app/spa/importmap.json';
const importMap = fs.readFileSync(importMapPath, 'utf8');
if (importMap.split(originalDirName).length - 1 !== 1 || importMap.includes(patchedDirName)) {
  throw new Error(`Expected exactly one unpatched ${originalDirName} import-map entry`);
}
fs.writeFileSync(importMapPath, importMap.replace(originalDirName, patchedDirName));
const targetDir = path.join('/app/spa', patchedDirName);
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

console.log(`Patched validation error messages for patient orders app`);
