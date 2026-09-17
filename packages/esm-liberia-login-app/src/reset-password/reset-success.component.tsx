import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Tile, InlineNotification } from '@carbon/react';
import Logo from '../logo.component';
import Footer from '../footer.component';
import styles from '../login/login.scss';

const ResetSuccess = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className={styles.container}>
      <Tile className={styles.loginCard}>
        <div className={styles.center}>
          <Logo t={t} />
        </div>
        
        <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
          <InlineNotification
            kind="success"
            title={t('passwordResetSuccess', 'Password reset successful')}
            subtitle={t('passwordResetSuccessMessage', 'Your password has been successfully reset. You can now log in with your new password.')}
            hideCloseButton
            lowContrast
          />
        </div>

        <Button
          onClick={() => navigate('/login')}
          className={styles.continueButton}
          style={{ width: '100%', marginBottom: '1rem' }}
        >
          {t('continue', 'Continue')}
        </Button>
      </Tile>
      <Footer />
    </div>
  );
};

export default ResetSuccess;
