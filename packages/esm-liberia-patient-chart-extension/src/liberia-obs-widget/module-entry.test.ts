import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moduleEntryVisible } from './module-entry.ts';

const has =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name);

describe('moduleEntryVisible', () => {
  it('shows a reader and a writer, and hides a matrix role with neither', () => {
    assert.equal(moduleEntryVisible(has('Read TB Screening', 'Get People'), 'Read TB Screening', 'Write TB Screening'), true);
    assert.equal(moduleEntryVisible(has('Write TB Screening', 'Get People'), 'Read TB Screening', 'Write TB Screening'), true);
    assert.equal(moduleEntryVisible(has('Get People'), 'Read TB Screening', 'Write TB Screening'), false);
  });

  it('keeps the entry for an account that was not given Get People', () => {
    assert.equal(moduleEntryVisible(has('Get Patients'), 'Read Labor and Delivery', 'Write Labor and Delivery'), true);
  });

  it('leaves an ungated widget visible', () => {
    assert.equal(moduleEntryVisible(has('Get People'), '', ''), true);
  });
});
