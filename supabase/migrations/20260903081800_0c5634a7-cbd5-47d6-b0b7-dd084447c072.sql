DROP POLICY IF EXISTS "Live books are public" ON public.books;
REVOKE SELECT ON public.books FROM anon;