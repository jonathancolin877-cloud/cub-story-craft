import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * ILLUSTRATOR AGENT
 * Only source of illustrations. Always 1:1 square, upscaled by the client to
 * 2625x2625 (8.75in incl. 0.125in bleed @ 300 DPI). Character bible is locked.
 */

/**
 * Squares we try, largest first. The gateway currently caps squares at 1024,
 * but if a bigger square becomes available this picks it up automatically.
 */
const SQUARE_CANDIDATES = [2048, 1536, 1024] as const;


export const SHERU_CHARACTER_BIBLE =
  "Cute baby tiger cub Sheru, orange with black stripes, white belly, pink nose, small rounded ears, big amber eyes, same proportions every page, Pixar storybook 2D, soft colors, lush Indian jungle background, no text in image";

const Input = z.object({
  scene: z.string().min(3),
  characterBible: z.string().optional(),
  characterSheet: z.string().optional(),
});

function apiKey() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("Missing LOVABLE_API_KEY");
  return k;
}

export const illustratorAgent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const prompt = [
      data.characterBible ?? SHERU_CHARACTER_BIBLE,
      `Scene: ${data.scene}.`,
      data.characterSheet ? `Character sheet: ${data.characterSheet}.` : "",
      "square 1:1 composition, full square frame, nothing important within 0.5 inch of the edges (0.125 inch bleed safe), kids book illustration, soft colors, Pixar storybook 2D, no text in image",
    ]
      .filter(Boolean)
      .join(" ");

    let lastError = "Illustration request failed";
    for (const px of SQUARE_CANDIDATES) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-image-1-mini",
          prompt,
          quality: "high",
          size: `${px}x${px}`,
          n: 1,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.message ?? body?.error?.message ?? "Illustration request failed";
        if (res.status === 402) throw new Error(`${msg} (AI credits needed)`);
        if (res.status === 429)
          throw new Error("AI is rate limited right now. Try again shortly.");
        // A rejected size is the only case we retry smaller on.
        if (res.status === 400 && /size/i.test(String(msg))) {
          console.warn(`[illustrator] gateway rejected ${px}x${px}: ${msg}`);
          lastError = msg;
          continue;
        }
        throw new Error(msg);
      }

      const json = await res.json();
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error("No image returned");
      console.info(`[illustrator] generated ${px}x${px} quality=high`);
      return { image: `data:image/png;base64,${b64}`, aspect: "1:1" as const, sourcePx: px };
    }
    throw new Error(lastError);

  });
