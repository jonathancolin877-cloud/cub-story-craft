import { supabase } from "@/integrations/supabase/client";
import type { Book, BookPage, BookStatus, Region } from "@/lib/book-types";

type ImagesJson = { cover?: string | undefined; pages?: (string | null)[] | undefined };

function split(book: Book) {
  const pages = book.pages.map(({ image, ...rest }) => rest);
  const images: ImagesJson = {
    cover: book.coverImage,
    pages: book.pages.map((p) => p.image ?? null),
  };
  return { pages, images };
}

export async function upsertBook(book: Book, id: string | null, saved = false) {
  const { pages, images } = split(book);
  const row = {
    region: book.region,
    animal: book.animal,
    title: book.title,
    pages,
    images,
    meta: {
      titleTranslated: book.titleTranslated,
      characterName: book.characterName,
      characterSheet: book.characterSheet,
      value: book.value,
      age: book.age,
      secondLanguage: book.secondLanguage,
      coverScene: book.coverScene,
      blurb: book.blurb,
    },
    ...(book.status ? { status: book.status } : {}),
    ...(book.bookNumber != null ? { book_number: book.bookNumber } : {}),
    ...(saved ? { saved: true } : {}),
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase.from("books").update(row).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }
  const { data, error } = await supabase.from("books").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

type Row = {
  id: string;
  title: string | null;
  region: string;
  animal: string;
  pages: unknown;
  images: unknown;
  meta: unknown;
  status?: BookStatus | null;
  book_number?: number | null;
  updated_at: string;
};

function toBook(data: Row): Book {
  const meta = (data.meta ?? {}) as Record<string, string>;
  const images = (data.images ?? {}) as ImagesJson;
  const rawPages = (data.pages ?? []) as BookPage[];

  return {
    status: (data.status ?? "draft") as BookStatus,
    bookNumber: data.book_number ?? null,
    title: data.title ?? "",
    titleTranslated: meta["titleTranslated"] ?? "",
    characterName: meta["characterName"] ?? "",
    characterSheet: meta["characterSheet"] ?? "",
    animal: data.animal,
    region: data.region as Region,
    value: meta["value"] ?? "",
    age: meta["age"] ?? "",
    secondLanguage: meta["secondLanguage"] ?? "",
    coverScene: meta["coverScene"] ?? "",
    coverImage: images.cover ?? undefined,
    blurb: meta["blurb"] ?? "",
    pages: rawPages.map((p, i) => ({ ...p, image: images.pages?.[i] ?? undefined })),
  };
}

export async function fetchLastBook(): Promise<{ id: string; book: Book } | null> {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string, book: toBook(data as Row) };
}

export type LibraryEntry = { id: string; updatedAt: string; book: Book };

export async function fetchLibrary(): Promise<LibraryEntry[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];

  const entries = data.map((row) => ({
    id: row.id as string,
    updatedAt: row.updated_at as string,
    book: toBook(row as Row),
  }));

  const rank: Record<BookStatus, number> = { live: 0, in_production: 1, draft: 2 };
  return entries.sort((a, b) => {
    const r = rank[a.book.status ?? "draft"] - rank[b.book.status ?? "draft"];
    if (r !== 0) return r;
    const an = a.book.bookNumber ?? Number.MAX_SAFE_INTEGER;
    const bn = b.book.bookNumber ?? Number.MAX_SAFE_INTEGER;
    if (an !== bn) return an - bn;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function updateBookStatus(id: string, status: BookStatus) {
  const { error } = await supabase
    .from("books")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
