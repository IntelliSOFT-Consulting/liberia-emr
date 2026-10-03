import React from 'react';
import { render, screen } from '@testing-library/react';
import { useSession, userHasAccess } from '@openmrs/esm-framework';
import { EXPORT_PRIVILEGE, REPORTS_DASHBOARD } from '../privileges';
import routes from '../routes.json';
import { createHomeDashboardLink } from './home-dashboard-link.component';

const mockUseSession = useSession as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

const DashboardLink = createHomeDashboardLink({
  name: REPORTS_DASHBOARD,
  titleKey: 'indicatorReports',
  title: 'Indicator reports',
  privilege: EXPORT_PRIVILEGE,
});

const given = ({ privileged = true } = {}) => {
  mockUseSession.mockReturnValue({ authenticated: true, user: { uuid: 'u', privileges: [], roles: [] } });
  mockUserHasAccess.mockImplementation((privilege: string) => privileged && privilege === 'Export National Report');
};

const extension = (name: string) => routes.extensions.find((candidate) => candidate.name === name);

describe('indicator reports home dashboard', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('links a holder of Export National Report to /home/indicator-reports', () => {
    given();
    render(<DashboardLink />);
    const link = screen.getByRole('link', { name: 'Indicator reports' });
    expect(link).toHaveAttribute('href', '/openmrs/spa/home/indicator-reports');
    expect(link).not.toHaveClass('active-left-nav-link');
  });

  it('marks the link active on its own dashboard', () => {
    given();
    window.history.pushState({}, '', '/openmrs/spa/home/indicator-reports');
    render(<DashboardLink />);
    expect(screen.getByRole('link', { name: 'Indicator reports' })).toHaveClass('active-left-nav-link');
  });

  it('renders nothing for anyone else', () => {
    given({ privileged: false });
    const { container } = render(<DashboardLink />);
    expect(container).toBeEmptyDOMElement();
  });

  it('registers a dashboard link and the page as its dashboard, both gated like the menu entry', () => {
    const link = extension('indicator-reports-dashboard-link');
    const dashboard = extension('indicator-reports-dashboard');
    expect(link.slot).toBe('homepage-dashboard-slot');
    expect(link.meta).toEqual({
      name: 'indicator-reports',
      slot: 'indicator-reports-dashboard-slot',
      title: 'Indicator reports',
    });
    // The dashboard is the page itself, so /indicator-reports and /home/indicator-reports match.
    expect(dashboard).toMatchObject({ slot: link.meta.slot, component: 'root' });
    expect(routes.pages).toContainEqual({ component: 'root', route: 'indicator-reports' });
    expect(link.privileges).toEqual([EXPORT_PRIVILEGE]);
    expect(dashboard.privileges).toEqual([EXPORT_PRIVILEGE]);
    expect(EXPORT_PRIVILEGE).toBe('Export National Report');
  });
});
