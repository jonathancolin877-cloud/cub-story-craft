import { jsPDF } from "jspdf";
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


const SCRIPT_FONT = '600 %dpx "Noto Sans Devanagari","Noto Sans Arabic",Nunito,sans-serif';

/** Browsers shape complex scripts (Devanagari matras, Arabic joining) correctly,
 *  PDF core fonts do not - so render the line on a canvas and embed it as an image. */
async function scriptLineImage(
  text: string,
  opts: { fontPx: number; maxWidthPx: number; color: string },
) {
  try {
    await document.fonts.load(SCRIPT_FONT.replace("%d", String(opts.fontPx)), text);
    await document.fonts.ready;
  } catch {
    /* fonts may already be resolved */
  }
  const scale = 3;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  const font = SCRIPT_FONT.replace("%d", String(opts.fontPx * scale));
  measure.font = font;
  const maxW = opts.maxWidthPx * scale;

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure.measureText(candidate).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = candidate;
  }
  if (line) lines.push(line);
  if (!lines.length) return null;

  const lineH = opts.fontPx * scale * 1.45;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(Math.min(maxW, Math.max(...lines.map((l) => measure.measureText(l).width))) + 8);
  canvas.height = Math.ceil(lineH * lines.length + 8);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  ctx.fillStyle = opts.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, lineH * (i + 0.5) + 4));
  return {
    dataUrl: canvas.toDataURL("image/png"),
    wIn: canvas.width / (96 * scale),
    hIn: canvas.height / (96 * scale),
  };
}

/** 8.5 x 8.5 inch square book, cover + 24 pages, Amazon KDP ready. */
export async function exportPdf(book: Book) {
  const S = 8.5;
  const doc = new jsPDF({ unit: "in", format: [S, S] });

  const drawImage = (img: string | undefined, x: number, y: number, w: number, h: number) => {
    if (img) {
      try {
        doc.addImage(img, "PNG", x, y, w, h);
        return;
      } catch {
        /* fall through to placeholder */
      }
    }
    doc.setFillColor(238, 242, 230);
    doc.rect(x, y, w, h, "F");
  };

  // Cover
  drawImage(book.coverImage, 0, 0, S, S);
  doc.setFillColor(255, 255, 255);
  doc.rect(0, S - 2.1, S, 2.1, "F");
  doc.setTextColor(23, 74, 45);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(doc.splitTextToSize(book.title, S - 1), S / 2, S - 1.35, { align: "center" });
  const coverHindi = await scriptLineImage(book.titleTranslated, {
    fontPx: 20,
    maxWidthPx: (S - 1) * 96,
    color: "#174a2d",
  });
  if (coverHindi) {
    doc.addImage(coverHindi.dataUrl, "PNG", (S - coverHindi.wIn) / 2, S - 1.15, coverHindi.wIn, coverHindi.hIn);
  }
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Mawil Kids Global Factory - Little Zoologists of the World", S / 2, S - 0.45, {
    align: "center",
  });

  for (const p of book.pages) {
    doc.addPage([S, S], "portrait");
    drawImage(p.image, 0.5, 0.5, S - 1, 4.6);
    doc.setTextColor(23, 74, 45);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(doc.splitTextToSize(p.en, S - 1.4), S / 2, 5.6, { align: "center" });
    const hindi = await scriptLineImage(p.translated, {
      fontPx: 15,
      maxWidthPx: (S - 1.4) * 96,
      color: "#7a5a14",
    });
    if (hindi) {
      doc.addImage(hindi.dataUrl, "PNG", (S - hindi.wIn) / 2, 5.85, hindi.wIn, hindi.hIn);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(120, 90, 20);
      doc.text(p.translated, S / 2, 6.15, { align: "center" });
    }
    doc.setDrawColor(210, 226, 200);
    doc.setFillColor(244, 250, 238);
    doc.roundedRect(0.7, 6.5, S - 1.4, 1.2, 0.12, 0.12, "FD");
    doc.setTextColor(40, 80, 55);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(`Did you know? ${p.fact}`, S - 1.8), 0.9, 6.95);
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(String(p.page), S / 2, S - 0.3, { align: "center" });
  }

  doc.save(`${slug(book.title)}-kdp-8.5x8.5.pdf`);
}

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
