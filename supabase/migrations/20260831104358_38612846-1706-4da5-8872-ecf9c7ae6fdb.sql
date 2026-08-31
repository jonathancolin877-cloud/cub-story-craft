CREATE TYPE public.book_status AS ENUM ('draft', 'in_production', 'live');

ALTER TABLE public.books
  ADD COLUMN status public.book_status NOT NULL DEFAULT 'draft',
  ADD COLUMN book_number integer;

CREATE UNIQUE INDEX books_book_number_key ON public.books (book_number) WHERE book_number IS NOT NULL;

UPDATE public.books
SET status = 'live', book_number = 1
WHERE title ILIKE '%Sheru%';