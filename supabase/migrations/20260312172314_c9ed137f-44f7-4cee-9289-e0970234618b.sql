
CREATE TABLE public.montage_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES public.book_chapters(id) ON DELETE CASCADE,
  part_number smallint NOT NULL DEFAULT 1,
  scene_ids uuid[] NOT NULL DEFAULT '{}',
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chapter_id, part_number)
);

ALTER TABLE public.montage_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own montage parts"
  ON public.montage_parts
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
