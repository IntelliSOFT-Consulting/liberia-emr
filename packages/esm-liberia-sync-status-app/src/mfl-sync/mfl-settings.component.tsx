import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineNotification, TextInput, Tile, Toggle } from '@carbon/react';
import { isValidTime, isValidUrl, messageOf, updateMflConfig } from './mfl-sync.resource';
import { type MflConfigUpdate, type MflStatus } from './mfl-sync.types';
import styles from './mfl-sync.scss';

interface MflSettingsProps {
  status: MflStatus;
  canManage: boolean;
  onSaved: (status: MflStatus) => void;
}

/**
 * The settings an administrator may change. There is deliberately no account or password field:
 * the credentials are a deployment secret (ADR 0009 decision 7), and the API rejects them.
 */
const MflSettings: React.FC<MflSettingsProps> = ({ status, canManage, onSaved }) => {
  const { t } = useTranslation();
  const { config } = status;
  const [enabled, setEnabled] = useState(config.enabled);
  const [url, setUrl] = useState(config.url);
  const [time, setTime] = useState(config.schedule.time);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; title: string } | null>(null);

  const urlInvalid = !isValidUrl(url);
  const timeInvalid = !isValidTime(time);

  const changes: MflConfigUpdate = {};
  if (enabled !== config.enabled) {
    changes.enabled = enabled;
  }
  if (url.trim() !== config.url) {
    changes.url = url.trim();
  }
  if (time.trim() !== config.schedule.time) {
    changes.schedule = { time: time.trim() };
  }
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await updateMflConfig(changes);
      onSaved(response.data);
      setResult({ kind: 'success', title: t('settingsSaved', 'Settings saved') });
    } catch (e) {
      setResult({ kind: 'error', title: messageOf(e) ?? t('settingsNotSaved', 'The settings were not saved. Try again.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tile className={styles.panel}>
      <section aria-label={t('mflSettings', 'MFL sync settings')}>
        <h4 className={styles.subheading}>{t('settings', 'Settings')}</h4>
        <p className={styles.meta}>
          {t(
            'credentialsAreSecret',
            'The MFL account and password are a deployment secret that ICT sets on the server. They are never shown or entered here.',
          )}
        </p>
        <div className={styles.form}>
          <Toggle
            id="mfl-enabled"
            labelText={t('scheduledSync', 'Scheduled sync')}
            labelA={t('scheduleOff', 'Off: runs only when started here')}
            labelB={t('scheduleOnDaily', 'On: runs daily')}
            toggled={enabled}
            disabled={!canManage}
            onToggle={setEnabled}
          />
          <TextInput
            id="mfl-time"
            labelText={t('dailyRunTime', 'Daily run time (HH:MM, Monrovia time)')}
            value={time}
            disabled={!canManage}
            invalid={timeInvalid}
            invalidText={t('timeInvalid', 'Use 24-hour time, for example 02:00.')}
            onChange={(event) => setTime(event.target.value)}
          />
          <TextInput
            id="mfl-url"
            labelText={t('mflUrl', 'MFL address')}
            helperText={t('mflUrlHelper', 'The DHIS2 instance root, starting https:// and without /api.')}
            value={url}
            disabled={!canManage}
            invalid={urlInvalid}
            invalidText={t('urlInvalid', 'Use an https:// address that does not end in /api.')}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        {result && (
          <InlineNotification
            className={styles.notice}
            kind={result.kind}
            lowContrast
            onClose={() => setResult(null)}
            title={result.title}
          />
        )}
        {canManage && (
          <Button kind="primary" size="sm" disabled={!dirty || urlInvalid || timeInvalid || saving} onClick={save}>
            {saving ? t('saving', 'Saving...') : t('saveSettings', 'Save settings')}
          </Button>
        )}
      </section>
    </Tile>
  );
};

export default MflSettings;
