/** Client display filter. The server still decides which encounters the role may read. */
export function keepHistoryEncounter(
  encounter: { form?: { uuid?: string }; encounterType?: { uuid?: string } },
  formUuids: string[] = [],
  dedicatedTypeUuids: string[] = [],
): boolean {
  const forms = formUuids.filter(Boolean);
  const types = dedicatedTypeUuids.filter(Boolean);
  if (forms.length === 0 && types.length === 0) {
    return true;
  }
  const form = encounter.form?.uuid;
  const type = encounter.encounterType?.uuid;
  if (form && forms.includes(form)) {
    return true;
  }
  return Boolean(type && types.includes(type));
}

export function summarizeObsDisplays(obs: Array<{ display?: string }> | undefined): string {
  const text = (obs ?? []).map((item) => item.display).filter(Boolean);
  return text.length ? text.join('; ') : '--';
}
