import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchLibrary } from "@/lib/book-store";
import { rebuildCover } from "@/lib/agents/layout-agent";
import { validatePrintPdf } from "@/lib/agents/print.functions";

export const Route = createFileRoute("/dev-cover")({
  component: DevCover,
  head: () => ({
    meta: [
      { title: "Cover rebuild runner" },
      { name: "description", content: "Internal runner for rebuilding the cover PDF." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const JOB = "sheru-finds-his-courage-1788263056720";
const INTERIOR = `47a52e36-566b-4eaf-91c0-c3231ca7b906/${JOB}/book-kdp-interior-8.5x8.5.pdf`;

function DevCover() {
  const [out, setOut] = useState("running...");
  useEffect(() => {
    (async () => {
      try {
        const lib = await fetchLibrary();
        const entry = lib.find((e) => e.book.bookNumber === 1) ?? lib[0];
        if (!entry) throw new Error("no book");
        const { cover, coverNativePx } = await rebuildCover(entry.book, JOB);
        const report = await validatePrintPdf({
          data: { path: INTERIOR, coverPath: cover.path, trueSourcePx: 1024, coverNativePx },
        });
        setOut(JSON.stringify({ cover, coverNativePx, report }, null, 2));
      } catch (e) {
        setOut(`ERROR: ${(e as Error).message}`);
      }
    })();
  }, []);
  return <pre id="out">{out}</pre>;
}
