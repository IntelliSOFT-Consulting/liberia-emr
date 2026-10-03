/**
 * Serves this checkout's build of a LiberiaEMR frontend module in place of the one the SPA serves,
 * when the served one is missing or older than the behaviour under test.
 *
 * A change to one of packages/esm-liberia-* reaches the distribution only after packages.yml has
 * published a pre-release from main and distribution/distro.properties is re-pinned to it, in a
 * follow-up PR. Until then the SPA the gateway serves runs the previous build, and a spec of the
 * new behaviour could not pass on the PR that makes it. So, per module, this asks the served SPA:
 * is the module in importmap.json, and (with `needs`) does its entry in routes.registry.json
 * register that extension? Only if not, it intercepts both files to point the module at
 * packages/<dir>/dist/, served from memory under /openmrs/spa/__e2e__/<dir>/. CI's E2E job builds
 * those dists first. Once the pin carries the change, the served SPA passes the check and the spec
 * tests exactly what the distribution ships; the overlay goes unused.
 *
 * Intercepts last one test, so call it in each test (or a beforeEach) before cy.visit.
 */
export type LocalEsm = {
  /** The npm name, as in the import map: '@liberiaemr/esm-liberia-audit-log-app'. */
  module: string;
  /** Its directory under packages/. */
  dir: string;
  /** An extension name the served build must register for it to be used as it is. */
  needs?: string;
};

type Routes = { extensions?: Array<{ name: string }> };

const json = (body: unknown) => (typeof body === 'string' ? JSON.parse(body) : body);

// No cached copy: a 304 would carry no body to add the module to.
const fresh = (req: { headers: Record<string, unknown> }) => {
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
};

/** Overlays each stale module; yields the names it overlaid (empty once all are pinned). */
export const loadLocalEsms = (esms: Array<LocalEsm>): Cypress.Chainable<Array<string>> =>
  cy.request('/openmrs/spa/importmap.json').then(({ body: mapBody }) =>
    cy.request('/openmrs/spa/routes.registry.json').then(({ body: registryBody }) => {
      const served: { imports?: Record<string, string> } = json(mapBody);
      const registry: Record<string, Routes> = json(registryBody) ?? {};
      const stale = esms.filter(
        ({ module, needs }) =>
          !served.imports?.[module] ||
          (needs !== undefined && !registry[module]?.extensions?.some((extension) => extension.name === needs)),
      );
      if (!stale.length) {
        return cy.wrap([] as Array<string>, { log: false });
      }

      const routes: Record<string, unknown> = {};
      const files: Record<string, Record<string, string>> = {};
      stale.forEach(({ module, dir }) => {
        // Both paths relative to qa/e2e: readFile resolves from the project, readDist from its cwd.
        cy.readFile(`../../packages/${dir}/dist/routes.json`, { log: false }).then((r) => (routes[module] = r));
        cy.task<Record<string, string>>('readDist', `../../packages/${dir}/dist`, { log: false }).then(
          (f) => (files[dir] = f),
        );
      });

      return cy.then(() => {
        cy.intercept('GET', '**/openmrs/spa/importmap.json*', (req) => {
          fresh(req);
          req.continue((res) => {
            const map = json(res.body);
            stale.forEach(({ module, dir }) => {
              map.imports[module] = `./__e2e__/${dir}/${module.replace('@', '').replace('/', '-')}.js`;
            });
            res.body = map;
          });
        });
        cy.intercept('GET', '**/openmrs/spa/routes.registry.json*', (req) => {
          fresh(req);
          req.continue((res) => {
            const map = json(res.body);
            stale.forEach(({ module }) => (map[module] = routes[module]));
            res.body = map;
          });
        });
        stale.forEach(({ dir }) => {
          cy.intercept('GET', `**/openmrs/spa/__e2e__/${dir}/*`, (req) => {
            const file = new URL(req.url).pathname.split('/').pop() ?? '';
            if (!(file in files[dir])) {
              req.reply({ statusCode: 404, body: '' });
              return;
            }
            req.reply({
              body: files[dir][file],
              headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/javascript' },
            });
          });
        });
        const names = stale.map(({ module }) => module);
        cy.log(`Serving this checkout's build of ${names.join(', ')}`);
        return cy.wrap(names, { log: false });
      });
    }),
  );

/** LiberiaEMR's apps that register a home dashboard (LE-397), as RoleSignIn and AuditLog load them. */
export const DASHBOARD_APPS: Array<LocalEsm> = [
  { module: '@liberiaemr/esm-liberia-reports-app', dir: 'esm-liberia-reports-app', needs: 'indicator-reports-dashboard-link' },
  { module: '@liberiaemr/esm-liberia-audit-log-app', dir: 'esm-liberia-audit-log-app', needs: 'audit-log-dashboard-link' },
  {
    module: '@liberiaemr/esm-liberia-sync-status-app',
    dir: 'esm-liberia-sync-status-app',
    needs: 'sync-conflicts-dashboard-link',
  },
];
