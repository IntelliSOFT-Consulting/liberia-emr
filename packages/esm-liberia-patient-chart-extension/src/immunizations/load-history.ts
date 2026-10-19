import type { FhirImmunization, NationalEncounter } from './history';

type Page = {
  resourceType?: string;
  type?: string;
  total?: number;
  entry?: Array<{ resource: FhirImmunization }>;
  link?: Array<{ relation: string; url: string }>;
  results?: NationalEncounter[];
  links?: Array<{ rel: string; uri: string }>;
};

/** Pagination is mandatory: a first page is not evidence that a later dose is absent. */
export async function loadHistory(
  fhirUrl: string, encounterUrl: string, fetchPage: (url: string) => Promise<Page>,
) {
  async function allPages(initialUrl: string, fhir: boolean) {
    const records: Array<FhirImmunization | NationalEncounter> = [];
    const seen = new Set<string>();
    const base = new URL(initialUrl, 'http://openmrs.local');
    let url: string | undefined = initialUrl;
    let expectedTotal: number | undefined;
    while (url) {
      const parsed = new URL(url, base);
      if (parsed.origin !== base.origin || parsed.pathname !== base.pathname || seen.has(parsed.href)) {
        throw new Error('Invalid or repeated history pagination link');
      }
      seen.add(parsed.href);
      const page = await fetchPage(url);
      if (fhir) {
        if (page.resourceType !== 'Bundle' || page.type !== 'searchset' ||
          (page.entry !== undefined && !Array.isArray(page.entry))) throw new Error('Invalid Immunization history response');
        if (expectedTotal === undefined) expectedTotal = page.total;
        records.push(...(page.entry ?? []).map((entry) => entry.resource));
      } else {
        if (!Array.isArray(page.results)) throw new Error('Invalid national history response');
        records.push(...page.results);
      }
      const next = fhir ? page.link?.filter((link) => link.relation === 'next').map((link) => link.url)
        : page.links?.filter((link) => link.rel === 'next').map((link) => link.uri);
      if (next && (next.length > 1 || next.some((link) => !link))) throw new Error('Ambiguous next history page');
      const href = next?.[0];
      if (!href) url = undefined;
      else {
        const resolved = new URL(href, parsed);
        url = base.origin === 'http://openmrs.local' ? `${resolved.pathname}${resolved.search}` : resolved.href;
        if (resolved.origin !== base.origin) throw new Error('History pagination changed origin');
      }
    }
    if (fhir && expectedTotal !== undefined && records.length !== expectedTotal) throw new Error('Incomplete Immunization history');
    return records;
  }
  const [fhir, encounters] = await Promise.all([allPages(fhirUrl, true), allPages(encounterUrl, false)]);
  return { fhir: fhir as FhirImmunization[], encounters: encounters as NationalEncounter[] };
}
