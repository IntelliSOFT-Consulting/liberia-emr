import { useMemo } from 'react';
import useSwrImmutable from 'swr/immutable';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

/**
 * The facility switcher (ADR 0009 decision 6) lists every location carrying one tag, which at
 * central is about 1,000 MFL facilities. Neither the REST nor the FHIR location search can
 * match on a location attribute, and the switcher must find a facility by its MFL code, so the
 * tagged list is fetched once per session in a slim representation and filtered in the browser.
 */

export interface FacilityOption {
  uuid: string;
  name: string;
  code: string;
  district: string;
  districtUuid: string;
  county: string;
  countyUuid: string;
}

interface RestLocationRef {
  uuid: string;
  display: string;
  parentLocation?: RestLocationRef | null;
}

interface RestFacility extends RestLocationRef {
  attributes?: Array<{ value: string; attributeType: { uuid: string } }>;
  /** County and district names. The MFL sync writes them on every facility (ADR 0009 decision 3). */
  stateProvince?: string | null;
  countyDistrict?: string | null;
}

interface RestPage {
  results: Array<RestFacility>;
  totalCount?: number;
}

// REST caps a page at webservices.rest.maxResultsAbsolute, 100 by default.
export const FACILITY_PAGE_SIZE = 100;

const representation =
  'custom:(uuid,display,stateProvince,countyDistrict,' +
  'parentLocation:(uuid,display,parentLocation:(uuid,display)),' +
  'attributes:(value,attributeType:(uuid)))';

export function facilityPageUrl(locationTag: string, startIndex: number) {
  const params = new URLSearchParams({
    tag: locationTag,
    v: representation,
    limit: String(FACILITY_PAGE_SIZE),
    startIndex: String(startIndex),
  });
  if (startIndex === 0) {
    params.set('totalCount', 'true');
  }
  return `${restBaseUrl}/location?${params}`;
}

function collapse(value: string) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function toFacilityOption(location: RestFacility, mflCodeAttributeTypeUuid: string): FacilityOption {
  const parent = location.parentLocation;
  const grandparent = parent?.parentLocation;
  // A facility sits under a district, which sits under a county. A location hung directly
  // under a county has no district. An adopted site root is top-level, because content owns its
  // parent (ADR 0009 decision 1), so its areas come from its address; resolveAddressAreas then
  // gives them the uuids of the matching county and district.
  const district = grandparent ? parent : null;
  const county = grandparent ?? parent;
  const code = location.attributes?.find((a) => a.attributeType?.uuid === mflCodeAttributeTypeUuid)?.value;

  return {
    uuid: location.uuid,
    name: collapse(location.display),
    code: collapse(code),
    district: collapse(district ? district.display : location.countyDistrict),
    districtUuid: district?.uuid ?? '',
    county: collapse(county ? county.display : location.stateProvince),
    countyUuid: county?.uuid ?? '',
  };
}

const areaKey = (...names: Array<string>) => names.map((name) => collapse(name).toLowerCase()).join('/');

/**
 * Gives an area named only by its address the uuid of the county or district location with that
 * name, so narrowing by county and district finds it. An area no located facility names gets an
 * `address:` key instead, so it still appears in the selects.
 */
export function resolveAddressAreas(facilities: Array<FacilityOption>): Array<FacilityOption> {
  const counties = new Map<string, FacilityOption>();
  const districts = new Map<string, FacilityOption>();
  for (const facility of facilities) {
    if (facility.countyUuid) {
      counties.set(areaKey(facility.county), facility);
    }
    if (facility.districtUuid) {
      districts.set(areaKey(facility.county, facility.district), facility);
    }
  }
  return facilities.map((facility) => {
    if (facility.countyUuid || (!facility.county && !facility.district)) {
      return facility;
    }
    const county = counties.get(areaKey(facility.county));
    const district = facility.district ? districts.get(areaKey(facility.county, facility.district)) : undefined;
    return {
      ...facility,
      county: county?.county ?? facility.county,
      countyUuid: county?.countyUuid ?? (facility.county ? `address:${areaKey(facility.county)}` : ''),
      district: district?.district ?? facility.district,
      districtUuid:
        district?.districtUuid ??
        (facility.district ? `address:${areaKey(facility.county, facility.district)}` : ''),
    };
  });
}

export async function fetchFacilities(locationTag: string, mflCodeAttributeTypeUuid: string) {
  const first = await openmrsFetch<RestPage>(facilityPageUrl(locationTag, 0));
  const total = first.data.totalCount ?? first.data.results.length;
  const rest = [];
  for (let start = FACILITY_PAGE_SIZE; start < total; start += FACILITY_PAGE_SIZE) {
    rest.push(openmrsFetch<RestPage>(facilityPageUrl(locationTag, start)));
  }
  const pages = [first, ...(await Promise.all(rest))];

  return resolveAddressAreas(
    pages.flatMap((page) => page.data.results).map((location) => toFacilityOption(location, mflCodeAttributeTypeUuid)),
  ).sort((a, b) => a.name.localeCompare(b.name));
}

export function useFacilities(locationTag: string, mflCodeAttributeTypeUuid: string) {
  const { data, error, isLoading } = useSwrImmutable(
    locationTag ? ['liberiaemr-facility-switcher', locationTag, mflCodeAttributeTypeUuid] : null,
    ([, tag, codeType]) => fetchFacilities(tag, codeType),
  );

  return useMemo(() => ({ facilities: data ?? [], error, isLoading }), [data, error, isLoading]);
}

export interface FacilityFilter {
  query: string;
  countyUuid: string;
  districtUuid: string;
}

/** Case- and whitespace-insensitive match on the facility name or its MFL code. */
export function filterFacilities(facilities: Array<FacilityOption>, { query, countyUuid, districtUuid }: FacilityFilter) {
  const needle = collapse(query).toLowerCase();
  return facilities.filter(
    (facility) =>
      (!countyUuid || facility.countyUuid === countyUuid) &&
      (!districtUuid || facility.districtUuid === districtUuid) &&
      (!needle || facility.name.toLowerCase().includes(needle) || facility.code.toLowerCase().includes(needle)),
  );
}

/** The distinct counties, and the districts of the chosen county, for the two narrowing selects. */
export function facilityAreas(facilities: Array<FacilityOption>, countyUuid: string) {
  const counties = new Map<string, string>();
  const districts = new Map<string, string>();
  for (const facility of facilities) {
    if (facility.countyUuid) {
      counties.set(facility.countyUuid, facility.county);
    }
    if (facility.districtUuid && (!countyUuid || facility.countyUuid === countyUuid)) {
      districts.set(facility.districtUuid, facility.district);
    }
  }
  const sorted = (areas: Map<string, string>) =>
    [...areas].map(([uuid, name]) => ({ uuid, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { counties: sorted(counties), districts: sorted(districts) };
}
