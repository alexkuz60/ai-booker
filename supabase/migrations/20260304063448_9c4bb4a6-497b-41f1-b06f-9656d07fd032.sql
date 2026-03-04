
-- Add book_parts table for 4-level hierarchy
CREATE TABLE public.book_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add part_id to book_chapters (nullable for backward compat)
ALTER TABLE public.book_chapters ADD COLUMN part_id UUID REFERENCES public.book_parts(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.book_parts ENABLE ROW LEVEL SECURITY;

-- RLS policy for book_parts
CREATE POLICY "Users can manage own parts"
ON public.book_parts
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM books WHERE books.id = book_parts.book_id AND books.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM books WHERE books.id = book_parts.book_id AND books.user_id = auth.uid()));
