/**
 * Duplicate vaccine answers inside one unsaved Immunization submission.
 *
 * History lookup cannot see a sibling row that has not been saved. Repeating
 * groups keep `vaccine_name` on the first row and `vaccine_name_N` on later
 * rows. The pinned engine leaves a removed persisted row's value in React Hook
 * Form state and removes only the group field, so `allFieldValues` alone still
 * contains that vaccine. `allFields` is the live form-field list: a value
 * counts only while its field and that field's group are still in the list.
 */
const VACCINE_NAME_FIELD = /^vaccine_name(?:_\d+)?$/;

type RepeatField = {
  id?: string;
  meta?: {
    groupId?: string;
    repeat?: { wasDeleted?: boolean };
  };
};

export function sameSubmissionVaccineDuplicate(
  myValue: unknown,
  allFieldValues: unknown,
  allFields?: unknown,
): boolean {
  if (myValue === undefined || myValue === null || myValue === '') return false;
  if (!allFieldValues || typeof allFieldValues !== 'object' || Array.isArray(allFieldValues)) return false;
  const fields = indexFields(allFields);
  const wanted = String(myValue);
  let count = 0;
  for (const [fieldId, value] of Object.entries(allFieldValues as Record<string, unknown>)) {
    if (!VACCINE_NAME_FIELD.test(fieldId)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (String(value) !== wanted) continue;
    if (fields && !isActiveVaccineField(fieldId, fields)) continue;
    count += 1;
  }
  return count > 1;
}

function indexFields(allFields: unknown): Map<string, RepeatField> | null {
  if (!Array.isArray(allFields)) return null;
  const indexed = new Map<string, RepeatField>();
  for (const field of allFields) {
    if (!field || typeof field !== 'object') continue;
    const id = (field as RepeatField).id;
    if (typeof id === 'string' && id) indexed.set(id, field as RepeatField);
  }
  return indexed;
}

function isActiveVaccineField(fieldId: string, fields: Map<string, RepeatField>): boolean {
  const field = fields.get(fieldId);
  if (!field || field.meta?.repeat?.wasDeleted) return false;
  const groupId = field.meta?.groupId;
  if (!groupId) return true;
  const group = fields.get(groupId);
  return !!group && !group.meta?.repeat?.wasDeleted;
}
