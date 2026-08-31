DROP POLICY IF EXISTS "Anyone can read books" ON public.books;

CREATE POLICY "Live books are public" ON public.books FOR SELECT USING (status = 'live'::book_status);
CREATE POLICY "Owners can read their books" ON public.books FOR SELECT TO authenticated USING (auth.uid() = user_id);