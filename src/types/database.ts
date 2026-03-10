// Supabase table types

export interface Source {
  id: string;
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
  created_at: string;
  last_accessed: string | null;
}

export interface YouTubeData {
  video_id: string;
  channel: string;
  duration?: number;
  has_captions: boolean;
  caption_source: 'youtube' | 'whisper' | 'manual';
  thumbnail_url: string;
}

export interface CaptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
  translation?: string;
}

export interface CaptionsData {
  segments: CaptionSegment[];
  language: string;
  source: 'youtube' | 'whisper' | 'manual';
}

export interface Annotation {
  id: string;
  user_id: string;
  source_id: string;
  type: 'highlight' | 'memo';
  selected_text: string | null;
  selection_rect: string | null; // JSON string
  ai_analysis_json: string | null; // JSON string
  memo_content: string | null;
  created_at: string;
}

export interface ChatLog {
  id: string;
  user_id: string;
  source_id: string | null;
  role: 'user' | 'assistant';
  message: string;
  is_bookmarked: boolean;
  created_at: string;
}

export interface ReviewItem {
  id: string;
  user_id: string;
  annotation_id: string;
  next_review_date: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  status: 'active' | 'completed';
  last_reviewed_at: string | null;
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
  type?: 'pen_stroke' | 'youtube_word';
  points?: Array<{ x: number; y: number }>;
  color?: string;
  strokeWidth?: number;
  // YouTube word fields
  segmentIndex?: number;
  wordIndex?: number;
  timestamp?: number;
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
  id: string;
  title: string;
  type: Source['type'];
  pinned: boolean;
  created_at: string;
  last_accessed: string | null;
  thumbnail: string | null;
  screenshot: string | null;
}
