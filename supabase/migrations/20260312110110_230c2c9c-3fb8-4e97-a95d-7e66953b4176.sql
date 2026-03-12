
-- Allow users to update their own impulses (for inline category/name editing)
CREATE POLICY "Users can update own impulses"
ON public.convolution_impulses
FOR UPDATE
TO authenticated
USING (uploaded_by = auth.uid())
WITH CHECK (uploaded_by = auth.uid());
