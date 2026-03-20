-- Add content_dirty flag to book_scenes for Parser→Studio sync
ALTER TABLE public.book_scenes
ADD COLUMN content_dirty boolean NOT NULL DEFAULT false;