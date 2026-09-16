import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, PasswordInput, Tile, InlineNotification } from '@carbon/react';
import Logo from '../logo.component';
import Footer from '../footer.component';
import styles from '../login/login.scss';

const ResetPassword = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
    } else {
      setErrorMessage(t('missingResetToken', 'Missing reset token in URL.'));
    }
  }, [location, t]);

  const handleSubmit = (evt: React.FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    setErrorMessage('');
    
    if (password !== confirmPassword) {
      setErrorMessage(t('passwordsDoNotMatch', 'Passwords do not match.'));
      return;
    }
    
    if (password.length < 8) {
      setErrorMessage(t('passwordTooShort', 'Password must be at least 8 characters long.'));
      return;
    }

    setIsSubmitting(true);
    
    // Placeholder for API integration
    setTimeout(() => {
      setIsSubmitting(false);
      navigate('/login/reset-success');
    }, 1500);
  };

  return (
    <div className={styles.container}>
      <Tile className={styles.loginCard}>
        <div className={styles.center}>
          <Logo t={t} />
        </div>
        
        <h2 className={styles.productiveHeading03} style={{ marginBottom: '1rem', textAlign: 'center' }}>
          {t('setNewPassword', 'Set new password')}
        </h2>
        
        <p className={styles.bodyShort01} style={{ marginBottom: '2rem', textAlign: 'center', color: '#525252' }}>
          {t('resetPasswordInstructions', "Your new password must be different from previously used passwords.")}
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
          <div className={styles.inputGroup} style={{ marginBottom: '1rem' }}>
            <PasswordInput
              id="password"
              name="password"
              labelText={t('password', 'Password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              showPasswordLabel={t('showPassword', 'Show password')}
              required
            />
          </div>
          
          <div className={styles.inputGroup} style={{ marginBottom: '1.5rem' }}>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              labelText={t('confirmPassword', 'Confirm Password')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              showPasswordLabel={t('showPassword', 'Show password')}
              required
            />
          </div>
          
          <Button
            type="submit"
            className={styles.continueButton}
            disabled={isSubmitting || !password || !confirmPassword || !token}
            style={{ width: '100%', marginBottom: '1rem' }}
          >
            {isSubmitting ? t('saving', 'Saving...') : t('resetPassword', 'Reset password')}
          </Button>
        </form>
      </Tile>
      <Footer />
    </div>
  );
};

export default ResetPassword;
