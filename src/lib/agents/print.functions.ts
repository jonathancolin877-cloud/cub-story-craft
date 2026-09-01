import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * PRINT AGENT (server / edge runtime)
 * Emits TWO print-ready PDFs per job, the way KDP wants them:
 *  - interior: exactly the 24 story pages
 *  - cover: the cover page only
 * Both files: Latin + Devanagari fonts fully EMBEDDED (no rasterised text),
 * MediaBox/BleedBox 8.75in, TrimBox 8.5in, 0.5in safe margin.
 *
 * NOTE ON COLOUR: illustrations are DeviceRGB JPEGs. A PDF/X-1a:2001 claim
 * requires CMYK (or a matching OutputIntent), so we deliberately do NOT assert
 * PDF/X-1a. These are honest print-ready RGB PDFs; KDP converts to CMYK.
 */

const PT = 72;
const TRIM_IN = 8.5;
const BLEED_IN = 0.125;
const MARGIN_IN = 0.5;
const PAGE_IN = TRIM_IN + BLEED_IN * 2; // 8.75
const PAGE_PT = PAGE_IN * PT; // 630
const BLEED_PT = BLEED_IN * PT; // 9
const SAFE_PT = (BLEED_IN + MARGIN_IN) * PT; // 45
const SAFE_W = PAGE_PT - SAFE_PT * 2; // 540
/** Print sizing target (upscaled). */
export const REQUIRED_IMAGE_PX = 2625;
/** Interior illustrations are drawn as a 5.5in square. */
const INTERIOR_IMG_IN = 5.5;
/** Honest minimum for TRUE generated pixels before upscaling. */
export const REQUIRED_TRUE_SOURCE_PX = 2048;

const FONT_URLS = {
  latin:
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
  latinBold:
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
  // Mukta (Ek Type) shapes cleanly with fontkit; Noto Devanagari trips a
  // fontkit GPOS mark-anchor bug in this runtime.
  devanagari: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mukta/Mukta-Regular.ttf",
  // Cover-only display faces.
  poppins: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Regular.ttf",
  poppinsBold: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Bold.ttf",
  baloo: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/baloo2/Baloo2%5Bwght%5D.ttf",
} as const;


