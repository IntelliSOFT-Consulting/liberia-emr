import React from 'react';
import { render, screen } from '@testing-library/react';
import Freshness from './freshness.component';
import { etlRefreshState, toReportingContext, type ReportingContextResponse } from './reporting-context.resource';

// Asserted through the words a reporting officer reads: t returns its default text.
jest.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string, options?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/{{(\w+)}}/g, (_m, name) => String(options?.[name]));
  return { useTranslation: () => ({ t }) };
});

// A fixed rendering of each time, so a test can tell which of the run's times was shown.
jest.mock('@openmrs/esm-framework', () => ({
  ...jest.requireActual('@openmrs/esm-framework'),
  formatDatetime: (date: Date) => `<${date.toISOString()}>`,
}));

const STARTED = '2026-09-27T09:58:00.000+0000';
const COMPLETED = '2026-09-27T10:00:00.000+0000';
const STARTED_SHOWN = '<2026-09-27T09:58:00.000Z>';
const COMPLETED_SHOWN = '<2026-09-27T10:00:00.000Z>';

function renderFor(etlLastRun: ReportingContextResponse['etlLastRun'], unavailable = false) {
  const context = toReportingContext(
    unavailable ? undefined : { instanceRole: 'facility', facilityLocation: { uuid: 'f' }, etlLastRun },
  );
  return render(<Freshness context={context} unavailable={unavailable} />);
}

/**
 * The Report data notice: its text, and whether Carbon renders it as a warning. At a facility
 * with a known role it is the only notice on the page.
 */
function notice() {
  const element = screen.getByRole('status');
  expect(element).toHaveTextContent('Report data');
  return {
    text: element.textContent,
    warning: element.classList.contains('cds--inline-notification--warning'),
  };
}

describe('Freshness', () => {
  it('SUCCESS: states the completion time as how fresh the figures are', () => {
    renderFor({ startedAt: STARTED, completedAt: COMPLETED, status: 'SUCCESS' });

    expect(notice().text).toContain(`Figures include data up to the last refresh, ${COMPLETED_SHOWN}.`);
    expect(notice().warning).toBe(false);
  });

  it.each(['ERROR', 'INTERRUPTED'])(
    '%s: warns that the refresh failed and states no refresh time, since the times are the last good run’s',
    (status) => {
      renderFor({ startedAt: STARTED, completedAt: COMPLETED, status });

      expect(notice().text).toContain('The last data refresh failed; figures may be out of date. Contact ICT.');
      expect(notice().text).not.toContain(COMPLETED_SHOWN);
      expect(notice().text).not.toContain(STARTED_SHOWN);
      expect(notice().text).not.toContain('Figures include data up to');
      expect(notice().warning).toBe(true);
    },
  );

  it('RUNNING: says a refresh is in progress, alongside the last known completion time', () => {
    renderFor({ startedAt: STARTED, completedAt: COMPLETED, status: 'RUNNING' });

    expect(notice().text).toContain(
      `A data refresh is in progress. Until it finishes, figures include data up to the last refresh, ${COMPLETED_SHOWN}.`,
    );
    expect(notice().warning).toBe(false);
  });

  it('RUNNING with no completion time: gives the start time and does not claim the figures are current', () => {
    renderFor({ startedAt: STARTED, completedAt: null, status: 'RUNNING' });

    expect(notice().text).toContain(`A data refresh is in progress; it started ${STARTED_SHOWN}.`);
    expect(notice().text).toContain('figures are those of the previous refresh');
    expect(notice().text).not.toContain('Figures include data up to');
  });

  it('RUNNING with no times at all: still says a refresh is in progress', () => {
    renderFor({ startedAt: null, completedAt: null, status: 'RUNNING' });

    expect(notice().text).toContain('A data refresh is in progress.');
  });

  it.each([
    ['no status', { startedAt: STARTED, completedAt: COMPLETED }],
    ['a status this page does not know', { startedAt: STARTED, completedAt: COMPLETED, status: 'PAUSED' }],
    ['SUCCESS with no completion time', { startedAt: STARTED, completedAt: null, status: 'SUCCESS' }],
  ])('%s: warns and states no refresh time', (_case, etlLastRun) => {
    renderFor(etlLastRun);

    expect(notice().text).toContain('The state of the last data refresh is not known');
    expect(notice().text).not.toContain(COMPLETED_SHOWN);
    expect(notice().warning).toBe(true);
  });

  it('no run yet: says reports will be empty', () => {
    renderFor(null);

    expect(notice().text).toContain('The report data has not been refreshed yet on this server');
    expect(notice().warning).toBe(true);
  });

  it('no context: says the refresh time is not known', () => {
    renderFor(undefined, true);

    expect(notice().text).toContain('When the report data was last refreshed is not known on this server.');
    expect(notice().warning).toBe(true);
  });
});

describe('etlRefreshState', () => {
  const state = (etlLastRun: ReportingContextResponse['etlLastRun']) =>
    etlRefreshState(toReportingContext({ instanceRole: 'facility', etlLastRun }));

  it('reads the four statuses the reports module sends, in any case', () => {
    expect(state({ completedAt: COMPLETED, status: 'SUCCESS' })).toBe('current');
    expect(state({ completedAt: COMPLETED, status: 'success' })).toBe('current');
    expect(state({ completedAt: COMPLETED, status: 'RUNNING' })).toBe('refreshing');
    expect(state({ completedAt: COMPLETED, status: 'ERROR' })).toBe('failed');
    expect(state({ completedAt: COMPLETED, status: ' interrupted ' })).toBe('failed');
  });

  it('claims nothing for a run it cannot read, and knows when there has been no run', () => {
    expect(state({ completedAt: COMPLETED })).toBe('unknown');
    expect(state({ completedAt: COMPLETED, status: 'PAUSED' })).toBe('unknown');
    expect(state({ completedAt: null, status: 'SUCCESS' })).toBe('unknown');
    expect(state(null)).toBe('never');
    expect(etlRefreshState(toReportingContext(undefined))).toBe('never');
  });
});
