ALTER TABLE public.book_chapters ADD COLUMN IF NOT EXISTS start_page integer NOT NULL DEFAULT 0;
ALTER TABLE public.book_chapters ADD COLUMN IF NOT EXISTS end_page integer NOT NULL DEFAULT 0;