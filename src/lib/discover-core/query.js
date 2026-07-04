// Discover-core: build search queries from the active interest set.
// Environment-free. One OR-combined query per pipeline (keeps API quota low); the
// wide-net recall is tightened by the local weighted-overlap re-rank in rank.js.
import { topInterestTerms } from './keywords.js';

// Quote multi-word topics so "space exploration" stays a phrase, not two loose ORs.
function termToken(term) {
  return term.includes(' ') ? `"${term}"` : term;
}

/**
 * @returns { yt, web, pdf } query strings, plus `terms` (the top terms used).
 * Returns nulls when there is no interest signal yet (caller then self-hides).
 */
export function buildQueries(profile, { maxTerms = 4 } = {}) {
  const top = topInterestTerms(profile, maxTerms).map((t) => t.term);
  if (top.length === 0) return { yt: null, web: null, pdf: null, terms: [] };
  const orExpr = top.map(termToken).join(' | '); // Google/YouTube treat | as OR
  return {
    yt: orExpr,
    web: orExpr,
    pdf: orExpr, // the route appends `filetype:pdf`
    terms: top,
  };
}
