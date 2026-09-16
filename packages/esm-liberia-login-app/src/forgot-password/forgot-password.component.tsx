import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, TextInput, Tile, InlineNotification } from '@carbon/react';
import Logo from '../logo.component';
import Footer from '../footer.component';
import styles from '../login/login.scss';

const ForgotPassword = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (evt: React.FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    
    // Placeholder for API integration
    setTimeout(() => {
      setSuccessMessage(t('resetLinkSent', 'If an account exists with that email, a reset link has been sent.'));
      setIsSubmitting(false);
    }, 1500);
  };

  return (
    <div className={styles.container}>
      <Tile className={styles.loginCard}>
        <div className={styles.center}>
          <Logo t={t} />
        </div>
        
        <h2 className={styles.productiveHeading03} style={{ marginBottom: '1rem', textAlign: 'center' }}>
          {t('forgotYourPassword', 'Forgot your password?')}
        </h2>
        
        <p className={styles.bodyShort01} style={{ marginBottom: '2rem', textAlign: 'center', color: '#525252' }}>
          {t('forgotPasswordInstructions', "Enter the email address you used to create the account, and we'll send you a password reset link.")}
        </p>

        {successMessage && (
          <div style={{ marginBottom: '1rem' }}>
            <InlineNotification
              kind="success"
              subtitle={successMessage}
              title={t('success', 'Success')}
              hideCloseButton
            />
          </div>
        )}

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
              id="email"
              type="email"
              name="email"
              labelText={t('emailAddress', 'Email Address')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          <Button
            type="submit"
            className={styles.continueButton}
            disabled={isSubmitting || !email.trim()}
            style={{ width: '100%', marginBottom: '1rem' }}
          >
            {isSubmitting ? t('sending', 'Sending...') : t('sendResetLink', 'Send reset link')}
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

export default ForgotPassword;
