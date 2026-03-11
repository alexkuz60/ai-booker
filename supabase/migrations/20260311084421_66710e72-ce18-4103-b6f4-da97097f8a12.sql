
CREATE TABLE public.stress_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  word text NOT NULL,
  stressed_index smallint NOT NULL,
  context text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, word, stressed_index)
);

ALTER TABLE public.stress_dictionary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own stress dictionary"
  ON public.stress_dictionary
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_stress_dictionary_user ON public.stress_dictionary(user_id);
CREATE INDEX idx_stress_dictionary_word ON public.stress_dictionary(user_id, word);
