import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * CHARACTER SHEET AGENT
 * Generates ONE canonical turnaround reference image per book. Every page
 * illustration is then produced image-to-image from this sheet, so the
 * character is reference-locked rather than held by prompt text alone.
 */

const ART_BUCKET = "book-art";

const Input = z.object({
  bookId: z.string().min(1),
  characterBible: z.string().min(3),
  /** Book-specific look notes (markings, accessory, expression) - drawn onto the sheet. */
  characterSheet: z.string().optional(),
  characterName: z.string().optional(),
});


function apiKey() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("Missing LOVABLE_API_KEY");
  return k;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const generateCharacterSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const prompt = [
      data.characterBible,
      data.characterSheet ? `Character details (must all be visible): ${data.characterSheet}` : "",
      `Character turnaround model sheet for ${data.characterName || "the character"}:`,

      "exactly three full-body poses of the SAME character side by side in one row -",
      "front view on the left, three-quarter view in the middle, side profile on the right.",
      "Plain flat light-grey studio background, no scenery, no props, no text, no labels, no border.",
      "Even neutral lighting, identical proportions, colours and markings in all three poses.",
      "Pixar storybook 2D, soft colors, square 1:1 composition.",
    ].join(" ");

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
        size: "1024x1024",
        n: 1,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.message ?? body?.error?.message ?? "Character sheet request failed";
      if (res.status === 402) throw new Error(`${msg} (AI credits needed)`);
      if (res.status === 429) throw new Error("AI is rate limited right now. Try again shortly.");
      throw new Error(msg);
    }

    const json = await res.json();
    const b64: string | undefined = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("No character sheet image returned");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${context.userId}/${data.bookId}/character-sheet.png`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(ART_BUCKET)
      .upload(path, b64ToBytes(b64), { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(`Character sheet upload failed: ${upErr.message}`);

    const { error: dbErr } = await context.supabase
      .from("books")
      .update({ character_sheet_image: path, updated_at: new Date().toISOString() })
      .eq("id", data.bookId);
    if (dbErr) throw new Error(dbErr.message);

    return {
      path,
      image: `data:image/png;base64,${b64}`,
      mechanism: "reference-image" as const,
    };
  });
