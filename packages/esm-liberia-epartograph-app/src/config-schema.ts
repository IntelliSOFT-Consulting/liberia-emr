import { Type } from '@openmrs/esm-framework';

/**
 * Every value here is supplied at runtime by
 * content-liberia-mch/configuration/frontend_configuration/config-mch.json, which itself
 * references ${var.*} from variables.properties. No UUID is hard-coded in this module —
 * see IMPLEMENTATION.md §7.
 *
 * The defaults below are deliberately empty rather than "a UUID that works on our test
 * server": an unset concept must fail visibly in configuration validation, not silently
 * write observations against the wrong concept.
 */
export const configSchema = {
  encounterTypeUuid: {
    _type: Type.UUID,
    _description: 'Encounter type recorded for each serial partograph observation.',
    _default: '',
  },
  concepts: {
    cervicalDilationUuid: { _type: Type.ConceptUuid, _default: '' },
    descentOfHeadUuid: { _type: Type.ConceptUuid, _default: '' },
    contractionsPerTenMinutesUuid: { _type: Type.ConceptUuid, _default: '' },
    contractionDurationUuid: { _type: Type.ConceptUuid, _default: '' },
    amnioticFluidUuid: { _type: Type.ConceptUuid, _default: '' },
    mouldingUuid: { _type: Type.ConceptUuid, _default: '' },
    fetalHeartRateUuid: { _type: Type.ConceptUuid, _default: '' },
    systolicBloodPressureUuid: { _type: Type.ConceptUuid, _default: '' },
    diastolicBloodPressureUuid: { _type: Type.ConceptUuid, _default: '' },
    pulseUuid: { _type: Type.ConceptUuid, _default: '' },
    temperatureUuid: { _type: Type.ConceptUuid, _default: '' },
  },
  alertLine: {
    _description:
      'WHO partograph alert and action line geometry. Confirm against the DAK before go-live.',
    startDilationCm: {
      _type: Type.Number,
      _description: 'Cervical dilation at which the alert line begins.',
      _default: 4,
    },
    cmPerHour: {
      _type: Type.Number,
      _description: 'Expected dilation rate defining the slope of the alert line.',
      _default: 1,
    },
    actionLineOffsetHours: {
      _type: Type.Number,
      _description: 'Hours to the right of the alert line at which the action line sits.',
      _default: 4,
    },
  },
};

export interface EPartographConfig {
  encounterTypeUuid: string;
  concepts: Record<string, string>;
  alertLine: {
    startDilationCm: number;
    cmPerHour: number;
    actionLineOffsetHours: number;
  };
}
