-- Add speech_tags and psycho_tags columns to book_characters
ALTER TABLE public.book_characters
  ADD COLUMN IF NOT EXISTS speech_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS psycho_tags text[] NOT NULL DEFAULT '{}';