
-- Table for voice reference samples (like convolution_impulses pattern)
CREATE TABLE public.voice_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  category TEXT NOT NULL DEFAULT 'male',
  language TEXT NOT NULL DEFAULT 'ru',
  file_path TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  channels SMALLINT NOT NULL DEFAULT 1,
  uploaded_by UUID NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.voice_references ENABLE ROW LEVEL SECURITY;

-- Read: all authenticated can see public
CREATE POLICY "Anyone can read public voice references"
  ON public.voice_references FOR SELECT
  TO authenticated
  USING (is_public = true);

-- Admin full control
CREATE POLICY "Admins can insert voice references"
  ON public.voice_references FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update voice references"
  ON public.voice_references FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete voice references"
  ON public.voice_references FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- Users manage own (for future user uploads)
CREATE POLICY "Users can insert own voice references"
  ON public.voice_references FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can update own voice references"
  ON public.voice_references FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid())
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can delete own voice references"
  ON public.voice_references FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid());

-- Storage bucket for voice reference audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-references', 'voice-references', true);

-- Storage policies
CREATE POLICY "Voice references are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'voice-references');

CREATE POLICY "Admins can upload voice references"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'voice-references' AND has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update voice references"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'voice-references' AND has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete voice references"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'voice-references' AND has_role(auth.uid(), 'admin'));
