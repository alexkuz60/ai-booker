
-- Enum for segment types
CREATE TYPE public.segment_type AS ENUM (
  'epigraph',
  'narrator',
  'first_person',
  'inner_thought',
  'dialogue',
  'lyric',
  'footnote'
);

-- Scene segments (fragments)
CREATE TABLE public.scene_segments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_id UUID NOT NULL REFERENCES public.book_scenes(id) ON DELETE CASCADE,
  segment_number INTEGER NOT NULL DEFAULT 1,
  segment_type public.segment_type NOT NULL DEFAULT 'narrator',
  speaker TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Segment phrases (sentences within a segment)
CREATE TABLE public.segment_phrases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES public.scene_segments(id) ON DELETE CASCADE,
  phrase_number INTEGER NOT NULL DEFAULT 1,
  text TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS on scene_segments
ALTER TABLE public.scene_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own segments"
ON public.scene_segments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM book_scenes s
    JOIN book_chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE s.id = scene_segments.scene_id
      AND b.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM book_scenes s
    JOIN book_chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE s.id = scene_segments.scene_id
      AND b.user_id = auth.uid()
  )
);

-- RLS on segment_phrases
ALTER TABLE public.segment_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own phrases"
ON public.segment_phrases
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM scene_segments seg
    JOIN book_scenes s ON s.id = seg.scene_id
    JOIN book_chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE seg.id = segment_phrases.segment_id
      AND b.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM scene_segments seg
    JOIN book_scenes s ON s.id = seg.scene_id
    JOIN book_chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE seg.id = segment_phrases.segment_id
      AND b.user_id = auth.uid()
  )
);

-- Indexes
CREATE INDEX idx_scene_segments_scene_id ON public.scene_segments(scene_id);
CREATE INDEX idx_segment_phrases_segment_id ON public.segment_phrases(segment_id);
