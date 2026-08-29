import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GenerateInput = z.object({
  region: z.string(),
  animal: z.string(),
  age: z.string(),
  secondLanguage: z.string(),
  value: z.string(),
  characterName: z.string().optional(),
});

const ImageInput = z.object({ prompt: z.string().min(4) });

function key() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("Missing LOVABLE_API_KEY");
  return k;
}

async function gatewayError(res: Response) {
  const body = await res.json().catch(() => null);
  const msg = body?.message ?? body?.error?.message ?? "AI request failed";
  if (res.status === 402) return `${msg} (AI credits needed)`;
  if (res.status === 429) return "AI is rate limited right now. Please try again in a moment.";
  return msg;
}

export const generateBook = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => GenerateInput.parse(d))
  .handler(async ({ data }) => {
    const prompt = `You are a children's picture-book author for Mawil Kids Global Factory.
Create a complete 24-page picture book.

Region: ${data.region}
Animal: a baby ${data.animal}
Character name: ${data.characterName || "invent a warm, culturally-fitting name"}
Reader age: ${data.age}
Core value: ${data.value}
Languages: English and ${data.secondLanguage}

Story arc (strict):
- Pages 1-3: introduce the character and its home.
- Pages 4-18: the challenge - the little animal is scared to cross a forest/river and tries, fails, and keeps going.
- Pages 19-22: it learns the lesson of ${data.value}.
- Pages 23-24: the moral plus a positive affirmation the child can say out loud.

Rules:
- Each page: ONE sentence in English, max 12 words, simple words for age ${data.age}.
- "translated" MUST be an accurate, natural translation of that exact English sentence into ${data.secondLanguage}, written ONLY in the proper native script (Hindi = Devanagari देवनागरी, Arabic = Arabic script, Spanish = Latin with accents).
- NEVER transliterate into English letters, never output romanized text, never mix scripts, never output placeholder or nonsense characters.
- The ${data.secondLanguage} sentence must use simple, everyday words a ${data.age} child understands, short (max ~12 words), and must be grammatically correct with correct matras/diacritics.
- Double-check every translated line reads naturally when spoken aloud to a small child.
- "fact" is a REAL zoology fact about the ${data.animal} (one short sentence, true, kid-friendly). No repeats.
- "scene" is a visual description of the illustration for that page (no text in the image), 1-2 sentences.
- "characterSheet" is a fixed visual description of the character (colors, markings, clothing/accessory, expression) reused for every illustration for consistency.

Return ONLY JSON:
{"title":"","titleTranslated":"","characterName":"","characterSheet":"","blurb":"","coverScene":"","pages":[{"page":1,"en":"","translated":"","fact":"","scene":""}]}
Exactly 24 pages.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) throw new Error(await gatewayError(res));
    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed as {
      title: string;
      titleTranslated: string;
      characterName: string;
      characterSheet: string;
      blurb: string;
      coverScene: string;
      pages: { page: number; en: string; translated: string; fact: string; scene: string }[];
    };
  });

export const generateIllustration = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ImageInput.parse(d))
  .handler(async ({ data }) => {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-image-1-mini",
        prompt: data.prompt,
        quality: "low",
        size: "1024x1024",
        n: 1,
      }),
    });

    if (!res.ok) throw new Error(await gatewayError(res));
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned");
    return { image: `data:image/png;base64,${b64}` };
  });
