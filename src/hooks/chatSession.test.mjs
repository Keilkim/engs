import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSession } from './chatSession.js';
import { createSessionScopeTracker } from '../utils/sessionScope.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(overrides = {}) {
  const tracker = createSessionScopeTracker();
  tracker.updateUser('A');
  const saves = [];
  const session = createChatSession({
    sourceId: 1,
    sessionScope: tracker.getSnapshot(),
    chatStream: async (_text, _context, _history, onChunk) => { onChunk('Answer', 'Answer'); return 'Answer'; },
    saveChatMessage: async (message, role, sourceId, options) => {
      saves.push({ message, role, sourceId, options });
      return { id: saves.length, message, role };
    },
    getChatLogs: async () => [],
    clearChatLogs: async () => {},
    ...overrides,
  });
  return { session, tracker, saves };
}

test('leaving the source aborts a pending AI reply and never saves its answer', async () => {
  const reply = deferred();
  let signal;
  let emit;
  const { session, saves } = fixture({ chatStream: (_t, _c, _h, onChunk, options) => {
    emit = onChunk;
    signal = options.signal;
    return reply.promise;
  } });
  const sending = session.send('hello');
  session.cancel();
  assert.equal(signal.aborted, true);
  emit('old', 'old answer');
  reply.resolve('old answer');
  await sending;
  assert.deepEqual(saves.map(save => save.role), ['user']);
  assert.equal(session.getSnapshot().streamingText, '');
  assert.equal(session.getSnapshot().messages.length, 1);
  assert.equal(session.getSnapshot().loading, false);
});

test('switching accounts while streaming prevents the old assistant save', async () => {
  const reply = deferred();
  const { session, tracker, saves } = fixture({ chatStream: () => reply.promise });
  const sending = session.send('A question');
  tracker.updateUser(null);
  tracker.updateUser('B');
  reply.resolve('A private answer');
  await sending;
  assert.deepEqual(saves.map(save => save.role), ['user']);
  assert.equal(session.getSnapshot().messages.some(message => message.message.includes('private')), false);
  await session.send('must not run in the expired session');
  assert.equal(saves.length, 1);
});

test('late history cannot replace the new conversation or an optimistic message', async () => {
  const history = deferred();
  const { session } = fixture({ getChatLogs: () => history.promise });
  const loading = session.loadHistory();
  await session.send('new question');
  history.resolve([{ role: 'assistant', message: 'old history' }]);
  await loading;
  assert.deepEqual(session.getSnapshot().messages.map(message => message.message), ['new question', 'Answer']);
});

test('clearing history aborts the in-flight answer and leaves the list empty', async () => {
  const reply = deferred();
  const { session, saves } = fixture({ chatStream: () => reply.promise });
  const sending = session.send('question');
  await session.clear();
  reply.resolve('late answer');
  await sending;
  assert.deepEqual(session.getSnapshot().messages, []);
  assert.deepEqual(saves.map(save => save.role), ['user']);
});

test('rapid repeated sends start only one paid request', async () => {
  const reply = deferred();
  let calls = 0;
  const { session } = fixture({ chatStream: () => { calls += 1; return reply.promise; } });
  const first = session.send('first');
  await session.send('second');
  reply.resolve('answer');
  await first;
  assert.equal(calls, 1);
});

test('a failed answer save preserves the visible answer without an unsafe duplicate retry', async () => {
  let assistantSaves = 0;
  const { session } = fixture({ saveChatMessage: async (message, role) => {
    if (role === 'assistant') { assistantSaves += 1; throw new Error('response lost'); }
    return { id: 1, message, role };
  } });
  await session.send('question');
  assert.equal(assistantSaves, 1);
  assert.equal(session.getSnapshot().messages.at(-1).message, 'Answer');
  assert.equal(session.getSnapshot().loading, false);
});

test('a cancelled history load can restart after a React StrictMode cleanup', async () => {
  const old = deferred();
  let calls = 0;
  const { session } = fixture({ getChatLogs: () => ++calls === 1 ? old.promise : Promise.resolve([{ message: 'saved' }]) });
  const first = session.loadHistory();
  session.cancel();
  await session.loadHistory();
  old.resolve([{ message: 'stale' }]);
  await first;
  assert.deepEqual(session.getSnapshot().messages, [{ message: 'saved' }]);
});
