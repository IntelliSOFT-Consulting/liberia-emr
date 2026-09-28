import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineNotification, TextInput, Tile, Toggle } from '@carbon/react';
import { isAboutUrl, isValidTime, isValidUrl, messageOf, statusOf, updateMflConfig } from './mfl-sync.resource';
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
  // The server values the draft was last aligned with. Status refreshes every minute, so another
  // administrator's change can arrive while this form is open.
  const [baseline, setBaseline] = useState({ enabled: config.enabled, url: config.url, time: config.schedule.time });
  // Fields the server changed underneath an edit the user has not saved yet.
  const [conflicts, setConflicts] = useState<Array<string>>([]);

  useEffect(() => {
    const server = { enabled: config.enabled, url: config.url, time: config.schedule.time };
    if (server.enabled === baseline.enabled && server.url === baseline.url && server.time === baseline.time) {
      return;
    }
    // An untouched field follows the server; an edited one keeps the user's value, with a warning
    // if the server moved it too.
    const moved: Array<string> = [];
    if (server.enabled !== baseline.enabled) {
      if (enabled === baseline.enabled) {
        setEnabled(server.enabled);
      } else {
        moved.push(t('scheduledSync', 'Scheduled sync'));
      }
    }
    if (server.url !== baseline.url) {
      if (url.trim() === baseline.url) {
        setUrl(server.url);
      } else {
        moved.push(t('mflUrl', 'MFL address'));
      }
    }
    if (server.time !== baseline.time) {
      if (time.trim() === baseline.time) {
        setTime(server.time);
      } else {
        moved.push(t('dailyRunTime', 'Daily run time (HH:MM, Monrovia time)'));
      }
    }
    setBaseline(server);
    setConflicts((previous) => Array.from(new Set([...previous, ...moved])));
    // Only a change on the server re-runs this; the draft is read as it stands at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled, config.url, config.schedule.time]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; title: string } | null>(null);
  // The server's reason for refusing the address, such as a host outside the deployment's allowlist.
  // It stands against the field until the address is edited.
  const [urlRefusal, setUrlRefusal] = useState<string | null>(null);

  const urlMalformed = !isValidUrl(url);
  const urlInvalid = urlMalformed || urlRefusal !== null;
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
      // Line the draft and the baseline up with what was saved first, so the status refresh that
      // follows is not mistaken for someone else's change.
      const saved = response.data.config;
      setEnabled(saved.enabled);
      setUrl(saved.url);
      setTime(saved.schedule.time);
      setBaseline({ enabled: saved.enabled, url: saved.url, time: saved.schedule.time });
      setConflicts([]);
      onSaved(response.data);
      setResult({ kind: 'success', title: t('settingsSaved', 'Settings saved') });
    } catch (e) {
      const message = messageOf(e);
      if (statusOf(e) === 400 && changes.url && message && isAboutUrl(message)) {
        setUrlRefusal(message);
        setResult({ kind: 'error', title: t('urlRefused', 'The MFL address was not accepted, so nothing was saved.') });
      } else {
        setResult({ kind: 'error', title: message ?? t('settingsNotSaved', 'The settings were not saved. Try again.') });
      }
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
            helperText={t(
              'mflUrlHelper',
              'The DHIS2 instance root, starting https:// and without /api. Only hosts the deployment allows can be used; ICT sets that list on the server, not here.',
            )}
            value={url}
            disabled={!canManage}
            invalid={urlInvalid}
            invalidText={
              urlMalformed
                ? t('urlInvalid', 'Use an https:// address without a user name or password, and not ending in /api.')
                : t('urlRefusedBy', '{{reason}}. The allowed hosts are set by the deployment, not on this page: ask ICT to add the host if it is right.', {
                    reason: urlRefusal?.replace(/\.$/, ''),
                  })
            }
            onChange={(event) => {
              setUrl(event.target.value);
              setUrlRefusal(null);
            }}
          />
        </div>
        {conflicts.length > 0 && (
          <InlineNotification
            className={styles.notice}
            kind="warning"
            lowContrast
            onClose={() => setConflicts([])}
            title={t('settingsChangedOnServer', 'These settings were changed on the server while you were editing: {{fields}}.', {
              fields: conflicts.join(', '),
            })}
            subtitle={t(
              'settingsChangedOnServerBody',
              'Saving replaces them with the values shown here. Settings you did not edit already show the newer values.',
            )}
          />
        )}
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
