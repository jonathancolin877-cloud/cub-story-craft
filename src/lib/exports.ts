import type { Book } from "./book-types";

function download(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");


export function exportYoutubeScript(book: Book) {
  const lines: string[] = [];
  lines.push(`YOUTUBE VOICEOVER SCRIPT (~3 minutes) - ${book.title}`);
  lines.push(`${book.titleTranslated}`);
  lines.push(`Languages: English + ${book.secondLanguage} | Value: ${book.value} | Age: ${book.age}`);
  lines.push("");
  lines.push("[0:00-0:12] HOOK - Cover on screen, warm music");
  lines.push(`EN: Meet ${book.characterName}, a little ${book.animal.toLowerCase()} with a big heart.`);
  lines.push(`${book.secondLanguage.toUpperCase()}: ${book.titleTranslated}`);
  lines.push("");
  book.pages.forEach((p, i) => {
    const start = 12 + i * 6;
    const t = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    lines.push(`[${t(start)}-${t(start + 6)}] SCENE ${p.page}`);
    lines.push(`VISUAL: ${p.scene}`);
    lines.push(`EN VO: ${p.en}`);
    lines.push(`${book.secondLanguage.toUpperCase()} VO: ${p.translated}`);
    lines.push(`FACT CARD: ${p.fact}`);
    lines.push("");
  });
  lines.push("[OUTRO] CTA");
  lines.push(`EN: Get "${book.title}" on Amazon - link in the description.`);
  lines.push(`${book.secondLanguage.toUpperCase()} CTA: Amazon par abhi order karein - link description mein.`);
  download(`${slug(book.title)}-youtube-script.txt`, lines.join("\n"));
}

export function exportReels(book: Book) {
  const picks = [book.pages[3], book.pages[11], book.pages[21]].filter(
    (p): p is (typeof book.pages)[number] => Boolean(p),
  );
  const hashtags =
    "#KidsBooks #BachonKiKahani #HindiStories #MomsOfIndia #ReadAloud #Amazonindia #KidsOfIndia #Parenting #Wildlife #BedtimeStories";
  const out: string[] = [`3 x 15-SECOND REELS - ${book.title}`, ""];
  picks.forEach((p, i) => {
    out.push(`===== REEL ${i + 1} (15s, 9:16) =====`);
    out.push(`0-3s HOOK (EN): Can a baby ${book.animal.toLowerCase()} be brave enough for this?`);
    out.push(`0-3s HOOK (${book.secondLanguage}): ${p.translated}`);
    out.push(`3-9s FACT: ${p.fact}`);
    out.push(`VISUAL: ${p.scene}`);
    out.push(`9-15s CTA (${book.secondLanguage}): Amazon par book lijiye - link bio mein.`);
    out.push(`9-15s CTA (EN): Get book on Amazon - link in bio.`);
    out.push(`CAPTION: ${p.en} | ${p.translated}`);
    out.push(`HASHTAGS: ${hashtags}`);
    out.push("");
  });
  download(`${slug(book.title)}-3-reels.txt`, out.join("\n"));
}
