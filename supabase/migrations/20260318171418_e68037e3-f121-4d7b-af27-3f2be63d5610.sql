
DROP FUNCTION IF EXISTS public.get_user_books_with_counts();

CREATE FUNCTION public.get_user_books_with_counts()
 RETURNS TABLE(id uuid, title text, file_name text, file_path text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, chapter_count bigint, scene_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    b.id,
    b.title,
    b.file_name,
    b.file_path,
    b.status,
    b.created_at,
    b.updated_at,
    (SELECT count(*) FROM book_chapters c WHERE c.book_id = b.id) AS chapter_count,
    (SELECT count(*) FROM book_scenes s WHERE s.chapter_id IN (SELECT c2.id FROM book_chapters c2 WHERE c2.book_id = b.id)) AS scene_count
  FROM books b
  WHERE b.user_id = auth.uid()
  ORDER BY b.created_at DESC;
$function$;
