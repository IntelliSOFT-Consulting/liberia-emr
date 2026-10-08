import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getConfig, navigate, showModal, useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { importRemotePatient, useRemotePatientSearch, useRemoteSearchStatus } from './import-patient.resource';
import { importPrivileges } from './remote-search.context';
import RemoteSearchResults from './remote-search-results.component';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (vars && name in vars ? String(vars[name]) : match)),
  }),
}));

jest.mock('./import-patient.resource', () => ({
  ...jest.requireActual('./import-patient.resource'),
  useRemoteSearchStatus: jest.fn(),
  useRemotePatientSearch: jest.fn(),
  importRemotePatient: jest.fn(),
  fetchFhirPatient: jest.fn(),
}));

const mockUseConfig = useConfig as jest.Mock;
const mockGetConfig = getConfig as jest.Mock;
const mockUseSession = useSession as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;
const mockShowModal = showModal as jest.Mock;
const mockNavigate = navigate as jest.Mock;
const mockUseRemoteSearchStatus = useRemoteSearchStatus as jest.Mock;
const mockUseRemotePatientSearch = useRemotePatientSearch as jest.Mock;
const mockImportRemotePatient = importRemotePatient as jest.Mock;

const NEW_UUID = '22222222-2222-2222-2222-222222222222';
const LOCAL_UUID = '11111111-1111-1111-1111-111111111111';

const patient = (uuid: string, alreadyLocal = false) => ({
  uuid,
  alreadyLocal,
  person: { display: 'Jane Doe', gender: 'F', birthdate: '1997-01-11' },
  identifiers: [{ identifier: 'BC-2026-00417', preferred: true, identifierType: { name: 'MOH Health Record Number' } }],
});

const given = ({ canImport = true, results = [patient(NEW_UUID)], alreadyLocalCount = 0 } = {}) => {
  const config = { enabled: true, defaultToggleOn: true, resetToggleOnClose: false };
  mockUseConfig.mockReturnValue(config);
  // The toggle store reads its default once, asynchronously; on, so it agrees with turnOn below.
  mockGetConfig.mockResolvedValue(config);
  mockUseRemoteSearchStatus.mockReturnValue({ status: { enabled: true } });
  mockUseRemotePatientSearch.mockReturnValue({
    results,
    alreadyLocalCount,
    isLoading: false,
    error: undefined,
    hasSearched: true,
  });
  mockUseSession.mockReturnValue({ authenticated: true, user: { uuid: 'u', privileges: [], roles: [] } });
  mockUserHasAccess.mockImplementation(
    (required: string | Array<string>) =>
      canImport && Array.isArray(required) && required.every((privilege) => importPrivileges.includes(privilege)),
  );
};

const setOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
};

describe('remote search results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setOnline(true);
  });

  // The full-page section hides while Remote Search is off.
  const turnOn = async () => {
    const { remoteSearchStore } = await import('./remote-search.context');
    await act(async () => remoteSearchStore.setState({ isRemoteSearchEnabled: true }));
  };

  it('offers Import & Open to a user with Import Remote Patient (1a)', async () => {
    given();
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);

    expect(screen.getByRole('button', { name: 'Import & Open' })).toBeInTheDocument();
    expect(screen.queryByText('Ask a Records Officer to import this patient.')).not.toBeInTheDocument();
    expect(mockUserHasAccess).toHaveBeenCalledWith(['Add Patients', 'Import Remote Patient'], expect.anything());
  });

  it('shows the hint and no button to a user without it (1b)', async () => {
    given({ canImport: false });
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);

    expect(screen.getByText('Ask a Records Officer to import this patient.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import & Open' })).not.toBeInTheDocument();
  });

  it('opens a patient already at this facility straight away, with no modal and no import (3c)', async () => {
    given({ canImport: false, results: [patient(LOCAL_UUID, true)] });
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);

    expect(screen.getByText('Already imported at this facility')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: `\${openmrsSpaBase}/patient/${LOCAL_UUID}/chart` }),
    );
    expect(mockShowModal).not.toHaveBeenCalled();
    expect(mockImportRemotePatient).not.toHaveBeenCalled();
  });

  it('asks for the reason first and sends nothing when the modal is cancelled', async () => {
    given();
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Import & Open' }));

    expect(mockShowModal).toHaveBeenCalledWith(
      'liberia-reason-for-access-modal',
      expect.objectContaining({ onConfirm: expect.any(Function) }),
    );
    // Cancel closes the modal without calling onConfirm.
    expect(mockImportRemotePatient).not.toHaveBeenCalled();
  });

  it('sends the reason with the import once confirmed, then opens the chart', async () => {
    given();
    mockImportRemotePatient.mockResolvedValue({ localUuid: NEW_UUID, created: true, history: 'retrieved' });
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Import & Open' }));
    const { onConfirm } = mockShowModal.mock.calls[0][1];
    await act(async () => onConfirm('Visiting patient'));

    expect(mockImportRemotePatient).toHaveBeenCalledWith(NEW_UUID, 'Visiting patient');
    expect(mockNavigate).toHaveBeenCalledWith({ to: `\${openmrsSpaBase}/patient/${NEW_UUID}/chart` });
  });

  it('still reports matches already here when the backend leaves them out and only counts them', async () => {
    // A backend without the alreadyLocal flag: every match is local, so none are listed.
    given({ results: [], alreadyLocalCount: 2 });
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);

    expect(
      screen.getByText(
        '2 matching patient(s) on the central server are already at this facility. See the local results.',
      ),
    ).toBeInTheDocument();
  });

  it('says no patients match when nothing at central matches', async () => {
    given({ results: [], alreadyLocalCount: 0 });
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);

    expect(screen.getByText('No patients on the central server match "Jane Doe".')).toBeInTheDocument();
  });

  it('says why Remote Search is unavailable offline', async () => {
    given();
    setOnline(false);
    await turnOn();
    render(<RemoteSearchResults query="Jane Doe" />);

    expect(
      screen.getByText('Remote Search is unavailable offline. This facility cannot reach central.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import & Open' })).not.toBeInTheDocument();
  });
});
