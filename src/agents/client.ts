/**
 * Thin client for the three production agents.
 * illustrator + print/kdp-validator run server-side (edge runtime); the layout
 * agent only prepares 2625px print assets in the browser and calls the server
 * print agent, which emits the real PDF/X-1a file with embedded fonts.
 */
import { illustratorAgent } from "@/lib/agents/illustrator.functions";
import { layoutAgent, type LayoutResult } from "@/lib/agents/layout-agent";
import { kdpValidatorAgent, type KdpReport } from "@/lib/agents/kdp-validator-agent";
import type { Book } from "@/lib/book-types";

export const agents = {
  illustrate: (input: {
    scene: string;
    characterBible?: string;
    characterSheet?: string;
    bookId?: string;
  }) => illustratorAgent({ data: input }),
  layout: (book: Book, onProgress?: (done: number, total: number) => void) =>
    layoutAgent(book, onProgress),
  validate: (book: Book, layout?: LayoutResult): Promise<KdpReport> =>
    kdpValidatorAgent(book, layout),
  /** Build the KDP PDF only if the server validator passes; otherwise return the report. */
  async exportIfValid(book: Book, onProgress?: (done: number, total: number) => void) {
    const layout = await layoutAgent(book, onProgress);
    const report = await kdpValidatorAgent(book, layout);
    if (report.blocksPublish) return { exported: false as const, report, layout };
    layout.interior.save();
    layout.cover.save();
    return { exported: true as const, report, layout };
  },
};

export type { KdpReport, LayoutResult };
