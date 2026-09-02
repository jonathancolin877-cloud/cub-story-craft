/**
 * LOCALISATION REGISTRY
 * One book = one master (scenes, illustrations, character sheet) + N
 * MONOLINGUAL editions. Each edition is a single country's language.
 * This module is client-safe: it holds no server imports.
 */

export type Direction = "ltr" | "rtl";
export type ScriptKey = "latin" | "devanagari" | "arabic";

export type LocaleDef = {
  /** BCP-47 code */
  code: string;
  /** English name */
  label: string;
  /** Name in the language itself */
  endonym: string;
  direction: Direction;
  script: ScriptKey;
  /** Primary market this edition is published into. */
  market: string;
};

export const LOCALES: Record<string, LocaleDef> = {
  en: { code: "en", label: "English", endonym: "English", direction: "ltr", script: "latin", market: "USA / UK / India" },
  hi: { code: "hi", label: "Hindi", endonym: "हिन्दी", direction: "ltr", script: "devanagari", market: "India" },
  ar: { code: "ar", label: "Arabic", endonym: "العربية", direction: "rtl", script: "arabic", market: "MENA" },
  es: { code: "es", label: "Spanish", endonym: "Español", direction: "ltr", script: "latin", market: "Spain / LatAm / USA" },
  fr: { code: "fr", label: "French", endonym: "Français", direction: "ltr", script: "latin", market: "France" },
  de: { code: "de", label: "German", endonym: "Deutsch", direction: "ltr", script: "latin", market: "Germany" },
  pt: { code: "pt", label: "Portuguese", endonym: "Português", direction: "ltr", script: "latin", market: "Brazil / Portugal" },
};

export const LOCALE_CODES = Object.keys(LOCALES);

export function localeDef(code: string): LocaleDef {
  return (
    LOCALES[code] ?? {
      code,
      label: code,
      endonym: code,
      direction: "ltr",
      script: "latin",
      market: "",
    }
  );
}

export type EditionPage = { page: number; text: string; fact: string };

export type BookEdition = {
  id: string;
  bookId: string;
  locale: string;
  languageLabel: string;
  direction: Direction;
  script: ScriptKey;
  title: string;
  blurb: string;
  affirmation: string;
  pages: EditionPage[];
  reviewStatus: "unreviewed" | "reviewed";
  exportedAt: string | null;
  updatedAt: string;
};

/* ------------------------------------------------------------------ *
 * Minimal Unicode bidirectional algorithm for a base-RTL paragraph.
 * fontkit shapes and reverses a pure-Arabic run correctly, but it
 * reverses EVERYTHING in the run - so "الصفحة 12" comes out as "21".
 * We therefore split the logical string into directional runs, shape
 * each run in its own direction and place the runs in visual order.
 * ------------------------------------------------------------------ */

const AR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const DIGIT_RE = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;

function charClass(ch: string): "L" | "R" | "N" {
  if (DIGIT_RE.test(ch) || LATIN_RE.test(ch)) return "L";
  if (AR_RE.test(ch)) return "R";
  return "N";
}

export type BidiRun = { text: string; ltr: boolean };

/**
 * Split `text` into directional runs and return them in VISUAL order
 * (left to right) for a base-RTL paragraph. Neutral characters take the
 * direction of their surroundings, falling back to the base direction.
 */
export function bidiRunsRtl(text: string): BidiRun[] {
  const chars = [...text];
  const cls = chars.map(charClass);
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== "N") continue;
    let j = i;
    while (j < cls.length && cls[j] === "N") j++;
    const before = i > 0 ? cls[i - 1] : "R";
    const after = j < cls.length ? cls[j] : "R";
    const resolved = before === after ? before! : "R";
    for (let k = i; k < j; k++) cls[k] = resolved as "L" | "R";
    i = j - 1;
  }
  const logical: BidiRun[] = [];
  chars.forEach((ch, i) => {
    const ltr = cls[i] === "L";
    const last = logical[logical.length - 1];
    if (last && last.ltr === ltr) last.text += ch;
    else logical.push({ ltr, text: ch });
  });
  return logical.reverse();
}

/** Runs in visual order for either base direction. */
export function bidiRuns(text: string, direction: Direction): BidiRun[] {
  return direction === "rtl" ? bidiRunsRtl(text) : [{ text, ltr: true }];
}
