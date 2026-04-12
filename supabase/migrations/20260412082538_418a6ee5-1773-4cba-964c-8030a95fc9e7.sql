
-- Create a public bucket for VC ONNX models
INSERT INTO storage.buckets (id, name, public)
VALUES ('vc-models', 'vc-models', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read VC models
CREATE POLICY "Anyone can read vc-models"
ON storage.objects FOR SELECT
USING (bucket_id = 'vc-models');

-- Only admins can upload VC models
CREATE POLICY "Admins can upload vc-models"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'vc-models' AND public.has_role(auth.uid(), 'admin'));

-- Only admins can delete VC models
CREATE POLICY "Admins can delete vc-models"
ON storage.objects FOR DELETE
USING (bucket_id = 'vc-models' AND public.has_role(auth.uid(), 'admin'));

-- Fix security: make voice-references bucket private
UPDATE storage.buckets SET public = false WHERE id = 'voice-references';

-- Fix security: remove segment_audio from realtime
ALTER PUBLICATION supabase_realtime DROP TABLE public.segment_audio;
