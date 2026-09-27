import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import {
  LocationPicker,
  openmrsFetch,
  setSessionLocation,
  useConfig,
  useConnectivity,
  useSession,
  type FetchResponse,
  type LoggedInUser,
  type Session,
} from '@openmrs/esm-framework';
import { mockConfig } from '../../__mocks__/config.mock';
import renderWithRouter from '../test-helpers/render-with-router';
import FacilityPicker from './facility-picker.component';
import LocationPickerView from './location-picker-view.component';

const CODE = '3118cabe-9a5d-420c-8a55-86234deb9b1b';
const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const mockUseConfig = vi.mocked(useConfig);
const mockUseSession = vi.mocked(useSession);
const mockUseConnectivity = vi.mocked(useConnectivity);
const mockLocationPicker = vi.mocked(LocationPicker);
const mockSetSessionLocation = vi.mocked(setSessionLocation);

const montserrado = { uuid: 'c1', display: 'Montserrado' };
const bong = { uuid: 'c2', display: 'Bong' };
const careysburgDistrict = { uuid: 'd1', display: 'Careysburg', parentLocation: montserrado };
const kpaai = { uuid: 'd3', display: 'Kpaai', parentLocation: bong };
const loc = (uuid: string, display: string, parent: object, code: string) => ({
  uuid,
  display,
  parentLocation: parent,
  attributes: [{ value: code, attributeType: { uuid: CODE } }],
});

const restLocations = [
  loc('f1', 'Careysburg Clinic', careysburgDistrict, 'LBR-06-0607-02'),
  loc('f2', 'Jah Clinic', kpaai, 'LBR-12-0624-06'),
  loc('f3', 'Jah Clinic', careysburgDistrict, 'LBR-06-0607-09'),
];

function mockBackend() {
  mockOpenmrsFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/ws/rest/v1/location?')) {
      return { data: { results: restLocations, totalCount: restLocations.length } } as FetchResponse<unknown>;
    }
    // useLocationCount's FHIR count query.
    return {
      data: { total: restLocations.length, entry: [{ resource: { id: 'f1' } }] },
    } as FetchResponse<unknown>;
  });
}

function renderPicker(props: Partial<React.ComponentProps<typeof FacilityPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <FacilityPicker
        locationTag="Health Facility"
        mflCodeAttributeTypeUuid={CODE}
        maxResults={50}
        onChange={onChange}
        {...props}
      />
    </SWRConfig>,
  );
  return { onChange };
}

describe('FacilityPicker', () => {
  beforeEach(mockBackend);

  it('lists each facility with its district and MFL code, so same-named facilities can be told apart', async () => {
    renderPicker();

    const radios = await screen.findAllByRole('radio', { name: /jah clinic/i });
    expect(radios).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /kpaai · LBR-12-0624-06/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /careysburg · LBR-06-0607-09/i })).toBeInTheDocument();
  });

  it('finds a facility by its MFL code', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findAllByRole('radio');

    await user.type(screen.getByRole('searchbox'), '0624');

    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /jah clinic.*kpaai/i })).toBeInTheDocument();
  });

  it('narrows by county and then district', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findAllByRole('radio');

    await user.selectOptions(screen.getByLabelText('County'), 'c1');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    const districtSelect = screen.getByLabelText('District');
    expect(within(districtSelect).queryByRole('option', { name: 'Kpaai' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('County'), 'c2');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('reports the selected facility and clears the selection when the search changes', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(await screen.findByRole('radio', { name: /careysburg clinic/i }));
    expect(onChange).toHaveBeenLastCalledWith('f1');

    await user.type(screen.getByRole('searchbox'), 'j');
    expect(onChange).toHaveBeenLastCalledWith();
  });

  it('puts the saved default facility first', async () => {
    renderPicker({ defaultLocationUuid: 'f3' });

    const radios = await screen.findAllByRole('radio');
    expect((radios[0] as HTMLInputElement).value).toBe('f3');
  });

  it('caps the list and says how to see more', async () => {
    renderPicker({ maxResults: 2 });

    expect(await screen.findAllByRole('radio')).toHaveLength(2);
    // The i18n test mock does not interpolate {{shown}}/{{total}}.
    expect(screen.getByRole('status')).toHaveTextContent('Refine your search to see more.');
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findAllByRole('radio');

    await user.type(screen.getByRole('searchbox'), 'no such place');

    expect(screen.getByText('No facilities match your search')).toBeInTheDocument();
  });

  it('shows an error when the facilities cannot be loaded', async () => {
    mockOpenmrsFetch.mockRejectedValue(new Error('boom'));
    renderPicker();

    expect(await screen.findByText('Facilities could not be loaded')).toBeInTheDocument();
  });
});

