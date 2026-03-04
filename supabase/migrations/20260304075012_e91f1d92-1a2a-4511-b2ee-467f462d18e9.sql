-- Create user-media bucket for sounds, atmosphere, music, audio-ready
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-media', 'user-media', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: users can manage their own files (path starts with their user_id)
CREATE POLICY "Users can upload own media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'user-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view own media"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'user-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'user-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own media"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'user-media' AND (storage.foldername(name))[1] = auth.uid()::text);
