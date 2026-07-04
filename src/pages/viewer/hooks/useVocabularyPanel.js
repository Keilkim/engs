import { useState, useCallback, useMemo } from 'react';
import { getMobileSafeAreaBottom } from '../../../utils/positioning';
import { parsePatternDefs, highlightSentencePatterns } from '../../../utils/patternMatcher';

// Skip text that is already inside a highlight or non-content element so we
// never touch tag names or attribute values.
const SKIP_ANCESTORS = new Set(['MARK', 'SUP', 'SCRIPT', 'STYLE']);

/**
 * Walk only the text nodes of `root` and replace regex matches with the node
 * returned by `makeReplacement`. Because we operate on text nodes (never on the
 * serialized HTML string), tag names and attribute values are never matched.
 */
function replaceInTextNodes(root, regex, makeReplacement) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p = node.parentNode;
      while (p && p !== root) {
        if (SKIP_ANCESTORS.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    regex.lastIndex = 0;
    if (!regex.test(text)) continue;

    regex.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const matched = m[0];
      if (m.index > lastIndex) {
        frag.appendChild(doc.createTextNode(text.slice(lastIndex, m.index)));
      }
      frag.appendChild(makeReplacement(matched));
      lastIndex = m.index + matched.length;
      if (matched.length === 0) regex.lastIndex++;
    }
    if (lastIndex < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

/**
 * Hook for vocabulary panel UI state and interactions
 * Data (vocabulary list) is provided externally (from useSourceData or Viewer)
 * highlightedVocabId / highlightVocab are managed by useModalState
 */
export function useVocabularyPanel(openModal, vocabulary, sentencePatterns = []) {
  const [showVocabPanel, setShowVocabPanel] = useState(false);
  const [deletingVocab, setDeletingVocab] = useState(false);

  // Show vocabulary word via wordMenu modal with smart positioning
  const showVocabWord = useCallback((word, definition, markerRect = null, annotation = null) => {
    let position = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let placement = 'below';

    if (markerRect) {
      const viewportHeight = window.innerHeight;
      const safeAreaBottom = getMobileSafeAreaBottom();
      const spaceAbove = markerRect.top;
      const spaceBelow = viewportHeight - markerRect.bottom - safeAreaBottom;

      placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

      const x = Math.min(
        Math.max(20, markerRect.left + markerRect.width / 2),
        window.innerWidth - 20
      );

      const y = placement === 'below'
        ? markerRect.bottom + 12
        : markerRect.top - 12;

      position = { x, y };
    }

    openModal('wordMenu', {
      word,
      existingAnnotation: annotation,
      isGrammarMode: false,
      position,
      placement,
    });
  }, [openModal]);

  // Escape special regex characters
  const escapeRegex = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Highlight vocabulary words in HTML content.
  // Parses the HTML into a DOM and only rewrites text nodes, so tag names and
  // attributes (e.g. <div>, data-vocab-id, <a title="...">) are never matched.
  // All words are handled in a single pass to avoid re-highlighting.
  const highlightVocabularyWords = useCallback((htmlContent) => {
    if (!vocabulary || vocabulary.length === 0) return htmlContent;
    if (typeof DOMParser === 'undefined') return htmlContent;

    // Map lowercased word -> vocab id (first occurrence wins) and build one
    // combined alternation regex, longest phrases first so they win ties.
    const wordToId = new Map();
    for (const item of vocabulary) {
      const word = item.selected_text;
      if (!word || word.length < 2) continue;
      const key = word.toLowerCase();
      if (!wordToId.has(key)) wordToId.set(key, { id: item.id, word });
    }
    if (wordToId.size === 0) return htmlContent;

    const alternation = [...wordToId.values()]
      .map(v => v.word)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex)
      .join('|');
    const regex = new RegExp(`\\b(?:${alternation})\\b`, 'gi');

    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    replaceInTextNodes(doc.body, regex, (matched) => {
      const entry = wordToId.get(matched.toLowerCase());
      const mark = doc.createElement('mark');
      mark.className = 'vocab-highlight';
      if (entry) mark.setAttribute('data-vocab-id', entry.id);
      mark.textContent = matched;
      return mark;
    });
    return doc.body.innerHTML;
  }, [vocabulary]);

  // Parse pattern defs (memoized)
  const patternDefs = useMemo(() => parsePatternDefs(sentencePatterns), [sentencePatterns]);

  // Combined highlighting: patterns first, then vocab words
  const highlightAllContent = useCallback((htmlContent) => {
    let result = highlightSentencePatterns(htmlContent, patternDefs);
    result = highlightVocabularyWords(result);
    return result;
  }, [patternDefs, highlightVocabularyWords]);

  return {
    showVocabPanel,
    setShowVocabPanel,
    deletingVocab,
    setDeletingVocab,
    showVocabWord,
    highlightVocabularyWords,
    highlightAllContent,
    patternDefs,
  };
}
