import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearExplicitLogout,
  isExplicitLogout,
  markExplicitLogout,
} from './logoutState.js';

test('explicit logout remains active until a successful sign-in clears it', () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  try {
    assert.equal(isExplicitLogout(), false);
    assert.equal(markExplicitLogout(), true);
    assert.equal(isExplicitLogout(), true);
    assert.equal(clearExplicitLogout(), true);
    assert.equal(isExplicitLogout(), false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
