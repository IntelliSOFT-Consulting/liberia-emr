import type { EligibilityRule, Offset } from './eligibility.ts';

/**
 * Dose-specific national concepts from content-liberia-national variables.properties.
 * Identity is that concept plus its clinical sequence number. Dose 1 of TD is
 * `var.concept.national.td.uuid`; there is no `td1` variable.
 */
const atBirth: Offset = { value: 0, unit: 'days' };

export const immunizationFormUuid = 'c1b0a028-d35d-3f54-a240-c027d51ac1df';
export const ancFormUuid = 'bd1ae06c-f522-34dd-816f-1235c89bebee';
export const vaccineQuestionUuid = 'ec2c08f4-1275-4dc4-ae37-b32740cdd0f8';
export const returnDateConceptUuid = '9014d952-c45f-4574-b7e5-75c8192e1c89';

export interface SequenceRule {
  id: string;
  series: string;
  vaccineConceptUuid: string;
  sequenceNumber: number;
  dueAge: Offset;
  upperAge?: { age: Offset; inclusive: boolean };
  prerequisiteId?: string;
  minimumInterval?: Offset;
  conceptUuids: readonly string[];
}

function rule(input: Omit<SequenceRule, 'dueAge' | 'conceptUuids'> & {
  dueAge?: Offset;
  equivalents?: readonly string[];
}): SequenceRule {
  const { equivalents, ...rest } = input;
  return {
    ...rest,
    dueAge: input.dueAge ?? atBirth,
    conceptUuids: [input.vaccineConceptUuid, ...(equivalents ?? [])],
  };
}

const hpvUpper = { age: { value: 14, unit: 'years' as const }, inclusive: false };
const pfizerUpper = { age: { value: 12, unit: 'years' as const }, inclusive: false };
const hpvAge: Offset = { value: 9, unit: 'years' };
const pfizerAge: Offset = { value: 5, unit: 'years' };

export const sequenceRules: readonly SequenceRule[] = [
  rule({ id: 'OPV1', series: 'opv', vaccineConceptUuid: 'da5d743f-dd31-4641-9e5e-26800c2920c5', sequenceNumber: 1 }),
  rule({
    id: 'OPV2', series: 'opv', vaccineConceptUuid: '41251020-c59f-495f-ad0b-12af05459286', sequenceNumber: 2,
    prerequisiteId: 'OPV1', minimumInterval: { value: 28, unit: 'days' },
  }),
  rule({
    id: 'OPV3', series: 'opv', vaccineConceptUuid: '3283dc78-d768-47ee-a322-f018e69308fd', sequenceNumber: 3,
    prerequisiteId: 'OPV2',
  }),
  rule({ id: 'Penta1', series: 'penta', vaccineConceptUuid: 'df0870b9-cd81-46ad-942f-768afbce7138', sequenceNumber: 1 }),
  rule({
    id: 'Penta2', series: 'penta', vaccineConceptUuid: '233fcc73-a392-4fcc-b896-76d3e21fe284', sequenceNumber: 2,
    prerequisiteId: 'Penta1',
  }),
  rule({
    id: 'Penta3', series: 'penta', vaccineConceptUuid: '2a847b11-084f-4e13-acea-f1ebd862cd1b', sequenceNumber: 3,
    prerequisiteId: 'Penta2',
  }),
  rule({ id: 'Pneumo1', series: 'pneumo', vaccineConceptUuid: '77d7cd54-557f-4403-a38f-a6fa96c0c535', sequenceNumber: 1 }),
  rule({
    id: 'Pneumo2', series: 'pneumo', vaccineConceptUuid: '4aa98c7f-07e3-4027-bf09-93abdb4b4aba', sequenceNumber: 2,
    prerequisiteId: 'Pneumo1',
  }),
  rule({
    id: 'Pneumo3', series: 'pneumo', vaccineConceptUuid: '92075d94-07e8-44e0-a324-1b4ad98dc6c8', sequenceNumber: 3,
    prerequisiteId: 'Pneumo2',
  }),
  rule({ id: 'Rota1', series: 'rota', vaccineConceptUuid: '5f5a5d3f-7d52-43f6-8889-898147abe978', sequenceNumber: 1 }),
  rule({
    id: 'Rota2', series: 'rota', vaccineConceptUuid: '2474cbde-2747-47ce-b63b-351dec329baf', sequenceNumber: 2,
    prerequisiteId: 'Rota1',
  }),
  rule({ id: 'Malaria1', series: 'malaria', vaccineConceptUuid: '7ecd4664-3633-45e8-84a1-324281570ecb', sequenceNumber: 1 }),
  rule({
    id: 'Malaria2', series: 'malaria', vaccineConceptUuid: '7c1b27ce-dba6-4fda-9f90-2f0095d02f15', sequenceNumber: 2,
    prerequisiteId: 'Malaria1',
  }),
  rule({
    id: 'Malaria3', series: 'malaria', vaccineConceptUuid: '31a8b4c8-b1b4-46b8-a3ce-278abd56fa21', sequenceNumber: 3,
    prerequisiteId: 'Malaria2',
  }),
  rule({
    id: 'Malaria4', series: 'malaria', vaccineConceptUuid: '6671b307-7f7d-49e8-b87f-cedc5b0ec56b', sequenceNumber: 4,
    prerequisiteId: 'Malaria3',
  }),
  rule({
    id: 'HPV1', series: 'hpv', vaccineConceptUuid: '02dc9528-231e-4e82-a8dc-071c25a57b48', sequenceNumber: 1,
    dueAge: hpvAge, upperAge: hpvUpper,
  }),
  rule({
    id: 'HPV2', series: 'hpv', vaccineConceptUuid: '5e59e204-9936-4da4-82b0-7ceaf6c806f4', sequenceNumber: 2,
    dueAge: hpvAge, upperAge: hpvUpper, prerequisiteId: 'HPV1', minimumInterval: { value: 6, unit: 'months' },
  }),
  rule({
    id: 'PediatricPfizer1', series: 'pediatric-pfizer',
    vaccineConceptUuid: 'd0798b88-8ac8-4fa5-8870-42dae3bf26fa', sequenceNumber: 1,
    dueAge: pfizerAge, upperAge: pfizerUpper,
  }),
  rule({
    id: 'PediatricPfizer2', series: 'pediatric-pfizer',
    vaccineConceptUuid: '9202dd52-85d7-4808-89cd-8e30b36131cd', sequenceNumber: 2,
    dueAge: pfizerAge, upperAge: pfizerUpper, prerequisiteId: 'PediatricPfizer1',
    minimumInterval: { value: 28, unit: 'days' },
  }),
  rule({
    id: 'TD1', series: 'tetanus', vaccineConceptUuid: '4b8758ca-3ba5-47d9-a1ae-1d8497cf2f41', sequenceNumber: 1,
    equivalents: ['802c2676-19aa-42cc-8d59-cfe476bec769'],
  }),
  rule({
    id: 'TD2', series: 'tetanus', vaccineConceptUuid: '18479963-48fc-470a-8018-d50713d8f94f', sequenceNumber: 2,
    prerequisiteId: 'TD1', minimumInterval: { value: 4, unit: 'weeks' },
    equivalents: ['3484e6ac-d2de-4af5-b895-d2f5e530dc83'],
  }),
  rule({
    id: 'TD3', series: 'tetanus', vaccineConceptUuid: '52573f03-61f0-4344-83b3-6689d372055e', sequenceNumber: 3,
    prerequisiteId: 'TD2', minimumInterval: { value: 6, unit: 'months' },
    equivalents: ['cbe81b8c-7ec4-4542-a050-b640fbf2909f'],
  }),
  rule({
    id: 'TD4', series: 'tetanus', vaccineConceptUuid: '9ca3bb2e-a09e-464e-b899-253b0ced59c3', sequenceNumber: 4,
    prerequisiteId: 'TD3', minimumInterval: { value: 1, unit: 'years' },
    equivalents: ['4c0ed954-1e8d-4aae-84ef-f64fae956f35'],
  }),
  rule({
    id: 'TD5', series: 'tetanus', vaccineConceptUuid: 'e81e56ad-a5f5-4257-9e52-725bb053a370', sequenceNumber: 5,
    prerequisiteId: 'TD4', minimumInterval: { value: 1, unit: 'years' },
    equivalents: ['17825f94-0aed-45af-9de4-925db15fe3fc'],
  }),
];

