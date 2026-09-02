CREATE TABLE public.book_editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  locale text NOT NULL,
  language_label text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr','rtl')),
  script text NOT NULL DEFAULT 'latin',
  title text NOT NULL DEFAULT '',
  blurb text NOT NULL DEFAULT '',
  affirmation text NOT NULL DEFAULT '',
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','reviewed')),
  exported_at timestamptz,
  last_export jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, locale)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_editions TO authenticated;
GRANT ALL ON public.book_editions TO service_role;

ALTER TABLE public.book_editions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their book editions"
ON public.book_editions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_editions.book_id AND b.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_editions.book_id AND b.user_id = auth.uid()));

CREATE INDEX book_editions_book_id_idx ON public.book_editions(book_id);

-- ---- Migrate Book 1 (and any other existing book) into en + native editions ----
INSERT INTO public.book_editions (book_id, locale, language_label, direction, script, title, blurb, affirmation, pages, review_status)
SELECT
  b.id,
  'en',
  'English',
  'ltr',
  'latin',
  COALESCE(b.title, ''),
  COALESCE(b.meta::jsonb->>'blurb',''),
  COALESCE(b.meta::jsonb->>'affirmationEn',''),
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('page', p->'page', 'text', COALESCE(p->>'en',''), 'fact', COALESCE(p->>'fact','')) ORDER BY (p->>'page')::int)
    FROM jsonb_array_elements(b.pages::jsonb) p
  ), '[]'::jsonb),
  'reviewed'
FROM public.books b
ON CONFLICT (book_id, locale) DO NOTHING;

INSERT INTO public.book_editions (book_id, locale, language_label, direction, script, title, blurb, affirmation, pages, review_status)
SELECT
  b.id,
  'hi',
  'Hindi',
  'ltr',
  'devanagari',
  COALESCE(NULLIF(b.meta::jsonb->>'titleTranslated',''), COALESCE(b.title,'')),
  COALESCE(b.meta::jsonb->>'blurbTranslated',''),
  COALESCE(b.meta::jsonb->>'affirmationTranslated',''),
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('page', p->'page', 'text', COALESCE(p->>'translated',''), 'fact', COALESCE(p->>'fact','')) ORDER BY (p->>'page')::int)
    FROM jsonb_array_elements(b.pages::jsonb) p
  ), '[]'::jsonb),
  'unreviewed'
FROM public.books b
WHERE COALESCE(b.meta::jsonb->>'secondLanguage','') = 'Hindi'
ON CONFLICT (book_id, locale) DO NOTHING;