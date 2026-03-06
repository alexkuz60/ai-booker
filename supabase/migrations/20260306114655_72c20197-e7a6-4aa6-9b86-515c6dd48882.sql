
-- Table: book_characters
CREATE TABLE public.book_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  aliases text[] NOT NULL DEFAULT '{}',
  gender text NOT NULL DEFAULT 'unknown',
  age_group text NOT NULL DEFAULT 'unknown',
  temperament text,
  speech_style text,
  description text,
  voice_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, name)
);

ALTER TABLE public.book_characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own characters"
  ON public.book_characters FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.books WHERE books.id = book_characters.book_id AND books.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.books WHERE books.id = book_characters.book_id AND books.user_id = auth.uid()
  ));

-- Table: character_appearances
CREATE TABLE public.character_appearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.book_characters(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES public.book_scenes(id) ON DELETE CASCADE,
  role_in_scene text NOT NULL DEFAULT 'speaker',
  segment_ids uuid[] NOT NULL DEFAULT '{}',
  UNIQUE (character_id, scene_id)
);

ALTER TABLE public.character_appearances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own appearances"
  ON public.character_appearances FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.book_characters bc
    JOIN public.books b ON b.id = bc.book_id
    WHERE bc.id = character_appearances.character_id AND b.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.book_characters bc
    JOIN public.books b ON b.id = bc.book_id
    WHERE bc.id = character_appearances.character_id AND b.user_id = auth.uid()
  ));
