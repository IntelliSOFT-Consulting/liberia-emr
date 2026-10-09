import { Type, validator } from '@openmrs/esm-framework';
import { sectionIds } from './external-records-sections';

/** `externalRecords` in this module's config. */
export const externalRecordsConfigSchema = {
  summarySections: {
    _type: Type.Array,
    _elements: { _type: Type.String },
    _default: ['allergies', 'conditions'],
    _description: `Sections on the Patient Summary card, at most two. One of: ${sectionIds.join(', ')}.`,
    _validators: [
      validator(
        (ids: Array<string>) => ids.length <= 2 && ids.every((id) => sectionIds.includes(id)),
        `summarySections takes at most two of: ${sectionIds.join(', ')}`,
      ),
    ],
  },
  dashboardIcon: {
    _type: Type.String,
    _default: 'omrs-icon-referral-order',
    _description: 'OpenMRS icon id for the External records item in the chart navigation.',
  },
  pageSize: {
    _type: Type.Number,
    _default: 5,
    _description: 'Rows per page in each External records table.',
  },
};

export interface ExternalRecordsConfig {
  summarySections: Array<string>;
  dashboardIcon: string;
  pageSize: number;
}

/** The External records dashboard, reached from the nav item, the banner tag and "View All". */
export const externalRecordsDashboardPath = 'external-records';

export const dashboardUrl = (patientUuid: string) =>
  `\${openmrsSpaBase}/patient/${patientUuid}/chart/${externalRecordsDashboardPath}`;
