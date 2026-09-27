import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openmrsFetch, type FetchResponse } from '@openmrs/esm-framework';
import {
  FACILITY_PAGE_SIZE,
  facilityAreas,
  facilityPageUrl,
  fetchFacilities,
  filterFacilities,
  toFacilityOption,
  type FacilityOption,
} from './facility-picker.resource';

const CODE = '3118cabe-9a5d-420c-8a55-86234deb9b1b';
const mockOpenmrsFetch = vi.mocked(openmrsFetch);

const county = { uuid: 'county-1', display: 'Montserrado' };
const district = { uuid: 'district-1', display: 'Careysburg', parentLocation: county };

function restFacility(uuid: string, display: string, code?: string) {
  return {
    uuid,
    display,
    parentLocation: district,
    attributes: code
      ? [
          { value: 'Clinic', attributeType: { uuid: 'type-attr' } },
          { value: code, attributeType: { uuid: CODE } },
        ]
      : [],
  };
}

const facilities: Array<FacilityOption> = [
  {
    uuid: 'f1',
    name: 'Careysburg Clinic',
    code: 'LBR-06-0607-02',
    district: 'Careysburg',
    districtUuid: 'd1',
    county: 'Montserrado',
    countyUuid: 'c1',
  },
  {
    uuid: 'f2',
    name: 'Barnersville HC',
    code: 'LBR-06-0601-11',
    district: 'Greater Monrovia',
    districtUuid: 'd2',
    county: 'Montserrado',
    countyUuid: 'c1',
  },
  {
    uuid: 'f3',
    name: 'Jah Clinic',
    code: 'LBR-12-0624-06',
    district: 'Kpaai',
    districtUuid: 'd3',
    county: 'Bong',
    countyUuid: 'c2',
  },
];

describe('toFacilityOption', () => {
  it('reads the MFL code, district and county, collapsing stray whitespace', () => {
    expect(toFacilityOption(restFacility('f1', '  Jah   Clinic ', ' LBR-06-0624-06 '), CODE)).toEqual({
      uuid: 'f1',
      name: 'Jah Clinic',
      code: 'LBR-06-0624-06',
      district: 'Careysburg',
      districtUuid: 'district-1',
      county: 'Montserrado',
      countyUuid: 'county-1',
    });
  });

  it('treats a parent with no parent of its own as the county', () => {
    const option = toFacilityOption({ uuid: 'f', display: 'X', parentLocation: county }, CODE);
    expect(option).toMatchObject({ county: 'Montserrado', countyUuid: 'county-1', district: '', districtUuid: '' });
  });

  it('leaves the code empty when the facility has none', () => {
    expect(toFacilityOption(restFacility('f', 'JFK Medical Center'), CODE).code).toBe('');
  });
});

describe('filterFacilities', () => {
  const none = { query: '', countyUuid: '', districtUuid: '' };

  it('returns everything when no filter is set', () => {
    expect(filterFacilities(facilities, none)).toHaveLength(3);
  });

  it('matches the name case-insensitively', () => {
    expect(filterFacilities(facilities, { ...none, query: 'jah' }).map((f) => f.uuid)).toEqual(['f3']);
  });

  it('matches part of the MFL code', () => {
    expect(filterFacilities(facilities, { ...none, query: 'lbr-06-0601' }).map((f) => f.uuid)).toEqual(['f2']);
  });

  it('narrows by county, then by district', () => {
    expect(filterFacilities(facilities, { ...none, countyUuid: 'c1' }).map((f) => f.uuid)).toEqual(['f1', 'f2']);
    expect(filterFacilities(facilities, { ...none, countyUuid: 'c1', districtUuid: 'd1' }).map((f) => f.uuid)).toEqual(
      ['f1'],
    );
  });

  it('combines the search with the area filters', () => {
    expect(filterFacilities(facilities, { query: 'clinic', countyUuid: 'c1', districtUuid: '' })).toHaveLength(1);
  });
});

describe('facilityAreas', () => {
  it('lists every county, and only the districts of the chosen county', () => {
    expect(facilityAreas(facilities, '').counties.map((c) => c.name)).toEqual(['Bong', 'Montserrado']);
    expect(facilityAreas(facilities, 'c1').districts.map((d) => d.name)).toEqual(['Careysburg', 'Greater Monrovia']);
    expect(facilityAreas(facilities, '').districts).toHaveLength(3);
  });
});

describe('fetchFacilities', () => {
  beforeEach(() => {
    mockOpenmrsFetch.mockReset();
  });

  it('asks for the tagged locations in a slim representation, with the total on the first page only', () => {
    const first = new URL(facilityPageUrl('Health Facility', 0), 'http://x');
    expect(first.pathname).toBe('/ws/rest/v1/location');
    expect(first.searchParams.get('tag')).toBe('Health Facility');
    expect(first.searchParams.get('limit')).toBe(String(FACILITY_PAGE_SIZE));
    expect(first.searchParams.get('totalCount')).toBe('true');
    expect(first.searchParams.get('v')).toContain('attributes:(value,attributeType:(uuid))');
    expect(new URL(facilityPageUrl('Health Facility', 100), 'http://x').searchParams.has('totalCount')).toBe(false);
  });

  it('fetches every page and returns the facilities sorted by name', async () => {
    const total = FACILITY_PAGE_SIZE * 2 + 5;
    mockOpenmrsFetch.mockImplementation(async (url: string) => {
      const start = Number(new URL(url, 'http://x').searchParams.get('startIndex'));
      const size = Math.min(FACILITY_PAGE_SIZE, total - start);
      const results = Array.from({ length: size }, (_, i) =>
        restFacility(`f${start + i}`, `Facility ${String(total - start - i).padStart(3, '0')}`, `C${start + i}`),
      );
      return { data: { results, totalCount: start === 0 ? total : undefined } } as FetchResponse<unknown>;
    });

    const result = await fetchFacilities('Health Facility', CODE);

    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(total);
    expect(result[0].name).toBe('Facility 001');
    expect(result[total - 1].name).toBe(`Facility ${total}`);
  });
});
