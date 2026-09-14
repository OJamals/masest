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

test('ending a session announces to sibling tabs, and a peer notice resets only a staff tab without re-announcing', async () => {
  const announced = [];
  let peer;
  const staff = lifecycleFixture({
    hasStaff: () => true,
    announce: (reason) => announced.push(reason),
    subscribe: (handler) => { peer = handler; },
  });
  assert.equal(typeof peer, 'function', 'lifecycle subscribes to peer notices on creation');

  assert.equal(peer('expired'), true);
  assert.deepEqual(staff.calls, ['gate:expired', 'clear', 'reload']);
  assert.deepEqual(announced, [], 'a peer notice must not echo back into the channel');
  assert.equal(peer('expired'), false, 'a tab already ending ignores further notices');
  assert.equal(staff.lifecycle.expire({ hadStaff: true }), false);

  const signedOutPeer = lifecycleFixture({ hasStaff: () => true, subscribe: (handler) => { peer = handler; } });
  assert.equal(peer('signed-out'), true);
  assert.deepEqual(signedOutPeer.calls, ['gate:signed-out', 'clear', 'reload']);

  const anonymous = lifecycleFixture({ hasStaff: () => false, subscribe: (handler) => { peer = handler; } });
  assert.equal(peer('expired'), false, 'an anonymous tab already sits on the gate');
  assert.deepEqual(anonymous.calls, []);

  const announcing = lifecycleFixture({ announce: (reason) => announced.push(reason) });
  assert.equal(await announcing.lifecycle.signOut(), true);
  announcing.lifecycle.expire({ hadStaff: true });
  assert.deepEqual(announced, ['signed-out'], 'sign-out announces once; an already-ending tab never announces expiry');
  const expiring = lifecycleFixture({ announce: (reason) => announced.push(reason) });
  assert.equal(expiring.lifecycle.expire({ hadStaff: true }), true);
  assert.equal(expiring.lifecycle.expire({ hadStaff: false }), false);
  assert.deepEqual(announced, ['signed-out', 'expired']);
});

test('the peer channel rides the storage event: same key only, other tabs only, malformed payloads fail closed', async () => {
  const { createSessionPeerChannel } = await import('../js/admin/session.js');
  const listeners = [];
  const written = [];
  const channel = createSessionPeerChannel({
    key: 'k',
    storage: { setItem: (key, value) => written.push([key, value]) },
    target: { addEventListener: (type, fn) => listeners.push([type, fn]) },
  });
  const received = [];
  channel.subscribe((reason) => received.push(reason));
  assert.deepEqual(listeners.map(([type]) => type), ['storage']);
  const fire = (event) => listeners.forEach(([, fn]) => fn(event));

  channel.announce('signed-out');
  assert.equal(written[0][0], 'k');
  assert.equal(JSON.parse(written[0][1]).reason, 'signed-out');

  fire({ key: 'other', newValue: written[0][1] });
  fire({ key: 'k', newValue: null });
  assert.deepEqual(received, [], 'other keys and removals are ignored');
  fire({ key: 'k', newValue: written[0][1] });
  fire({ key: 'k', newValue: 'not json' });
  assert.deepEqual(received, ['signed-out', 'expired'], 'malformed payloads still end the session');

  const broken = createSessionPeerChannel({ key: 'k', storage: { setItem() { throw new Error('quota'); } }, target: null });
  assert.doesNotThrow(() => broken.announce('expired'));
  assert.doesNotThrow(() => broken.subscribe(() => {}));
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
