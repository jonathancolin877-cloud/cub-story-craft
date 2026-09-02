import { PRINT_SPEC, type Book } from "@/lib/book-types";
import { localeDef, type BookEdition, type Direction, type ScriptKey } from "@/lib/locales";
import { supabase } from "@/integrations/supabase/client";
import { buildPrintPdf, buildWraparoundCover } from "./print.functions";

/**
 * LAYOUT AGENT (client half)
 * Prepares print assets - every illustration upscaled to a 2625x2625 square
 * JPEG (8.75in incl. 0.125in bleed @ 300 DPI) - uploads them to private
 * storage, then asks the server print agent to emit the real PDF for ONE
 * edition (one language per file).
 */
export type PrintFile = {
  filename: string;
  path: string;
  url: string;
  bytes: number;
  pageCount: number;
  save: () => void;
};

export const SERIES_LINE = "Little Zoologists";
export const BOOK_AUTHOR = "Nathan Col";
/** Legal publisher - copyright/imprint line only, never marketing or covers. */
export const PUBLISHER = "Mawil";

/** "Did you know?" per locale - the fact-box label, not the fact itself. */
const FACT_LABEL: Record<string, string> = {
  en: "Did you know?",
  hi: "क्या आप जानते हैं?",
  ar: "هل تعلم؟",
  es: "¿Sabías que?",
  fr: "Le savais-tu ?",
  de: "Wusstest du?",
  pt: "Você sabia?",
};

export type LayoutResult = {
  interior: PrintFile;
  cover: PrintFile;
  /** Single-sheet KDP wraparound: back + spine + front, 17.304in x 8.75in. */
  wraparound: PrintFile;
  /** Kept for callers that still want a single "the PDF" handle (the interior). */
  path: string;
  locale: string;
  direction: Direction;
  script: ScriptKey;
  meta: {
    pageSizeIn: number;
    trimIn: number;
    bleedIn: number;
    safeMarginIn: number;
    imagePx: number;
    trueSourcePx: number;
    coverNativePx: number;
    interiorImageIn: number;
  };
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";

/** True generated pixel size of an illustration, before any upscale. */
let smallestTrueSourcePx = Infinity;
/** True native pixel size of the cover art (uploaded without upscaling). */
let coverNativePx = 0;

/**
 * Encode a 1:1 illustration as JPEG.
 * `px = 0` keeps the NATIVE generated size (used for the cover panel, which is
 * drawn at nativePx/300 inches so it is a true 300 DPI placement).
 */
async function printJpeg(
  src: string,
  px: number = PRINT_SPEC.printPx,
): Promise<{ blob: Blob; px: number } | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const nativePx = Math.min(img.naturalWidth, img.naturalHeight);
  smallestTrueSourcePx = Math.min(smallestTrueSourcePx, nativePx);
  const out = px || nativePx;
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out, out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, out, out); // source is square - pure upscale, never a crop
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", px ? 0.9 : 0.92),
  );
  return blob ? { blob, px: out } : null;
}

