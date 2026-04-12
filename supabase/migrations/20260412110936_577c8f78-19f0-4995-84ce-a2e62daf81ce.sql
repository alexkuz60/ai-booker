
-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Voice references are publicly readable" ON storage.objects;

-- Create a new policy scoped to authenticated users only
CREATE POLICY "Voice references are readable by authenticated users"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'voice-references');
