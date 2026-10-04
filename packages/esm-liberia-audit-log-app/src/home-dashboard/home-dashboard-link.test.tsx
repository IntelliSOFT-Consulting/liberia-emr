import React from 'react';
import { render, screen } from '@testing-library/react';
import { useSession, userHasAccess } from '@openmrs/esm-framework';
import { AUDIT_LOG_DASHBOARD, VIEW_PRIVILEGE } from '../privileges';
import routes from '../routes.json';
import { createHomeDashboardLink } from './home-dashboard-link.component';

const mockUseSession = useSession as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

const DashboardLink = createHomeDashboardLink({
  name: AUDIT_LOG_DASHBOARD,
  titleKey: 'auditLog',
  title: 'Audit log',
  privilege: VIEW_PRIVILEGE,
});

const given = ({ privileged = true } = {}) => {
  mockUseSession.mockReturnValue({ authenticated: true, user: { uuid: 'u', privileges: [], roles: [] } });
  mockUserHasAccess.mockImplementation((privilege: string) => privileged && privilege === 'View Audit Log');
};

const extension = (name: string) => routes.extensions.find((candidate) => candidate.name === name);

describe('audit log home dashboard', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('links a holder of View Audit Log to /home/audit-log', () => {
    given();
    render(<DashboardLink />);
    const link = screen.getByRole('link', { name: 'Audit log' });
    expect(link).toHaveAttribute('href', '/openmrs/spa/home/audit-log');
    expect(link).not.toHaveClass('active-left-nav-link');
  });

  it('marks the link active on its own dashboard', () => {
    given();
    window.history.pushState({}, '', '/openmrs/spa/home/audit-log');
    render(<DashboardLink />);
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveClass('active-left-nav-link');
  });

  it('renders nothing for anyone else', () => {
    given({ privileged: false });
    const { container } = render(<DashboardLink />);
    expect(container).toBeEmptyDOMElement();
  });

  it('registers a dashboard link and the page as its dashboard, both gated like the menu entry', () => {
    const link = extension('audit-log-dashboard-link');
    const dashboard = extension('audit-log-dashboard');
    expect(link.slot).toBe('homepage-dashboard-slot');
    expect(link.meta).toEqual({ name: 'audit-log', slot: 'audit-log-dashboard-slot', title: 'Audit log' });
    // The dashboard is the page itself, so /audit-log and /home/audit-log show the same thing.
    expect(dashboard).toMatchObject({ slot: link.meta.slot, component: 'root' });
    expect(routes.pages).toContainEqual({ component: 'root', route: 'audit-log' });
    expect(link.privileges).toEqual([VIEW_PRIVILEGE]);
    expect(dashboard.privileges).toEqual([VIEW_PRIVILEGE]);
  });
});
