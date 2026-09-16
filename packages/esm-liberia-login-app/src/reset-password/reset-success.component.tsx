import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Tile } from '@carbon/react';
import { CheckmarkFilled } from '@carbon/icons-react';
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
        
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem', marginTop: '1rem' }}>
          <CheckmarkFilled size={48} style={{ color: '#24a148' }} />
        </div>
        
        <h2 className={styles.productiveHeading03} style={{ marginBottom: '1rem', textAlign: 'center' }}>
          {t('passwordResetSuccess', 'Password reset')}
        </h2>
        
        <p className={styles.bodyShort01} style={{ marginBottom: '2rem', textAlign: 'center', color: '#525252' }}>
          {t('passwordResetSuccessMessage', 'Your password has been successfully reset. Click below to log in.')}
        </p>

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
