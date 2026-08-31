/**
 * Thin client for the three production agents.
 * illustrator runs server-side (Lovable Cloud runtime); layout + kdp-validator
 * run in the browser because they build and inspect the PDF document itself.
 */
import { illustratorAgent } from "@/lib/agents/illustrator.functions";
import { layoutAgent } from "@/lib/agents/layout-agent";
import { kdpValidatorAgent, type KdpReport } from "@/lib/agents/kdp-validator-agent";
import type { Book } from "@/lib/book-types";

export const agents = {
  illustrate: (input: { scene: string; characterBible?: string; characterSheet?: string }) =>
    illustratorAgent({ data: input }),
  layout: (book: Book) => layoutAgent(book),
  validate: (book: Book): Promise<KdpReport> => kdpValidatorAgent(book),
  /** Build the KDP PDF only if the validator passes; otherwise return the report. */
  async exportIfValid(book: Book) {
    const layout = await layoutAgent(book);
    const report = await kdpValidatorAgent(book, layout);
    if (report.blocksPublish) return { exported: false as const, report };
    layout.save();
    return { exported: true as const, report };
  },
};

export type { KdpReport };
