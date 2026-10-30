import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceOptions, chooseBatch, compareSpokenAnswer, createPractice, createPracticeStorage, currentPracticeId, gradePractice,
  isReturning, markSpans, nextReviewState, practiceParts, reconcilePractice } from './reviewPractice.js';

const card = (id, updates = {}) => ({ id, status: 'active', next_review_date: '2026-10-30',
  last_reviewed: null, repetitions: 0, annotation: { selected_text: `word ${id}`, source: { id: 7 } }, ...updates });

test('a bounded batch offers a familiar start without starving forgotten cards', () => {
  const known = [1, 2, 3].map(id => card(id, { last_reviewed: '2026-10-20', repetitions: 2 }));
  const forgotten = [4, 5, 6].map(id => card(id, { last_reviewed: '2026-10-20' }));
  assert.deepEqual(chooseBatch([...known, ...forgotten, card(7)], { size: 3 }).map(item => item.id), [1, 4, 5]);
});

test('new-card allowance, suspended cards, and source selection are honored', () => {
  assert.equal(chooseBatch([card(1), card(2)], { newLimit: 0 }).length, 0);
  assert.equal(chooseBatch([card(1), card(2)], { newLimit: 1 }).length, 1);
  assert.equal(chooseBatch([card(1, { status: 'suspended' })]).length, 0);
  assert.equal(chooseBatch([card(1)], { sourceId: 8 }).length, 0);
  assert.equal(chooseBatch([card(1)], { sourceId: '7' }).length, 1);
});

test('an answer only advances its current card; double-clicks cannot grade the next one', () => {
  const original = createPractice([card(1), card(2)]);
  const graded = gradePractice(original, '1', false);
  assert.equal(currentPracticeId(graded), '2');
  assert.equal(gradePractice(graded, '1', true), graded);
  assert.equal(graded.answers['1'].correct, false);
  assert.equal(currentPracticeId(gradePractice(graded, '2', true)), null);
});

test('revealed/hinted state and account-specific progress survive reload', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const a = createPracticeStorage(storage, 'account-a');
  const b = createPracticeStorage(storage, 'account-b');
  const session = { ...createPractice([card(1)]), revealedId: '1', hintedIds: ['1'] };
  a.write(session);
  assert.deepEqual(a.read(), session);
  assert.equal(b.read(), null);
  a.clear();
  assert.equal(a.read(), null);
});

test('unavailable/corrupt storage does not prevent practice', () => {
  const unavailable = createPracticeStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } }, 'a');
  assert.equal(unavailable.read(), null);
  assert.equal(unavailable.write(createPractice([])), false);
  assert.equal(createPracticeStorage({ getItem: () => '{bad json' }, 'a').read(), null);
  assert.equal(createPracticeStorage({ getItem: () => JSON.stringify({ version: 1, ids: ['1'], answers: [], hintedIds: [] }) }, 'a').read(), null);
});

test('resume reconciles deleted cards and a committed answer with a lost response', () => {
  const session = createPractice([card(1), card(2), card(3)], 'daily', Date.parse('2026-10-30T01:00:00Z'));
  const restored = reconcilePractice(session, [card(1, { repetitions: 1, last_reviewed: '2026-10-30T01:01:00Z' }), card(2)]);
  assert.deepEqual(restored.ids, ['1', '2']);
  assert.equal(restored.answers['1'].type, 'recovered');
  assert.equal(currentPracticeId(restored), '2');
  const retry = reconcilePractice({ ...session, kind: 'retry' }, [card(1, { last_reviewed: '2026-10-30T01:01:00Z' })]);
  assert.equal(currentPracticeId(retry), '1');
});

test('speech matching tolerates punctuation and case but never declares mismatches wrong', () => {
  assert.equal(compareSpokenAnswer(' Figure   out! ', 'figure out'), 'match');
  assert.equal(compareSpokenAnswer('delay', 'postpone'), 'unconfirmed');
  assert.equal(compareSpokenAnswer('', 'postpone'), 'unconfirmed');
  assert.equal(compareSpokenAnswer('I said postpone', 'postpone'), 'unconfirmed');
});

