/**
 * What `GET reportingrest/downloadReport` returns: reportingrest's `ReportFile`
 * (docs/reporting/README.md section 4.2).
 */
export interface ReportFile {
  filename: string;
  contentType: string;
  /** `byte[]` on the server. How it reaches the browser is not yet confirmed; see toReportBlob. */
  fileContent: unknown;
}

const BASE64 = /^[A-Za-z0-9+/\r\n]*={0,2}\s*$/;

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Turns a downloaded ReportFile into a Blob. The ONE place that knows how `fileContent` is encoded.
 *
 * TODO(LE-335): confirm the encoding against a running reportingrest 2.0.0, then delete the shapes
 * that do not occur. Jackson serialises `byte[]` as a base64 string, and the upstream
 * `@openmrs/esm-reports-app` 4.4.0 decodes it with `atob`, so base64 is expected. Until the MOH reports
 * run on a real stack, this also accepts:
 *   - a JSON array of byte values, which some serialiser configurations produce for `byte[]`;
 *   - text that is not base64, e.g. a CSV body passed through unencoded.
 * A CSV whose every character happens to be in the base64 alphabet would be misread as base64; the
 * MOH CSVs always contain commas, which are not, so that cannot happen for them.
 */
export function toReportBlob(file: ReportFile): Blob {
  const type = file.contentType || 'application/octet-stream';
  const content = file.fileContent;

  if (Array.isArray(content)) {
    // Java bytes are signed; Uint8Array wraps -1 to 255 as intended.
    return new Blob([new Uint8Array(content as Array<number>)], { type });
  }
  if (typeof content === 'string') {
    if (content.length > 0 && BASE64.test(content)) {
      return new Blob([base64ToBytes(content)], { type });
    }
    return new Blob([content], { type });
  }
  throw new Error('The report file has no content');
}

/** Hands a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
