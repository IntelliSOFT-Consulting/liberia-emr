import React from 'react';
import { render, screen } from '@testing-library/react';
import { useSession, userHasAccess } from '@openmrs/esm-framework';
import {
  RESOLVE_SYNC_CONFLICTS,
  SYNC_CONFLICTS_DASHBOARD,
  SYNC_STATUS_DASHBOARD,
  VIEW_MFL_SYNC,
  VIEW_SYNC_STATUS,
} from '../privileges';
import routes from '../routes.json';
import { createHomeDashboardLink } from './home-dashboard-link.component';

const mockUseSession = useSession as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

const SyncStatusLink = createHomeDashboardLink({
  name: SYNC_STATUS_DASHBOARD,
  titleKey: 'syncStatus',
  title: 'Sync status',
  privilege: VIEW_SYNC_STATUS,
});

const SyncConflictsLink = createHomeDashboardLink({
  name: SYNC_CONFLICTS_DASHBOARD,
  titleKey: 'syncConflicts',
  title: 'Sync conflicts',
  privilege: RESOLVE_SYNC_CONFLICTS,
});

const given = (privileges: Array<string>) => {
  mockUseSession.mockReturnValue({ authenticated: true, user: { uuid: 'u', privileges: [], roles: [] } });
  mockUserHasAccess.mockImplementation((privilege: string) => privileges.includes(privilege));
};

const extension = (name: string) => routes.extensions.find((candidate) => candidate.name === name);

describe('sync home dashboards', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('reads each privilege from the entry routes.json gates with it', () => {
    expect(VIEW_SYNC_STATUS).toBe('View Sync Status');
    expect(VIEW_MFL_SYNC).toBe('View MFL Sync');
    expect(RESOLVE_SYNC_CONFLICTS).toBe('Resolve Sync Conflicts');
  });

  it('gives the Sync Administrator the sync status dashboard only', () => {
    given(['View Sync Status', 'View MFL Sync', 'Manage MFL Sync', 'Manage Facility Sync']);
    render(
      <>
        <SyncStatusLink />
        <SyncConflictsLink />
      </>,
    );
    expect(screen.getByRole('link', { name: 'Sync status' })).toHaveAttribute('href', '/openmrs/spa/home/sync-status');
    expect(screen.queryByRole('link', { name: 'Sync conflicts' })).not.toBeInTheDocument();
  });

  it('gives the Sync Conflict Reviewer both, the conflicts one at /home/sync-conflicts', () => {
    given(['Resolve Sync Conflicts', 'View Sync Status', 'Get People']);
    window.history.pushState({}, '', '/openmrs/spa/home/sync-conflicts');
    render(
      <>
        <SyncStatusLink />
        <SyncConflictsLink />
      </>,
    );
    const conflicts = screen.getByRole('link', { name: 'Sync conflicts' });
    expect(conflicts).toHaveAttribute('href', '/openmrs/spa/home/sync-conflicts');
    expect(conflicts).toHaveClass('active-left-nav-link');
    expect(screen.getByRole('link', { name: 'Sync status' })).not.toHaveClass('active-left-nav-link');
  });

  it('renders nothing for a role with neither privilege', () => {
    given(['Export National Report']);
    const { container } = render(
      <>
        <SyncStatusLink />
        <SyncConflictsLink />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['sync-status', 'root', 'View Sync Status', 'Sync status'],
    ['sync-conflicts', 'syncConflicts', 'Resolve Sync Conflicts', 'Sync conflicts'],
  ])('registers the %s page as a home dashboard, gated by its privilege', (name, component, privilege, title) => {
    const link = extension(`${name}-dashboard-link`);
    const dashboard = extension(`${name}-dashboard`);
    expect(link.slot).toBe('homepage-dashboard-slot');
    expect(link.meta).toEqual({ name, slot: `${name}-dashboard-slot`, title });
    // The dashboard is the page itself, so /<name> and /home/<name> show the same thing.
    expect(dashboard).toMatchObject({ slot: link.meta.slot, component });
    expect(routes.pages).toContainEqual({ component, route: name });
    expect(link.privileges).toEqual([privilege]);
    expect(dashboard.privileges).toEqual([privilege]);
  });
});
