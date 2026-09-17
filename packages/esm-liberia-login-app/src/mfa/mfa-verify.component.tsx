import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, TextInput, Tile, InlineNotification } from '@carbon/react';
import Logo from '../logo.component';
import Footer from '../footer.component';
import styles from '../login/login.scss';

const MFAVerify = () => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (evt: React.FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    setErrorMessage('');
    
    if (code.length < 6) {
      setErrorMessage(t('invalidMFACode', 'Please enter a valid 6-digit code.'));
      return;
    }

    setIsSubmitting(true);
    
    // Placeholder for API integration
    setTimeout(() => {
      setIsSubmitting(false);
      setErrorMessage(t('mfaNotImplemented', 'MFA verification is currently a placeholder.'));
    }, 1500);
  };

  return (
    <div className={styles.container}>
      <Tile className={styles.loginCard}>
        <div className={styles.center}>
          <Logo t={t} />
        </div>
        
        <h2 className={styles.productiveHeading03} style={{ marginBottom: '1rem', textAlign: 'center' }}>
          {t('twoFactorAuthentication', 'Two-Factor Authentication')}
        </h2>
        
        <p className={styles.bodyShort01} style={{ marginBottom: '2rem', textAlign: 'center', color: '#525252' }}>
          {t('mfaInstructions', "Please enter the verification code sent to your mobile device.")}
        </p>

        {errorMessage && (
          <div style={{ marginBottom: '1rem' }}>
            <InlineNotification
              kind="error"
              subtitle={errorMessage}
              title={t('error', 'Error')}
              onClick={() => setErrorMessage('')}
            />
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.inputGroup} style={{ marginBottom: '1.5rem' }}>
            <TextInput
              id="mfaCode"
              type="text"
              name="mfaCode"
              labelText={t('verificationCode', 'Verification Code')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={6}
            />
          </div>
          
          <Button
            type="submit"
            className={styles.continueButton}
            disabled={isSubmitting || !code.trim()}
            style={{ width: '100%', marginBottom: '1rem' }}
          >
            {isSubmitting ? t('verifying', 'Verifying...') : t('verify', 'Verify')}
          </Button>

          <div style={{ textAlign: 'center' }}>
            <Link to="/login" style={{ textDecoration: 'none' }}>
              {t('backToLogin', 'Back to login')}
            </Link>
          </div>
        </form>
      </Tile>
      <Footer />
    </div>
  );
};

export default MFAVerify;
