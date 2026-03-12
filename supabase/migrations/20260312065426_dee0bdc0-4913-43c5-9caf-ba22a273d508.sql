
-- Create convolution_impulses table
CREATE TABLE public.convolution_impulses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  description text,
  category text NOT NULL DEFAULT 'hall',
  file_path text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  sample_rate integer NOT NULL DEFAULT 48000,
  channels smallint NOT NULL DEFAULT 2,
  uploaded_by uuid NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.convolution_impulses ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read public impulses
CREATE POLICY "Anyone can read public impulses"
  ON public.convolution_impulses
  FOR SELECT
  TO authenticated
  USING (is_public = true);

-- Only admins can insert
CREATE POLICY "Admins can insert impulses"
  ON public.convolution_impulses
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can update
CREATE POLICY "Admins can update impulses"
  ON public.convolution_impulses
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can delete
CREATE POLICY "Admins can delete impulses"
  ON public.convolution_impulses
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Create public storage bucket for impulse responses
INSERT INTO storage.buckets (id, name, public)
VALUES ('impulse-responses', 'impulse-responses', true);

-- Storage RLS: anyone authenticated can read
CREATE POLICY "Authenticated users can read impulses"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'impulse-responses');

-- Storage RLS: only admins can upload
CREATE POLICY "Admins can upload impulses"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'impulse-responses' AND public.has_role(auth.uid(), 'admin'));

-- Storage RLS: only admins can delete
CREATE POLICY "Admins can delete impulse files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'impulse-responses' AND public.has_role(auth.uid(), 'admin'));
