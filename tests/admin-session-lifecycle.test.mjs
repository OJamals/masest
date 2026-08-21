import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminSessionLifecycle } from '../js/admin/session.js';
import * as chromeModule from '../js/admin/chrome.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function lifecycleFixture(overrides = {}) {
  const calls = [];
  const lifecycle = createAdminSessionLifecycle({
    logout: async () => { calls.push('logout'); },
    hasUnsavedEdits: () => false,
    confirmDiscard: async () => true,
    clearUnsavedEdits: () => { calls.push('clear'); },
    showGate: ({ expired }) => { calls.push(expired ? 'gate:expired' : 'gate:signed-out'); },
    reload: () => { calls.push('reload'); },
    ...overrides,
  });
  return { calls, lifecycle };
}

test('staff sign out awaits auth, clears stale admin state, then reloads', async () => {
  const pending = deferred();
  const { calls, lifecycle } = lifecycleFixture({
    logout: async () => { calls.push('logout'); await pending.promise; },
  });

  const result = lifecycle.signOut();
  await Promise.resolve();
  assert.deepEqual(calls, ['logout'], 'UI must not claim signed out before auth finishes');

  pending.resolve();
  assert.equal(await result, true);
  assert.deepEqual(calls, ['logout', 'clear', 'gate:signed-out', 'reload']);
});

test('cancelled dirty-state warning keeps staff signed in', async () => {
  const { calls, lifecycle } = lifecycleFixture({
    hasUnsavedEdits: () => true,
    confirmDiscard: async () => false,
  });

  assert.equal(await lifecycle.signOut(), false);
  assert.deepEqual(calls, []);
});

test('failed auth sign-out keeps admin state and permits retry', async () => {
  let attempts = 0;
  const { calls, lifecycle } = lifecycleFixture({
    logout: async () => {
      calls.push('logout');
      attempts += 1;
      if (attempts === 1) throw new Error('sign_out_failed');
    },
  });

  await assert.rejects(lifecycle.signOut(), /sign_out_failed/);
  assert.deepEqual(calls, ['logout']);
  assert.equal(await lifecycle.signOut(), true);
  assert.deepEqual(calls, ['logout', 'logout', 'clear', 'gate:signed-out', 'reload']);
});

test('session expiry reloads only an established staff session', () => {
  const anonymous = lifecycleFixture();
  assert.equal(anonymous.lifecycle.expire({ hadStaff: false }), false);
  assert.deepEqual(anonymous.calls, ['gate:expired']);

  const staff = lifecycleFixture();
  assert.equal(staff.lifecycle.expire({ hadStaff: true }), true);
  assert.deepEqual(staff.calls, ['gate:expired', 'clear', 'reload']);
  assert.equal(staff.lifecycle.expire({ hadStaff: true }), false);
  assert.deepEqual(staff.calls, ['gate:expired', 'clear', 'reload', 'gate:expired']);
});

test('staff chrome exposes session-only controls only after verified staff context', () => {
  assert.equal(typeof chromeModule.setAdminChromeSession, 'function');
  const user = { textContent: '', hidden: false };
  const signOut = { hidden: false };
  const search = { hidden: false };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return id === 'admChromeUser' ? user : id === 'admSignOut' ? signOut : null;
    },
    querySelector(selector) {
      return selector === '.adm-chrome-search' ? search : null;
    },
  };

  try {
    chromeModule.setAdminChromeSession(null);
    assert.deepEqual({ user: user.hidden, signOut: signOut.hidden, search: search.hidden }, {
      user: true, signOut: true, search: true,
    });

    chromeModule.setAdminChromeSession({ email: 'staff@example.test' });
    assert.equal(user.textContent, 'staff@example.test');
    assert.deepEqual({ user: user.hidden, signOut: signOut.hidden, search: search.hidden }, {
      user: false, signOut: false, search: false,
    });
  } finally {
    globalThis.document = previousDocument;
  }
});
