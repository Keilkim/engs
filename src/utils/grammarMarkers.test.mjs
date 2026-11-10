import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrammarMarkers } from './grammarMarkers.js';

function words(text, y = 10) {
  return text.split(' ').map((text, index) => ({ text, bbox: { x: index * 10, y, width: 8, height: 3 } }));
}
function annotation(sentenceWords, patterns, legacy = false) {
  return {
    selection_rect: JSON.stringify({ bounds: { x: 0, y: 10, width: 100, height: 3 },
      ...(legacy ? {} : { words: sentenceWords }) }),
    ai_analysis_json: JSON.stringify({ type: 'grammar', patterns }),
  };
}
const pattern = { words: ['take A into account'], spans: ['take', 'into account'], variableSpans: ['this risk'] };

test('marks fixed expression and variable words without underlining the rest of the sentence', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [pattern]));
  assert.deepEqual(markers.filter(m => m.role === 'fixed').map(m => [m.x, m.width]), [[10, 8], [40, 18]]);
  assert.deepEqual(markers.filter(m => m.role === 'variable').map(m => [m.x, m.width]), [[20, 18]]);
});

test('splits a multiline expression at the line break', () => {
  const row = [...words('Regardless of'), ...words('the result we continued.', 16)];
  const markers = buildGrammarMarkers(annotation(row, [{ spans: ['Regardless of the result'] }]));
  assert.deepEqual(markers.map(m => [m.x, m.width]), [[0, 18], [0, 18]]);
  assert.ok(Math.abs(markers[0].y - 13.24) < 1e-9 && Math.abs(markers[1].y - 19.24) < 1e-9);
});

// Tesseract boxes hug the ink: g/p/y push a word's bottom below the baseline.
function inked(text, y = 10) {
  return text.split(' ').map((text, index) => ({ text,
    bbox: { x: index * 10, y, width: 8, height: /[gjpqy]/.test(text) ? 4 : 3 } }));
}

test('fixed and variable underlines share the row baseline despite descenders', () => {
  const row = inked('She is going to play cards.');
  const markers = buildGrammarMarkers(annotation(row, [
    { words: ['be going to V'], spans: ['is going to'], variableSpans: ['play'] }]));
  assert.deepEqual(markers.map(m => m.role), ['fixed', 'variable']);
  assert.equal(new Set(markers.map(m => m.y)).size, 1);
  assert.ok(markers[0].y > 13 && markers[0].y < 13.5);
});

test('legacy whole spans are split by aligning the template, whatever its notation', () => {
  const cases = [
    ['She decided to leave early.', ['to-v', 'to-V', 'to V', 'to 동사원형', 'to부정사', 'to-부정사'], 'to leave', ['to'], ['leave']],
    ['I am used to working late.', ['be used to Ving', 'be used to V-ing', 'be used to ~ing'], 'am used to working', ['am used to'], ['working']],
    ['She asked him to come.', ['ask sb to V', 'ask 목적어 to 동사원형'], 'asked him to come', ['asked', 'to'], ['him', 'come']],
    ['It was given to me.', ['be p.p.'], 'was given', ['was'], ['given']],
    ['She made up her mind.', ["make up one's mind"], 'made up her mind', ['made up', 'mind'], ['her']],
    ['We take a coat into account.', ['take A into account'], 'take a coat into account', ['take', 'into account'], ['a coat']],
    ['Regardless of the cost of living, we stay.', ['regardless of ~', 'Regardless of A', 'regardless of …'],
      'Regardless of the cost of living', ['regardless of'], ['the cost of living']],
  ];
  for (const [sentence, templates, span, fixedWords, slotWords] of cases) {
    const row = words(sentence);
    const text = sentence.toLowerCase().replace(/[.,]/g, '');
    const label = markers => markers.map(m => text.split(' ').slice(m.x / 10, Math.round((m.x + m.width + 2) / 10)).join(' '));
    for (const template of templates) {
      const markers = buildGrammarMarkers(annotation(row, [{ words: [template], spans: [span] }]));
      assert.deepEqual(label(markers.filter(m => m.role === 'fixed')), fixedWords, template);
      assert.deepEqual(label(markers.filter(m => m.role === 'variable')), slotWords, template);
    }
  }
});

