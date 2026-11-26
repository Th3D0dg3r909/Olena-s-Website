import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createMaintenance } from '../maintenance.js';

const setup = value => {
  const errors = [];
  const maintenance = createMaintenance({ db: new DatabaseSync(':memory:'), env: { MAINTENANCE_MODE: value }, log: { error: message => errors.push(message) } });
  return { enabled: maintenance.enabled, errors };
};

test('common ways of writing "on" switch the opening-soon page on', () => {
  for (const value of ['true', 'TRUE', 'True', ' true ', '"true"', "'true'", '1', 'yes', 'on', 'ja', 'Aan']) {
    assert.equal(setup(value).enabled, true, JSON.stringify(value));
  }
});

test('off values and a missing variable keep the site open without a warning', () => {
  for (const value of [undefined, '', 'false', '0', 'no', 'off', 'nee', 'uit']) {
    const { enabled, errors } = setup(value);
    assert.equal(enabled, false, JSON.stringify(value));
    assert.deepEqual(errors, []);
  }
});

test('an unrecognised value keeps the site open and is logged', () => {
  const { enabled, errors } = setup('maintenance');
  assert.equal(enabled, false);
  assert.match(errors[0], /MAINTENANCE_MODE has an unrecognised value/);
});
