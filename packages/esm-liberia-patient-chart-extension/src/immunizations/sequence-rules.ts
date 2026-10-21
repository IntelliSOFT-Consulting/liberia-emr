import type { EligibilityRule, Offset } from './eligibility.ts';

/**
 * Sequencing policy only. OpenMRS form and concept UUIDs come from runtime
 * `routineImmunizations` config, keyed by these canonical dose IDs.
 */
const atBirth: Offset = { value: 0, unit: 'days' };

export interface SequenceRule {
  id: string;
  series: string;
  sequenceNumber: number;
  dueAge: Offset;
  upperAge?: { age: Offset; inclusive: boolean };
  prerequisiteId?: string;
  minimumInterval?: Offset;
  /**
   * The first day `eligibleDate` is reached stays DUE. A later day with the dose
   * still absent is OVERDUE. This does not add a maximum interval.
   */
  markOverdueAfterEligibleDate?: boolean;
}

export interface DoseLookup {
  byConcept: ReadonlyMap<string, SequenceRule>;
  recognized: ReadonlySet<string>;
  ambiguous: boolean;
}

function rule(input: Omit<SequenceRule, 'dueAge'> & { dueAge?: Offset }): SequenceRule {
  return { ...input, dueAge: input.dueAge ?? atBirth };
}

const hpvUpper = { age: { value: 14, unit: 'years' as const }, inclusive: false };
const pfizerUpper = { age: { value: 12, unit: 'years' as const }, inclusive: false };
const hpvAge: Offset = { value: 9, unit: 'years' };
const pfizerAge: Offset = { value: 5, unit: 'years' };

export const sequenceRules: readonly SequenceRule[] = [
  rule({ id: 'OPV1', series: 'opv', sequenceNumber: 1 }),
  rule({
    id: 'OPV2', series: 'opv', sequenceNumber: 2,
    prerequisiteId: 'OPV1', minimumInterval: { value: 28, unit: 'days' },
  }),
  rule({ id: 'OPV3', series: 'opv', sequenceNumber: 3, prerequisiteId: 'OPV2' }),
  rule({ id: 'Penta1', series: 'penta', sequenceNumber: 1 }),
  rule({ id: 'Penta2', series: 'penta', sequenceNumber: 2, prerequisiteId: 'Penta1' }),
  rule({ id: 'Penta3', series: 'penta', sequenceNumber: 3, prerequisiteId: 'Penta2' }),
  rule({ id: 'Pneumo1', series: 'pneumo', sequenceNumber: 1 }),
  rule({ id: 'Pneumo2', series: 'pneumo', sequenceNumber: 2, prerequisiteId: 'Pneumo1' }),
  rule({ id: 'Pneumo3', series: 'pneumo', sequenceNumber: 3, prerequisiteId: 'Pneumo2' }),
  rule({ id: 'Rota1', series: 'rota', sequenceNumber: 1 }),
  rule({ id: 'Rota2', series: 'rota', sequenceNumber: 2, prerequisiteId: 'Rota1' }),
  rule({ id: 'Malaria1', series: 'malaria', sequenceNumber: 1 }),
  rule({ id: 'Malaria2', series: 'malaria', sequenceNumber: 2, prerequisiteId: 'Malaria1' }),
  rule({ id: 'Malaria3', series: 'malaria', sequenceNumber: 3, prerequisiteId: 'Malaria2' }),
  rule({ id: 'Malaria4', series: 'malaria', sequenceNumber: 4, prerequisiteId: 'Malaria3' }),
  rule({
    id: 'HPV1', series: 'hpv', sequenceNumber: 1,
    dueAge: hpvAge, upperAge: hpvUpper,
  }),
  rule({
    id: 'HPV2', series: 'hpv', sequenceNumber: 2,
    dueAge: hpvAge, upperAge: hpvUpper, prerequisiteId: 'HPV1', minimumInterval: { value: 6, unit: 'months' },
  }),
  rule({
    id: 'PediatricPfizer1', series: 'pediatric-pfizer', sequenceNumber: 1,
    dueAge: pfizerAge, upperAge: pfizerUpper,
  }),
  rule({
    id: 'PediatricPfizer2', series: 'pediatric-pfizer', sequenceNumber: 2,
    prerequisiteId: 'PediatricPfizer1',
    minimumInterval: { value: 28, unit: 'days' },
    markOverdueAfterEligibleDate: true,
  }),
  rule({ id: 'TD1', series: 'tetanus', sequenceNumber: 1 }),
  rule({
    id: 'TD2', series: 'tetanus', sequenceNumber: 2,
    prerequisiteId: 'TD1', minimumInterval: { value: 4, unit: 'weeks' },
  }),
  rule({
    id: 'TD3', series: 'tetanus', sequenceNumber: 3,
    prerequisiteId: 'TD2', minimumInterval: { value: 6, unit: 'months' },
  }),
  rule({
    id: 'TD4', series: 'tetanus', sequenceNumber: 4,
    prerequisiteId: 'TD3', minimumInterval: { value: 1, unit: 'years' },
  }),
  rule({
    id: 'TD5', series: 'tetanus', sequenceNumber: 5,
    prerequisiteId: 'TD4', minimumInterval: { value: 1, unit: 'years' },
  }),
];

