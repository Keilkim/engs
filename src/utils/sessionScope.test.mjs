import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionScopeTracker } from './sessionScope.js';

test('account changes abort old work before notifying cache subscribers', () => {
  const tracker = createSessionScopeTracker();
  tracker.updateUser('A');
  const old = tracker.getSnapshot();
  let notified = false;
  tracker.subscribe(() => {
    notified = true;
    assert.equal(old.signal.aborted, true);
    assert.equal(tracker.getSnapshot().userId, 'B');
  });
  tracker.updateUser('B');
  assert.equal(notified, true);
  assert.throws(() => tracker.assertCurrent(old), { name: 'AbortError' });
});

test('logout and login to the same account still invalidate the old generation', () => {
  const tracker = createSessionScopeTracker();
  tracker.updateUser('A');
  const old = tracker.getSnapshot();
  tracker.updateUser(null);
  tracker.updateUser('A');
  assert.notEqual(tracker.getSnapshot().generation, old.generation);
  assert.throws(() => tracker.assertCurrent(old), { name: 'AbortError' });
  tracker.assertCurrent(tracker.getSnapshot());
});

test('token refresh for the same account retains active work and cache scope', () => {
  const tracker = createSessionScopeTracker();
  tracker.updateUser('A');
  const old = tracker.getSnapshot();
  tracker.updateUser('A');
  assert.equal(tracker.getSnapshot(), old);
  assert.equal(old.signal.aborted, false);
});
