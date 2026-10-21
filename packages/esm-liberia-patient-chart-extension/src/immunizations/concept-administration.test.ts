import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function propertiesOf(text: string) {
  const properties = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    properties.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return properties;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const properties = propertiesOf(readFileSync(new URL(
  '../../../../content-packages/content-liberia-national/configuration/variables.properties',
  import.meta.url,
), 'utf8'));
const csvPath = new URL(
  '../../../../content-packages/content-liberia-national/configuration/backend_configuration/concepts/concepts-national.csv',
  import.meta.url,
);
const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const header = rows[0];

function column(name: string) {
  const index = header.indexOf(name);
  assert.ok(index >= 0, name);
  return index;
}

describe('concepts-national.csv column width', () => {
  it('gives every row the same number of columns as the header', () => {
    assert.ok(rows.length > 1);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.length, header.length, `line ${index + 1} has ${row.length} cells`);
    }
  });

  it('notices an unquoted comma as extra columns', () => {
    const widened = parseCsv(`${header.join(',')}\n${header[0]},,Vaccine administration,Vaccine administration,Groups the vaccine name, route, and return date.,ConvSet,N/A,,,,`);
    assert.ok(widened[1].length > header.length);
  });

  it('rejects that widened row in validate-content.sh for this hand-written file', () => {
    const validator = readFileSync(new URL('../../../../scripts/validate/validate-content.sh', import.meta.url), 'utf8');
    assert.match(validator, /exact_width = os\.path\.basename\(f\) == "concepts-national\.csv"/);
    assert.match(validator, /exact_width and len\(row\) > width/);
  });
});

describe('Vaccine administration concept', () => {
  const concept = rows.find((row) => row[0] === '${var.concept.national.vaccine-administration.uuid}');

  it('is a ConvSet whose members are Vaccine Name, Route, and Return Date', () => {
    assert.ok(concept);
    assert.equal(concept[column('Data class')], 'ConvSet');
    assert.equal(concept[column('Data type')], 'N/A');
    assert.equal(
      concept[column('Description:en')],
      'Groups the vaccine name, route, and return date for one administration. This is not CIEL:1421 Immunization history.',
    );
    const members = concept[column('Members')].split(';').map((member) => {
      const name = member.match(/^\$\{([^}]+)\}$/)?.[1];
      assert.ok(name, member);
      const uuid = properties.get(name);
      assert.ok(uuid, name);
      return uuid;
    });
    assert.deepEqual(members, [
      properties.get('var.concept.national.vaccine-name.uuid'),
      properties.get('var.concept.national.route.uuid'),
      properties.get('var.concept.national.return-date-for-the-next-vaccination.uuid'),
    ]);
  });
});