test('SM-2 schedules are preserved; forgetting resets to tomorrow', () => {
  const now = new Date(2026, 9, 30, 12);
  const first = nextReviewState({}, true, now);
  assert.equal(first.interval_days, 1);
  assert.equal(first.next_review_date, '2026-10-31');
  const second = nextReviewState(first, true, now);
  assert.equal(second.interval_days, 6);
  assert.equal(nextReviewState(second, true, now).interval_days, 15);
  const forgotten = nextReviewState(second, false, now);
  assert.equal(forgotten.repetitions, 0);
  assert.equal(forgotten.interval_days, 1);
  assert.ok(forgotten.ease_factor >= 1.3);
});

test('a week away gets a gentle return; missing dates are not lapsed users', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(isReturning('2026-10-22T12:00:00Z', now), true);
  assert.equal(isReturning('2026-10-29T12:00:00Z', now), false);
  assert.equal(isReturning(null, now), false);
});

const sentenceCard = (id, patterns, translation = '결과에 상관없이 그는 계속 달렸다.') => card(id, { annotation: {
  selected_text: 'Regardless of the result, he kept running.',
  ai_analysis_json: JSON.stringify({ type: 'grammar', originalText: 'Regardless of the result, he kept running.', translation, patterns }) } });

test('a saved sentence is practiced one checked expression at a time, with the sentence for context', () => {
  const parts = practiceParts(sentenceCard(1, [
    { words: ['regardless of A'], spans: ['Regardless of'], explanation: 'A에 상관없이' },
    { words: ['keep Ving'], spans: ['kept running'], explanation: '계속 ~하다' },
    { words: [], spans: [], explanation: '빈 표현' },
  ]));
  assert.deepEqual(parts.map(part => [part.kind, part.word, part.definition]), [['pattern', 'regardless of A', 'A에 상관없이'], ['pattern', 'keep Ving', '계속 ~하다']]);
  assert.equal(parts[1].sentence, 'Regardless of the result, he kept running.');
  assert.equal(parts[1].translation, '결과에 상관없이 그는 계속 달렸다.');
  const plain = practiceParts(sentenceCard(2, []));
  assert.deepEqual(plain.map(part => [part.kind, part.definition]), [['sentence', '결과에 상관없이 그는 계속 달렸다.']]);
  assert.equal(practiceParts(card(3))[0].kind, 'word');
});

test('only the practiced expression is emphasized inside its sentence', () => {
  assert.deepEqual(markSpans('Nothing is not but fine', ['not', 'but']).filter(part => part.strong).map(part => part.text), ['not', 'but']);
  assert.deepEqual(markSpans('he kept running', ['kept', 'kept running']), [{ text: 'he ', strong: false }, { text: 'kept running', strong: true }]);
  assert.deepEqual(markSpans('plain', []), [{ text: 'plain', strong: false }]);
});

test('"remembered" is checked against a look-alike meaning that cannot also be right', () => {
  const target = { kind: 'word', word: 'postpone', definition: '미루다, 연기하다' };
  const pool = [
    { kind: 'word', word: 'delay', definition: '연기하다' },
    { kind: 'pattern', word: 'keep Ving', definition: '계속 ~하다' },
    { kind: 'word', word: 'propose', definition: '제안하다' },
    { kind: 'word', word: 'reservation', definition: '예약' },
  ];
  const first = choiceOptions(target, pool, () => 0);
  assert.deepEqual(first, { options: ['미루다, 연기하다', '제안하다'], answer: 0 });
  const second = choiceOptions(target, pool, () => 0.9);
  assert.equal(second.options[second.answer], '미루다, 연기하다');
  assert.equal(second.answer, 1);
  assert.equal(choiceOptions(target, [{ kind: 'word', definition: '미루다, 연기하다' }]), null);
  assert.equal(choiceOptions({ ...target, definition: '' }, pool), null);
});

test('a sentence is graded once, after its last expression, and partial progress survives reload', () => {
  const session = { ...createPractice([card(1), card(2)]), parts: { 1: [true, false] }, revealedId: '1', result: { correct: true, type: 'choice' } };
  const values = new Map();
  const storage = createPracticeStorage({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, 'a');
  storage.write(session);
  assert.deepEqual(storage.read(), session);
  const graded = gradePractice(session, '1', false, 'choice');
  assert.deepEqual(graded.answers['1'].parts, [true, false]);
  assert.deepEqual(graded.parts, {});
  assert.equal(graded.result, null);
  assert.equal(currentPracticeId(graded), '2');
  const corrupt = createPracticeStorage({ getItem: () => JSON.stringify({ ...session, parts: { 1: 'yes' } }) }, 'a');
  assert.equal(corrupt.read(), null);
});
