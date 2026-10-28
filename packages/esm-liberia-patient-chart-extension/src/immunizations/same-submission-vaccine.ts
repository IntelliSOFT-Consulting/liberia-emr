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
    if (fields && !isActiveField(fieldId, fields)) continue;
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

/**
 * A vaccine-administration row is being saved when this row has a route or a
 * return date and Vitamin A did not calculate those values. Repeating rows are
 * `vaccine_name`, `vaccine_name_1`, and so on. The pinned form engine does not
 * rewrite a reference to a later sibling, so the row is found from this field's
 * own id rather than from `route` or `return_date` in the expression.
 */
export function vaccineNameRequired(
  myValue: unknown,
  currentFieldId: unknown,
  allFieldValues: unknown,
  allFields?: unknown,
  vitaminA?: unknown,
): boolean {
  if (!blank(myValue) || !blank(vitaminA)) return false;
  return rowInUse('vaccine_name', currentFieldId, allFieldValues, allFields, false);
}

/** Route is required on a vaccine row. A Vitamin A-only row keeps its calculated route. */
export function routeRequired(
  myValue: unknown,
  currentFieldId: unknown,
  allFieldValues: unknown,
  allFields?: unknown,
  vitaminA?: unknown,
): boolean {
  if (!blank(myValue)) return false;
  return rowInUse('route', currentFieldId, allFieldValues, allFields, !blank(vitaminA));
}

function rowInUse(
  base: 'vaccine_name' | 'route',
  currentFieldId: unknown,
  allFieldValues: unknown,
  allFields: unknown,
  vitaminAOwnsReturnDate: boolean,
): boolean {
  const suffix = rowSuffix(currentFieldId, base);
  if (suffix === null) return true;
  const fields = indexFields(allFields);
  if (fields && !isActiveField(String(currentFieldId), fields)) return false;
  const vaccine = readRow(allFieldValues, `vaccine_name${suffix}`, fields);
  const route = readRow(allFieldValues, `route${suffix}`, fields);
  const returnDate = readRow(allFieldValues, `return_date${suffix}`, fields);
  if (base === 'route') {
    if (!blank(vaccine)) return true;
    return !vitaminAOwnsReturnDate && !blank(returnDate);
  }
  return !blank(route) || !blank(returnDate);
}

function rowSuffix(currentFieldId: unknown, base: string): string | null {
  if (typeof currentFieldId !== 'string') return null;
  if (currentFieldId === base) return '';
  const match = new RegExp(`^${base}_(\\d+)$`).exec(currentFieldId);
  return match ? `_${match[1]}` : null;
}

function readRow(allFieldValues: unknown, fieldId: string, fields: Map<string, RepeatField> | null): unknown {
  if (!allFieldValues || typeof allFieldValues !== 'object' || Array.isArray(allFieldValues)) return undefined;
  if (fields && !isActiveField(fieldId, fields)) return undefined;
  return (allFieldValues as Record<string, unknown>)[fieldId];
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function isActiveField(fieldId: string, fields: Map<string, RepeatField>): boolean {
  const field = fields.get(fieldId);
  if (!field || field.meta?.repeat?.wasDeleted) return false;
  const groupId = field.meta?.groupId;
  if (!groupId) return true;
  const group = fields.get(groupId);
  return !!group && !group.meta?.repeat?.wasDeleted;
}
