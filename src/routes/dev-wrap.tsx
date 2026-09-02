import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { buildWraparoundCover, validateWraparoundPdf } from "@/lib/agents/print.functions";

export const Route = createFileRoute("/dev-wrap")({
  component: DevWrap,
  head: () => ({
    meta: [
      { title: "Wraparound cover build - internal tool" },
      { name: "description", content: "Internal tool to emit the KDP wraparound cover PDF." },
      { property: "og:title", content: "Wraparound cover build - internal tool" },
      { property: "og:description", content: "Internal tool to emit the KDP wraparound cover PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const JOB_ID = "sheru-finds-his-courage-1788263056720";
const UID = "47a52e36-566b-4eaf-91c0-c3231ca7b906";

function DevWrap() {
  const build = useServerFn(buildWraparoundCover);
  const validate = useServerFn(validateWraparoundPdf);
  const [out, setOut] = useState("");

  const run = async () => {
    setOut("running...");
    try {
      const res = await build({
        data: {
          jobId: JOB_ID,
          title: "Sheru Finds His Courage",
          titleTranslated: "शेरू की बहादुरी",
          coverPath: `${UID}/${JOB_ID}/cover-native.jpg`,
          coverNativePx: 1024,
          blurbEn:
            "Join Sheru the little tiger cub as he faces his fear and learns that being brave means trying your best!",
          blurbHi:
            "नन्हे बाघ शेरू के साथ चलिए, जो अपने डर का सामना करता है और सीखता है कि बहादुर होने का मतलब है पूरी कोशिश करना!",
          affirmationEn: "I am brave like Sheru",
          affirmationHi: "मैं शेरू की तरह बहादुर हूँ",
          seriesLine: "Little Zoologists",
        },
      });
      const report = await validate({ data: { path: res.path, coverNativePx: 1024 } });
      setOut(JSON.stringify({ res, report }, null, 2));
    } catch (e) {
      setOut(`ERROR: ${(e as Error).message}`);
    }
  };

  return (
    <main className="p-8">
      <h1 className="text-xl font-bold">Wraparound cover build</h1>
      <button onClick={run} className="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground">
        Build wraparound
      </button>
      <pre id="out" className="mt-6 whitespace-pre-wrap text-xs">
        {out}
      </pre>
    </main>
  );
}
