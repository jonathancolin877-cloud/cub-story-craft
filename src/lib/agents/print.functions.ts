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

      return { doc, latin, latinBold, newPage, drawImage, drawCentered, drawCenteredDeva, wrap, finish };
    }

    // ---- Cover file (full-bleed square, cover only) ----
    const c = await makeDoc();
    const cover = c.newPage();
    await c.drawImage(cover, data.coverPath, 0, 0, PAGE_PT);
    cover.drawRectangle({ x: 0, y: 0, width: PAGE_PT, height: 158, color: rgb(1, 1, 1) });
    let cy = c.drawCentered(cover, c.wrap(data.title, c.latinBold, 26, SAFE_W), c.latinBold, 26, 110, INK);
    if (data.titleTranslated.trim()) {
      cy = c.drawCenteredDeva(cover, data.titleTranslated, 18, cy - 4, INK);
    }
    c.drawCentered(
      cover,
      ["Mawil Kids Global Factory - Little Zoologists of the World"],
      c.latin,
      10,
      30,
      INK,
    );
    const coverBytes = await c.finish();

    // ---- Interior file (story pages only, no cover) ----
    const it = await makeDoc();
    const IMG = 5.5 * PT; // 396pt square, never cropped
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
    if (data.coverPath) {
      const cdl = await store.download(data.coverPath);
      if (!cdl.error && cdl.data) {
        const cdoc = await PDFDocument.load(new Uint8Array(await cdl.data.arrayBuffer()), {
          updateMetadata: false,
        });
        coverPages = cdoc.getPageCount();
      }
    }

    const count = (re: RegExp) => (raw.match(re) ?? []).length;
    const widths = [...raw.matchAll(/\/Subtype\s*\/Image[\s\S]{0,400}?\/Width\s+(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    const imgMin = widths.length ? Math.min(...widths) : 0;
    const trueSrc = data.trueSourcePx ?? 0;

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
        label: `Embedded image size >= ${REQUIRED_IMAGE_PX}px (print sizing)`,
        pass: widths.length > 0 && imgMin >= REQUIRED_IMAGE_PX,
        detail: widths.length
          ? `${widths.length} image(s) in the interior, smallest ${imgMin}px (upscaled from ${trueSrc || "unknown"}px)`
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