/**
 * Vaccine concepts that are configured but not sequenced. A record of one of
 * these does not block an unrelated series. IDs shared with the routine
 * schedule stay the same so both features read one concept map.
 */
export const recognizedDoseIds = [
  'BCG', 'OPV0', 'IPV', 'MCV1', 'MCV2', 'TCV', 'YellowFever', 'Pfizer', 'JJ', 'CovidBooster',
] as const;

const byId = new Map(sequenceRules.map((item) => [item.id, item]));

export function ruleById(id: string): SequenceRule | undefined {
  return byId.get(id);
}

/** Maps trimmed concept UUIDs from runtime config onto sequence rules. */
export function doseLookup(config: {
  vaccineConceptUuids?: Readonly<Record<string, string>>;
  ancTtConceptUuids?: Readonly<Record<string, string>>;
}): DoseLookup {
  const byConcept = new Map<string, SequenceRule>();
  const recognized = new Set<string>();
  const unbound = new Set<string>();
  let ambiguous = false;
  const claim = (raw: string | undefined, dose: SequenceRule | undefined) => {
    const uuid = raw?.trim() ?? '';
    if (!uuid) return;
    recognized.add(uuid);
    if (!dose) {
      if (byConcept.has(uuid)) ambiguous = true;
      else unbound.add(uuid);
      return;
    }
    if (unbound.has(uuid)) ambiguous = true;
    const existing = byConcept.get(uuid);
    if (existing && existing !== dose) ambiguous = true;
    else byConcept.set(uuid, dose);
  };
  for (const [id, uuid] of Object.entries(config.vaccineConceptUuids ?? {})) claim(uuid, byId.get(id));
  for (const [id, uuid] of Object.entries(config.ancTtConceptUuids ?? {})) {
    const dose = byId.get(id);
    if (!dose || dose.series !== 'tetanus') {
      if (uuid?.trim()) ambiguous = true;
      continue;
    }
    claim(uuid, dose);
  }
  return { byConcept, recognized, ambiguous };
}

export function toEligibilityRule(
  item: SequenceRule,
  vaccineConceptUuids: Readonly<Record<string, string>>,
): EligibilityRule {
  const vaccineConceptUuid = vaccineConceptUuids[item.id]?.trim() ?? '';
  if (!vaccineConceptUuid) throw new Error('Missing vaccine identity');
  const prior = item.prerequisiteId ? byId.get(item.prerequisiteId) : undefined;
  if (item.prerequisiteId && !prior) throw new Error('Unknown predecessor');
  const priorUuid = prior ? vaccineConceptUuids[prior.id]?.trim() ?? '' : '';
  if (prior && !priorUuid) throw new Error('Missing vaccine identity');
  return {
    vaccineConceptUuid,
    sequenceNumber: item.sequenceNumber,
    dueAge: item.dueAge,
    overdueAfterDays: null,
    ...(item.upperAge ? { upperAge: item.upperAge } : {}),
    ...(prior ? {
      prerequisite: {
        dose: { vaccineConceptUuid: priorUuid, sequenceNumber: prior.sequenceNumber },
        ...(item.minimumInterval ? { minimumInterval: item.minimumInterval } : {}),
      },
    } : {}),
  };
}
