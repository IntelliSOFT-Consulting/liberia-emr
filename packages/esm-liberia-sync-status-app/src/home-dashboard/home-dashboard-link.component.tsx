import React from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ConfigurableLink, useSession, userHasAccess } from '@openmrs/esm-framework';

/**
 * A home page dashboard: a link in esm-home-app's homepage-dashboard-slot, whose meta names the
 * dashboard (/home/<name>) and the slot the home app renders for it. Built the way the RefApp's
 * laboratory app builds its own (createHomeDashboardLink), so the link highlights like theirs.
 *
 * The app shell already leaves the link out for a user without the privilege in routes.json,
 * which also keeps the dashboard out of /home's choice of a landing page. The same check here
 * keeps the rule in tests.
 */
export interface HomeDashboardLinkConfig {
  /** The dashboard's name: the path after /home/, and meta.name in routes.json. */
  name: string;
  titleKey: string;
  title: string;
  privilege: string;
}

function HomeDashboardLink({ name, titleKey, title, privilege }: HomeDashboardLinkConfig) {
  const { t } = useTranslation();
  const session = useSession();
  const { pathname } = useLocation();

  if (!session?.user || !userHasAccess(privilege, session.user)) {
    return null;
  }

  const active = pathname.split('/').map(decodeURIComponent).includes(name);
  return (
    <ConfigurableLink
      to={`\${openmrsSpaBase}/home/${name}`}
      className={`cds--side-nav__link ${active ? 'active-left-nav-link' : ''}`}>
      {t(titleKey, title)}
    </ConfigurableLink>
  );
}

export const createHomeDashboardLink = (config: HomeDashboardLinkConfig) =>
  function HomeDashboardLinkExtension() {
    return (
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HomeDashboardLink {...config} />
      </BrowserRouter>
    );
  };
