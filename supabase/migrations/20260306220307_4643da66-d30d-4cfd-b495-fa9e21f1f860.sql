
-- Table to persist scene-level segment_type → character mappings
-- Survives re-segmentation: when segments are recreated, these rules are re-applied
CREATE TABLE public.scene_type_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.book_scenes(id) ON DELETE CASCADE,
  segment_type text NOT NULL,
  character_id uuid NOT NULL REFERENCES public.book_characters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, segment_type)
);

ALTER TABLE public.scene_type_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own type mappings"
  ON public.scene_type_mappings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM book_scenes s
      JOIN book_chapters c ON c.id = s.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE s.id = scene_type_mappings.scene_id
        AND b.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM book_scenes s
      JOIN book_chapters c ON c.id = s.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE s.id = scene_type_mappings.scene_id
        AND b.user_id = auth.uid()
    )
  );
