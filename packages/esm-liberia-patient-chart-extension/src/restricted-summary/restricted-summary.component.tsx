import React from 'react';
import { useSession, userHasAccess } from '@openmrs/esm-framework';
import NoAccessCard from './no-access-card.component';
import { restrictedSummarySections } from './permission';

/**
 * Shown in place of the upstream Vitals, Biometrics, and Conditions widgets.
 * Those widgets render ErrorState for any failed fetch, including a privilege denial.
 */
const RestrictedSummary: React.FC = () => {
  const session = useSession();
  if (!session?.user) {
    return null;
  }
  const sections = restrictedSummarySections((name) => userHasAccess(name, session.user));
  if (!sections.length) {
    return null;
  }
  return (
    <>
      {sections.map((section) => (
        <NoAccessCard key={section.id} title={section.title} />
      ))}
    </>
  );
};

export default RestrictedSummary;
