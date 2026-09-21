import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Button, PasswordInput, Tile, InlineNotification } from '@carbon/react';
import { openmrsFetch } from '@openmrs/esm-framework';
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
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('token');
    
    if (urlToken) {
      setToken(urlToken);
      // For demonstration: If the token is exactly 'expired', we mock an invalid state
      if (urlToken === 'expired') {
        setIsTokenInvalid(true);
      } else {
        // Placeholder for API pre-validation check
        // e.g., openmrsFetch(`/ws/rest/v1/liberiaemr/password-reset/validate?token=${urlToken}`)
      }
    } else {
      setIsTokenInvalid(true);
    }
  }, [location]);

  const handleSubmit = async (evt: React.FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    setErrorMessage('');
    
    if (password !== confirmPassword) {
      setErrorMessage(t('passwordsDoNotMatch', 'Passwords do not match.'));
      return;
    }
    
    if (password.length < 13) {
      setErrorMessage(t('passwordTooShort', 'Password must be at least 13 characters long.'));
      return;
    }

    setIsSubmitting(true);
    
    try {
      const response = await openmrsFetch('/ws/liberiaemr/passwordReset/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token, newPassword: password })
      });
      
      if (!response.ok) {
        let serverMessage = '';
        try {
          const errorData = await response.json();
          serverMessage = errorData?.error?.message || errorData?.message || '';
        } catch (e) {
          // Ignore JSON parse error
        }

        if (serverMessage) {
          throw new Error(serverMessage);
        }
        throw new Error(t('resetFailed', 'Invalid or expired token. Please request a new link.'));
      }
      
      navigate('/login/reset-success');
    } catch (err: any) {
      const msg = err.message || 'An error occurred';
      setErrorMessage(msg);
      
      if (msg.toLowerCase().includes('token') || msg.toLowerCase().includes('expire')) {
        setIsTokenInvalid(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isTokenInvalid) {
    return (
      <div className={styles.container}>
        <Tile className={styles.loginCard}>
          <div className={styles.center}>
            <Logo t={t} />
          </div>
          
          <h2 className={styles.productiveHeading03} style={{ marginBottom: '1rem', textAlign: 'center' }}>
            {t('linkExpired', 'Link Expired or Invalid')}
          </h2>
          
          <p className={styles.bodyShort01} style={{ marginBottom: '2rem', textAlign: 'center', color: '#525252' }}>
            {t('linkExpiredInstructions', "The password reset link you clicked is either invalid or has expired. Please request a new password reset link.")}
          </p>

          <Button
            onClick={() => navigate('/login/forgot-password')}
            className={styles.continueButton}
            style={{ width: '100%', marginBottom: '1rem' }}
          >
            {t('requestNewLink', 'Request new link')}
          </Button>

          <div style={{ textAlign: 'center' }}>
            <Link to="/login" style={{ textDecoration: 'none' }}>
              {t('backToLogin', 'Back to login')}
            </Link>
          </div>
        </Tile>
        <Footer />
      </div>
    );
  }

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