// Reads each marker back as the words it covers (words() boxes sit 10 apart).
function roleWords(sentence, markers) {
  const list = sentence.toLowerCase().replace(/[.,]/g, '').split(' ');
  const read = role => markers.filter(m => m.role === role)
    .map(m => list.slice(Math.round(m.x / 10), Math.round((m.x + m.width + 2) / 10)).join(' '));
  return { fixed: read('fixed'), slot: read('variable') };
}

test('older saves recover roles for word order, alternatives, contractions and repeats', () => {
  const cases = [
    // [sentence, pattern, fixed, slot]
    ['As long as you are quiet, stay.', { words: ['as long as'], spans: ['As long as you are quiet'] }, ['as long as'], ['you are quiet']],
    ['We take into account the risks.', { words: ['take A into account'], spans: ['take into account the risks'] }, ['take into account'], ['the risks']],
    ['We take into account the risks.', { words: ['take A into account'], spans: ['take into account'] }, ['take into account'], []],
    ['She will pick it up.', { words: ['pick up A'], spans: ['pick it up'] }, ['pick', 'up'], ['it']],
    ['She turned down the offer.', { words: ['turn A down'], spans: ['turned down the offer'] }, ['turned down'], ['the offer']],
    ['Look out for cars.', { words: ['look/watch out for A'], spans: ['Look out for cars'] }, ['look out for'], ['cars']],
    ['In case of fire, run.', { words: ['in (the) case of A'], spans: ['In case of fire'] }, ['in case of'], ['fire']],
    ['He is good at math.', { words: ['be good/bad at A'], spans: ['is good at math'] }, ['is good at'], ['math']],
    ['She is a doctor as well as a teacher.', { words: ['A as well as B'], spans: ['a doctor as well as a teacher'] }, ['as well as'], ['a doctor', 'a teacher']],
    ["It isn't cheap but fast.", { words: ['not A but B'], spans: ["isn't cheap but fast"] }, ["isn't", 'but'], ['cheap', 'fast']],
    ["It's time to go.", { words: ['it is time to V'], spans: ["It's time to go"] }, ["it's time to"], ['go']],
    ["She's been working hard.", { words: ['have been Ving'], spans: ["She's been working"] }, ["she's been"], ['working']],
    ["I can't help laughing.", { words: ['can not help V-ing'], spans: ["can't help laughing"] }, ["can't help"], ['laughing']],
    ['He is as tall as his father.', { words: ['as ~ as'], spans: ['as'], variableSpans: ['tall'] }, ['as', 'as'], ['tall']],
    ['He is as tall as his father.', { words: ['as ~ as'], spans: ['as'] }, ['as', 'as'], ['tall']],
    ['The more you read the more you learn.', { words: ['the more A, the more B'], spans: ['The more'] },
      ['the more', 'the more'], ['you read']],
    ['관계대명사 who', { words: ['관계대명사 who'], spans: ['who'] }, [], []],
  ];
  for (const [sentence, pattern, fixedWords, slotWords] of cases) {
    if (!/[a-z]/i.test(sentence.split(' ')[0])) continue;
    const got = roleWords(sentence, buildGrammarMarkers(annotation(words(sentence), [pattern])));
    assert.deepEqual(got, { fixed: fixedWords, slot: slotWords }, `${pattern.words[0]} / ${sentence}`);
  }
});

