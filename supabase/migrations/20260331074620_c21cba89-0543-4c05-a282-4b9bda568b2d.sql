CREATE POLICY "Users can update own books"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'book-uploads' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'book-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);