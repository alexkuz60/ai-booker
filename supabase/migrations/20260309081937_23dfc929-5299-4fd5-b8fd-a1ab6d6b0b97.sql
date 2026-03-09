
-- Create scene_atmospheres table
CREATE TABLE public.scene_atmospheres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.book_scenes(id) ON DELETE CASCADE,
  layer_type text NOT NULL DEFAULT 'ambience',
  audio_path text NOT NULL,
  prompt_used text NOT NULL DEFAULT '',
  duration_ms integer NOT NULL DEFAULT 0,
  volume real NOT NULL DEFAULT 0.5,
  fade_in_ms integer NOT NULL DEFAULT 500,
  fade_out_ms integer NOT NULL DEFAULT 1000,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scene_atmospheres ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can manage atmospheres for their own scenes
CREATE POLICY "Users can manage own atmospheres"
  ON public.scene_atmospheres
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM book_scenes s
      JOIN book_chapters c ON c.id = s.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE s.id = scene_atmospheres.scene_id
        AND b.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM book_scenes s
      JOIN book_chapters c ON c.id = s.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE s.id = scene_atmospheres.scene_id
        AND b.user_id = auth.uid()
    )
  );
