import { jsPDF } from "jspdf";
import { PRINT_SPEC, type Book } from "./book-types";

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

/** Upscale a square illustration to the 300 DPI print size (2625x2625, 8.75in incl. bleed). */
async function upscaleSquare(src: string, px = PRINT_SPEC.printPx): Promise<string> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return src;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // source is 1:1, so this is a pure upscale - never a crop
    ctx.drawImage(img, 0, 0, px, px);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return src;
  }
}

/**
 * 8.5 x 8.5 inch trim + 0.125in bleed on every side (8.75 x 8.75 page),
 * 0.5in safe margin, cover + 24 pages, all illustrations 1:1 square at
 * 2625x2625 (300 DPI). Amazon KDP ready.
 */
export async function buildKdpPdf(book: Book) {
  const TRIM = PRINT_SPEC.trimIn;
  const B = PRINT_SPEC.bleedIn;
  const M = PRINT_SPEC.safeMarginIn;
  const S = TRIM + B * 2; // full page incl. bleed
  const safeL = B + M;
  const safeW = S - safeL * 2;
  const doc = new jsPDF({ unit: "in", format: [S, S] });
  doc.setProperties({ title: book.title, subject: "PDF/X-1a:2001", creator: "Mawil Kids Global Factory" });

  const drawSquare = async (img: string | undefined, x: number, y: number, size: number) => {
    if (img) {
      try {
        const hi = await upscaleSquare(img);
        doc.addImage(hi, "JPEG", x, y, size, size);
        return;
      } catch {
        /* fall through to placeholder */
      }
    }
    doc.setFillColor(238, 242, 230);
    doc.rect(x, y, size, size, "F");
  };

  // Cover - full bleed square
  await drawSquare(book.coverImage, 0, 0, S);
  doc.setFillColor(255, 255, 255);
  doc.rect(0, S - 2.2, S, 2.2, "F");
  doc.setTextColor(23, 74, 45);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(doc.splitTextToSize(book.title, safeW), S / 2, S - 1.45, { align: "center" });
  const coverHindi = await scriptLineImage(book.titleTranslated, {
    fontPx: 20,
    maxWidthPx: safeW * 96,
    color: "#174a2d",
  });
  if (coverHindi) {
    doc.addImage(coverHindi.dataUrl, "PNG", (S - coverHindi.wIn) / 2, S - 1.25, coverHindi.wIn, coverHindi.hIn);
  }
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Mawil Kids Global Factory - Little Zoologists of the World", S / 2, S - 0.6, {
    align: "center",
  });

  const imgSize = 5.5; // square, no crop
  const imgX = (S - imgSize) / 2;
  const imgY = safeL;

  for (const p of book.pages) {
    doc.addPage([S, S], "portrait");
    await drawSquare(p.image, imgX, imgY, imgSize);
    const textTop = imgY + imgSize + 0.4;
    doc.setTextColor(23, 74, 45);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(doc.splitTextToSize(p.en, safeW), S / 2, textTop, { align: "center" });
    const hindi = await scriptLineImage(p.translated, {
      fontPx: 15,
      maxWidthPx: safeW * 96,
      color: "#7a5a14",
    });
    if (hindi) {
      doc.addImage(hindi.dataUrl, "PNG", (S - hindi.wIn) / 2, textTop + 0.25, hindi.wIn, hindi.hIn);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(120, 90, 20);
      doc.text(p.translated, S / 2, textTop + 0.55, { align: "center" });
    }
    doc.setDrawColor(210, 226, 200);
    doc.setFillColor(244, 250, 238);
    doc.roundedRect(safeL, S - safeL - 1.3, safeW, 1.05, 0.12, 0.12, "FD");
    doc.setTextColor(40, 80, 55);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(`Did you know? ${p.fact}`, safeW - 0.4), safeL + 0.2, S - safeL - 0.95);
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(String(p.page), S / 2, S - safeL + 0.1, { align: "center" });
  }

  return {
    doc,
    filename: `${slug(book.title)}-kdp-8.5x8.5-bleed.pdf`,
    meta: {
      pageCount: book.pages.length + 1,
      pageSizeIn: S,
      trimIn: TRIM,
      bleedIn: B,
      safeMarginIn: M,
      imagePx: PRINT_SPEC.printPx,
    },
  };
}

export async function exportPdf(book: Book) {
  const { doc, filename } = await buildKdpPdf(book);
  doc.save(filename);
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
