import { useEffect } from 'react';
import { useConfig, useConnectivity, useSession } from '@openmrs/esm-framework';
import { clearHistory } from '@openmrs/esm-framework/src/internal';
import { type ConfigSchema } from '../config-schema';
import { completeLogout, navigateAfterLogout } from './logout.resource';

const RedirectLogout: React.FC = () => {
  const config = useConfig<ConfigSchema>();
  const isLoginEnabled = useConnectivity();
  const session = useSession();

  useEffect(() => {
    clearHistory();
    if (!session.authenticated || !isLoginEnabled) {
      navigateAfterLogout(config.provider);
      return;
    }

    completeLogout(config.provider).catch((error) => {
      console.error('Logout failed:', error);
    });
  }, [config, isLoginEnabled, session]);

  return null;
};

export default RedirectLogout;