describe('LocationPickerView facility switcher wiring', () => {
  beforeEach(() => {
    mockBackend();
    mockUseConnectivity.mockReturnValue(true);
    mockUseSession.mockReturnValue({
      user: { display: 'Testy', uuid: 'u1', userProperties: {} } as LoggedInUser,
    } as Session);
  });

  it('keeps the framework LocationPicker with the Login Location tag when no locationTag is set', async () => {
    mockUseConfig.mockReturnValue(mockConfig);
    renderWithRouter(LocationPickerView, {});

    expect(mockLocationPicker).toHaveBeenCalled();
    expect(mockLocationPicker.mock.lastCall[0]).toMatchObject({ locationTag: 'Login Location' });
    expect(screen.queryByLabelText('County')).not.toBeInTheDocument();
    expect(mockOpenmrsFetch.mock.calls.some(([url]) => String(url).startsWith('/ws/rest/v1/location?'))).toBe(false);
  });

  it('uses the facility switcher, and counts locations by that tag, when locationTag is set', async () => {
    mockUseConfig.mockReturnValue({
      ...mockConfig,
      chooseLocation: { ...mockConfig.chooseLocation, locationTag: 'Health Facility' },
    });
    renderWithRouter(LocationPickerView, {});

    expect(await screen.findByLabelText('County')).toBeInTheDocument();
    expect(mockLocationPicker).not.toHaveBeenCalled();
    const countUrl = mockOpenmrsFetch.mock.calls.map(([url]) => String(url)).find((url) => url.includes('_count=1'));
    expect(countUrl).toContain('_tag=Health+Facility');
    expect(countUrl).not.toContain('Login');
  });

  describe('a saved default location', () => {
    const tagged = {
      ...mockConfig,
      chooseLocation: { ...mockConfig.chooseLocation, locationTag: 'Health Facility' },
    };

    function withSavedDefault(uuid: string) {
      mockUseSession.mockReturnValue({
        user: { display: 'Testy', uuid: 'u1', userProperties: { defaultLocation: uuid } } as LoggedInUser,
      } as Session);
      const base = mockOpenmrsFetch.getMockImplementation();
      mockOpenmrsFetch.mockImplementation(async (url: string, init?: unknown) => {
        if (url.includes(`Location?_id=${uuid}`)) {
          // A real, valid location: useDefaultLocation accepts it.
          return { ok: true, data: { total: 1, entry: [{ resource: { id: uuid } }] } } as FetchResponse<unknown>;
        }
        return base(url, init as never);
      });
    }

    beforeEach(() => {
      mockSetSessionLocation.mockReset();
      mockSetSessionLocation.mockResolvedValue(undefined);
      mockUseConfig.mockReturnValue(tagged);
    });

    it('logs straight in when the saved default is one of the tagged facilities', async () => {
      withSavedDefault('f1');
      renderWithRouter(LocationPickerView, {});

      await waitFor(() => expect(mockSetSessionLocation).toHaveBeenCalledWith('f1', expect.anything()));
    });

    it('ignores a saved default that is not one of the tagged facilities', async () => {
      withSavedDefault('login-only');
      renderWithRouter(LocationPickerView, {});

      await screen.findAllByRole('radio', { name: /jah clinic/i });
      expect(mockSetSessionLocation).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    });

    it('does not preselect an untagged saved default when updating the preference', async () => {
      withSavedDefault('login-only');
      renderWithRouter(LocationPickerView, {}, { routes: ['?update=true'] });

      const radios = await screen.findAllByRole('radio');
      expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
      expect(mockSetSessionLocation).not.toHaveBeenCalled();
    });

    it('keeps Confirm disabled for a current location until the tagged list confirms it', async () => {
      let release: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const base = mockOpenmrsFetch.getMockImplementation();
      mockOpenmrsFetch.mockImplementation(async (url: string, init?: unknown) => {
        if (url.startsWith('/ws/rest/v1/location?')) {
          await gate;
        }
        return base(url, init as never);
      });
      // A tag no other test uses, so SWR has no cached list and the load is really pending.
      mockUseConfig.mockReturnValue({
        ...tagged,
        chooseLocation: { ...tagged.chooseLocation, locationTag: 'Gated Facility' },
      });
      renderWithRouter(LocationPickerView, { currentLocationUuid: 'not-tagged', hideWelcomeMessage: true });

      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
      release();
      await screen.findAllByRole('radio', { name: /jah clinic/i });
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    });

    it('enables Confirm for a current location once it is found in the tagged list', async () => {
      let release: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const base = mockOpenmrsFetch.getMockImplementation();
      mockOpenmrsFetch.mockImplementation(async (url: string, init?: unknown) => {
        if (url.startsWith('/ws/rest/v1/location?')) {
          await gate;
        }
        return base(url, init as never);
      });
      mockUseConfig.mockReturnValue({
        ...tagged,
        chooseLocation: { ...tagged.chooseLocation, locationTag: 'Gated Facility 2' },
      });
      renderWithRouter(LocationPickerView, { currentLocationUuid: 'f1', hideWelcomeMessage: true });

      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
      release();
      await screen.findAllByRole('radio', { name: /jah clinic/i });
      await waitFor(() => expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled());
    });

    it('still honours any valid saved default when no locationTag is set', async () => {
      mockUseConfig.mockReturnValue(mockConfig);
      withSavedDefault('login-only');
      renderWithRouter(LocationPickerView, {});

      await waitFor(() => expect(mockSetSessionLocation).toHaveBeenCalledWith('login-only', expect.anything()));
    });
  });
});
