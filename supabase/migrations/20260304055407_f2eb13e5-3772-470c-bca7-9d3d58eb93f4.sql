-- Books table
CREATE TABLE public.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  file_path text,
  raw_text text,
  status text NOT NULL DEFAULT 'uploaded',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own books" ON public.books
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Chapters table
CREATE TABLE public.book_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chapter_number int NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT '',
  content text,
  scene_type text,
  mood text,
  bpm int,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chapters" ON public.book_chapters
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = book_chapters.book_id AND books.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.books WHERE books.id = book_chapters.book_id AND books.user_id = auth.uid()));

-- Scenes table
CREATE TABLE public.book_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES public.book_chapters(id) ON DELETE CASCADE,
  scene_number int NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT '',
  content text,
  scene_type text,
  mood text,
  bpm int,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own scenes" ON public.book_scenes
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.book_chapters c
    JOIN public.books b ON b.id = c.book_id
    WHERE c.id = book_scenes.chapter_id AND b.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.book_chapters c
    JOIN public.books b ON b.id = c.book_id
    WHERE c.id = book_scenes.chapter_id AND b.user_id = auth.uid()
  ));

-- Storage bucket for book uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('book-uploads', 'book-uploads', false, 20971520);

-- Storage RLS
CREATE POLICY "Users can upload own books" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'book-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own books" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'book-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own books" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'book-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);