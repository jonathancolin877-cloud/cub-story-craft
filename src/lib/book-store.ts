import { supabase } from "@/integrations/supabase/client";
import type { Book, BookPage, BookStatus, Region } from "@/lib/book-types";

type ImagesJson = { cover?: string | undefined; pages?: (string | null)[] | undefined };

const ART_BUCKET = "book-art";
const SIGNED_TTL = 60 * 60 * 24 * 7; // 7 days

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head ?? "")?.[1] ?? "image/png";
  const bin = atob(b64 ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Illustrations live in private storage; the row only keeps their paths. */
async function storeArt(src: string | undefined, uid: string, folder: string, name: string) {
  if (!src) return undefined;
  if (!src.startsWith("data:")) return src.startsWith("http") ? undefined : src;
  const path = `${uid}/${folder}/${name}.png`;
  const { error } = await supabase.storage
    .from(ART_BUCKET)
    .upload(path, dataUrlToBlob(src), { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Artwork upload failed: ${error.message}`);
  return path;
}

async function split(book: Book, uid: string, folder: string) {
  const pages = book.pages.map(({ image, ...rest }) => rest);
  const cover = await storeArt(book.coverImage, uid, folder, "cover");
  const pageArt: (string | null)[] = [];
  for (const p of book.pages) {
    pageArt.push(
      (await storeArt(p.image, uid, folder, `p${String(p.page).padStart(2, "0")}`)) ?? null,
    );
  }
  const images: ImagesJson = { cover, pages: pageArt };
  return { pages, images };
}

export async function upsertBook(book: Book, id: string | null, saved = false) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Sign in to save your books.");

  const { pages, images } = await split(book, userId, id ?? `new-${Date.now()}`);
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
  const { data, error } = await supabase
    .from("books")
    .insert({ ...row, user_id: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Persist a single illustration right after it is generated: upload the PNG to
 * private storage and patch just that slot of the row's images json.
 */
export async function saveArtwork(
  bookId: string,
  dataUrl: string,
  slot: { kind: "cover" } | { kind: "page"; index: number; page: number },
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Sign in to save your books.");

  const name = slot.kind === "cover" ? "cover" : `p${String(slot.page).padStart(2, "0")}`;
  const path = await storeArt(dataUrl, uid, bookId, name);
  if (!path) return;

  const { data: row } = await supabase.from("books").select("images").eq("id", bookId).single();
  const images = ((row?.images ?? {}) as ImagesJson) || {};
  const pages = [...(images.pages ?? [])];
  if (slot.kind === "cover") images.cover = path;
  else pages[slot.index] = path;
  images.pages = pages;

  const { error } = await supabase
    .from("books")
    .update({ images, updated_at: new Date().toISOString() })
    .eq("id", bookId);
  if (error) throw new Error(error.message);
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

/** Turn stored artwork paths into temporary signed URLs the browser can render. */
async function signArt(paths: (string | null | undefined)[]) {
  const wanted = paths.filter((p): p is string => !!p && !p.startsWith("http") && !p.startsWith("data:"));
  const map = new Map<string, string>();
  if (wanted.length) {
    const { data } = await supabase.storage.from(ART_BUCKET).createSignedUrls(wanted, SIGNED_TTL);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
    }
  }
  return (p: string | null | undefined) =>
    p ? (map.get(p) ?? (p.startsWith("data:") || p.startsWith("http") ? p : undefined)) : undefined;
}

async function toBook(data: Row): Promise<Book> {
  const meta = (data.meta ?? {}) as Record<string, string>;
  const images = (data.images ?? {}) as ImagesJson;
  const rawPages = (data.pages ?? []) as BookPage[];
  const resolve = await signArt([images.cover, ...(images.pages ?? [])]);

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
    coverImage: resolve(images.cover),
    blurb: meta["blurb"] ?? "",
    pages: rawPages.map((p, i) => ({ ...p, image: resolve(images.pages?.[i]) })),
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
  return { id: data.id as string, book: await toBook(data as Row) };
}

export type LibraryEntry = { id: string; updatedAt: string; book: Book };

export async function fetchLibrary(): Promise<LibraryEntry[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];

  const entries = await Promise.all(
    data.map(async (row) => ({
      id: row.id as string,
      updatedAt: row.updated_at as string,
      book: await toBook(row as Row),
    })),
  );


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
