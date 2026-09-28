import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { getDefaultsFromConfigSchema, openmrsFetch, useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { configSchema } from '../config-schema';
import { EXPORT_PRIVILEGE } from '../privileges';
import routes from '../routes.json';
import ReportRunner from './report-runner.component';
import ReportsAppMenuItem from './reports-app-menu-item.component';
import { createMockBackend, CSV_DESIGN, MALARIA, RMNCAH, XLSX_DESIGN } from '../testing/mock-backend';

const mockOpenmrsFetch = openmrsFetch as jest.Mock;
const mockUseConfig = useConfig as jest.Mock;
const mockUseSession = useSession as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

// Asserted through the words a reporting officer reads: t returns its default text.
// A stable t, as react-i18next's is between language changes.
jest.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string, options?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/{{(\w+)}}/g, (_m, name) => String(options?.[name]));
  return { useTranslation: () => ({ t }) };
});

const facilityContext = {
  instanceRole: 'facility',
  facilityLocation: { uuid: 'facility-careysburg', display: 'Careysburg Health Center' },
  etlLastRun: { startedAt: '2026-09-27T09:58:00.000+0000', completedAt: '2026-09-27T10:00:00.000+0000' },
};

const saved: Array<{ name: string; blob: Blob }> = [];

/** Lets the promises an event started settle, so their state updates land inside act. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await settle();
}

async function select(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
  await settle();
}

function renderWithSwr(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

function given(options: Parameters<typeof createMockBackend>[0] = {}, privileged = true) {
  const backend = createMockBackend(options);
  mockOpenmrsFetch.mockImplementation(backend.fetch);
  mockUseConfig.mockReturnValue({
    ...getDefaultsFromConfigSchema(configSchema),
    reportUuids: [MALARIA, RMNCAH],
    pollIntervalMs: 20,
  });
  mockUseSession.mockReturnValue({ authenticated: true, user: { uuid: 'u', privileges: [], roles: [] } });
  mockUserHasAccess.mockImplementation((privilege: string) => privileged && privilege === 'Export National Report');
  return backend;
}

beforeAll(() => {
  window.URL.createObjectURL = jest.fn(() => 'blob:report');
  window.URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: (window.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] });
  });
});

beforeEach(() => {
  saved.length = 0;
  mockOpenmrsFetch.mockReset();
});

describe('report runner at a facility', () => {
  it('lists only the configured MOH reports, in configured order, with their not-captured notes', async () => {
    given({ context: facilityContext });
    renderWithSwr(<ReportRunner />);

    const select = await screen.findByLabelText('Report');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'MOH Malaria Indicators',
      'MOH RMNCAH Indicators',
    ]);
    expect(screen.getByText(/Not captured: suspected cases/)).toBeInTheDocument();
  });

  it('fixes the location to the facility and shows when the data was refreshed, with no central lag note', async () => {
    given({ context: facilityContext });
    renderWithSwr(<ReportRunner />);

    expect(await screen.findByTestId('fixed-location')).toHaveTextContent('Careysburg Health Center');
    expect(screen.queryByLabelText('County')).not.toBeInTheDocument();
    expect(screen.getByText(/Figures include data up to the last refresh/)).toBeInTheDocument();
    expect(screen.queryByText('Central figures lag the facilities')).not.toBeInTheDocument();
  });

  it('runs, polls to completion, shows figures by disaggregation and downloads the CSV it rendered', async () => {
    const backend = given({ context: facilityContext, pollsBeforeDone: 2 });
    renderWithSwr(<ReportRunner />);

    await click(await screen.findByRole('button', { name: 'Run report' }));

    const post = backend.calls.find((c) => c.method === 'POST');
    expect(post.url).toBe('/ws/rest/v1/reportingrest/reportRequest');
    expect(post.body.renderingMode).toEqual({ argument: CSV_DESIGN });
    expect(post.body.reportDefinition.parameterizable).toEqual({ uuid: MALARIA });
    expect(post.body.reportDefinition.parameterMappings.location).toBe('facility-careysburg');
    // The default period is the last complete month.
    expect(post.body.reportDefinition.parameterMappings.startDate).toMatch(/^\d{4}-\d{2}-01$/);

    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Completed'));
    expect(backend.calls.filter((c) => c.url.endsWith('/reportRequest/request-1')).length).toBeGreaterThanOrEqual(3);

    const numerator = await screen.findByTestId('cell-MAL_004_NUM');
    expect(within(numerator).getByText('MAL-004')).toBeInTheDocument();
    expect(within(numerator).getByText('Numerator')).toBeInTheDocument();
    expect(within(numerator).getByText('12')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-MAL_004_15_49')).getByText('15–49 years')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-NCD_007_PCT')).getByText('33.3')).toBeInTheDocument();
    const preview = backend.calls.find((c) => c.url.includes('/reportDataSet/'));
    expect(preview.url).toContain(`/reportingrest/reportDataSet/${MALARIA}/indicators?`);
    expect(preview.url).toContain('location=facility-careysburg');

    await click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('MOH_Malaria_Indicators.csv');
    expect(backend.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('fetches fresh figures for every run, even of the same report, period and location', async () => {
    const backend = given({ context: facilityContext });
    renderWithSwr(<ReportRunner />);
    const previews = () => backend.calls.filter((c) => c.url.includes('/reportDataSet/'));

    await click(await screen.findByRole('button', { name: 'Run report' }));
    expect(within(await screen.findByTestId('cell-MAL_004_NUM')).getByText('12')).toBeInTheDocument();
    expect(previews()).toHaveLength(1);

    // The ETL refreshes between the two runs.
    backend.figures.MAL_004_NUM = 20;
    await click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Completed'));

    await waitFor(() => expect(within(screen.getByTestId('cell-MAL_004_NUM')).getByText('20')).toBeInTheDocument());
    expect(previews()).toHaveLength(2);
    expect(previews()[1].url).toBe(previews()[0].url);
    const posts = backend.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1].body.reportDefinition.parameterMappings).toEqual(posts[0].body.reportDefinition.parameterMappings);
  });

  it('exports Excel as a second request with the Excel design, then downloads it', async () => {
    const backend = given({ context: facilityContext, fileEncoding: 'bytes' });
    renderWithSwr(<ReportRunner />);

    await click(await screen.findByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Completed'));
    await click(screen.getByRole('button', { name: 'Download Excel' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('MOH_Malaria_Indicators.xlsx');
    const posts = backend.calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.body.renderingMode.argument)).toEqual([CSV_DESIGN, XLSX_DESIGN]);
    expect(posts[1].body.reportDefinition.parameterMappings).toEqual(posts[0].body.reportDefinition.parameterMappings);
  });

  it('says so when the server fails the run', async () => {
    given({ context: facilityContext, finalStatus: 'FAILED' });
    renderWithSwr(<ReportRunner />);

    await click(await screen.findByRole('button', { name: 'Run report' }));
    expect(await screen.findByText('The report failed on the server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
  });

  it('runs nothing when the reporting context cannot be read, and says why', async () => {
    const backend = given({ context: 'missing' });
    renderWithSwr(<ReportRunner />);

    expect(
      await screen.findByText(
        "Reporting context unavailable; cannot determine this site's location. Try again or contact ICT.",
      ),
    ).toBeInTheDocument();
    // Neither location is claimed: the server could be central, where no location means national.
    expect(screen.queryByTestId('fixed-location')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-location')).not.toBeInTheDocument();
    expect(screen.queryByText('This facility')).not.toBeInTheDocument();
    expect(screen.queryByText("This server's role is not known")).not.toBeInTheDocument();
    expect(screen.getByText(/last refreshed is not known/)).toBeInTheDocument();

    const run = screen.getByRole('button', { name: 'Run report' });
    expect(run).toBeDisabled();
    await click(run);
    expect(backend.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('runs nothing at a facility whose own location is not reported', async () => {
    const backend = given({ context: { ...facilityContext, facilityLocation: null } });
    renderWithSwr(<ReportRunner />);

    expect(await screen.findByTestId('context-unavailable')).toHaveTextContent(/cannot determine this site's location/);
    expect(screen.queryByTestId('fixed-location')).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: 'Run report' }));
    expect(backend.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('names the facility in the run when the role is missing but the facility location is reported', async () => {
    const backend = given({ context: { facilityLocation: facilityContext.facilityLocation } });
    renderWithSwr(<ReportRunner />);

    expect(await screen.findByTestId('fixed-location')).toHaveTextContent('Careysburg Health Center');
    expect(screen.getByText("This server's role is not known")).toBeInTheDocument();

    await click(screen.getByRole('button', { name: 'Run report' }));
    const post = backend.calls.find((c) => c.method === 'POST');
    expect(post.body.reportDefinition.parameterMappings.location).toBe('facility-careysburg');
  });

  it('runs once the reporting context answers again after "Try again"', async () => {
    const backend = given({ context: 'missing' });
    renderWithSwr(<ReportRunner />);

    await screen.findByTestId('context-unavailable');
    backend.setContext(facilityContext);
    await click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('fixed-location')).toHaveTextContent('Careysburg Health Center');
    expect(screen.queryByTestId('context-unavailable')).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: 'Run report' }));
    const post = backend.calls.find((c) => c.method === 'POST');
    expect(post.body.reportDefinition.parameterMappings.location).toBe('facility-careysburg');
  });
});

describe('report runner safeguards', () => {
  const runToCompletion = async () => {
    await click(await screen.findByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Completed'));
  };

  it('will not run a report that has no CSV design, rather than render another format as CSV', async () => {
    const backend = given({ context: facilityContext, designs: 'excel-only' });
    renderWithSwr(<ReportRunner />);

    expect(await screen.findByText('This report cannot be run yet')).toBeInTheDocument();
    expect(screen.getByText(/It has no CSV format/)).toBeInTheDocument();
    const run = screen.getByRole('button', { name: 'Run report' });
    expect(run).toBeDisabled();
    await click(run);
    expect(backend.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
  });

  it('says a report has no formats at all when it has no designs', async () => {
    given({ context: facilityContext, designs: 'none' });
    renderWithSwr(<ReportRunner />);

    expect(await screen.findByText('This report has no export formats set up yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run report' })).toBeDisabled();
  });

  it('starts one Excel export however fast the button is clicked', async () => {
    const backend = given({ context: facilityContext });
    renderWithSwr(<ReportRunner />);
    await runToCompletion();

    const excel = screen.getByRole('button', { name: 'Download Excel' });
    // Every click lands before React re-renders the button as disabled: native clicks inside one
    // act are not flushed between them, as fireEvent's own act would do.
    await act(async () => {
      excel.click();
      excel.click();
      excel.click();
    });

    await waitFor(() => expect(saved).toHaveLength(1));
    const posts = backend.calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.body.renderingMode.argument)).toEqual([CSV_DESIGN, XLSX_DESIGN]);
  });

  it('cancels a running report when another report is chosen, and shows nothing of it', async () => {
    const backend = given({ context: facilityContext, pollsBeforeDone: 1000 });
    renderWithSwr(<ReportRunner />);

    await click(await screen.findByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Processing'));
    await select(screen.getByLabelText('Report'), RMNCAH);

    expect(backend.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', url: expect.stringMatching(/reportRequest\/request-1$/) }));
    expect(screen.queryByTestId('run-status')).not.toBeInTheDocument();
    const pollsAfter = backend.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/request-1')).length;
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(backend.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/request-1'))).toHaveLength(pollsAfter);
  });

  it('drops a run that is accepted only after another report was chosen', async () => {
    const backend = given({ context: facilityContext, holdPosts: true });
    renderWithSwr(<ReportRunner />);

    await click(await screen.findByRole('button', { name: 'Run report' }));
    await select(screen.getByLabelText('Report'), RMNCAH);
    await act(async () => backend.releasePosts());

    await waitFor(() =>
      expect(backend.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', url: expect.stringMatching(/request-1$/) })),
    );
    expect(screen.queryByTestId('run-status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run report' })).toBeEnabled();
    expect(backend.calls.some((c) => c.url.includes('/reportDataSet/'))).toBe(false);
  });

  it('keeps Run disabled while an Excel export is in flight', async () => {
    const backend = given({ context: facilityContext, holdPosts: true });
    renderWithSwr(<ReportRunner />);

    await click(await screen.findByRole('button', { name: 'Run report' }));
    await act(async () => backend.releasePosts());
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Completed'));

    await click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(screen.getByRole('button', { name: 'Run report' })).toBeDisabled();
    await click(screen.getByRole('button', { name: 'Run report' }));
    expect(backend.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(screen.getByTestId('run-status')).toHaveTextContent('Completed');
  });

  it('drops an Excel export that is accepted only after another report was chosen', async () => {
    const backend = given({ context: facilityContext, holdPosts: true });
    renderWithSwr(<ReportRunner />);

    await click(await screen.findByRole('button', { name: 'Run report' }));
    await act(async () => backend.releasePosts());
    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('Completed'));

    await click(screen.getByRole('button', { name: 'Download Excel' }));
    await select(screen.getByLabelText('Report'), RMNCAH);
    await act(async () => backend.releasePosts());

    await waitFor(() =>
      expect(backend.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', url: expect.stringMatching(/request-2$/) })),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(saved).toHaveLength(0);
    expect(backend.calls.some((c) => c.method === 'GET' && c.url.endsWith('/request-2'))).toBe(false);
    expect(screen.queryByText('Preparing the file...')).not.toBeInTheDocument();
  });

  it('stops waiting for an Excel export whose status cannot be read, and says why', async () => {
    given({ context: facilityContext, failPolls: ['request-2'] });
    renderWithSwr(<ReportRunner />);
    await runToCompletion();

    await click(screen.getByRole('button', { name: 'Download Excel' }));

    expect(await screen.findByText('Status unavailable')).toBeInTheDocument();
    expect(screen.getByText('The export could not be produced. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('Preparing the file...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
    expect(saved).toHaveLength(0);
  });
});

describe('report runner at central', () => {
  const central = { instanceRole: 'central', facilityLocation: null, etlLastRun: { completedAt: '2026-09-27T10:00:00.000+0000' } };

  it('defaults to national, sends no location, and warns that figures lag the facilities', async () => {
    const backend = given({ context: central });
    renderWithSwr(<ReportRunner />);

    expect(await screen.findByTestId('selected-location')).toHaveTextContent('Reporting on: National (all facilities)');
    expect(screen.getByText('Central figures lag the facilities')).toBeInTheDocument();

    await click(screen.getByRole('button', { name: 'Run report' }));
    const post = backend.calls.find((c) => c.method === 'POST');
    expect(post.body.reportDefinition.parameterMappings).not.toHaveProperty('location');
  });

  it('reports on a county, a district, or a single facility from the MFL hierarchy', async () => {
    const backend = given({ context: central });
    renderWithSwr(<ReportRunner />);

    const county = await screen.findByLabelText('County');
    await waitFor(() => expect(within(county).getAllByRole('option')).toHaveLength(3));
    await select(county, 'county-bong');
    expect(screen.getByTestId('selected-location')).toHaveTextContent('Reporting on: Bong');

    await select(screen.getByLabelText('District'), 'district-jorquelleh');
    expect(screen.getByTestId('selected-location')).toHaveTextContent('Reporting on: Jorquelleh');

    await click(screen.getByLabelText(/Phebe Hospital/));
    expect(screen.getByTestId('selected-location')).toHaveTextContent('Reporting on: Phebe Hospital');

    await click(screen.getByRole('button', { name: 'Run report' }));
    const post = backend.calls.find((c) => c.method === 'POST');
    expect(post.body.reportDefinition.parameterMappings.location).toBe('facility-phebe');
    expect(backend.calls.find((c) => c.url.startsWith('/ws/rest/v1/location?')).url).toContain('tag=Health+Facility');
  });
});

describe('access', () => {
  it('reads the privilege from routes.json, the one place it is written, and it is not a config key', () => {
    expect(EXPORT_PRIVILEGE).toBe('Export National Report');
    expect(routes.extensions.find((e) => e.name === 'indicator-reports-app-menu-item').privileges).toEqual([
      EXPORT_PRIVILEGE,
    ]);
    expect(configSchema).not.toHaveProperty('exportPrivilege');
  });

  it('ignores a privilege set in config', async () => {
    given({ context: facilityContext });
    mockUseConfig.mockReturnValue({ ...mockUseConfig(), exportPrivilege: 'Some Other Privilege' });
    renderWithSwr(<ReportRunner />);
    expect(await screen.findByRole('button', { name: 'Run report' })).toBeInTheDocument();
    expect(mockUserHasAccess).toHaveBeenCalledWith('Export National Report', expect.anything());
    expect(mockUserHasAccess).not.toHaveBeenCalledWith('Some Other Privilege', expect.anything());
  });

  it('shows the page only to holders of Export National Report', async () => {
    const backend = given({ context: facilityContext }, false);
    renderWithSwr(<ReportRunner />);

    expect(screen.getByText('You do not have permission to run national reports')).toBeInTheDocument();
    expect(backend.calls).toHaveLength(0);
  });

  it('hides the menu entry without Export National Report', () => {
    given({}, false);
    const { container } = renderWithSwr(<ReportsAppMenuItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the menu entry with Export National Report', () => {
    given({}, true);
    renderWithSwr(<ReportsAppMenuItem />);
    expect(screen.getByText('Indicator reports')).toBeInTheDocument();
  });
});
