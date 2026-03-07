-- Relax user-media storage path policy to support both:
-- 1) <user_id>/...
-- 2) tts/<user_id>/... (legacy/current TTS synthesis path)

DROP POLICY IF EXISTS "Users can view own media" ON storage.objects;
CREATE POLICY "Users can view own media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'user-media'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Users can update own media" ON storage.objects;
CREATE POLICY "Users can update own media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'user-media'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Users can delete own media" ON storage.objects;
CREATE POLICY "Users can delete own media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'user-media'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Users can upload own media" ON storage.objects;
CREATE POLICY "Users can upload own media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'user-media'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);