test('older saves: repeated cues, contractions both ways, and nested slots', () => {
  const cases = [
    ['As he said she is as tall as her father.', { words: ['as ~ as'], spans: ['as'] }, ['as', 'as'], ['tall']],
    ['The sooner you start the better it is and the plan works.', { words: ['the 비교급, the 비교급'], spans: ['the'] },
      ['the', 'the'], ['sooner you start']],
    ['Do not touch it.', { words: ["don't V"], spans: ['Do not touch'] }, ['do not'], ['touch']],
    ['He will not give up.', { words: ["won't give up"], spans: ['will not give up'] }, ['will not give up'], []],
    ['It is time to go.', { words: ["it's time to V"], spans: ['It is time to go'] }, ['it is time to'], ['go']],
    ["There's a book that is on the desk.", { words: ['there is A'], spans: ["There's a book"] }, ["there's"], ['a book']],
    ["He's been there before.", { words: ['be there'], spans: ["He's been there"] }, ['been there'], ["he's"]],
    ['We take this risk into account today.', { spans: ['take this risk into account'], variableSpans: ['this risk'] },
      ['take', 'into account'], ['this risk']],
    ['If you go there you will see it if needed.', { spans: ['if', 'will'], variableSpans: ['you go there'] },
      ['if', 'will'], ['you go there']],
    ['It isn’t cheap but fast.', { words: ['not A but B'], spans: ["isn't cheap but fast"] }, ['isn’t', 'but'], ['cheap', 'fast']],
  ];
  for (const [sentence, pattern, fixedWords, slotWords] of cases) {
    const got = roleWords(sentence, buildGrammarMarkers(annotation(words(sentence), [pattern])));
    assert.deepEqual(got, { fixed: fixedWords, slot: slotWords }, `${pattern.words?.[0] ?? pattern.spans} / ${sentence}`);
  }
});

test('stays fast on a long sentence with several older patterns', () => {
  const sentence = ('Although the committee had been considering the proposal for several months without reaching '
    + 'any agreement the members who attended the meeting asked the chair to look at the budget again and it is time '
    + 'to decide so that the plan could start the sooner the better for the city and the people who live there now');
  const patterns = [{ words: ['관계대명사 who'], spans: ['who'] }, { words: ['It is time to V'], spans: ['time to'] },
    { words: ['ask O to V'], spans: ['asked the chair to look'] }, { words: ['so that S can V'], spans: ['so that'] },
    { words: ['the 비교급, the 비교급'], spans: ['the'] }];
  const item = annotation(words(sentence), patterns);
  buildGrammarMarkers(item);
  const started = performance.now();
  for (let i = 0; i < 5; i++) buildGrammarMarkers(item);
  assert.ok((performance.now() - started) / 5 < 50, `${(performance.now() - started) / 5}ms`);
});

test('a fixed cue word followed by its filler in an old whole span keeps its dark line', () => {
  const sentence = 'The man who runs fast won.';
  const got = roleWords(sentence, buildGrammarMarkers(annotation(words(sentence), [{ words: ['관계대명사 who'], spans: ['who runs fast'] }])));
  assert.deepEqual(got, { fixed: ['who'], slot: ['runs fast'] });
});

test('a tilted scan keeps each line on its own baseline', () => {
  // Two lines, each drifting down 0.4 per word, close enough that a growing
  // band would swallow the second line.
  const tilt = (text, y0) => text.split(' ').map((text, i) => ({ text,
    bbox: { x: i * 10, y: y0 + i * 0.4, width: 8, height: /[gjpqy]/.test(text) ? 2.6 : 2 } }));
  const row = [...tilt('one two three four into', 10), ...tilt('account was used here', 13)];
  const markers = buildGrammarMarkers(annotation(row, [{ spans: ['four into account was'] }]));
  assert.equal(markers.length, 2);
  const [first, second] = markers;
  // Baseline of line 1: bottom 12 at x=4 rising 0.04 per unit; line 2: bottom 15 at x=4.
  const at = (bottom, x) => bottom + 0.04 * (x - 4) + 0.16;
  assert.ok(Math.abs(first.y - at(12, 30)) < 1e-6 && Math.abs(first.y2 - at(12, 48)) < 1e-6, JSON.stringify(first));
  assert.ok(Math.abs(second.y - at(15, 0)) < 1e-6 && Math.abs(second.y2 - at(15, 18)) < 1e-6, JSON.stringify(second));
});

