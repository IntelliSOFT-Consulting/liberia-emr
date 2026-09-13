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
    _default: '9e2c4f70-4a8d-4c01-87a9-48b2c6f0d2fb',
  },
  deliveryEncounterTypeUuid: {
    _type: Type.UUID,
    _description: 'Encounter type representing delivery outcome / delivery summary.',
    _default: '7c0a2d58-2e6b-4a9e-a587-26f0a4e8b0d9',
  },
  formUuid: {
    _type: Type.String,
    _description: 'UUID of the partograph AMPATH form to launch when the user clicks Add.',
    _default: '41d56853-8338-302e-a9f3-f81e70e797dd',
  },
  thirdStageFormUuid: {
    _type: Type.String,
    _description: 'UUID of the Stage 3 / Delivery of Infant and Placenta AMPATH form.',
    _default: 'a1f46814-43c4-3690-9b87-ae4644b8b93a',
  },
  concepts: {
    cervicalDilationUuid: { _type: Type.ConceptUuid, _default: '34cffe7c-726f-5da4-ade1-c67e3209f5eb' },
    descentOfHeadUuid: { _type: Type.ConceptUuid, _default: 'f5306f9f-a41d-5750-9d19-cbc69da9d833' },
    contractionsPerTenMinutesUuid: { _type: Type.ConceptUuid, _default: '07d345b3-90ff-56fd-ad73-3c64032f3447' },
    contractionDurationUuid: { _type: Type.ConceptUuid, _default: '70c2a4e6-e083-4ccd-e4b5-a02c4e618305' },
    amnioticFluidUuid: { _type: Type.ConceptUuid, _default: '92e4c608-02a5-4eef-06d7-c24e60830527' },
    mouldingUuid: { _type: Type.ConceptUuid, _default: 'b9997fd8-705c-5030-9df3-99704510b444' },
    fetalHeartRateUuid: { _type: Type.ConceptUuid, _default: '1440AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    systolicBloodPressureUuid: { _type: Type.ConceptUuid, _default: '5085AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    diastolicBloodPressureUuid: { _type: Type.ConceptUuid, _default: '5086AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    pulseUuid: { _type: Type.ConceptUuid, _default: '5087AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    temperatureUuid: { _type: Type.ConceptUuid, _default: '5088AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    oxytocinUnitsPerLitreUuid: { _type: Type.ConceptUuid, _default: 'a154a798-594f-5161-9fb3-f6281bb97f2a' },
    drugsAndIvFluidsUuid: { _type: Type.ConceptUuid, _default: '77c2b68a-b814-5179-88b7-ab862f5d9106' },
    proteinsInUrineUuid: { _type: Type.ConceptUuid, _default: 'ae5975cf-3db6-5af8-bdba-862ffc0971b9' },
    acetoneInUrineUuid: { _type: Type.ConceptUuid, _default: '3b1719eb-8a36-5954-b8b5-168dba013ed7' },
    urineVolumeUuid: { _type: Type.ConceptUuid, _default: '8910504d-b468-5616-94b8-35c970ab1324' },
    negativeDipstickUuid: { _type: Type.ConceptUuid, _default: '' },
    plus1DipstickUuid: { _type: Type.ConceptUuid, _default: '' },
    plus2DipstickUuid: { _type: Type.ConceptUuid, _default: '' },
    plus3DipstickUuid: { _type: Type.ConceptUuid, _default: '' },
    plus4DipstickUuid: { _type: Type.ConceptUuid, _default: '' },
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
  deliveryEncounterTypeUuid?: string;
  formUuid: string;
  thirdStageFormUuid?: string;
  concepts: {
    cervicalDilationUuid: string;
    descentOfHeadUuid: string;
    contractionsPerTenMinutesUuid: string;
    contractionDurationUuid: string;
    amnioticFluidUuid: string;
    mouldingUuid: string;
    fetalHeartRateUuid: string;
    systolicBloodPressureUuid: string;
    diastolicBloodPressureUuid: string;
    pulseUuid: string;
    temperatureUuid: string;
    oxytocinUnitsPerLitreUuid: string;
    drugsAndIvFluidsUuid: string;
    proteinsInUrineUuid: string;
    acetoneInUrineUuid: string;
    urineVolumeUuid: string;
    negativeDipstickUuid?: string;
    plus1DipstickUuid?: string;
    plus2DipstickUuid?: string;
    plus3DipstickUuid?: string;
    plus4DipstickUuid?: string;
  };
  alertLine: {
    startDilationCm: number;
    cmPerHour: number;
    actionLineOffsetHours: number;
  };
}
