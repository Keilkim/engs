// Supabase table types

// NOTE: id / foreign-key columns are BIGSERIAL/BIGINT in the DB, so they come back
// as numbers. Callers that compare against string DOM attributes must normalize
// (e.g. String(row.id) === attr).
export interface Source {
  id: number;
  user_id: string;
  title: string;
  type: 'image' | 'pdf' | 'url' | 'screenshot' | 'youtube';
  file_path: string | null;
  screenshot: string | null;
  thumbnail: string | null;
  pages: string | null; // JSON string of page images
  ocr_data: OcrData | null;
  content: string | null; // HTML content for URL type
  youtube_data: YouTubeData | null;
  captions_data: CaptionsData | null;
  source_language: string | null;
  pinned: boolean;
  to_read: boolean;
  created_at: string;
  last_accessed: string | null;
}

export interface YouTubeData {
  video_id: string;
  channel: string;
  channel_id?: string; // UC... — captured at add time (Phase 2) or backfilled lazily by the shelf
  author_url?: string; // noembed channel URL (backfill material)
  duration?: number;
  has_captions: boolean;
  caption_source: 'youtube' | 'whisper' | 'manual';
  thumbnail_url: string;
}

export interface CaptionSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
  translation?: string;
  // Whisper confidence signals (only on whisper-sourced segments) — used to
  // reject hallucinated no-speech segments before pause-chunking.
  no_speech_prob?: number;
  avg_logprob?: number;
}

// Additive, non-destructive word-timing block attached by the "정밀 타이밍
// 업그레이드" flow. The original `segments` array is never mutated, so legacy
// annotations that index it by position stay valid.
export interface WhisperTimings {
  version: number;
  createdAt: string;
  model: string;
  language: string;
  duration: number | null;
  segments: CaptionSegment[];
}

export interface CaptionsData {
  segments: CaptionSegment[];
  language: string;
  source: 'youtube' | 'whisper' | 'manual';
  whisper?: WhisperTimings;
}

export interface Annotation {
  id: number;
  user_id: string;
  source_id: number | null; // nullable: manual dictionary entries have no source
  type: 'highlight' | 'memo';
  coordinates: string | null; // JSON string (legacy)
  selected_text: string | null;
  selection_rect: string | null; // JSON string
  ai_analysis_json: string | null; // JSON string
  memo_content: string | null;
  created_at: string;
}

export interface ChatLog {
  id: number;
  user_id: string;
  source_id: number | null;
  role: 'user' | 'assistant';
  message: string;
  is_scrapped: boolean;
  created_at: string;
}

export interface ReviewItem {
  id: number;
  user_id: string;
  annotation_id: number;
  next_review_date: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  stack: number;
  status: 'active' | 'completed' | 'suspended';
  last_reviewed: string | null;
}

// Parsed JSON subtypes

export interface OcrData {
  pages: OcrPage[];
}

export interface OcrPage {
  pageIndex: number;
  words: OcrWord[];
}

export interface OcrWord {
  text: string;
  bbox: BBox;
  confidence?: number;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionRect {
  bounds?: BBox;
  lines?: BBox[];
  page?: number;
  // Pen stroke fields
  type?: 'pen_stroke' | 'youtube_word' | 'youtube_grammar';
  points?: Array<{ x: number; y: number }>;
  color?: string;
  strokeWidth?: number;
  // YouTube word fields. `segmentIndex` always refers to the STORED
  // captions_data.segments array (translated from any derived display row).
  segmentIndex?: number;
  wordIndex?: number;
  timestamp?: number;
  // Authoritative scene bounds captured at save time (a pause-chunk row is a
  // better scene than a raw cue). When present, scene playback uses these and
  // skips the fragile index lookup entirely. Absent on legacy annotations.
  sceneStart?: number;
  sceneEnd?: number;
}

export interface VocabularyAnalysis {
  isVocabulary: true;
  word: string;
  definition: string;
  phonetic?: string;
}

export interface GrammarAnalysis {
  type: 'grammar';
  originalText: string;
  translation: string;
  patterns: GrammarPattern[];
}

export interface GrammarPattern {
  words?: string[];
  explanation: string;
  type?: string;
  typeKr?: string;
}

// Source list item (subset for grid display)
export interface SourceListItem {
  id: number;
  title: string;
  type: Source['type'];
  pinned: boolean;
  created_at: string;
  last_accessed: string | null;
  thumbnail: string | null;
  screenshot: string | null;
}