test('the tilt holds on wide images and on rows with few baseline words', () => {
  // A steep-in-percent tilt (wide landscape image) and a row with only two flat words.
  const tilt = (text, slope) => text.split(' ').map((text, i) => ({ text,
    bbox: { x: i * 10, y: 10 + i * 10 * slope, width: 8, height: /[gjpqy]/.test(text) ? 2.6 : 2 } }));
  for (const [text, slope] of [['one two three four five six', 0.12], ['kept growing bigger by the minute', 0.03]]) {
    const markers = buildGrammarMarkers(annotation(tilt(text, slope), [{ spans: [text] }]));
    assert.equal(markers.length, 1);
    assert.ok(Math.abs((markers[0].y2 - markers[0].y) / markers[0].width - slope) < 0.005, `${text}: ${JSON.stringify(markers[0])}`);
  }
});

test('legacy line boxes rebuild the sentence in reading order without neighbouring words', () => {
  const page = [
    ...words('Regardless of the cost', 10), ...words('of living, we stay.', 16),
    { text: 'Other', bbox: { x: 0, y: 21.5, width: 8, height: 3 } },
  ];
  const item = { selection_rect: JSON.stringify({ lines: [{ x: 0, y: 9.5, width: 38, height: 4 }, { x: 0, y: 15.5, width: 38, height: 4 }] }),
    ai_analysis_json: JSON.stringify({ patterns: [{ spans: ['Regardless of'], variableSpans: ['the cost of living'] }] }) };
  const markers = buildGrammarMarkers(item, page);
  assert.deepEqual(markers.map(m => [m.role, m.x, Math.round(m.y)]), [['fixed', 0, 13], ['variable', 20, 13], ['variable', 0, 19]]);
});

test('a row of descender words borrows a baseline only from its own column', () => {
  const sentence = [{ text: 'happy.', bbox: { x: 5, y: 40, width: 8, height: 2.6 } }];
  // The next column starts across a gutter wider than word spacing, even if within two word widths.
  const otherColumn = [{ text: 'the', bbox: { x: 20, y: 40.6, width: 6, height: 2 } }];
  const nearby = [{ text: 'and', bbox: { x: 14.5, y: 40, width: 6, height: 2 } }];
  const draw = ocr => buildGrammarMarkers(annotation(sentence, [{ spans: ['happy'] }]), ocr)[0].y;
  assert.ok(Math.abs(draw(otherColumn) - (40 + 2.6 * 0.75 + 2.6 * 0.08)) < 1e-9);
  assert.ok(Math.abs(draw(nearby) - (42 + 2.6 * 0.08)) < 1e-9);
});

test('ordered segments mark only the occurrence that belongs to the pattern', () => {
  const row = words('She wants to go to school.');
  const markers = buildGrammarMarkers(annotation(row, [{ words: ['to-v'],
    segments: [{ text: 'to', role: 'fixed' }, { text: 'go', role: 'slot' }] }]));
  assert.deepEqual(markers.map(m => [m.role, m.x]), [['fixed', 20], ['variable', 30]]);
  const unordered = buildGrammarMarkers(annotation(row, [{ words: ['to-v'], spans: ['to'], variableSpans: ['go'] }]));
  assert.deepEqual(unordered.map(m => [m.role, m.x]), [['fixed', 20], ['variable', 30]]);
});

test('a saved cue without its slot words is not guessed, nor which occurrence it was', () => {
  assert.deepEqual(buildGrammarMarkers(annotation(words('She decided to leave early.'), [{ words: ['to-v'], spans: ['to'] }]))
    .map(m => [m.role, m.x]), [['fixed', 20]]);
  assert.deepEqual(buildGrammarMarkers(annotation(words('She wants to go to school.'), [{ words: ['to-v'], spans: ['to'] }]))
    .map(m => [m.role, m.x]), [['fixed', 20], ['fixed', 40]]);
});

