
CREATE TABLE public.ru_phonemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ipa text NOT NULL UNIQUE,
  description jsonb NOT NULL DEFAULT '{"ru":"","en":""}',
  examples text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'consonant' CHECK (category IN ('consonant', 'vowel')),
  notes text,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ru_phonemes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can read phonemes"
  ON public.ru_phonemes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage phonemes"
  ON public.ru_phonemes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
