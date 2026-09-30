import { Type } from '@openmrs/esm-framework';

export const configSchema = {
  pageSize: {
    _type: Type.Number,
    _default: 50,
    _description: 'Entries per page when the audit log opens. The server returns at most 200.',
  },
  pageSizes: {
    _type: Type.Array,
    _elements: { _type: Type.Number },
    _default: [25, 50, 100, 200],
    _description: 'The page sizes offered. Values above 200 are served as 200.',
  },
  exportRowLimit: {
    _type: Type.Number,
    _default: 50000,
    _description:
      'The most rows one CSV download holds, newest first. The server caps every export at 50,000 whatever this says.',
  },
};

export interface AuditLogConfig {
  pageSize: number;
  pageSizes: Array<number>;
  exportRowLimit: number;
}
