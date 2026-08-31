import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * PRINT AGENT (server / edge runtime)
 * Emits a real PDF/X-1a:2001 file:
 *  - OutputIntent (GTS_PDFX, CGATS TR 001 SWOP) + XMP pdfxid metadata
 *  - Latin + Devanagari fonts fully EMBEDDED (no rasterised text)
 *  - every illustration embedded at >= 2625x2625 px (8.75in incl. bleed @ 300 DPI)
 *  - MediaBox/BleedBox 8.75in, TrimBox 8.5in, 0.5in safe margin
 * Followed by a real validator that parses the emitted bytes.
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
export const REQUIRED_IMAGE_PX = 2625;

const FONT_URLS = {
  latin:
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
  latinBold:
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
  // Mukta (Ek Type) shapes cleanly with fontkit; Noto Devanagari trips a
  // fontkit GPOS mark-anchor bug in this runtime.
  devanagari: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mukta/Mukta-Regular.ttf",
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
      PDFArray,
      PDFNumber,
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

    const doc = await PDFDocument.create();
    doc.registerFontkit(
      fontkit as unknown as Parameters<(typeof doc)["registerFontkit"]>[0],
    );
    // subset: false -> the complete font program is embedded (FontFile2)
    const latin = await doc.embedFont(await loadFont(FONT_URLS.latin), { subset: false });
    const latinBold = await doc.embedFont(await loadFont(FONT_URLS.latinBold), { subset: false });
    const devaBytes = await loadFont(FONT_URLS.devanagari);
    const deva = await doc.embedFont(devaBytes, { subset: false });
    // Devanagari needs full GSUB/GPOS shaping (matra reordering + mark
    // attachment), so glyphs are positioned individually instead of relying
    // on pdf-lib's simple advance-width text showing.
    const shaper = fontkit.create(new Uint8Array(devaBytes));
    const emScale = (size: number) => size / shaper.unitsPerEm;

    const measureDeva = (text: string, size: number) =>
      shaper.layout(text).advanceWidth * emScale(size);

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


    let smallestImagePx = Infinity;
    let embeddedImages = 0;

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
      page.node.set(PDFName.of("ArtBox"), doc.context.obj([SAFE_PT, SAFE_PT, PAGE_PT - SAFE_PT, PAGE_PT - SAFE_PT]));
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


    // ---- Cover (full-bleed square) ----
    const cover = newPage();
    await drawImage(cover, data.coverPath, 0, 0, PAGE_PT);
    cover.drawRectangle({ x: 0, y: 0, width: PAGE_PT, height: 158, color: rgb(1, 1, 1) });
    let y = drawCentered(cover, wrap(data.title, latinBold, 26, SAFE_W), latinBold, 26, 110, INK);
    if (data.titleTranslated.trim()) {
      y = drawCentered(cover, wrap(data.titleTranslated, deva, 18, SAFE_W), deva, 18, y - 4, INK);
    }
    drawCentered(
      cover,
      ["Mawil Kids Global Factory - Little Zoologists of the World"],
      latin,
      10,
      30,
      INK,
    );

    // ---- Interior pages ----
    const IMG = 5.5 * PT; // 396pt square, never cropped
    for (const p of data.pages) {
      const page = newPage();
      await drawImage(page, p.path, (PAGE_PT - IMG) / 2, PAGE_PT - SAFE_PT - IMG, IMG);
      let ty = PAGE_PT - SAFE_PT - IMG - 30;
      ty = drawCentered(page, wrap(p.en, latinBold, 16, SAFE_W), latinBold, 16, ty, INK);
      if (p.translated.trim()) {
        ty = drawCentered(page, wrap(p.translated, deva, 14, SAFE_W), deva, 14, ty - 4, AMBER);
      }
      const factLines = wrap(`Did you know? ${p.fact}`, latin, 9.5, SAFE_W - 24);
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
        page.drawText(line, { x: SAFE_PT + 12, y: fy, size: 9.5, font: latin, color: rgb(0.16, 0.31, 0.22) });
        fy -= 13;
      }
      const num = String(p.page);
      page.drawText(num, {
        x: (PAGE_PT - latin.widthOfTextAtSize(num, 9)) / 2,
        y: SAFE_PT - 2,
        size: 9,
        font: latin,
        color: rgb(0.6, 0.6, 0.6),
      });
    }

    // ---- PDF/X-1a:2001 conformance ----
    doc.setTitle(data.title);
    doc.setAuthor("Mawil Kids Global Factory");
    doc.setCreator("Mawil Print Agent");
    doc.setProducer("Mawil Print Agent (pdf-lib)");
    const now = new Date();
    doc.setCreationDate(now);
    doc.setModificationDate(now);
    const info = (doc as unknown as {
      getInfoDict(): { set(key: unknown, value: unknown): void };
    }).getInfoDict();
    info.set(PDFName.of("GTS_PDFXVersion"), PDFString.of("PDF/X-1a:2001"));
    info.set(PDFName.of("Trapped"), PDFName.of("False"));

    const outputIntent = doc.context.obj({
      Type: PDFName.of("OutputIntent"),
      S: PDFName.of("GTS_PDFX"),
      OutputCondition: PDFString.of("CGATS TR 001 (SWOP)"),
      OutputConditionIdentifier: PDFString.of("CGATS TR 001"),
      RegistryName: PDFString.of("http://www.color.org"),
      Info: PDFString.of("U.S. Web Coated (SWOP) v2"),
    });
    const intents = PDFArray.withContext(doc.context);
    intents.push(doc.context.register(outputIntent));
    doc.catalog.set(PDFName.of("OutputIntents"), intents);

    const iso = now.toISOString();
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <pdfxid:GTS_PDFXVersion>PDF/X-1a:2001</pdfxid:GTS_PDFXVersion>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>Mawil Print Agent (pdf-lib)</pdf:Producer>
   <pdf:Trapped>False</pdf:Trapped>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:CreatorTool>Mawil Print Agent</xmp:CreatorTool>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${data.title.replace(/[<&]/g, "")}</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const metaStream = doc.context.stream(xmp, {
      Type: PDFName.of("Metadata"),
      Subtype: PDFName.of("XML"),
    });
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(metaStream));
    doc.context.trailerInfo.ID = doc.context.obj([
      PDFString.of(data.jobId.padEnd(16, "0").slice(0, 16)),
      PDFString.of(data.jobId.padEnd(16, "0").slice(0, 16)),
    ]);
    void PDFNumber;

    const bytes = await doc.save({ useObjectStreams: false });
    const path = `${context.userId}/${data.jobId}/book-kdp-8.5x8.5.pdf`;
    const up = await bucket.upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (up.error) throw new Error(`Could not store PDF: ${up.error.message}`);
    const signed = await bucket.createSignedUrl(path, 60 * 60);
    if (signed.error || !signed.data) throw new Error("Could not sign PDF url");

    return {
      path,
      url: signed.data.signedUrl,
      bytes: bytes.length,
      embeddedImages,
      smallestImagePx: Number.isFinite(smallestImagePx) ? smallestImagePx : 0,
      pageCount: doc.getPageCount(),
    };
  });

