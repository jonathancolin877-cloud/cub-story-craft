import type { Book } from "@/lib/book-types";
import { layoutAgent, type LayoutResult } from "./layout-agent";
import { validatePrintPdf, type KdpCheck, type KdpReport } from "./print.functions";

/**
 * KDP VALIDATOR AGENT (thin client)
 * The real validation runs server-side against the emitted PDF bytes:
 * embedded font programs, true vs upscaled image resolution,
 * trim/bleed boxes and page count.
 */
export type { KdpCheck, KdpReport };

export async function kdpValidatorAgent(book: Book, layout?: LayoutResult): Promise<KdpReport> {
  const result = layout ?? (await layoutAgent(book));
  return await validatePrintPdf({
    data: {
      path: result.interior.path,
      coverPath: result.cover.path,
      trueSourcePx: result.meta.trueSourcePx,
    },
  });
}
