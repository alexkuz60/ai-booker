
-- Allow authenticated users to insert their own impulses
CREATE POLICY "Users can insert own impulses"
ON public.convolution_impulses
FOR INSERT
TO authenticated
WITH CHECK (uploaded_by = auth.uid());

-- Allow users to delete their own impulses
CREATE POLICY "Users can delete own impulses"
ON public.convolution_impulses
FOR DELETE
TO authenticated
USING (uploaded_by = auth.uid());
