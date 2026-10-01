'use strict';

// Patient search app 11.1.0 has no ExtensionSlot where a custom app could add "Remote Search"
// (patients held on the central server). This patch adds three slots to the compiled bundle for
// esm-liberia-remote-search-app, which fills them. That app is NOT installed here: it is pinned in
// distro.properties (spa.frontendModules) like every other app and assembled with the rest. Until
// it is pinned the slots stay empty and the feature does not appear:
//
//   patient-search-remote-results-slot   header dropdown, and below the local results on the
//                                        /search page and in the "Add patient to ..." workspaces
//   patient-search-remote-toggle-slot    the Remote Search card in the Refine Search sidebar, and in
//                                        the tablet/phone "Add additional search criteria" dialog
//   patient-search-remote-summary-slot   `5 results for "x"` above the /search result sections
//
// It also relabels the local results heading to `LOCAL SEARCH · N MATCHES`, as designed.
//
// Every anchor is asserted to occur exactly once in the pinned 11.1.0 chunks and any miss
// throws, so an upstream bump fails the image build instead of shipping without the feature.
// The chunk and variable names are minifier output: when spa.core or the patient-search
// version changes, re-derive them from an unminified build and update the anchors below.

const fs = require('node:fs');
const path = require('node:path');

const version = '11.1.0';
const revision = 'liberiaRemote2';
const originalDirName = `openmrs-esm-patient-search-app-${version}`;
const patchedDirName = `${originalDirName}-${revision}`;
// Overridable so the patch can be exercised against a copy outside the image.
const spaDir = process.env.SPA_DIR || '/app/spa';
const moduleDir = path.join(spaDir, originalDirName);
const lock = '__liberiaEmrPatientSearchRemote';

const remoteAppName = '@liberiaemr/esm-liberia-remote-search-app';

if (!fs.existsSync(moduleDir)) {
  throw new Error(
    `Patient search app ${version} was not assembled at ${moduleDir}. Run openmrs assemble before this patch, ` +
      'and check the pinned version in distro.properties.',
  );
}

// The app arrives through spa.frontendModules in distro.properties. Say so when it is not there yet
// (a new package has no published version before its first merge), because the slots added below
// then render nothing.
const importMapPath = path.join(spaDir, 'importmap.json');
if (!fs.existsSync(importMapPath) || !fs.readFileSync(importMapPath, 'utf8').includes(`"${remoteAppName}"`)) {
  console.log(
    `WARN ${remoteAppName} is not in importmap.json: pin it in distro.properties (spa.frontendModules) ` +
      'for Remote Search to appear. Patching the patient-search chunks only.',
  );
}

for (const f of fs.readdirSync(moduleDir).filter((n) => n.endsWith('.js'))) {
  if (fs.readFileSync(path.join(moduleDir, f), 'utf8').includes(lock)) {
    throw new Error(`Chunk ${f} is already patched (lock token found). Aborting.`);
  }
}

function assertOneOccurrence(source, anchor, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(
      `${label}: expected exactly 1 anchor occurrence, found ${count}.\n` +
        'The upstream bundle may have changed - update the anchor in this patch file.',
    );
  }
}

