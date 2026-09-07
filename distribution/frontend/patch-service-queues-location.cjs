'use strict';

/**
 * patch-service-queues-location.cjs
 *
 * Problem (upstream bug in esm-service-queues-app 11.1.0):
 *   The QueueFields component initialises react-hook-form with:
 *
 *     defaultValues: { queueLocation: sessionLocation?.uuid ?? '', ... }
 *
 *   However react-hook-form evaluates `defaultValues` only once at mount.
 *   Because `useSession()` data arrives asynchronously via SWR, `sessionLocation`
 *   is `undefined` on the very first render tick, so the field always starts as ""
 *   ("Select a queue location") even though a session location is available.
 *   A `useEffect` that sets other defaults (priority) already exists, but there is
 *   no equivalent effect for `queueLocation`.
 *
 * Fix:
 *   Inject a `useEffect` immediately after the existing "setOnSubmit" effect that
 *   does two things once the queue-locations list has loaded:
 *   1. If a queueLocation is currently set, but it is NOT in the list of valid
 *      queue locations, it clears the field. This handles the case where `useSession`
 *      was synchronous (e.g. cached) and `defaultValues` set it to the parent facility.
 *   2. If the field is blank, and the session location IS a valid queue location,
 *      it sets it as the default.
 *
 *   In minified form the injected effect is:
 *     (0,n.useEffect)(function(){
 *       O||(G?k.some(function(e){return e.id===G})||F("queueLocation",""):E&&E.uuid&&k.some(function(e){return e.id===E.uuid})&&F("queueLocation",E.uuid))
 *     },[O,G,E,k,F])
 *
 *   where (matching the minified variable names in chunk 6138.js):
 *     O  = isLoadingQueueLocations (boolean)
 *     G  = queueLocation (watched form value)
 *     E  = sessionLocation (from useSession())
 *     k  = memoizedQueueLocations (array of {id, name})
 *     F  = setValue (react-hook-form)
 *
 * The anchor is unique across the entire bundle (confirmed for 11.1.0).
 */

const fs   = require('node:fs');
const path = require('node:path');

const version         = '11.1.0';
const revision        = 'liberia1';
const originalDirName = `openmrs-esm-service-queues-app-${version}`;
const patchedDirName  = `${originalDirName}-${revision}`;
const moduleDir       = path.join('/app/spa', originalDirName);
const lock            = '__liberiaEmrServiceQueuesLocation';

// Anchor: the existing setOnSubmit effect (unique in the bundle).
const anchor = '(0,n.useEffect)(function(){null==r||r(ee)},[ee,r])';

// The fix to inject immediately after the anchor.
const injected =
  ',(0,n.useEffect)(function(){' +
    'O||(G?k.some(function(e){return e.id===G})||F("queueLocation",""):E&&E.uuid&&k.some(function(e){return e.id===E.uuid})&&F("queueLocation",E.uuid))' +
  '},[O,G,E,k,F])';

if (!fs.existsSync(moduleDir)) {
  throw new Error(`Service queues app ${version} was not assembled at ${moduleDir}`);
}

const matches = [];
for (const file of fs.readdirSync(moduleDir).filter((name) => name.endsWith('.js'))) {
  const filePath = path.join(moduleDir, file);
  const source   = fs.readFileSync(filePath, 'utf8');

  if (source.includes(lock)) {
    throw new Error(`${path.basename(filePath)} is already patched`);
  }

  const anchorCount = source.split(anchor).length - 1;
  if (anchorCount > 0) {
    matches.push({ filePath, source, anchorCount });
  }
}

if (matches.length !== 1 || matches[0].anchorCount !== 1) {
  throw new Error(
    `Expected exactly one occurrence of the setOnSubmit effect anchor, found: ${JSON.stringify(
      matches.map(({ filePath, anchorCount }) => ({
        file: path.basename(filePath),
        anchorCount,
      })),
    )}`,
  );
}

const match   = matches[0];
const patched = match.source
  .replace(anchor, anchor + injected)
  .replace(/\/\/# sourceMappingURL=[^\n]+\n?$/, '');

fs.writeFileSync(match.filePath, patched);

// Update import map so the browser fetches the renamed directory.
const importMapPath = '/app/spa/importmap.json';
const importMap     = fs.readFileSync(importMapPath, 'utf8');
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

console.log(
  `Patched service-queues default queue location in ${patchedDirName}/${path.basename(match.filePath)}`,
);