/** Recognized vaccine concepts that are outside these sequence rules. */
export const ignoredConceptUuids = new Set([
  'fed0b18d-c769-4c9f-9edc-ed7190a1f460',
  '59caf13a-5256-451b-adb4-014c9e0edda9',
  'cf48aec4-a83d-4c36-952d-921651556f16',
  '9e6d911e-2c2a-48da-9002-638ac331a0e8',
  '51be3ea7-5481-43bf-89fe-d45a25224838',
  '64a66900-f10d-47fb-8b74-f8c96cf546e5',
  'ea6e1ba3-ae05-4093-ae10-c75e5d2b28d3',
  'c9b46159-426c-4989-96a3-7bc44ca8c424',
  '6e7e06e5-2f24-41b2-947a-f68f2fbd777e',
  'c769d28e-f339-4ca1-97fe-f6a59fc8301c',
]);

const byId = new Map(sequenceRules.map((item) => [item.id, item]));
const byConcept = new Map<string, SequenceRule>();
for (const item of sequenceRules) {
  for (const uuid of item.conceptUuids) {
    if (byConcept.has(uuid) || ignoredConceptUuids.has(uuid)) {
      throw new Error(`Vaccine concept ${uuid} is mapped more than once`);
    }
    byConcept.set(uuid, item);
  }
}

export function ruleById(id: string): SequenceRule | undefined {
  return byId.get(id);
}

export function ruleForConcept(uuid: string): SequenceRule | undefined {
  return byConcept.get(uuid);
}

export function toEligibilityRule(item: SequenceRule, rules: readonly SequenceRule[] = sequenceRules): EligibilityRule {
  const prior = item.prerequisiteId ? rules.find((candidate) => candidate.id === item.prerequisiteId) : undefined;
  if (item.prerequisiteId && !prior) throw new Error('Unknown predecessor');
  return {
    vaccineConceptUuid: item.vaccineConceptUuid,
    sequenceNumber: item.sequenceNumber,
    dueAge: item.dueAge,
    overdueAfterDays: null,
    ...(item.upperAge ? { upperAge: item.upperAge } : {}),
    ...(prior ? {
      prerequisite: {
        dose: { vaccineConceptUuid: prior.vaccineConceptUuid, sequenceNumber: prior.sequenceNumber },
        ...(item.minimumInterval ? { minimumInterval: item.minimumInterval } : {}),
      },
    } : {}),
  };
}
