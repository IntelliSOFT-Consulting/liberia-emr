'use strict';

/**
 * patch-service-queues-serve-redirect.cjs
 *
 * Problem (esm-service-queues-app 11.1.0, still present in 12.1.1):
 *   The Serve button in the call-queue-entry modal always navigates to
 *   `${openmrsSpaBase}/patient/<uuid>/chart`. A queue's service cannot send the
 *   clinician to the chart page for that service (LE-121 item 3).
 *
 * Fix:
 *   1. Config schema (the chunk holding `customPatientChartUrl:{`): add
 *        servePatientChartUrls: Array<{ serviceConceptUuid, url }>, default [].
 *      `url` is a template; `${patientUuid}` and `${openmrsSpaBase}` are interpolated.
 *   2. Serve handler (the chunk holding the navigate anchor): navigate to the entry
 *      whose serviceConceptUuid is the queue's service, else the chart as before.
 *      With the default [], behaviour is unchanged.
 *
 *   In the handler's scope (11.1.0): r = @openmrs/esm-framework, f = useConfig(),
 *   y = mapVisitQueueEntryProperties(queueEntry) (y.queue is the raw queue, whose
 *   default representation carries service.uuid).
 *
 * Must run AFTER patch-service-queues-location.cjs: that patch renames the module
 * directory to -liberia1; this one patches -liberia1 and renames it to -liberia2 so
 * browsers do not reuse the cached chunks.
 */

const fs   = require('node:fs');
const path = require('node:path');

const spaDir          = process.env.SPA_DIR || '/app/spa';
const baseDirName     = 'openmrs-esm-service-queues-app-11.1.0';
const originalDirName = `${baseDirName}-liberia1`;
const patchedDirName  = `${baseDirName}-liberia2`;
const moduleDir       = path.join(spaDir, originalDirName);
const lock            = '__liberiaEmrServiceQueuesServeRedirect';

const edits = [
  {
    name: 'config schema',
    anchor: 'customPatientChartUrl:{_type:i.Type.String,',
    replacement:
      'servePatientChartUrls:{/* ' + lock + ' */_type:i.Type.Array,_default:[],' +
        '_description:"Where Serve sends the clinician, per queue service. Each entry maps a service concept UUID to a URL template (patientUuid, openmrsSpaBase). Services with no entry open the patient chart.",' +
        '_elements:{_type:i.Type.Object,' +
          'serviceConceptUuid:{_type:i.Type.UUID,_default:"",_description:"The queue service concept."},' +
          'url:{_type:i.Type.String,_default:"",_description:"URL template, e.g. ${openmrsSpaBase}/patient/${patientUuid}/chart/programs"}}},' +
      'customPatientChartUrl:{_type:i.Type.String,',
  },
  {
    name: 'serve handler',
    anchor: '(0,r.navigate)({to:"${openmrsSpaBase}/patient/".concat(y.patientUuid,"/chart")})',
    replacement:
      '(0,r.navigate)({/* ' + lock + ' */to:function(e){' +
        'var n=e&&(f.servePatientChartUrls||[]).find(function(n){return String(n.serviceConceptUuid).toLowerCase()===e.toLowerCase()});' +
        'return n&&n.url?n.url:"${openmrsSpaBase}/patient/${patientUuid}/chart"' +
      '}(null==y.queue||null==y.queue.service?void 0:y.queue.service.uuid),' +
      'templateParams:{patientUuid:y.patientUuid}})',
  },
];

if (!fs.existsSync(moduleDir)) {
  throw new Error(`Expected ${moduleDir}; run patch-service-queues-location.cjs first`);
}

const files = fs.readdirSync(moduleDir).filter((name) => name.endsWith('.js'));
const sources = new Map();
for (const file of files) {
  const source = fs.readFileSync(path.join(moduleDir, file), 'utf8');
  if (source.includes(lock)) {
    throw new Error(`${file} is already patched`);
  }
  sources.set(file, source);
}

for (const edit of edits) {
  const hits = [];
  for (const [file, source] of sources) {
    const count = source.split(edit.anchor).length - 1;
    if (count > 0) hits.push({ file, count });
  }
  if (hits.length !== 1 || hits[0].count !== 1) {
    throw new Error(`Expected exactly one ${edit.name} anchor, found: ${JSON.stringify(hits)}`);
  }
  const file = hits[0].file;
  sources.set(
    file,
    sources.get(file).replace(edit.anchor, edit.replacement).replace(/\/\/# sourceMappingURL=[^\n]+\n?$/, ''),
  );
  edit.file = file;
}

for (const edit of edits) {
  fs.writeFileSync(path.join(moduleDir, edit.file), sources.get(edit.file));
}

const importMapPath = path.join(spaDir, 'importmap.json');
const importMap     = fs.readFileSync(importMapPath, 'utf8');
if (importMap.split(originalDirName).length - 1 !== 1 || importMap.includes(patchedDirName)) {
  throw new Error(`Expected exactly one ${originalDirName} import-map entry`);
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
  `Patched service-queues serve redirect in ${patchedDirName}/` + edits.map((e) => e.file).join(', '),
);
