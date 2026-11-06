import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDateError, localDateToday } from '../src/capture-date.ts';

const today = '2026-11-05';
test('capture date permits unknown dates and real Gregorian calendar days including leap centuries', () => {
  for (const value of ['', undefined, '0001-01-01', '1900-02-28', '2000-02-29', '2024-02-29', '2026-10-10', today]) assert.equal(captureDateError(value, today), '');
});

test('capture date rejects malformed input and impossible dates without rolling into another month', () => {
  for (const value of [null, 20261010, {}, '2026-1-01', '26-10-10', '2026-10-10T08:11:00', ' 2026-10-10', '0000-01-01', '2026-00-10', '2026-13-01', '2026-10-00', '2026-01-32', '2026-04-31', '2026-02-29', '1900-02-29', '2024-02-30']) assert.notEqual(captureDateError(value, today), '', String(value));
});

test('capture date accepts today and rejects future days', () => {
  assert.equal(captureDateError(today, today), '');
  for (const value of ['2026-11-06', '2027-01-01', '9999-12-31']) assert.match(captureDateError(value, today), /不能晚于今天/);
});

test('today follows local calendar boundaries rather than the UTC date', () => {
  assert.equal(localDateToday(new Date(2026, 10, 5, 0, 1)), today);
  assert.equal(localDateToday(new Date(2026, 10, 5, 23, 59)), today);
  assert.equal(localDateToday(new Date(2024, 1, 29, 12)), '2024-02-29');
});
