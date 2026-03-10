import type { Annotation, BBox } from './database';

// Modal state types

export type ModalType = 'wordMenu' | 'vocabTooltip' | 'vocabDeleteConfirm' | 'grammarTooltip' | null;

export interface ModalState {
  type: ModalType;
  data: ModalData;
}

export interface ModalData {
  word?: string;
  wordBbox?: BBox | null;
  sentenceWords?: Array<{ text: string; bbox: BBox }> | null;
  position?: Position;
  placement?: 'above' | 'below';
  existingAnnotation?: Annotation | null;
  isGrammarMode?: boolean;
  annotation?: Annotation;
}

export interface Position {
  x: number;
  y: number;
}

export interface PanOffset {
  x: number;
  y: number;
}

export interface ZoomOrigin {
  x: number;
  y: number;
}

export interface ViewportPosition {
  top: number;
  height: number;
}
