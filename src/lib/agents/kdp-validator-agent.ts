import type { Book } from "@/lib/book-types";
import { layoutAgent, type LayoutResult } from "./layout-agent";
import { validatePrintPdf, type KdpCheck, type KdpReport } from "./print.functions";

/**
 * KDP VALIDATOR AGENT (thin client)
 * The real validation runs server-side against the emitted PDF bytes:
 * PDF/X-1a output intent, embedded font programs, 2625px images,
 * trim/bleed boxes and page count.
 */
export type { KdpCheck, KdpReport };

export async function kdpValidatorAgent(book: Book, layout?: LayoutResult): Promise<KdpReport> {
  const result = layout ?? (await layoutAgent(book));
  return await validatePrintPdf({ data: { path: result.path } });
}
