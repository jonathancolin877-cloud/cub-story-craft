import { supabase } from "@/integrations/supabase/client";
import type { Book, BookPage, Region } from "@/lib/book-types";

type ImagesJson = { cover?: string; pages?: (string | null)[] };

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

export async function fetchLastBook(): Promise<{ id: string; book: Book } | null> {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const meta = (data.meta ?? {}) as Record<string, string>;
  const images = (data.images ?? {}) as ImagesJson;
  const rawPages = (data.pages ?? []) as BookPage[];

  const book: Book = {
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
  return { id: data.id as string, book };
}
