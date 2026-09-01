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
  bookId: z.string().optional(),
});

function apiKey() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("Missing LOVABLE_API_KEY");
  return k;
}

/** Stable FNV-1a hash -> positive 31-bit integer seed. */
function stableSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 2147483647;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read real pixel dimensions from PNG IHDR or JPEG SOFn markers. */
function imageSize(bytes: Uint8Array): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      const len = dv.getUint16(i + 2);
      const isSOF =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  }
  throw new Error("Could not decode image header to verify dimensions");
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

    const seed = data.bookId ? stableSeed(data.bookId) : undefined;
    let seedApplied = false;
    let seedError: string | null = null;
    let lastError = "Illustration request failed";

    for (const px of SQUARE_CANDIDATES) {
      // Two attempts per size: with seed (if we have one), then without.
      const attempts: boolean[] = seed !== undefined && !seedError ? [true, false] : [false];
      let sizeRejected = false;

      for (const withSeed of attempts) {
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
            ...(withSeed ? { seed } : {}),
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const msg = body?.message ?? body?.error?.message ?? "Illustration request failed";
          if (res.status === 402) throw new Error(`${msg} (AI credits needed)`);
          if (res.status === 429)
            throw new Error("AI is rate limited right now. Try again shortly.");
          if (res.status === 400 && /size/i.test(String(msg))) {
            console.warn(`[illustrator] gateway rejected ${px}x${px}: ${msg}`);
            lastError = msg;
            sizeRejected = true;
            break;
          }
          if (withSeed) {
            // Any other failure on the seeded attempt: drop the seed and retry.
            seedError = `${res.status}: ${msg}`;
            console.warn(`[illustrator] seed rejected, retrying without seed -> ${seedError}`);
            continue;
          }
          throw new Error(msg);
        }

        const json = await res.json();
        const b64 = json.data?.[0]?.b64_json;
        if (!b64) throw new Error("No image returned");
        const { width, height } = imageSize(b64ToBytes(b64));
        if (width !== height) {
          throw new Error(
            `Illustrator returned a non-square image (${width}x${height}); every page must be 1:1.`,
          );
        }
        seedApplied = withSeed;
        console.info(
          `[illustrator] generated ${width}x${height} quality=high seedApplied=${seedApplied}` +
            (seedError ? ` seedError="${seedError}"` : ""),
        );
        return {
          image: `data:image/png;base64,${b64}`,
          aspect: "1:1" as const,
          sourcePx: Math.min(width, height),
          width,
          height,
          seedApplied,
          seedError,
        };
      }
      if (!sizeRejected) break;
    }
    throw new Error(lastError);
  });
