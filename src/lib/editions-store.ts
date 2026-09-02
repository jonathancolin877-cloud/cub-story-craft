import { supabase } from "@/integrations/supabase/client";
import type { Book } from "@/lib/book-types";
import { localeDef, type BookEdition, type Direction, type EditionPage, type ScriptKey } from "@/lib/locales";

type Row = {
  id: string;
  book_id: string;
  locale: string;
  language_label: string;
  direction: string;
  script: string;
  title: string;
  blurb: string;
  affirmation: string;
  pages: unknown;
  review_status: string;
  exported_at: string | null;
  updated_at: string;
};

function toEdition(row: Row): BookEdition {
  return {
    id: row.id,
    bookId: row.book_id,
    locale: row.locale,
    languageLabel: row.language_label || localeDef(row.locale).label,
    direction: (row.direction as Direction) ?? "ltr",
    script: (row.script as ScriptKey) ?? "latin",
    title: row.title,
    blurb: row.blurb,
    affirmation: row.affirmation,
    pages: ((row.pages ?? []) as EditionPage[]).map((p) => ({
      page: Number(p.page),
      text: p.text ?? "",
      fact: p.fact ?? "",
    })),
    reviewStatus: row.review_status === "reviewed" ? "reviewed" : "unreviewed",
    exportedAt: row.exported_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchEditions(bookId: string): Promise<BookEdition[]> {
  const { data, error } = await supabase
    .from("book_editions")
    .select("*")
    .eq("book_id", bookId)
    .order("locale");
  if (error || !data) return [];
  return (data as unknown as Row[]).map(toEdition);
}

/** Create an edition row for a locale, seeded from the master book's English text. */
export async function createEdition(
  bookId: string,
  book: Book,
  locale: string,
): Promise<BookEdition> {
  const def = localeDef(locale);
  const seedFromMaster = locale === "en";
  const payload = {
    book_id: bookId,
    locale,
    language_label: def.label,
    direction: def.direction,
    script: def.script,
    title: seedFromMaster ? book.title : "",
    blurb: seedFromMaster ? book.blurb : "",
    affirmation: seedFromMaster ? (book.affirmationEn ?? "") : "",
    pages: book.pages.map((p) => ({
      page: p.page,
      text: seedFromMaster ? p.en : "",
      fact: seedFromMaster ? p.fact : "",
    })),
    review_status: seedFromMaster ? "reviewed" : "unreviewed",
  };
  const { data, error } = await supabase
    .from("book_editions")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toEdition(data as unknown as Row);
}

export async function saveEdition(edition: BookEdition) {
  const { error } = await supabase
    .from("book_editions")
    .update({
      title: edition.title,
      blurb: edition.blurb,
      affirmation: edition.affirmation,
      pages: edition.pages as never,
      review_status: edition.reviewStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", edition.id);
  if (error) throw new Error(error.message);
}

export async function markEditionExported(id: string, info: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("book_editions")
    .update({ exported_at: now, last_export: info as never, updated_at: now })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setEditionReviewed(id: string, reviewed: boolean) {
  const { error } = await supabase
    .from("book_editions")
    .update({
      review_status: reviewed ? "reviewed" : "unreviewed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteEdition(id: string) {
  const { error } = await supabase.from("book_editions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
