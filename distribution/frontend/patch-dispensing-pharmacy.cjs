const fs = require('node:fs');
const path = require('node:path');

/**
 * Dispensing 1.11.1 loads its worklist through Encounter?_query=encountersWithMedicationRequests,
 * which requires Get Encounters, and shows Dispense only for Task: dispensing.create.dispense.
 * Neither is an approved matrix privilege. The worklist becomes a MedicationRequest search.
 * Rows are built from the request's encounter reference, not from an encounter body.
 * Dispense is shown for Manage Pharmacy. Edit, delete, and allowSubstitutions task checks stay.
 */
const version = '1.11.1';
const originalDirName = `openmrs-esm-dispensing-app-${version}`;
const spaDir = process.env.SPA_DIR || '/app/spa';
const moduleDir = [
  originalDirName,
  `${originalDirName}-liberia1`,
]
  .map((name) => path.join(spaDir, name))
  .find((dir) => fs.existsSync(dir));

if (!moduleDir) {
  throw new Error(`Dispensing app ${version} was not assembled under ${spaDir}`);
}

const encounterRows =
  '.filter(function(e){var n;return(null==e||null==(n=e.resource)?void 0:n.resourceType)=="Encounter"}).map(function(e){return e.resource})';
const medicationRows =
  '.reduce(function(a,e){var n,r,id;n=e&&e.resource;if(!n||n.resourceType!="MedicationRequest"||!n.encounter||!n.encounter.reference){return a}r=String(n.encounter.reference);id=r.indexOf("Encounter/")===0?r.substring("Encounter/".length):r.split("/").pop();if(!id||a.seen[id]){return a}a.seen[id]=1;a.list.push({id:id,resourceType:"Encounter",period:{start:n.authoredOn},subject:n.subject||{},location:[]});return a},{seen:{},list:[]}).list';

// Both the main bundle and the dispensing chunk contain each string.
// status is counted before the date template that contains one of the two copies is replaced.
const replacements = [
  ['"Task: dispensing.create.dispense"', '"Manage Pharmacy"', 2],
  ['Encounter?_query=encountersWithMedicationRequests', 'MedicationRequest?_revinclude=MedicationDispense:prescription', 2],
  ['&_include=MedicationRequest:encounter', '', 2],
  ['&date=ge${date}&status=${status}', '&_lastUpdated=ge${date}', 2],
  ['&status=${status}', '', 4],
  [encounterRows, medicationRows, 4],
  ['?"&patientSearchTerm=${patientSearchTerm}":""', '?"":""', 4],
  ['&location=${location}', '', 4],
];

for (const [from, , expected] of replacements) {
  let found = 0;
  for (const file of fs.readdirSync(moduleDir).filter((name) => name.endsWith('.js'))) {
    found += fs.readFileSync(path.join(moduleDir, file), 'utf8').split(from).length - 1;
  }
  if (found !== expected) {
    throw new Error(`Expected ${expected} occurrence(s) of ${from.slice(0, 80)}, found ${found}`);
  }
}

for (const file of fs.readdirSync(moduleDir).filter((name) => name.endsWith('.js'))) {
  const filePath = path.join(moduleDir, file);
  let source = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [from, to] of replacements) {
    if (source.includes(from)) {
      source = source.split(from).join(to);
      changed = true;
    }
  }
  if (changed) {
    if (source.includes('Task: dispensing.create.dispense"') || source.includes('encountersWithMedicationRequests')) {
      throw new Error(`${file} still contains the unpatched dispensing worklist`);
    }
    fs.writeFileSync(filePath, source);
    console.log(`Patched pharmacy worklist in ${file}`);
  }
}

const patchedDirName = `${originalDirName}-liberia1`;
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

console.log('Patched dispensing worklist to MedicationRequest and Manage Pharmacy');