/** Fall back to the master book's English text when an edition is missing. */
export function editionFromBook(book: Book): BookEdition {
  return {
    id: "local-en",
    bookId: "",
    locale: "en",
    languageLabel: "English",
    direction: "ltr",
    script: "latin",
    title: book.title,
    blurb: book.blurb,
    affirmation: book.affirmationEn ?? "",
    pages: book.pages.map((p) => ({ page: p.page, text: p.en, fact: p.fact })),
    reviewStatus: "reviewed",
    exportedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function layoutAgent(
  book: Book,
  edition: BookEdition,
  onProgress?: (done: number, total: number) => void,
): Promise<LayoutResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Sign in to build the print-ready PDF");

  const def = localeDef(edition.locale);
  const direction = edition.direction ?? def.direction;
  const script = edition.script ?? def.script;

  smallestTrueSourcePx = Infinity;
  coverNativePx = 0;
  const jobId = `${slug(book.title)}-${edition.locale}-${Date.now()}`;
  const bucket = supabase.storage.from("print-assets");
  const total = book.pages.length + 1;
  let done = 0;

  const upload = async (src: string | undefined, name: string, px: number = PRINT_SPEC.printPx) => {
    done++;
    onProgress?.(done, total);
    if (!src) return undefined;
    const encoded = await printJpeg(src, px);
    if (!encoded) return undefined;
    const path = `${uid}/${jobId}/${name}.jpg`;
    const { error } = await bucket.upload(path, encoded.blob, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return { path, px: encoded.px };
  };

  // Cover ships at its NATIVE generated size (no upscale) so the panel layout
  // can place it at exactly nativePx / 300 inches = true 300 DPI.
  const coverUp = await upload(book.coverImage, "cover", 0);
  const coverPath = coverUp?.path;
  coverNativePx = coverUp?.px ?? 0;

  const textFor = (pageNo: number) => edition.pages.find((p) => p.page === pageNo);
  const pages: { page: number; text: string; fact: string; path?: string }[] = [];
  for (const p of book.pages) {
    const up = await upload(p.image, `p${String(p.page).padStart(2, "0")}`);
    const t = textFor(p.page);
    pages.push({
      page: p.page,
      text: t?.text ?? p.en,
      fact: t?.fact ?? p.fact,
      ...(up ? { path: up.path } : {}),
    });
  }

  const trueSourcePx = Number.isFinite(smallestTrueSourcePx) ? smallestTrueSourcePx : 0;
  const localeArgs = {
    locale: edition.locale,
    direction,
    script,
    seriesLine: SERIES_LINE,
    author: BOOK_AUTHOR,
    publisher: PUBLISHER,
  };

  const result = await buildPrintPdf({
    data: {
      jobId,
      ...localeArgs,
      factLabel: FACT_LABEL[edition.locale] ?? "Did you know?",
      title: edition.title || book.title,
      ...(coverPath ? { coverPath } : {}),
      trueSourcePx,
      coverNativePx,
      pages,
    },
  });

  const base = `${slug(book.title)}-${edition.locale}`;
  const file = (
    part: { path: string; url: string; bytes: number; pageCount: number },
    filename: string,
  ) => ({
    ...part,
    filename,
    save: () => {
      const a = document.createElement("a");
      a.href = part.url;
      a.download = filename;
      a.rel = "noopener";
      a.click();
    },
  });

  const wrap = await buildWraparoundCover({
    data: {
      jobId,
      ...localeArgs,
      title: edition.title || book.title,
      coverPath: coverPath ?? "",
      coverNativePx,
      blurb: edition.blurb,
      affirmation: edition.affirmation,
    },
  });

  const interior = result.interior!;
  return {
    interior: file(interior, `${base}-kdp-interior-8.5x8.5.pdf`),
    cover: file(result.cover, `${base}-kdp-cover-8.5x8.5.pdf`),
    wraparound: file(wrap, `${base}-kdp-cover-wraparound-17.304x8.75.pdf`),
    path: interior.path,
    locale: edition.locale,
    direction,
    script,
    meta: {
      pageSizeIn: PRINT_SPEC.trimIn + PRINT_SPEC.bleedIn * 2,
      trimIn: PRINT_SPEC.trimIn,
      bleedIn: PRINT_SPEC.bleedIn,
      safeMarginIn: PRINT_SPEC.safeMarginIn,
      imagePx: PRINT_SPEC.printPx,
      trueSourcePx,
      coverNativePx,
      interiorImageIn: result.interiorImageIn,
    },
  };
}

/**
 * Rebuild ONLY the cover PDF (native-resolution panel layout) into an existing
 * job folder. The interior PDF in that folder is never read or rewritten.
 */
export async function rebuildCover(book: Book, jobId: string, edition: BookEdition) {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Sign in to build the print-ready PDF");
  if (!book.coverImage) throw new Error("This book has no cover illustration");

  const encoded = await printJpeg(book.coverImage, 0);
  if (!encoded) throw new Error("Could not encode the cover illustration");
  const coverPath = `${uid}/${jobId}/cover-native.jpg`;
  const { error } = await supabase.storage
    .from("print-assets")
    .upload(coverPath, encoded.blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const def = localeDef(edition.locale);
  const result = await buildPrintPdf({
    data: {
      jobId,
      locale: edition.locale,
      direction: edition.direction ?? def.direction,
      script: edition.script ?? def.script,
      seriesLine: SERIES_LINE,
      author: BOOK_AUTHOR,
      publisher: PUBLISHER,
      factLabel: FACT_LABEL[edition.locale] ?? "Did you know?",
      title: edition.title || book.title,
      coverPath,
      coverNativePx: encoded.px,
      coverOnly: true,
      pages: [{ page: 1, text: "", fact: "" }],
    },
  });
  return { cover: result.cover, coverNativePx: encoded.px };
}
