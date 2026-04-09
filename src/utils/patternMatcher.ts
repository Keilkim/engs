/**
 * Sentence pattern matching utilities
 * Matches saved grammar patterns (e.g., "not only...but also") in content text
 */

// Escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface PatternDef {
  id: string;
  pattern: string;
  parts: string[];
  explanation: string;
  example: string;
}

export interface PatternMatch {
  patternId: string;
  fullMatchStart: number;
  fullMatchEnd: number;
  partMatches: Array<{ start: number; end: number; text: string }>;
}

/**
 * Build a regex that matches all parts of a pattern in sequence,
 * with flexible gaps between them (up to 200 chars).
 */
export function buildPatternRegex(parts: string[]): RegExp | null {
  if (!parts || parts.length === 0) return null;

  const regexParts = parts.map(part => {
    // Split part into words and join with flexible whitespace
    const words = part.trim().split(/\s+/).map(w => escapeRegex(w));
    return `(${words.join('\\s+')})`;
  });

  // Join parts with a flexible gap (1-200 chars between)
  const pattern = regexParts.join('[\\s\\S]{1,200}?');
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

/**
 * Find all pattern matches in a text string.
 * Returns match info including positions of each part.
 */
export function findPatternMatches(text: string, patterns: PatternDef[]): PatternMatch[] {
  const matches: PatternMatch[] = [];

  for (const patternDef of patterns) {
    const regex = buildPatternRegex(patternDef.parts);
    if (!regex) continue;

    let match: RegExpExecArray | null;
    // Reset lastIndex for safety
    regex.lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      const partMatches: PatternMatch['partMatches'] = [];

      // match[0] is the full match, match[1..n] are the captured groups (parts)
      let searchFrom = match.index;
      for (let i = 1; i <= patternDef.parts.length; i++) {
        if (match[i]) {
          const partStart = text.indexOf(match[i], searchFrom);
          if (partStart !== -1) {
            partMatches.push({
              start: partStart,
              end: partStart + match[i].length,
              text: match[i],
            });
            searchFrom = partStart + match[i].length;
          }
        }
      }

      if (partMatches.length > 0) {
        matches.push({
          patternId: patternDef.id,
          fullMatchStart: match.index,
          fullMatchEnd: match.index + match[0].length,
          partMatches,
        });
      }

      // Prevent infinite loop on zero-length matches
      if (match[0].length === 0) regex.lastIndex++;
    }
  }

  return matches;
}

/**
 * Parse pattern definitions from annotation objects.
 */
export function parsePatternDefs(annotations: any[]): PatternDef[] {
  return annotations.map(a => {
    try {
      const json = JSON.parse(a.ai_analysis_json || '{}');
      return {
        id: a.id,
        pattern: json.pattern || a.selected_text || '',
        parts: json.parts || [],
        explanation: json.explanation || '',
        example: json.example || '',
      };
    } catch {
      return null;
    }
  }).filter((p): p is PatternDef => p !== null && p.parts.length > 0);
}

/**
 * Highlight sentence pattern parts in HTML content.
 * Each matched part gets wrapped with a numbered marker indicating which pattern it belongs to.
 *
 * IMPORTANT: Must be called BEFORE highlightVocabularyWords to avoid breaking <mark> tags.
 */
export function highlightSentencePatterns(htmlContent: string, patterns: PatternDef[]): string {
  if (!patterns || patterns.length === 0) return htmlContent;

  // Strip HTML tags to get plain text for matching
  const textOnly = htmlContent.replace(/<[^>]+>/g, '');
  const allMatches = findPatternMatches(textOnly, patterns);
  if (allMatches.length === 0) return htmlContent;

  // Collect all part matches with their pattern index (1-based)
  const partHighlights: Array<{
    start: number;
    end: number;
    patternId: string;
    patternIndex: number;
  }> = [];

  // Assign pattern index per unique patternId
  const patternIndexMap = new Map<string, number>();
  let nextIndex = 1;

  for (const match of allMatches) {
    if (!patternIndexMap.has(match.patternId)) {
      patternIndexMap.set(match.patternId, nextIndex++);
    }
    const pIdx = patternIndexMap.get(match.patternId)!;
    for (const part of match.partMatches) {
      partHighlights.push({
        start: part.start,
        end: part.end,
        patternId: match.patternId,
        patternIndex: pIdx,
      });
    }
  }

  // Sort by start position descending to insert from end (avoid offset shifting)
  partHighlights.sort((a, b) => b.start - a.start);

  // Map plain-text offsets to HTML offsets
  let result = htmlContent;
  for (const highlight of partHighlights) {
    const { htmlStart, htmlEnd } = mapTextOffsetToHtml(htmlContent, highlight.start, highlight.end);
    if (htmlStart === -1 || htmlEnd === -1) continue;

    const before = result.slice(0, htmlStart);
    const matched = result.slice(htmlStart, htmlEnd);
    const after = result.slice(htmlEnd);

    result = before +
      `<mark class="pattern-highlight" data-pattern-id="${highlight.patternId}" data-pattern-idx="${highlight.patternIndex}">` +
      matched +
      `</mark><sup class="pattern-sup" data-pattern-id="${highlight.patternId}">${highlight.patternIndex}</sup>` +
      after;
  }

  return result;
}

/**
 * Map a plain-text offset range to the corresponding HTML string offset range,
 * skipping over HTML tags.
 */
function mapTextOffsetToHtml(html: string, textStart: number, textEnd: number): { htmlStart: number; htmlEnd: number } {
  let textPos = 0;
  let htmlStart = -1;
  let htmlEnd = -1;
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      // Skip HTML tag
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) break;
      i = tagEnd + 1;
      continue;
    }

    if (textPos === textStart) htmlStart = i;
    textPos++;
    if (textPos === textEnd) {
      htmlEnd = i + 1;
      break;
    }
    i++;
  }

  return { htmlStart, htmlEnd };
}
