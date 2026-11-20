import test from 'node:test';
import assert from 'node:assert/strict';
import { getLastLoginMethod, LOGIN_METHODS, saveLastLoginMethod } from './loginMethodPreference.js';

test('last-used login method stores only one of the known method identifiers', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.deepEqual(LOGIN_METHODS, ['password', 'mobile', 'abha', 'aadhaar']);
  assert.equal(getLastLoginMethod(storage), 'mobile');
  saveLastLoginMethod('abha', storage);
  assert.equal(getLastLoginMethod(storage), 'abha');
  assert.deepEqual([...values.values()], ['abha']);
  saveLastLoginMethod('unknown', storage);
  assert.equal(getLastLoginMethod(storage), 'abha');
});

test('login method preference tolerates unavailable local storage', () => {
  assert.equal(
    getLastLoginMethod({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    'mobile',
  );
  assert.doesNotThrow(() =>
    saveLastLoginMethod('password', {
      setItem: () => {
        throw new Error('blocked');
      },
    }),
  );
});
