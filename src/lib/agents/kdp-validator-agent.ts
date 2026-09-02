import type { Book } from "@/lib/book-types";
import type { BookEdition } from "@/lib/locales";
import { layoutAgent, type LayoutResult } from "./layout-agent";
import { validatePrintPdf, type KdpCheck, type KdpReport } from "./print.functions";

/**
 * KDP VALIDATOR AGENT (thin client) - per edition.
 * The real validation runs server-side against the emitted PDF bytes:
 * embedded font programs, true vs upscaled image resolution,
 * trim/bleed boxes, page count, locale and reading direction.
 */
export type { KdpCheck, KdpReport };

export async function kdpValidatorAgent(
  book: Book,
  edition: BookEdition,
  layout?: LayoutResult,
): Promise<KdpReport> {
  const result = layout ?? (await layoutAgent(book, edition));
  return await validatePrintPdf({
    data: {
      path: result.interior.path,
      coverPath: result.cover.path,
      trueSourcePx: result.meta.trueSourcePx,
      coverNativePx: result.meta.coverNativePx,
      locale: result.locale,
      direction: result.direction,
      script: result.script,
    },
  });
}
