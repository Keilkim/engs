// Release evaluation for grammar-pattern segments: runs the app's own prompt
// against a corpus of sentence types and checks every returned pattern with
// the app's own validation and placement code.
//
//   node --env-file=.vercel/.env.production.local scripts/eval-grammar-segments.mjs \
//     [--models gemini-3.8-flash,gemini-3.5-flash-lite] [--limit 20] [--out .vercel/grammar-eval]
//
// Needs GOOGLE_API_KEY. Paid calls (one per sentence per model); no app or
// customer data is read or written. Results go to --out (gitignored .vercel).
import fs from 'node:fs';
import path from 'node:path';
import { buildGeminiRequest } from '../api/_lib/gemini.js';
import { buildGrammarPrompt, validatePattern, withSegmentSpans } from '../src/services/ai/grammarPrompt.js';
import { fold, prepareSentence, resolvePatternPieces } from '../src/utils/grammarRoles.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const models = arg('models', 'gemini-3.8-flash,gemini-3.5-flash-lite').split(',');
const limit = Number(arg('limit', 0)) || Infinity;
const outDir = arg('out', '.vercel/grammar-eval');
const corpusPath = arg('corpus', 'scripts/grammar-eval-corpus.json');
const LEVELS = ['intermediate', 'beginner', 'advanced'];

if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set (use --env-file)');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')).slice(0, limit);

function parseJSON(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|```$/g, '');
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? JSON.parse(trimmed.slice(start, end + 1)) : null;
}

async function analyze(model, sentence, level) {
  process.env.GEMINI_MODEL = model;
  // Same request body as analyzeGrammarPatterns in src/services/ai/grammar.js.
  const request = buildGeminiRequest({
    contents: [{ parts: [{ text: buildGrammarPrompt(sentence, level) }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' }, responseMimeType: 'application/json' },
  }, 'generateContent');
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(60000) });
    if (response.ok) {
      const data = await response.json();
      return parseJSON(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
    }
    if (attempt >= 4 || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500 * 2 ** attempt));
  }
}

// Role of every word a set of pieces covers, keyed by word start.
function roleMap(pieces, words) {
  const map = new Map();
  for (const piece of pieces) {
    for (const word of words) {
      if (word.start < piece.end && piece.start < word.end && (piece.role === 'fixed' || !map.has(word.start))) {
        map.set(word.start, { role: piece.role, label: piece.label, text: word.raw });
      }
    }
  }
  return map;
}

function checkPattern(raw, sentence, prepared) {
  const pattern = validatePattern(withSegmentSpans(raw), sentence);
  const rawSegments = Array.isArray(raw?.segments) ? raw.segments : [];
  const segments = pattern.segments || [];
  const pieces = resolvePatternPieces(pattern, prepared.text, prepared.words);
  const slots = pieces.filter(p => p.role === 'slot');
  const forms = (Array.isArray(pattern.words) ? pattern.words : []).filter(w => typeof w === 'string');
  const aiSlots = segments.filter(s => s.role === 'slot');
  const checks = {
    segments: rawSegments.length > 0,
    verbatim: rawSegments.length > 0 && segments.length === rawSegments.length,
    placed: segments.length > 0 && segments.every(segment => pieces.some(piece =>
      fold(prepared.raw.slice(piece.start, piece.end)).length && fold(segment.text).includes(fold(prepared.raw.slice(piece.start, piece.end))))),
    slotsLabeled: slots.every(slot => slot.label),
    aiLabelsValid: aiSlots.every(s => s.label && forms.some(f => fold(f).includes(fold(s.label)))),
  };
  // Independent check of the roles: forget them, keep only the stretch of the
  // sentence and the template, and recover roles by alignment (the path older
  // saves take). Compare word by word.
  let agreement = null, disagreements = [];
  if (pieces.length) {
    const start = Math.min(...pieces.map(p => p.start)), end = Math.max(...pieces.map(p => p.end));
    const legacy = resolvePatternPieces({ words: pattern.words, spans: [prepared.raw.slice(start, end)] },
      prepared.text, prepared.words);
    const ai = roleMap(pieces, prepared.words), recovered = roleMap(legacy, prepared.words);
    const keys = new Set([...ai.keys(), ...recovered.keys()]);
    let same = 0;
    for (const key of keys) {
      const a = ai.get(key), r = recovered.get(key);
      if (a?.role === r?.role) same++;
      else disagreements.push({ word: (a || r).text, ai: a?.role || '-', recovered: r?.role || '-' });
    }
    agreement = keys.size ? same / keys.size : 1;
  }
  return {
    words: pattern.words, explanation: pattern.explanation,
    segments: segments.map(s => `${s.role === 'slot' ? `[${s.label || '?'}]` : ''}${s.text}`),
    resolved: pieces.map(p => `${p.role}${p.label ? `(${p.label})` : ''}:${prepared.raw.slice(p.start, p.end)}`),
    checks, pass: checks.segments && checks.verbatim && checks.placed && checks.slotsLabeled,
    agreement, disagreements,
  };
}

async function runModel(model) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < corpus.length) {
      const index = next++;
      const { type, sentence } = corpus[index];
      const level = LEVELS[index % LEVELS.length];
      const prepared = prepareSentence(sentence);
      try {
        const answer = await analyze(model, sentence, level);
        const patterns = Array.isArray(answer?.patterns) ? answer.patterns : [];
        results[index] = { type, sentence, level, patterns: patterns.map(p => checkPattern(p, sentence, prepared)) };
      } catch (err) {
        results[index] = { type, sentence, level, error: err.message, patterns: [] };
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return results;
}

function summarize(model, results) {
  const byType = new Map();
  const total = { sentences: 0, errors: 0, empty: 0, patterns: 0, pass: 0, agreement: [], checks: {} };
  for (const item of results) {
    const t = byType.get(item.type) || { patterns: 0, pass: 0, agreement: [] };
    byType.set(item.type, t);
    total.sentences++;
    if (item.error) total.errors++;
    else if (!item.patterns.length) total.empty++;
    for (const p of item.patterns) {
      total.patterns++; t.patterns++;
      if (p.pass) { total.pass++; t.pass++; }
      if (p.agreement !== null) { total.agreement.push(p.agreement); t.agreement.push(p.agreement); }
      for (const [name, ok] of Object.entries(p.checks)) {
        total.checks[name] = total.checks[name] || [0, 0];
        total.checks[name][0] += ok ? 1 : 0;
        total.checks[name][1]++;
      }
    }
  }
  const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
  const mean = list => (list.length ? `${(100 * list.reduce((s, v) => s + v, 0) / list.length).toFixed(1)}%` : '-');
  console.log(`\n=== ${model} ===`);
  console.log(`sentences ${total.sentences}, request errors ${total.errors}, no patterns ${total.empty}, patterns ${total.patterns}`);
  console.log(`all checks pass: ${pct(total.pass, total.patterns)}; role agreement with template alignment: ${mean(total.agreement)}`);
  for (const [name, [ok, n]] of Object.entries(total.checks)) console.log(`  ${name.padEnd(14)} ${pct(ok, n)} (${ok}/${n})`);
  console.log('by type (pass / role agreement):');
  for (const [type, t] of byType) console.log(`  ${type.padEnd(14)} ${pct(t.pass, t.patterns).padStart(6)}  ${mean(t.agreement).padStart(6)}  (${t.patterns})`);
}

fs.mkdirSync(outDir, { recursive: true });
for (const model of models) {
  const results = await runModel(model);
  fs.writeFileSync(path.join(outDir, `${model}.json`), JSON.stringify(results, null, 2));
  summarize(model, results);
}
