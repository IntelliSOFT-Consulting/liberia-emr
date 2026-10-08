import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  getConfig,
  navigate,
  showModal,
  showSnackbar,
  useConfig,
  useSession,
  userHasAccess,
} from '@openmrs/esm-framework';
import {
  importRemotePatient,
  pingCentral,
  refreshRemoteHistory,
  useRemotePatientSearch,
  useRemoteSearchStatus,
} from './import-patient.resource';
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
  pingCentral: jest.fn(),
  importRemotePatient: jest.fn(),
  refreshRemoteHistory: jest.fn(),
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
const mockPingCentral = pingCentral as jest.Mock;
const mockRefreshRemoteHistory = refreshRemoteHistory as jest.Mock;
const mockShowSnackbar = showSnackbar as jest.Mock;

const NEW_UUID = '22222222-2222-2222-2222-222222222222';
const LOCAL_UUID = '11111111-1111-1111-1111-111111111111';

const patient = (uuid: string, alreadyLocal = false) => ({
  uuid,
  alreadyLocal,
  person: { display: 'Jane Doe', gender: 'F', age: 29, birthdate: '1997-01-11' },
  identifiers: [{ identifier: 'BC-2026-00417', preferred: true, identifierType: { name: 'MOH Health Record Number' } }],
});

const given = ({ canImport = true, results = [patient(NEW_UUID)] } = {}) => {
  const config = { enabled: true, defaultToggleOn: true, resetToggleOnClose: false };
  mockUseConfig.mockReturnValue(config);
  // The toggle store reads its default once, asynchronously; on, so it agrees with turnOn below.
  mockGetConfig.mockResolvedValue(config);
  mockUseRemoteSearchStatus.mockReturnValue({ status: { enabled: true } });
  mockUseRemotePatientSearch.mockReturnValue({ results, isLoading: false, error: undefined, hasSearched: true });
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

  // Confirms the reason and waits for the import; returns the modal's close.
  const importWithReason = async (reason = 'Visiting patient') => {
    const closeModal = jest.fn();
    render(<RemoteSearchResults query="Jane Doe" isFullPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Import & Open' }));
    const { onConfirm } = mockShowModal.mock.calls[0][1];
    await act(async () => onConfirm(reason, closeModal));
    return closeModal;
  };

  const givenImportSucceeds = () => {
    mockPingCentral.mockResolvedValue(undefined);
    mockImportRemotePatient.mockResolvedValue({ localUuid: NEW_UUID, created: true, history: 'deferred' });
    mockRefreshRemoteHistory.mockResolvedValue({ attempt: 'ok', history: 'retrieved', facilityCount: 2 });
  };

  it('shows the progress dialog for the patient, imports in steps with the reason, then opens the chart (2c)', async () => {
    given();
    givenImportSucceeds();
    await turnOn();

    const closeProgress = await importWithReason();

    // One modal: the progress shows in the reason modal, so nothing opens a second one.
    expect(mockShowModal).toHaveBeenCalledTimes(1);
    expect(mockShowModal).toHaveBeenCalledWith('liberia-reason-for-access-modal', {
      size: 'sm',
      progress: {
        patientName: expect.any(String),
        age: '29 Years',
        birthdate: '11-Jan-1997',
        identifier: 'MOH Health Record Number: BC-2026-00417',
      },
      onConfirm: expect.any(Function),
    });
    expect(mockPingCentral).toHaveBeenCalled();
    expect(mockImportRemotePatient).toHaveBeenCalledWith(NEW_UUID, 'Visiting patient');
    expect(mockRefreshRemoteHistory).toHaveBeenCalledWith(NEW_UUID, 'Visiting patient');
    expect(closeProgress).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: `\${openmrsSpaBase}/patient/${NEW_UUID}/chart` });
  });

  it('tells the user how many facilities the history came from (3a)', async () => {
    given();
    givenImportSucceeds();
    await turnOn();

    await importWithReason();

    expect(mockShowSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        title: 'Patient imported successfully',
        subtitle: 'Records from 2 other facilities are in External records.',
      }),
    );
  });

  it('warns, and still opens the chart, when the history could not be retrieved (3b)', async () => {
    given();
    givenImportSucceeds();
    mockRefreshRemoteHistory.mockResolvedValue({ attempt: 'unreachable', history: 'notRetrieved', facilityCount: 0 });
    await turnOn();

    await importWithReason();

    expect(mockNavigate).toHaveBeenCalled();
    expect(mockShowSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'warning',
        title: 'Patient imported successfully',
        subtitle: 'History from other facilities will be retrieved later.',
      }),
    );
  });

  it('closes the dialog and shows the error when the import fails', async () => {
    given();
    mockPingCentral.mockRejectedValue({ responseBody: { error: 'Failed to contact central server' } });
    await turnOn();

    const closeProgress = await importWithReason();

    expect(closeProgress).toHaveBeenCalled();
    expect(mockImportRemotePatient).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShowSnackbar).toHaveBeenCalledWith({
      isLowContrast: true,
      kind: 'error',
      title: 'Failed to import patient',
      subtitle: 'Failed to contact central server',
    });
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
