import { Type } from '@openmrs/esm-framework';

export const configSchema = {
  reportUuids: {
    _type: Type.Array,
    _elements: { _type: Type.UUID },
    _default: [],
    _description:
      'The MOH indicator reports to offer, in this order. Set them in config-national.json as ' +
      '${var.report.<sheet>.uuid} (docs/reporting/README.md section 3.1), never as literals. ' +
      'Report definitions not listed here are not shown.',
  },
  dataSetKey: {
    _type: Type.String,
    _default: 'indicators',
    _description: 'The data set shown on screen. Every MOH report keys its indicators data set "indicators".',
  },
  facilityLocationTag: {
    _type: Type.String,
    _default: 'Health Facility',
    _description:
      'At central, the location picker lists every location with this tag, and offers their districts and ' +
      'counties (their parent and grandparent) too. The same tag as the login facility switcher.',
  },
  mflCodeAttributeTypeUuid: {
    _type: Type.String,
    _default: '',
    _description:
      "UUID of the 'MFL Code' location attribute type, so a facility can be found by its code. Empty: search by name only.",
  },
  maxFacilitiesShown: {
    _type: Type.Number,
    _default: 8,
    _description: 'How many matching facilities the central picker lists at once.',
  },
  pollIntervalMs: {
    _type: Type.Number,
    _default: 3000,
    _description: 'How often a running report request is polled, in milliseconds.',
  },
  monthsOffered: {
    _type: Type.Number,
    _default: 12,
    _description: 'How many months, counting back from the current one, the period picker offers.',
  },
  quartersOffered: {
    _type: Type.Number,
    _default: 8,
    _description: 'How many quarters, counting back from the current one, the period picker offers.',
  },
};

export interface ReportsConfig {
  reportUuids: Array<string>;
  dataSetKey: string;
  facilityLocationTag: string;
  mflCodeAttributeTypeUuid: string;
  maxFacilitiesShown: number;
  pollIntervalMs: number;
  monthsOffered: number;
  quartersOffered: number;
}
