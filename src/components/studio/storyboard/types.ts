import type { PhraseAnnotation, TtsProvider } from "../phraseAnnotations";

export interface Phrase {
  phrase_id: string;
  phrase_number: number;
  text: string;
  annotations?: PhraseAnnotation[];
}

export interface InlineNarration {
  text: string;
  insert_after: string;
}

export interface Segment {
  segment_id: string;
  segment_number: number;
  segment_type: string;
  speaker: string | null;
  phrases: Phrase[];
  inline_narrations?: InlineNarration[];
  split_silence_ms?: number;
}

export interface CharacterOption {
  id: string;
  name: string;
  color: string | null;
  voiceConfig?: Record<string, unknown>;
}