test('grammar labels that share no word with the sentence keep the saved cue fixed', () => {
  const row = words('They have been working hard.');
  const markers = buildGrammarMarkers(annotation(row, [{ words: ['현재완료진행'], spans: ['have been working'] }]));
  assert.deepEqual(markers.map(m => [m.role, m.x, m.width]), [['fixed', 10, 28]]);
});

test('a spaced dash or quote stays on its row instead of drawing a second line', () => {
  const row = [
    { text: 'It', bbox: { x: 0, y: 18.6, width: 2, height: 1.4 } },
    { text: 'is', bbox: { x: 3, y: 18.6, width: 2, height: 1.4 } },
    { text: '—', bbox: { x: 6, y: 19.45, width: 2, height: 0.1 } },
    { text: 'as', bbox: { x: 9, y: 19, width: 2, height: 1 } },
    { text: 'we', bbox: { x: 12, y: 19, width: 2, height: 1 } },
    { text: '“', bbox: { x: 15, y: 18.6, width: 1, height: 0.4 } },
    { text: 'going', bbox: { x: 17, y: 18.6, width: 4, height: 1.75 } },
  ];
  const markers = buildGrammarMarkers(annotation(row, [{ spans: ['It is — as we “ going'] }]));
  assert.equal(markers.length, 1);
  assert.ok(markers[0].y >= 20 && markers[0].y < 20.2, String(markers[0].y));
});

test('the article "a" is never treated as an A slot', () => {
  const row = words('It takes a lot of time.');
  const markers = buildGrammarMarkers(annotation(row, [{ words: ['a lot of'], spans: ['a lot of'] }]));
  assert.deepEqual(markers.map(m => [m.role, m.x, m.width]), [['fixed', 20, 28]]);
  for (const [sentence, template] of [['A lot of people came.', 'A lot of'], ['a lot of people came.', 'a lot of']]) {
    assert.deepEqual(buildGrammarMarkers(annotation(words(sentence), [{ words: [template], spans: ['a lot of'] }]))
      .map(m => [m.role, m.x, m.width]), [['fixed', 0, 28]], sentence);
  }
});

test('overlapping saved patterns produce one strong line and do not double-mark variables', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [pattern, pattern,
    { spans: ['this risk'], variableSpans: ['take this risk'] }]));
  assert.equal(markers.filter(m => m.role === 'variable').length, 0);
  assert.equal(markers.filter(m => m.x === 10).length, 1);
});

test('recovers legacy word geometry from OCR and infers only bounded A/B slots', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [{ ...pattern, variableSpans: undefined }], true), row);
  assert.deepEqual(markers.filter(m => m.role === 'variable').map(m => [m.x, m.width]), [[20, 18]]);
  assert.deepEqual(buildGrammarMarkers(annotation(row, [pattern], true)), []);
});

test('splits legacy phrase-wide spans using their A/B template', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [{ words: ['take A into account'], spans: ['take this risk into account'] }]));
  assert.deepEqual(markers.filter(m => m.role === 'fixed').map(m => [m.x, m.width]), [[10, 8], [40, 18]]);
  assert.deepEqual(markers.filter(m => m.role === 'variable').map(m => [m.x, m.width]), [[20, 18]]);
});

test('does not match cue words inside unrelated words or draw invented spans', () => {
  const row = words('Nothing is inside it.');
  assert.deepEqual(buildGrammarMarkers(annotation(row, [{ spans: ['not', 'in', 'invented'] }])), []);
});

test('translation-only and malformed saves render no sentence-wide fallback', () => {
  for (const item of [{ selection_rect: '{' }, annotation(words('A sentence.'), []),
    annotation(words('A sentence.'), [null, { spans: [null, 42] }])]) {
    assert.deepEqual(buildGrammarMarkers(item), []);
  }
});
