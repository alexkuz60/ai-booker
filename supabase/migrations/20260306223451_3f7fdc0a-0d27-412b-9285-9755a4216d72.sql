
CREATE TABLE public.scene_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.book_scenes(id) ON DELETE CASCADE,
  total_duration_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'partial',
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id)
);

ALTER TABLE public.scene_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own playlists"
ON public.scene_playlists
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM book_scenes s
    JOIN book_chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE s.id = scene_playlists.scene_id AND b.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM book_scenes s
    JOIN book_chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE s.id = scene_playlists.scene_id AND b.user_id = auth.uid()
  )
);
