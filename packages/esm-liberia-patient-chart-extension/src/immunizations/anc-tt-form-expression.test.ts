import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateAsync } from '@openmrs/esm-expression-evaluator';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const form = JSON.parse(readFileSync(join(
  root,
  'content-packages/content-liberia-national/configuration/backend_configuration/ampathforms/anc-national.json',
), 'utf8'));
const indexSource = readFileSync(join(root, 'packages/esm-liberia-patient-chart-extension/src/index.ts'), 'utf8');

function questions() {
  return form.pages.flatMap((page: { sections: Array<{ questions?: unknown[] }> }) =>
    page.sections.flatMap((section) => section.questions ?? []));
}

function question(id: string) {
  const found = questions().find((item: { id?: string }) => item.id === id);
  assert.ok(found, `missing form question ${id}`);
  return found as {
    id: string;
    hide?: { hideWhenExpression?: string };
    questionOptions?: { calculate?: { calculateExpression?: string } };
    validators?: Array<{ failsWhenExpression: string; message: string }>;
  };
}

describe('ANC form Date-of-TT duplicate/conflict gates', () => {
  it('versions the form from its name and version', () => {
    assert.equal(form.name, '1. ANC Form');
    assert.equal(form.version, '1.2');
    assert.equal(form.uuid, '${var.form.anc-national.uuid}');
  });

  it('registers the helper the form calls', () => {
    assert.match(indexSource, /registerFormEngineExpressionHelper\('ttAdministrationGate', ttAdministrationGate\)/);
  });

  for (const sequence of [1, 2, 3, 4, 5] as const) {
    it(`wires TT${sequence}'s own gate on its own doseId and value`, () => {
      const gate = question(`tt${sequence}_gate`);
      assert.equal(gate.hide?.hideWhenExpression, 'true');
      const expression = gate.questionOptions?.calculate?.calculateExpression ?? '';
      assert.match(expression, new RegExp(`ttAdministrationGate\\(patient\\.id, 'TD${sequence}', tt${sequence}, vitaminAEditingEncounterUuid\\(\\)\\)`));
      assert.match(expression, /\.then\(code => code\)$/);

      const dateQuestion = question(`tt${sequence}`);
      const validators = dateQuestion.validators ?? [];
      assert.equal(validators.length, 2);
      assert.deepEqual(validators.map((validator) => validator.failsWhenExpression), [
        `tt${sequence}_gate === 'unresolved'`,
        `tt${sequence}_gate === 'history-conflict'`,
      ]);
      assert.ok(validators[0].message.includes(`TT${sequence}`));
      assert.ok(validators[1].message.includes(`TT${sequence}`));
    });
  }

  it('evaluates the shipped calculate expression for TT1, passing through the helper result', async () => {
    const expression = question('tt1_gate').questionOptions?.calculate?.calculateExpression ?? '';
    const calls: unknown[][] = [];
    const ttAdministrationGate = (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve('allowed');
    };
    const code = await evaluateAsync(expression, {
      patient: { id: 'patient-1' },
      tt1: '2024-06-01',
      vitaminAEditingEncounterUuid: () => 'encounter-1',
      ttAdministrationGate,
    });
    assert.equal(code, 'allowed');
    assert.deepEqual(calls[0], ['patient-1', 'TD1', '2024-06-01', 'encounter-1']);
  });

  it('blocks saving TT3 when its gate is unresolved or conflicting, and allows every other value', () => {
    const validators = question('tt3').validators ?? [];
    const fails = (tt3Gate: string) => validators.map((validator) => {
      const evaluate = new Function('tt3_gate', `return (${validator.failsWhenExpression});`);
      return evaluate(tt3Gate);
    });
    assert.deepEqual(fails('allowed'), [false, false]);
    assert.deepEqual(fails('unresolved'), [true, false]);
    assert.deepEqual(fails('history-conflict'), [false, true]);
    assert.deepEqual(fails(''), [false, false]);
  });

  it('gives every question its own id, with no duplicates introduced by the new gates', () => {
    const ids: string[] = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.type === 'string') ids.push(record.id);
      Object.values(record).forEach(visit);
    };
    visit(form);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual(duplicates, []);
    for (const sequence of [1, 2, 3, 4, 5]) {
      assert.equal(ids.filter((id) => id === `tt${sequence}`).length, 1);
      assert.equal(ids.filter((id) => id === `tt${sequence}_gate`).length, 1);
    }
  });
});
