import React, { useEffect, useState } from 'react';
import {
  Button,
  ButtonSet,
  FormLabel,
  InlineNotification,
  NumberInput,
  RadioButton,
  RadioButtonGroup,
} from '@carbon/react';
import {
  openmrsFetch,
  restBaseUrl,
  showSnackbar,
  useConfig,
  useSession,
  Workspace2,
  type Workspace2DefinitionProps,
} from '@openmrs/esm-framework';
import type { ConfigObject } from '../config-schema';
import {
  buildRbsEncounter,
  clinicianEncounterRole,
  rbsConceptPair,
  rbsEncounterMetadataError,
  validateRbsValue,
  type RbsUnit,
} from './random-blood-sugar';

interface RbsGroupProps {
  patientUuid?: string;
  visitContext?: { uuid?: string };
  mutate?: () => void;
}

/**
 * Unit and one number. Save posts a single vitals encounter observation:
 * CIEL 887 for mg/dL, CIEL 1458 for mmol/L.
 */
const RbsFormWorkspace: React.FC<Workspace2DefinitionProps<object, object, RbsGroupProps>> = ({
  closeWorkspace,
  groupProps,
}) => {
  const config = useConfig<ConfigObject>();
  const session = useSession();
  const concepts = rbsConceptPair(config.data);
  const [unit, setUnit] = useState<RbsUnit | ''>('');
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [encounterRoleUuid, setEncounterRoleUuid] = useState<string | null | undefined>(undefined);
  const providerUuid = session?.currentProvider?.uuid;
  const error = unit || raw ? validateRbsValue(unit, raw) : null;

  useEffect(() => {
    const controller = new AbortController();
    openmrsFetch(`${restBaseUrl}/encounterrole?v=custom:(uuid,name)`, { signal: controller.signal })
      .then((response) => {
        setEncounterRoleUuid(clinicianEncounterRole(response?.data?.results));
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setEncounterRoleUuid(null);
      });
    return () => controller.abort();
  }, []);

  function encounterAt(encounterDatetime: Date) {
    return buildRbsEncounter({
      patientUuid: groupProps?.patientUuid ?? '',
      encounterTypeUuid: config.entryEncounterType,
      locationUuid: session?.sessionLocation?.uuid,
      visitUuid: groupProps?.visitContext?.uuid,
      providerUuid,
      encounterRoleUuid,
      encounterDatetime,
      unit,
      raw,
      concepts,
    });
  }

  const metadataError =
    !error &&
    raw.trim() !== '' &&
    unit &&
    (providerUuid ? encounterRoleUuid !== undefined : true) &&
    !encounterAt(new Date())
      ? rbsEncounterMetadataError({
          patientUuid: groupProps?.patientUuid,
          encounterTypeUuid: config.entryEncounterType,
          locationUuid: session?.sessionLocation?.uuid,
          providerUuid,
          encounterRoleUuid,
          encounterDatetime: new Date(),
        })
      : null;

  async function save() {
    const encounter = encounterAt(new Date());
    if (!encounter || saving) {
      if (!encounter && metadataError) {
        showSnackbar({
          kind: 'error',
          title: 'Unable to save blood sugar',
          subtitle: metadataError,
        });
      }
      return;
    }
    setSaving(true);
    try {
      await openmrsFetch(`${restBaseUrl}/encounter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: encounter,
      });
      groupProps?.mutate?.();
      closeWorkspace({ discardUnsavedChanges: true });
    } catch (err) {
      showSnackbar({
        kind: 'error',
        title: 'Unable to save blood sugar',
        subtitle: err instanceof Error ? err.message : String(err),
      });
      setSaving(false);
    }
  }

  return (
    <Workspace2 title="Add blood sugar" hasUnsavedChanges={Boolean(unit || raw)}>
      <div data-testid="initial-blood-sugar">
        <RadioButtonGroup
          legendText="Initial blood sugar unit"
          name="initial-blood-sugar-unit"
          orientation="horizontal"
          valueSelected={unit}
          onChange={(selected) => setUnit(selected === 'mmol/L' ? 'mmol/L' : 'mg/dL')}
        >
          <RadioButton id="initial-blood-sugar-mgdl" labelText="mg/dL" value="mg/dL" />
          <RadioButton id="initial-blood-sugar-mmol" labelText="mmol/L" value="mmol/L" />
        </RadioButtonGroup>
        {unit ? (
          <NumberInput
            allowEmpty
            disableWheel
            hideSteppers
            id="initial-blood-sugar-value"
            invalid={Boolean(error)}
            invalidText={error ?? ''}
            label="Initial blood sugar / RBS"
            max={unit === 'mg/dL' ? 600 : 33.3}
            min={0}
            step={unit === 'mg/dL' ? 1 : 0.1}
            value={raw}
            onChange={(_event, data) => setRaw(data.value == null ? '' : String(data.value))}
          />
        ) : (
          <FormLabel>Choose a unit to enter initial blood sugar.</FormLabel>
        )}
        {metadataError ? (
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title="Unable to save blood sugar"
            subtitle={metadataError}
          />
        ) : null}
        <ButtonSet>
          <Button kind="secondary" onClick={() => closeWorkspace()}>
            Discard
          </Button>
          <Button kind="primary" disabled={!encounterAt(new Date()) || saving} onClick={() => void save()}>
            Save and close
          </Button>
        </ButtonSet>
      </div>
    </Workspace2>
  );
};

export default RbsFormWorkspace;
