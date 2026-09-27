import { Type } from '@openmrs/esm-framework';
import { DEFAULT_ANC_NATIONAL_FORM_NAME, type LabourEpisodeConfig } from './labour-episode';

/**
 * Runtime config for current-pregnancy ANC lookups used by form-engine helpers.
 * Values come from content-package frontend JSON (`${var.*}`), not from this module.
 */
export const currentPregnancyAncConfigSchema = {
  deliveryEncounterTypeUuid: {
    _type: Type.String,
    _description: 'Encounter type representing delivery outcome / delivery summary (current-pregnancy lower bound).',
    _default: '',
  },
  thirdStageFormUuid: {
    _type: Type.String,
    _description: 'Runtime Form UUID of Stage 3 / Delivery of Infant and Placenta.',
    _default: '',
  },
  ancInitialEncounterTypeUuid: {
    _type: Type.String,
    _description: 'Encounter type for ANC Initial Visit.',
    _default: '',
  },
  ancInitialFormUuid: {
    _type: Type.String,
    _description: 'Runtime Form UUID of ANC Initial Visit.',
    _default: '',
  },
  ancNationalFormName: {
    _type: Type.String,
    _description:
      'Published name of the legacy national ANC form (1. ANC Form). Matched by form identity, not by Consultation encounter type.',
    _default: DEFAULT_ANC_NATIONAL_FORM_NAME,
  },
};

export type CurrentPregnancyAncConfig = LabourEpisodeConfig;
