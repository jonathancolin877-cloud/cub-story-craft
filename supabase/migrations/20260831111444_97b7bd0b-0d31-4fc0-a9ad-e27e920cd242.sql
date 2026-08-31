ALTER TABLE public.books ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Anyone can create books" ON public.books;
DROP POLICY IF EXISTS "Anyone can delete books" ON public.books;
DROP POLICY IF EXISTS "Anyone can read books" ON public.books;
DROP POLICY IF EXISTS "Anyone can update books" ON public.books;

REVOKE INSERT, UPDATE, DELETE ON public.books FROM anon;
GRANT SELECT ON public.books TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.books TO authenticated;
GRANT ALL ON public.books TO service_role;

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read books" ON public.books FOR SELECT USING (true);
CREATE POLICY "Owners can create books" ON public.books FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners can update their books" ON public.books FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners can delete their books" ON public.books FOR DELETE TO authenticated USING (auth.uid() = user_id);