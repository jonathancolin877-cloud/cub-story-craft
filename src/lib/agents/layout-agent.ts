import { PRINT_SPEC, type Book } from "@/lib/book-types";
import { buildKdpPdf } from "@/lib/exports";

/**
 * LAYOUT AGENT
 * Builds the print-ready interior: 8.5x8.5in trim + 0.125in bleed (8.75in page),
 * 0.5in safe margin, bilingual EN + HI text, illustrations sourced at
 * 2625x2625 square (300 DPI).
 */
export type LayoutResult = {
  filename: string;
  meta: {
    pageCount: number;
    pageSizeIn: number;
    trimIn: number;
    bleedIn: number;
    safeMarginIn: number;
    imagePx: number;
  };
  save: () => void;
  dataUri: () => string;
};

export async function layoutAgent(book: Book): Promise<LayoutResult> {
  const { doc, filename, meta } = await buildKdpPdf(book);
  return {
    filename,
    meta: { ...meta, imagePx: PRINT_SPEC.printPx },
    save: () => doc.save(filename),
    dataUri: () => doc.output("datauristring"),
  };
}
