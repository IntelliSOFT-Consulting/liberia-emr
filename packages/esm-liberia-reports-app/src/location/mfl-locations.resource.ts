import { useMemo } from 'react';
import useSWRImmutable from 'swr/immutable';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

/**
 * The MFL hierarchy for the central location picker.
 *
 * Aligned with the login app's facility switcher (LE-324, esm-liberia-login-app
 * `location-picker/facility-picker.resource.ts`): the same tag, the same slim representation and
 * paging, and the same facility → district → county reading of parentLocation. Kept as a copy
 * rather than a shared package until a third module needs it; keep the two in step.
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

export interface Area {
  uuid: string;
  name: string;
}

interface RestLocationRef {
  uuid: string;
  display: string;
  parentLocation?: RestLocationRef | null;
}

interface RestFacility extends RestLocationRef {
  attributes?: Array<{ value: string; attributeType: { uuid: string } }>;
}

interface RestPage {
  results: Array<RestFacility>;
  totalCount?: number;
}

// REST caps a page at webservices.rest.maxResultsAbsolute, 100 by default.
export const FACILITY_PAGE_SIZE = 100;

const representation =
  'custom:(uuid,display,parentLocation:(uuid,display,parentLocation:(uuid,display)),' +
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

function collapse(value?: string) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function toFacilityOption(location: RestFacility, mflCodeAttributeTypeUuid: string): FacilityOption {
  const parent = location.parentLocation;
  const grandparent = parent?.parentLocation;
  // A facility sits under a district, which sits under a county. A location hung directly
  // under a county has no district.
  const district = grandparent ? parent : null;
  const county = grandparent ?? parent;
  const code = mflCodeAttributeTypeUuid
    ? location.attributes?.find((a) => a.attributeType?.uuid === mflCodeAttributeTypeUuid)?.value
    : '';

  return {
    uuid: location.uuid,
    name: collapse(location.display),
    code: collapse(code),
    district: collapse(district?.display),
    districtUuid: district?.uuid ?? '',
    county: collapse(county?.display),
    countyUuid: county?.uuid ?? '',
  };
}

export async function fetchFacilities(locationTag: string, mflCodeAttributeTypeUuid: string) {
  const first = await openmrsFetch<RestPage>(facilityPageUrl(locationTag, 0));
  const total = first.data.totalCount ?? first.data.results.length;
  const rest = [];
  for (let start = FACILITY_PAGE_SIZE; start < total; start += FACILITY_PAGE_SIZE) {
    rest.push(openmrsFetch<RestPage>(facilityPageUrl(locationTag, start)));
  }
  const pages = [first, ...(await Promise.all(rest))];

  return pages
    .flatMap((page) => page.data.results)
    .map((location) => toFacilityOption(location, mflCodeAttributeTypeUuid))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function useFacilities(locationTag: string, mflCodeAttributeTypeUuid: string, enabled = true) {
  const { data, error, isLoading } = useSWRImmutable(
    enabled && locationTag ? ['liberiaemr-reports-facilities', locationTag, mflCodeAttributeTypeUuid] : null,
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

/**
 * The distinct counties, and the districts of the chosen county. They are read off the
 * facilities, so a county or district with no tagged facility is not offered: it would report
 * nothing anyway.
 */
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
  const sorted = (areas: Map<string, string>): Array<Area> =>
    [...areas].map(([uuid, name]) => ({ uuid, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { counties: sorted(counties), districts: sorted(districts) };
}