const fontCache = new Map<string, ArrayBuffer>();
async function loadFont(url: string) {
  const hit = fontCache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font download failed (${res.status})`);
  const buf = await res.arrayBuffer();
  fontCache.set(url, buf);
  return buf;
}

/** Read the pixel size of a JPEG straight from its SOF marker. */
function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: (bytes[i + 5]! << 8) | bytes[i + 6]!, w: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    i += 2 + len;
  }
  return null;
}

const PageInput = z.object({
  page: z.number(),
  en: z.string(),
  translated: z.string(),
  fact: z.string(),
  path: z.string().optional(),
});

const Input = z.object({
  jobId: z.string().min(3),
  title: z.string(),
  titleTranslated: z.string(),
  coverPath: z.string().optional(),
  /** True generated pixel size of the illustrations before any upscale. */
  trueSourcePx: z.number().optional(),
  /** True native pixel size of the cover image as uploaded (no upscale). */
  coverNativePx: z.number().optional(),
  /** Rebuild only the cover PDF, leaving any existing interior file untouched. */
  coverOnly: z.boolean().optional(),
  pages: z.array(PageInput).min(1),
});

type Rgb = [number, number, number];
const INK: Rgb = [0.09, 0.29, 0.18];
const AMBER: Rgb = [0.48, 0.35, 0.08];

export const buildPrintPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const {
      PDFDocument,
      PDFName,
      PDFString,
      PDFHexString,
      rgb,
      pushGraphicsState,
      popGraphicsState,
      beginText,
      endText,
      setFontAndSize,
      setFillingRgbColor,
      moveText,
      showText,
    } = await import("pdf-lib");
    const fontkitMod = (await import("fontkit")) as unknown as Record<string, unknown>;
    const fontkit = (fontkitMod["default"] ?? fontkitMod) as {
      create(data: Uint8Array): {
        unitsPerEm: number;
        layout(text: string): {
          glyphs: { id: number }[];
          positions: { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[];
          advanceWidth: number;
        };
      };
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const bucket = supabaseAdmin.storage.from("print-assets");
    const readImage = async (path?: string) => {
      if (!path) return null;
      const { data: blob, error } = await bucket.download(path);
      if (error || !blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    };

    const latinBytes = await loadFont(FONT_URLS.latin);
    const latinBoldBytes = await loadFont(FONT_URLS.latinBold);

    let smallestImagePx = Infinity;
    let embeddedImages = 0;

    /** One fully-configured document with the same fonts + helpers. */
    async function makeDoc(opts: { devanagariUrl?: string; display?: boolean } = {}) {
      const devaBytes = await loadFont(opts.devanagariUrl ?? FONT_URLS.devanagari);
      const shaper = fontkit.create(new Uint8Array(devaBytes));
      const emScale = (size: number) => size / shaper.unitsPerEm;
      const measureDeva = (text: string, size: number) =>
        shaper.layout(text).advanceWidth * emScale(size);
      const doc = await PDFDocument.create();
      doc.registerFontkit(
        fontkit as unknown as Parameters<(typeof doc)["registerFontkit"]>[0],
      );
      // subset: false -> the complete font program is embedded (FontFile2)
      const latin = await doc.embedFont(latinBytes, { subset: false });
      const latinBold = await doc.embedFont(latinBoldBytes, { subset: false });
      const deva = await doc.embedFont(devaBytes, { subset: false });
      const poppins = opts.display
        ? await doc.embedFont(await loadFont(FONT_URLS.poppins), { subset: false })
        : latin;
      const poppinsBold = opts.display
        ? await doc.embedFont(await loadFont(FONT_URLS.poppinsBold), { subset: false })
        : latinBold;


      // Devanagari needs full GSUB/GPOS shaping (matra reordering + mark
      // attachment), so glyphs are positioned individually instead of relying
      // on pdf-lib's simple advance-width text showing.
      const drawDeva = (
        page: ReturnType<typeof doc.addPage>,
        text: string,
        size: number,
        x: number,
        y: number,
        color: Rgb,
      ) => {
        const run = shaper.layout(text);
        const s = emScale(size);
        const key = page.node.newFontDictionary(deva.name, deva.ref);
        const ops: unknown[] = [
          pushGraphicsState(),
          beginText(),
          setFillingRgbColor(color[0], color[1], color[2]),
          setFontAndSize(key, size),
        ];
        let penX = x;
        let penY = y;
        let curX = 0;
        let curY = 0;
        run.glyphs.forEach((glyph, i) => {
          const pos = run.positions[i]!;
          const gx = penX + pos.xOffset * s;
          const gy = penY + pos.yOffset * s;
          ops.push(moveText(gx - curX, gy - curY));
          curX = gx;
          curY = gy;
          ops.push(showText(PDFHexString.of(glyph.id.toString(16).padStart(4, "0"))));
          penX += pos.xAdvance * s;
          penY += (pos.yAdvance || 0) * s;
        });
        ops.push(endText(), popGraphicsState());
        page.pushOperators(...(ops as Parameters<typeof page.pushOperators>));
      };

      const wrap = (text: string, font: typeof latin, size: number, maxW: number) => {
        const out: string[] = [];
        let line = "";
        for (const word of text.split(/\s+/).filter(Boolean)) {
          const cand = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(cand, size) > maxW && line) {
            out.push(line);
            line = word;
          } else line = cand;
        }
        if (line) out.push(line);
        return out;
      };

      const newPage = () => {
        const page = doc.addPage([PAGE_PT, PAGE_PT]);
        page.node.set(
          PDFName.of("TrimBox"),
          doc.context.obj([BLEED_PT, BLEED_PT, PAGE_PT - BLEED_PT, PAGE_PT - BLEED_PT]),
        );
        page.node.set(PDFName.of("BleedBox"), doc.context.obj([0, 0, PAGE_PT, PAGE_PT]));
        page.node.set(
          PDFName.of("ArtBox"),
          doc.context.obj([SAFE_PT, SAFE_PT, PAGE_PT - SAFE_PT, PAGE_PT - SAFE_PT]),
        );
        return page;
      };

      const drawImage = async (
        page: ReturnType<typeof newPage>,
        path: string | undefined,
        x: number,
        y: number,
        size: number,
      ) => {
        const bytes = await readImage(path);
        if (!bytes) {
          page.drawRectangle({ x, y, width: size, height: size, color: rgb(0.93, 0.95, 0.9) });
          return;
        }
        const dims = jpegSize(bytes);
        if (dims) smallestImagePx = Math.min(smallestImagePx, Math.min(dims.w, dims.h));
        const img = await doc.embedJpg(bytes);
        page.drawImage(img, { x, y, width: size, height: size });
        embeddedImages++;
      };

      const drawCentered = (
        page: ReturnType<typeof newPage>,
        lines: string[],
        font: typeof latin,
        size: number,
        top: number,
        color: Rgb,
      ) => {
        let y = top;
        for (const line of lines) {
          const w = font.widthOfTextAtSize(line, size);
          page.drawText(line, {
            x: (PAGE_PT - w) / 2,
            y,
            size,
            font,
            color: rgb(color[0], color[1], color[2]),
          });
          y -= size * 1.35;
        }
        return y;
      };

      const wrapDeva = (text: string, size: number, maxW: number) => {
        const out: string[] = [];
        let line = "";
        for (const word of text.split(/\s+/).filter(Boolean)) {
          const cand = line ? `${line} ${word}` : word;
          if (measureDeva(cand, size) > maxW && line) {
            out.push(line);
            line = word;
          } else line = cand;
        }
        if (line) out.push(line);
        return out;
      };

      const drawCenteredDeva = (
        page: ReturnType<typeof newPage>,
        text: string,
        size: number,
        top: number,
        color: Rgb,
      ) => {
        let y = top;
        for (const line of wrapDeva(text, size, SAFE_W)) {
          drawDeva(page, line, size, (PAGE_PT - measureDeva(line, size)) / 2, y, color);
          y -= size * 1.45;
        }
        return y;
      };

      const finish = async () => {
        doc.setTitle(data.title);
        doc.setAuthor("Mawil Kids Global Factory");
        doc.setCreator("Mawil Print Agent");
        doc.setProducer("Mawil Print Agent (pdf-lib)");
        const now = new Date();
        doc.setCreationDate(now);
        doc.setModificationDate(now);
        return await doc.save({ useObjectStreams: false });
      };

      return {
        doc,
        latin,
        latinBold,
        poppins,
        poppinsBold,
        newPage,
        drawImage,
        drawCentered,
        drawCenteredDeva,
        wrap,
        finish,
      };
    }

    // ---- Cover file (white panel layout, cover only) ----
    const c = await makeDoc({ devanagariUrl: FONT_URLS.baloo, display: true });
    const cover = c.newPage();
    cover.drawRectangle({ x: 0, y: 0, width: PAGE_PT, height: PAGE_PT, color: rgb(1, 1, 1) });

    // Panel drawn at exactly nativePx / 300 inches -> a true 300 DPI placement.
    const nativePx = data.coverNativePx && data.coverNativePx > 0 ? data.coverNativePx : 1024;
    const panelPt = Math.min((nativePx / 300) * PT, SAFE_W);
    const panelX = (PAGE_PT - panelPt) / 2;
    const panelY = (PAGE_PT - panelPt) / 2 - 12;
    cover.drawRectangle({
      x: panelX - 6,
      y: panelY - 6,
      width: panelPt + 12,
      height: panelPt + 12,
      color: rgb(0.988, 0.965, 0.906),
      borderColor: rgb(0.85, 0.76, 0.53),
      borderWidth: 1.2,
    });
    await c.drawImage(cover, data.coverPath, panelX, panelY, panelPt);

    const titleLines = c.wrap(data.title, c.poppinsBold, 30, SAFE_W);
    const titleTop = panelY + panelPt + 30 + (titleLines.length - 1) * 30 * 1.35;
    c.drawCentered(cover, titleLines, c.poppinsBold, 30, titleTop, INK);
    if (data.titleTranslated.trim()) {
      c.drawCenteredDeva(cover, data.titleTranslated, 20, panelY - 44, INK);
    }
    c.drawCentered(
      cover,
      ["Mawil Kids Global Factory - Little Zoologists of the World"],
      c.poppins,
      10,
      SAFE_PT + 6,
      INK,
    );
    const coverBytes = await c.finish();

    const put = async (name: string, bytes: Uint8Array) => {
      const path = `${context.userId}/${data.jobId}/${name}`;
      const up = await bucket.upload(path, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (up.error) throw new Error(`Could not store PDF: ${up.error.message}`);
      const signed = await bucket.createSignedUrl(path, 60 * 60);
      if (signed.error || !signed.data) throw new Error("Could not sign PDF url");
      return { path, url: signed.data.signedUrl, bytes: bytes.length };
    };

    // Cover-only rebuild: leaves any existing interior PDF completely untouched.
    if (data.coverOnly) {
      const only = await put("book-kdp-cover-8.5x8.5.pdf", coverBytes);
      return {
        interior: null,
        cover: { ...only, pageCount: c.doc.getPageCount() },
        embeddedImages,
        smallestImagePx: Number.isFinite(smallestImagePx) ? smallestImagePx : 0,
        trueSourcePx: data.trueSourcePx ?? 0,
      };
    }

    // ---- Interior file (story pages only, no cover) ----
    const it = await makeDoc();
    const IMG = INTERIOR_IMG_IN * PT; // 396pt square, never cropped

    for (const p of data.pages) {
      const page = it.newPage();
      await it.drawImage(page, p.path, (PAGE_PT - IMG) / 2, PAGE_PT - SAFE_PT - IMG, IMG);
      let ty = PAGE_PT - SAFE_PT - IMG - 30;
      ty = it.drawCentered(page, it.wrap(p.en, it.latinBold, 16, SAFE_W), it.latinBold, 16, ty, INK);
      if (p.translated.trim()) {
        ty = it.drawCenteredDeva(page, p.translated, 14, ty - 4, AMBER);
      }
      const factLines = it.wrap(`Did you know? ${p.fact}`, it.latin, 9.5, SAFE_W - 24);
      const boxH = factLines.length * 13 + 20;
      page.drawRectangle({
        x: SAFE_PT,
        y: SAFE_PT + 18,
        width: SAFE_W,
        height: boxH,
        color: rgb(0.957, 0.98, 0.933),
        borderColor: rgb(0.82, 0.886, 0.784),
        borderWidth: 0.8,
      });
      let fy = SAFE_PT + 18 + boxH - 16;
      for (const line of factLines) {
        page.drawText(line, {
          x: SAFE_PT + 12,
          y: fy,
          size: 9.5,
          font: it.latin,
          color: rgb(0.16, 0.31, 0.22),
        });
        fy -= 13;
      }
      const num = String(p.page);
      page.drawText(num, {
        x: (PAGE_PT - it.latin.widthOfTextAtSize(num, 9)) / 2,
        y: SAFE_PT - 2,
        size: 9,
        font: it.latin,
        color: rgb(0.6, 0.6, 0.6),
      });
    }
    const interiorBytes = await it.finish();

    void PDFString;




    const interior = await put("book-kdp-interior-8.5x8.5.pdf", interiorBytes);
    const coverFile = await put("book-kdp-cover-8.5x8.5.pdf", coverBytes);

    return {
      interior: { ...interior, pageCount: it.doc.getPageCount() },
      cover: { ...coverFile, pageCount: c.doc.getPageCount() },
      embeddedImages,
      smallestImagePx: Number.isFinite(smallestImagePx) ? smallestImagePx : 0,
      trueSourcePx: data.trueSourcePx ?? 0,
    };
  });

/** Real validator: parses the emitted PDF bytes. */
export type KdpCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  severity: "error" | "warning";
};
export type KdpReport = { pass: boolean; blocksPublish: boolean; checks: KdpCheck[] };

export const validatePrintPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        path: z.string().min(3),
        coverPath: z.string().optional(),
        trueSourcePx: z.number().optional(),
        coverNativePx: z.number().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<KdpReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const store = supabaseAdmin.storage.from("print-assets");
    const dl = await store.download(data.path);
    if (dl.error || !dl.data) throw new Error("PDF not found for validation");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const raw = new TextDecoder("latin1").decode(bytes);

    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = doc.getPages();

    let coverPages = 0;
    let coverImgPx = 0;
    if (data.coverPath) {
      const cdl = await store.download(data.coverPath);
      if (!cdl.error && cdl.data) {
        const cbytes = new Uint8Array(await cdl.data.arrayBuffer());
        const cdoc = await PDFDocument.load(cbytes, {
          updateMetadata: false,
        });
        coverPages = cdoc.getPageCount();
        const craw = new TextDecoder("latin1").decode(cbytes);
        const cw = [...craw.matchAll(/\/Subtype\s*\/Image[\s\S]{0,400}?\/Width\s+(\d+)/g)].map((m) =>
          Number(m[1]),
        );
        coverImgPx = cw.length ? Math.min(...cw) : 0;
      }
    }


    const count = (re: RegExp) => (raw.match(re) ?? []).length;
    const widths = [...raw.matchAll(/\/Subtype\s*\/Image[\s\S]{0,400}?\/Width\s+(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    const imgMin = widths.length ? Math.min(...widths) : 0;
    const trueSrc = data.trueSourcePx ?? 0;
    // Effective DPI = embedded pixels / drawn size in inches.
    const interiorDpi = imgMin ? imgMin / INTERIOR_IMG_IN : 0;
    const coverDrawnIn = Math.min(
      (data.coverNativePx || coverImgPx || 1024) / 300,
      SAFE_W / PT,
    );
    const coverDpi = coverImgPx && coverDrawnIn ? coverImgPx / coverDrawnIn : 0;

    const boxOk = pages.every((p) => {
      const media = p.getSize();
      return Math.abs(media.width - PAGE_PT) < 0.5 && Math.abs(media.height - PAGE_PT) < 0.5;
    });
    const trimBoxes = count(/\/TrimBox/g);
    const bleedBoxes = count(/\/BleedBox/g);

    const checks: KdpCheck[] = [
      {
        id: "fonts",
        label: "All fonts embedded (Latin + Devanagari)",
        pass: count(/\/FontFile2/g) >= 3 && !raw.includes("/BaseFont /Helvetica"),
        detail: `${count(/\/FontFile2/g)} embedded TrueType font program(s); no core-font references`,
        severity: "error",
      },
      {
        id: "true-source-px",
        label: `True generated illustration size >= ${REQUIRED_TRUE_SOURCE_PX}px`,
        pass: trueSrc >= REQUIRED_TRUE_SOURCE_PX,
        detail: trueSrc
          ? `Artwork was generated at ${trueSrc}x${trueSrc}px and upscaled to ${imgMin || REQUIRED_IMAGE_PX}px for print sizing. ${
              trueSrc >= REQUIRED_TRUE_SOURCE_PX
                ? "Real detail meets the 300 DPI target."
                : `Real detail is below ${REQUIRED_TRUE_SOURCE_PX}px — the ${imgMin || REQUIRED_IMAGE_PX}px in the file is upscaled, not native, so print will look soft.`
            }`
          : "No true source resolution reported for this export.",
        severity: "warning",
      },
      {
        id: "embedded-px",
        label: "Effective image resolution >= 300 DPI (as drawn)",
        pass: widths.length > 0 && interiorDpi >= 300 && (!coverImgPx || coverDpi >= 300),
        detail: widths.length
          ? `interior art ${imgMin}px drawn at ${INTERIOR_IMG_IN}in = ${Math.round(interiorDpi)} DPI (upscaled from ${trueSrc || "unknown"}px); ` +
            (coverImgPx
              ? `cover art ${coverImgPx}px drawn at ${coverDrawnIn.toFixed(2)}in = ${Math.round(coverDpi)} DPI (native, not upscaled)`
              : "cover file not checked")
          : "No images embedded",
        severity: "error",
      },

      {
        id: "colour-space",
        label: "Colour space: DeviceRGB (no PDF/X-1a claim)",
        pass: true,
        detail:
          "Illustrations are DeviceRGB JPEGs, so this file does NOT assert PDF/X-1a:2001 (that standard needs CMYK). It is a plain print-ready RGB PDF; KDP converts RGB to CMYK on upload and colours may shift slightly.",
        severity: "warning",
      },
      {
        id: "trim-bleed",
        label: "8.5in trim + 0.125in bleed boxes on every page",
        pass: boxOk && trimBoxes >= pages.length && bleedBoxes >= pages.length,
        detail: `${pages.length} page(s) at 8.75in, ${trimBoxes} TrimBox / ${bleedBoxes} BleedBox entries`,
        severity: "error",
      },
      {
        id: "page-count",
        label: "Interior = 24 pages, cover = 1 page (separate files)",
        pass: pages.length === 24 && (!data.coverPath || coverPages === 1),
        detail: `${pages.length} interior page(s)${data.coverPath ? `, ${coverPages} cover page(s)` : ", cover file not checked"}`,
        severity: "error",
      },
      {
        id: "no-transparency",
        label: "No transparency groups",
        pass: !raw.includes("/Group") && !raw.includes("/SMask"),
        detail: "Opaque JPEG (DCTDecode) images and solid fills only",
        severity: "error",
      },
    ];

    const pass = checks.every((c) => c.pass);
    const blocksPublish = checks.some((c) => !c.pass && c.severity === "error");
    return { pass, blocksPublish, checks };
  });

/* ============================================================
 * WRAPAROUND COVER (single landscape sheet, 17.304in x 8.75in)
 *  bleed .125 | back 8.5 | spine .054 | front 8.5 | bleed .125
 * ============================================================ */
export const SPINE_IN = 24 * 0.002252; // 0.054048 -> 0.054in for 24 white pages
const WRAP_SPINE_IN = 0.054;
const WRAP_W_IN = BLEED_IN + TRIM_IN + WRAP_SPINE_IN + TRIM_IN + BLEED_IN; // 17.304
const WRAP_W_PT = WRAP_W_IN * PT; // 1245.888
const WRAP_H_PT = PAGE_PT; // 630
const BACK_X0 = BLEED_PT;
const BACK_X1 = BLEED_PT + TRIM_IN * PT; // 621
const SPINE_X1 = BACK_X1 + WRAP_SPINE_IN * PT; // 624.888
const FRONT_X1 = SPINE_X1 + TRIM_IN * PT; // 1236.888
const SAFE_IN_PT = MARGIN_IN * PT; // 36
/** Blank barcode reserve: 2in x 1.2in, bottom-right of the back cover. */
const BARCODE_W = 2 * PT;
const BARCODE_H = 1.2 * PT;

const WrapInput = z.object({
  jobId: z.string().min(3),
  title: z.string(),
  titleTranslated: z.string(),
  coverPath: z.string().min(3),
  coverNativePx: z.number().optional(),
  blurbEn: z.string(),
  blurbHi: z.string(),
  affirmationEn: z.string(),
  affirmationHi: z.string(),
  seriesLine: z.string(),
});

export const buildWraparoundCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WrapInput.parse(d))
  .handler(async ({ data, context }) => {
    const { PDFDocument, PDFName, PDFHexString, rgb, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setFillingRgbColor, moveText, showText } =
      await import("pdf-lib");
    const fontkitMod = (await import("fontkit")) as unknown as Record<string, unknown>;
    const fontkit = (fontkitMod["default"] ?? fontkitMod) as {
      create(data: Uint8Array): {
        unitsPerEm: number;
        layout(text: string): {
          glyphs: { id: number }[];
          positions: { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[];
          advanceWidth: number;
        };
      };
    };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bucket = supabaseAdmin.storage.from("print-assets");

    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit as unknown as Parameters<(typeof doc)["registerFontkit"]>[0]);
    const poppinsBytes = await loadFont(FONT_URLS.poppins);
    const poppinsBoldBytes = await loadFont(FONT_URLS.poppinsBold);
    const balooBytes = await loadFont(FONT_URLS.baloo);
    const poppins = await doc.embedFont(poppinsBytes, { subset: false });
    const poppinsBold = await doc.embedFont(poppinsBoldBytes, { subset: false });
    const deva = await doc.embedFont(balooBytes, { subset: false });
    const shaper = fontkit.create(new Uint8Array(balooBytes));
    const emScale = (size: number) => size / shaper.unitsPerEm;
    const measureDeva = (t: string, size: number) => shaper.layout(t).advanceWidth * emScale(size);

    const page = doc.addPage([WRAP_W_PT, WRAP_H_PT]);
    page.node.set(PDFName.of("BleedBox"), doc.context.obj([0, 0, WRAP_W_PT, WRAP_H_PT]));
    page.node.set(
      PDFName.of("TrimBox"),
      doc.context.obj([BLEED_PT, BLEED_PT, WRAP_W_PT - BLEED_PT, WRAP_H_PT - BLEED_PT]),
    );
    page.drawRectangle({ x: 0, y: 0, width: WRAP_W_PT, height: WRAP_H_PT, color: rgb(1, 1, 1) });

    const drawDeva = (text: string, size: number, x: number, y: number, color: Rgb) => {
      const run = shaper.layout(text);
      const s = emScale(size);
      const key = page.node.newFontDictionary(deva.name, deva.ref);
      const ops: unknown[] = [
        pushGraphicsState(),
        beginText(),
        setFillingRgbColor(color[0], color[1], color[2]),
        setFontAndSize(key, size),
      ];
      let penX = x;
      let penY = y;
      let curX = 0;
      let curY = 0;
      run.glyphs.forEach((glyph, i) => {
        const pos = run.positions[i]!;
        const gx = penX + pos.xOffset * s;
        const gy = penY + pos.yOffset * s;
        ops.push(moveText(gx - curX, gy - curY));
        curX = gx;
        curY = gy;
        ops.push(showText(PDFHexString.of(glyph.id.toString(16).padStart(4, "0"))));
        penX += pos.xAdvance * s;
        penY += (pos.yAdvance || 0) * s;
      });
      ops.push(endText(), popGraphicsState());
      page.pushOperators(...(ops as Parameters<typeof page.pushOperators>));
    };

    const wrapLatin = (text: string, font: typeof poppins, size: number, maxW: number) => {
      const out: string[] = [];
      let line = "";
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const cand = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(cand, size) > maxW && line) {
          out.push(line);
          line = word;
        } else line = cand;
      }
      if (line) out.push(line);
      return out;
    };
    const wrapDeva = (text: string, size: number, maxW: number) => {
      const out: string[] = [];
      let line = "";
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const cand = line ? `${line} ${word}` : word;
        if (measureDeva(cand, size) > maxW && line) {
          out.push(line);
          line = word;
        } else line = cand;
      }
      if (line) out.push(line);
      return out;
    };
    const centreLatin = (
      lines: string[],
      font: typeof poppins,
      size: number,
      cx: number,
      top: number,
      color: Rgb,
      lead = 1.4,
    ) => {
      let y = top;
      for (const line of lines) {
        page.drawText(line, {
          x: cx - font.widthOfTextAtSize(line, size) / 2,
          y,
          size,
          font,
          color: rgb(color[0], color[1], color[2]),
        });
        y -= size * lead;
      }
      return y;
    };
    const centreDeva = (
      text: string,
      size: number,
      cx: number,
      top: number,
      maxW: number,
      color: Rgb,
      lead = 1.5,
    ) => {
      let y = top;
      for (const line of wrapDeva(text, size, maxW)) {
        drawDeva(line, size, cx - measureDeva(line, size) / 2, y, color);
        y -= size * lead;
      }
      return y;
    };

    // ---------------- BACK COVER ----------------
    const backSafeX0 = BACK_X0 + SAFE_IN_PT;
    const backSafeX1 = BACK_X1 - SAFE_IN_PT;
    const backSafeW = backSafeX1 - backSafeX0; // 540
    const backCx = (backSafeX0 + backSafeX1) / 2;
    const safeBottom = BLEED_PT + SAFE_IN_PT; // 45
    const safeTop = WRAP_H_PT - BLEED_PT - SAFE_IN_PT; // 585
    // Barcode reserve (bottom-right of back cover) — intentionally left blank.
    const barcodeX0 = backSafeX1 - BARCODE_W;
    const barcodeTop = safeBottom + BARCODE_H;

    // Vertically centre the back-cover text block above the blank barcode reserve.
    let by = safeTop - 130;
    by = centreLatin(wrapLatin(data.blurbEn, poppins, 15, backSafeW), poppins, 15, backCx, by, INK);
    by = centreDeva(data.blurbHi, 13.5, backCx, by - 16, backSafeW, INK);
    by -= 34;
    by = centreLatin([data.affirmationEn], poppinsBold, 19, backCx, by, AMBER, 1.4);
    by = centreDeva(data.affirmationHi, 17, backCx, by - 6, backSafeW, AMBER);
    // Series line: centred in the area LEFT of the blank barcode reserve.
    centreLatin(
      [data.seriesLine],
      poppins,
      9,
      (backSafeX0 + barcodeX0) / 2,
      safeBottom + 2,
      INK,
    );
    void barcodeTop;

    // ---------------- SPINE (blank white, no text) ----------------

    // ---------------- FRONT COVER ----------------
    const frontCx = (SPINE_X1 + FRONT_X1) / 2;
    const nativePx = data.coverNativePx && data.coverNativePx > 0 ? data.coverNativePx : 1024;
    const panelPt = Math.min((nativePx / 300) * PT, TRIM_IN * PT - SAFE_IN_PT * 2);
    const panelX = frontCx - panelPt / 2;
    const panelY = (WRAP_H_PT - panelPt) / 2 - 10;
    page.drawRectangle({
      x: panelX - 6,
      y: panelY - 6,
      width: panelPt + 12,
      height: panelPt + 12,
      color: rgb(0.988, 0.965, 0.906),
      borderColor: rgb(0.85, 0.76, 0.53),
      borderWidth: 1.2,
    });
    const dl = await bucket.download(data.coverPath);
    if (dl.error || !dl.data) throw new Error("Cover art not found in storage");
    const artBytes = new Uint8Array(await dl.data.arrayBuffer());
    const artPx = jpegSize(artBytes);
    const art = await doc.embedJpg(artBytes);
    page.drawImage(art, { x: panelX, y: panelY, width: panelPt, height: panelPt });

    const frontSafeW = TRIM_IN * PT - SAFE_IN_PT * 2;
    const titleLines = wrapLatin(data.title, poppinsBold, 30, frontSafeW);
    const titleTop = panelY + panelPt + 30 + (titleLines.length - 1) * 30 * 1.35;
    centreLatin(titleLines, poppinsBold, 30, frontCx, titleTop, INK, 1.35);
    if (data.titleTranslated.trim()) {
      centreDeva(data.titleTranslated, 20, frontCx, panelY - 44, frontSafeW, INK, 1.45);
    }
    centreLatin([data.seriesLine], poppins, 10, frontCx, safeBottom + 6, INK);

    doc.setTitle(`${data.title} - KDP wraparound cover`);
    doc.setAuthor("Mawil Kids Global Factory");
    doc.setCreator("Mawil Print Agent");
    doc.setProducer("Mawil Print Agent (pdf-lib)");
    const now = new Date();
    doc.setCreationDate(now);
    doc.setModificationDate(now);
    const bytes = await doc.save({ useObjectStreams: false });

    const path = `${context.userId}/${data.jobId}/book-kdp-cover-wraparound-17.304x8.75.pdf`;
    const up = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`Could not store PDF: ${up.error.message}`);
    const signed = await bucket.createSignedUrl(path, 60 * 60);
    if (signed.error || !signed.data) throw new Error("Could not sign PDF url");

    return {
      path,
      url: signed.data.signedUrl,
      bytes: bytes.length,
      pageCount: doc.getPageCount(),
      artPx: artPx ? Math.min(artPx.w, artPx.h) : 0,
      panelIn: panelPt / PT,
      barcodeArea: { x: barcodeX0, y: safeBottom, w: BARCODE_W, h: BARCODE_H },
    };
  });

export const validateWraparoundPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ path: z.string().min(3), coverNativePx: z.number().optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<KdpReport & { measured: Record<string, number> }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const store = supabaseAdmin.storage.from("print-assets");
    const dl = await store.download(data.path);
    if (dl.error || !dl.data) throw new Error("Wraparound PDF not found for validation");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const raw = new TextDecoder("latin1").decode(bytes);
    const { PDFDocument, PDFName, PDFArray, PDFNumber } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = doc.getPages();
    const p0 = pages[0]!;
    const size = p0.getSize();

    const readBox = (name: string): number[] | null => {
      const arr = p0.node.get(PDFName.of(name));
      if (!(arr instanceof PDFArray)) return null;
      return arr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
    };
    const trim = readBox("TrimBox");
    const expectedTrim = [BLEED_PT, BLEED_PT, WRAP_W_PT - BLEED_PT, WRAP_H_PT - BLEED_PT];
    const trimOk = !!trim && trim.length === 4 && trim.every((v, i) => Math.abs(v - expectedTrim[i]!) < 0.5);

    const widths = [...raw.matchAll(/\/Subtype\s*\/Image[\s\S]{0,400}?\/Width\s+(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    const artPx = widths.length ? Math.min(...widths) : 0;
    const drawnIn = Math.min((data.coverNativePx || artPx || 1024) / 300, TRIM_IN - MARGIN_IN * 2);
    const dpi = artPx && drawnIn ? artPx / drawnIn : 0;
    const fontFiles = (raw.match(/\/FontFile2/g) ?? []).length;

    const checks: KdpCheck[] = [
      {
        id: "wrap-page-size",
        label: "Wraparound page size = 17.304in x 8.75in",
        pass:
          Math.abs(size.width - WRAP_W_PT) < 0.5 && Math.abs(size.height - WRAP_H_PT) < 0.5,
        detail: `${size.width.toFixed(3)}pt x ${size.height.toFixed(3)}pt = ${(size.width / PT).toFixed(4)}in x ${(size.height / PT).toFixed(4)}in (bleed .125 + back 8.5 + spine ${WRAP_SPINE_IN} + front 8.5 + bleed .125)`,
        severity: "error",
      },
      {
        id: "wrap-trimbox",
        label: "TrimBox present and inset 0.125in on all four sides",
        pass: trimOk,
        detail: trim
          ? `TrimBox [${trim.map((v) => v.toFixed(3)).join(" ")}] vs expected [${expectedTrim.map((v) => v.toFixed(3)).join(" ")}]`
          : "No TrimBox on the wraparound page",
        severity: "error",
      },
      {
        id: "wrap-fonts",
        label: "All fonts embedded (Poppins + Baloo 2), no core fonts",
        pass: fontFiles >= 3 && !raw.includes("/BaseFont /Helvetica"),
        detail: `${fontFiles} embedded TrueType font program(s); no core-font references`,
        severity: "error",
      },
      {
        id: "wrap-transparency",
        label: "No transparency groups",
        pass: !raw.includes("/Group") && !raw.includes("/SMask"),
        detail: "Opaque JPEG (DCTDecode) art and solid fills only",
        severity: "error",
      },
      {
        id: "wrap-front-dpi",
        label: "Effective DPI of the front cover art >= 300",
        pass: dpi >= 300,
        detail: artPx
          ? `front art ${artPx}px drawn at ${drawnIn.toFixed(4)}in = ${Math.round(dpi)} DPI (native, not upscaled)`
          : "No image embedded",
        severity: "error",
      },
      {
        id: "wrap-page-count",
        label: "Wraparound cover = 1 landscape page",
        pass: pages.length === 1,
        detail: `${pages.length} page(s)`,
        severity: "error",
      },
      {
        id: "wrap-colour-space",
        label: "Colour space: DeviceRGB (no PDF/X-1a claim)",
        pass: true,
        detail:
          "Front art is a DeviceRGB JPEG, so this file does not assert PDF/X-1a:2001 (that needs CMYK). KDP converts RGB to CMYK on upload.",
        severity: "warning",
      },
    ];
    return {
      pass: checks.every((c) => c.pass),
      blocksPublish: checks.some((c) => !c.pass && c.severity === "error"),
      checks,
      measured: {
        widthPt: size.width,
        heightPt: size.height,
        widthIn: size.width / PT,
        heightIn: size.height / PT,
        artPx,
        dpi,
        bytes: bytes.length,
        pages: pages.length,
      },
    };
  });