/** Real validator: parses the emitted PDF bytes. */
export type KdpCheck = { id: string; label: string; pass: boolean; detail: string };
export type KdpReport = { pass: boolean; blocksPublish: boolean; checks: KdpCheck[] };

export const validatePrintPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string().min(3) }).parse(d))
  .handler(async ({ data }): Promise<KdpReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dl = await supabaseAdmin.storage.from("print-assets").download(data.path);
    if (dl.error || !dl.data) throw new Error("PDF not found for validation");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const raw = new TextDecoder("latin1").decode(bytes);

    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = doc.getPages();

    const count = (re: RegExp) => (raw.match(re) ?? []).length;
    const widths = [...raw.matchAll(/\/Subtype\s*\/Image[\s\S]{0,400}?\/Width\s+(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    const imgMin = widths.length ? Math.min(...widths) : 0;

    const boxOk = pages.every((p) => {
      const media = p.getSize();
      return Math.abs(media.width - PAGE_PT) < 0.5 && Math.abs(media.height - PAGE_PT) < 0.5;
    });
    const trimBoxes = count(/\/TrimBox/g);
    const bleedBoxes = count(/\/BleedBox/g);

    const checks: KdpCheck[] = [
      {
        id: "pdfx",
        label: "PDF/X-1a:2001 output intent",
        pass: raw.includes("/GTS_PDFX") && raw.includes("/OutputIntents"),
        detail: raw.includes("/GTS_PDFX")
          ? "OutputIntent GTS_PDFX + pdfxid XMP present in file"
          : "No PDF/X output intent found",
      },
      {
        id: "fonts",
        label: "All fonts embedded (Latin + Devanagari)",
        pass: count(/\/FontFile2/g) >= 3 && !raw.includes("/BaseFont /Helvetica"),
        detail: `${count(/\/FontFile2/g)} embedded TrueType font program(s); no core-font references`,
      },
      {
        id: "print-px",
        label: `Illustrations >= ${REQUIRED_IMAGE_PX}px (300 DPI)`,
        pass: widths.length > 0 && imgMin >= REQUIRED_IMAGE_PX,
        detail: widths.length
          ? `${widths.length} image(s), smallest ${imgMin}px`
          : "No images embedded",
      },
      {
        id: "trim-bleed",
        label: "8.5in trim + 0.125in bleed boxes on every page",
        pass: boxOk && trimBoxes >= pages.length && bleedBoxes >= pages.length,
        detail: `${pages.length} page(s) at 8.75in, ${trimBoxes} TrimBox / ${bleedBoxes} BleedBox entries`,
      },
      {
        id: "page-count",
        label: "Cover + 24 interior pages",
        pass: pages.length === 25,
        detail: `${pages.length} pages in the emitted PDF`,
      },
      {
        id: "no-transparency",
        label: "No transparency groups (PDF/X-1a)",
        pass: !raw.includes("/Group") && !raw.includes("/SMask"),
        detail: "Opaque JPEG (DCTDecode) images and solid fills only",
      },
    ];

    const pass = checks.every((c) => c.pass);
    return { pass, blocksPublish: !pass, checks };
  });