/** Applies [label, anchor, replacement] edits to one chunk. Replacements use a function so `$` in code is literal. */
function patchChunk(name, edits) {
  const filePath = path.join(moduleDir, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${name} not found in ${moduleDir}: the chunk layout of ${version} has changed.`);
  }
  let source = fs.readFileSync(filePath, 'utf8');
  for (const [label, anchor] of edits) {
    assertOneOccurrence(source, anchor, `${name} ${label}`);
  }
  for (const [, anchor, replacement] of edits) {
    source = source.replace(anchor, () => replacement);
  }
  // The maps no longer describe the edited file.
  source = source.replace(/\/\/# sourceMappingURL=[^\n]+\n?$/, '');
  fs.writeFileSync(path.join(moduleDir, name), source);
  console.log(`OK  Patched ${name}`);
}

const marker = `/* ${lock} */`;
const slot = (framework, name, state) =>
  `i().createElement(${marker}${framework}.ExtensionSlot,{name:"${name}"${state ? `,state:${state}` : ''}})`;

// "LOCAL SEARCH · 3 MATCHES" as a grey label bar, like the designs. · is the middle dot.
const localLabel = (countVar) =>
  `{count:${countVar},defaultValue_one:"LOCAL SEARCH \\u00b7 {{count}} MATCH"}`;
const localKey = '"localSearchResultsCount","LOCAL SEARCH \\u00b7 {{count}} MATCHES"';
const labelStyle =
  '{textTransform:"uppercase",letterSpacing:"0.1em",fontSize:"0.75rem",fontWeight:600,lineHeight:"1rem",color:"#525252"}';

// -----------------------------------------------------------------------------
// 8383.js - CompactPatientSearch (the header dropdown)
// -----------------------------------------------------------------------------
// The floating container renders PatientSearch (the local results) when there is a search term.
// The remote section goes after it, inside the same container. In this scope `a` is React,
// `p` is @openmrs/esm-framework, `E` is the debounced term and `J` closes the dropdown and
// records the patient as recently viewed.
//
// It must NOT go into the sibling container for the recently-searched list (no search term)
// and must not also be added inside PatientSearch (4959.js): that renders it twice.
const compactSlot = slot('p', 'patient-search-remote-results-slot', '{query:E,onPatientOpened:J}').replace(
  'i().createElement',
  'a().createElement',
);

patchChunk('8383.js', [
  [
    'floating results container',
    '"data-tutorial-target":"floating-search-results-container"},a().createElement(m.A,F({query:E,ref:C},B)))',
    '"data-tutorial-target":"floating-search-results-container"},a().createElement(m.A,F({query:E,ref:C},B)),' +
      compactSlot +
      ')',
  ],
]);

// -----------------------------------------------------------------------------
// 4959.js - PatientSearch (the local results inside the dropdown): heading only
// -----------------------------------------------------------------------------
patchChunk('4959.js', [
  [
    'results heading',
    'i().createElement("p",{className:p.A.resultsText},$("searchResultsCount","{{count}} search result",{count:A}))',
    'i().createElement("p",{className:p.A.resultsText,style:{margin:0,padding:"1rem 1.5rem",background:"#f4f4f4",' +
      'borderBottom:"1px solid #e0e0e0",...' +
      labelStyle +
      '}},$(' +
      localKey +
      ',' +
      localLabel('A') +
      '))',
  ],
]);

// -----------------------------------------------------------------------------
// 5882.js - module 6084: the /search page, its sidebar and the workspace layout
// -----------------------------------------------------------------------------
// Module-level: `i` React, `o` classnames, `l` @openmrs/esm-framework, `u` the patient-search
// context module (u.cn = usePatientSearchContext, u.Cz = usePatientSearchContext2).
//
// The results component (Y) shadows `u`, so the two context hooks are aliased at module level
// just before B (the banner, which uses them) where `u` is still the context module.
//
// In Y: t = query, s = inTabletOrOverlay, u = isLoading, h = number of local results,
// f = t(), w = the local results view.
const summarySlot = slot('l', 'patient-search-remote-summary-slot', '{query:t,localCount:h,isLoading:u,inTabletOrOverlay:s}');

// In a workspace (Add patient to queue, book appointment...) the workspace hands a callback to
// the search context; Import & Open calls it instead of opening the chart, exactly as clicking a
// local result does in the banner (B). The workspace v2 context wins over the v1 one.
const selectionCallback =
  '(function(){var c2=__liberiaUsePatientSearchContext2(),c1=__liberiaUsePatientSearchContext();' +
  'if(c2&&c2.onPatientSelected)return function(id,p){return c2.onPatientSelected(id,p,c2.launchChildWorkspace,c2.closeWorkspace)};' +
  'if(c1&&c1.nonNavigationSelectPatientAction)return function(id,p){c1.nonNavigationSelectPatientAction(id,p);' +
  'c1.patientClickSideEffect&&c1.patientClickSideEffect(id,p)}})()';
const resultsSlot = slot(
  'l',
  'patient-search-remote-results-slot',
  `{query:t,isFullPage:!0,inTabletOrOverlay:s,onPatientSelected:${selectionCallback}}`,
);

const h2Head =
  'i().createElement("h2",{className:o()(N.resultsHeader,N.productiveHeading02,H({},N.leftPaddedResultHeader,s))},' +
  'u?f("searchingText","Searching..."):f("searchResultsCount","{{count}} search result",{count:h}))';
const h2Patched =
  summarySlot +
  ',i().createElement("h2",{className:o()(N.resultsHeader,N.productiveHeading02,H({},N.leftPaddedResultHeader,s)),style:' +
  labelStyle +
  '},u?f("searchingText","Searching..."):f(' +
  localKey +
  ',' +
  localLabel('h') +
  '))';

patchChunk('5882.js', [
  [
    'context hook aliases',
    'var B=function(e){var n,t=e.patient',
    `var __liberiaUsePatientSearchContext=u.cn,__liberiaUsePatientSearchContext2=u.Cz;var B=function(e){var n,t=e.patient`,
  ],
  ['results heading', h2Head, h2Patched],
  [
    'results slot after the local results',
    '),w),_?i().createElement("div",{className:o()(N.pagination,H({},N.stickyPagination,r))}',
    `),w,${resultsSlot}),_?i().createElement("div",{className:o()(N.pagination,H({},N.stickyPagination,r))}`,
  ],
  [
    // Tablet and phone layouts (and the workspaces) replace the sidebar with the "Add additional
    // search criteria" dialog; the toggle goes after its fields, above Reset fields / Apply.
    // `l` is still the framework here: RefineSearchTablet uses l.ChevronDownIcon.
    'refine search tablet dialog',
    'i().createElement("form",{onSubmit:g,role:"refine-search-tablet"},y,i().createElement("div",{className:o()(ed.buttonSet,ed.paddedButtons)}',
    `i().createElement("form",{onSubmit:g,role:"refine-search-tablet"},y,${slot('l', 'patient-search-remote-toggle-slot', '{inDialog:!0}')},i().createElement("div",{className:o()(ed.buttonSet,ed.paddedButtons)}`,
  ],
  [
    'refine search sidebar',
    'w,i().createElement("hr",{className:o()(eb.field,eb.horizontalDivider)})',
    `w,${slot('l', 'patient-search-remote-toggle-slot')},i().createElement("hr",{className:o()(eb.field,eb.horizontalDivider)})`,
  ],
]);

// -----------------------------------------------------------------------------
// importmap: follow the renamed patient-search directory
// -----------------------------------------------------------------------------
let importMapStr = fs.readFileSync(importMapPath, 'utf8');
assertOneOccurrence(importMapStr, originalDirName, 'importmap.json patient-search entry');
// The renamed directory (below) busts browser caches, so the importmap follows it.
importMapStr = importMapStr.replace(originalDirName, () => patchedDirName);
JSON.parse(importMapStr); // fail here, not in the browser
fs.writeFileSync(importMapPath, importMapStr);

// Rename so browsers do not serve the previous build of the patient-search app from cache.
// A directory from an earlier image layer cannot be renamed on the overlay filesystem
// (EXDEV), so fall back to copy and delete.
const patchedDir = path.join(spaDir, patchedDirName);
try {
  fs.renameSync(moduleDir, patchedDir);
} catch (e) {
  if (e.code !== 'EXDEV') throw e;
  fs.cpSync(moduleDir, patchedDir, { recursive: true });
  fs.rmSync(moduleDir, { recursive: true, force: true });
}
console.log('OK  Done');
