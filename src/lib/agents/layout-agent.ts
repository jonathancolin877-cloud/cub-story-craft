import { PRINT_SPEC, type Book } from "@/lib/book-types";
import { supabase } from "@/integrations/supabase/client";
import { buildPrintPdf } from "./print.functions";

/**
 * LAYOUT AGENT (client half)
 * Prepares print assets - every illustration upscaled to a 2625x2625 square
 * JPEG (8.75in incl. 0.125in bleed @ 300 DPI) - uploads them to private
 * storage, then asks the server print agent to emit the real PDF/X-1a file.
 */
export type PrintFile = {
  filename: string;
  path: string;
  url: string;
  bytes: number;
  pageCount: number;
  save: () => void;
};

export type LayoutResult = {
  interior: PrintFile;
  cover: PrintFile;
  /** Kept for callers that still want a single "the PDF" handle (the interior). */
  path: string;
  meta: {
    pageSizeIn: number;
    trimIn: number;
    bleedIn: number;
    safeMarginIn: number;
    imagePx: number;
    trueSourcePx: number;
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



export async function layoutAgent(
  book: Book,
  onProgress?: (done: number, total: number) => void,
): Promise<LayoutResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Sign in to build the print-ready PDF");

  smallestTrueSourcePx = Infinity;
  coverNativePx = 0;
  const jobId = `${slug(book.title)}-${Date.now()}`;
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
  const pages: { page: number; en: string; translated: string; fact: string; path?: string }[] = [];
  for (const p of book.pages) {
    const up = await upload(p.image, `p${String(p.page).padStart(2, "0")}`);
    pages.push({
      page: p.page,
      en: p.en,
      translated: p.translated,
      fact: p.fact,
      ...(up ? { path: up.path } : {}),
    });
  }

  const trueSourcePx = Number.isFinite(smallestTrueSourcePx) ? smallestTrueSourcePx : 0;

  const result = await buildPrintPdf({
    data: {
      jobId,
      title: book.title,
      titleTranslated: book.titleTranslated,
      ...(coverPath ? { coverPath } : {}),
      trueSourcePx,
      coverNativePx,
      pages,
    },
  });


  const base = slug(book.title);
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

  return {
    interior: file(result.interior, `${base}-kdp-interior-8.5x8.5.pdf`),
    cover: file(result.cover, `${base}-kdp-cover-8.5x8.5.pdf`),
    path: result.interior.path,
    meta: {
      pageSizeIn: PRINT_SPEC.trimIn + PRINT_SPEC.bleedIn * 2,
      trimIn: PRINT_SPEC.trimIn,
      bleedIn: PRINT_SPEC.bleedIn,
      safeMarginIn: PRINT_SPEC.safeMarginIn,
      imagePx: PRINT_SPEC.printPx,
      trueSourcePx,
    },
  };
}

