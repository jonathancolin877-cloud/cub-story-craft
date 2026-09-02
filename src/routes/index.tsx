import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Download,
  FileText,
  Film,
  Globe2,
  Loader2,
  Library,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { generateBook } from "@/lib/book.functions";
import { illustratorAgent } from "@/lib/agents/illustrator.functions";
import { generateCharacterSheet } from "@/lib/agents/character-sheet.functions";

import { characterBible } from "@/lib/book-types";
import {
  AGES,
  ANIMALS_BY_REGION,
  BOOK_STORAGE_KEY,
  KDP_VALIDATED_KEY,
  LANGUAGE_BY_REGION,
  PRINT_SPEC,
  REGIONS,
  STYLE_BASE,
  VALUES,
  type Book,
  type Region,
} from "@/lib/book-types";
import { exportReels, exportYoutubeScript } from "@/lib/exports";
import { agents, type KdpReport } from "@/agents/client";
import type { PrintFile } from "@/lib/agents/layout-agent";
import { fetchLastBook, saveArtwork, upsertBook } from "@/lib/book-store";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mawil Kids Global Factory - Little Zoologists of the World" },
      {
        name: "description",
        content:
          "Generate a 24-page bilingual kids picture book, KDP-ready PDF, YouTube script and Instagram reels from one animal and region.",
      },
      { property: "og:title", content: "Mawil Kids Global Factory - Little Zoologists" },
      {
        property: "og:description",
        content: "One animal + one region = a complete kids book package ready for Amazon and YouTube.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

function Studio() {
  const [region, setRegion] = useState<Region>("India");
  const [animal, setAnimal] = useState("Tiger");
  const [age, setAge] = useState<string>(AGES[0]);
  const [value, setValue] = useState<string>("Courage");
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(false);
  const [imgProgress, setImgProgress] = useState<{ done: number; total: number } | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [kdpValidated, setKdpValidated] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const [kdpReport, setKdpReport] = useState<KdpReport | null>(null);
  const [printFiles, setPrintFiles] = useState<{
    interior: PrintFile;
    cover: PrintFile;
    wraparound: PrintFile;
  } | null>(null);

  useEffect(() => {
    try {
      setKdpValidated(localStorage.getItem(KDP_VALIDATED_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const book2Blocked = Boolean(book) && !kdpValidated;

  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetApproved, setSheetApproved] = useState(false);
  /** True only when a real reference image is approved and will be sent to the illustrator. */
  const sheetLocked = Boolean(book?.characterSheetPath) && sheetApproved;

  const makeBook = useServerFn(generateBook);
  const makeImage = useServerFn(illustratorAgent);
  const makeSheet = useServerFn(generateCharacterSheet);

  async function onGenerateSheet() {
    if (!book) return;
    setSheetBusy(true);
    try {
      let id = bookId;
      if (!id) {
        id = await upsertBook(book, null);
        setBookId(id);
      }
      const res = await makeSheet({
        data: {
          bookId: id,
          characterBible: characterBible(book),
          characterSheet: book.characterSheet,
          characterName: book.characterName,

        },
      });
      setBook({ ...book, characterSheetPath: res.path, characterSheetImage: res.image });
      setSheetApproved(false);
      toast.success("Character sheet generated. Approve it to lock page art to it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Character sheet failed");
    } finally {
      setSheetBusy(false);
    }
  }


  async function onExportPrintPdf() {
    if (!book) {
      toast.error("Generate a book first");
      return;
    }
    if (!book.coverImage || book.pages.some((p) => !p.image)) {
      toast("Exporting with current images");
    }
    setKdpReport(null);
    setPrintFiles(null);
    try {
      setPrinting("Preparing 2625px art...");
      const layout = await agents.layout(book, (done, total) =>
        setPrinting(`Uploading print art ${done}/${total}...`),
      );
      setPrinting("Validating print files...");
      const report = await agents.validate(book, layout);
      setKdpReport(report);
      setPrintFiles({
        interior: layout.interior,
        cover: layout.cover,
        wraparound: layout.wraparound,
      });
      if (report.pass) toast.success("Interior + cover PDFs built and validated");
      else if (!report.blocksPublish)
        toast.warning("Interior + cover PDFs built - passed with warnings, see report");
      else toast.error("PDF exported but KDP validation failed - see report");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setPrinting(null);
    }
  }

  const language = LANGUAGE_BY_REGION[region];
  const animals = ANIMALS_BY_REGION[region];

  useEffect(() => {
    let cancelled = false;
    fetchLastBook()
      .then((res) => {
        if (cancelled || !res) return;
        setBookId(res.id);
        setBook(res.book);
        setRegion(res.book.region);
        setAnimal(res.book.animal);
        if (res.book.age) setAge(res.book.age);
        if (res.book.value) setValue(res.book.value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!animals.includes(animal)) setAnimal(animals[0] ?? "");
  }, [animals, animal]);

  useEffect(() => {
    if (book) {
      try {
        const light = { ...book, pages: book.pages.map((p) => ({ ...p, image: undefined })) };
        localStorage.setItem(BOOK_STORAGE_KEY, JSON.stringify(light));
      } catch {
        /* storage full - landing page falls back */
      }
    }
  }, [book]);

  async function onGenerate() {
    if (book2Blocked) {
      toast.error("Book 2 is locked until Book 1's PDF passes the KDP validator.");
      return;
    }
    setLoading(true);

    setBook(null);
    setImgProgress(null);
    try {
      const raw = await makeBook({
        data: {
          region,
          animal,
          age,
          value,
          secondLanguage: language.second,
          characterName: region === "India" && animal === "Tiger" ? "Sheru" : undefined,
        },
      });
      const next: Book = {
        ...raw,
        animal,
        region,
        value,
        age,
        secondLanguage: language.second,
        pages: raw.pages.slice(0, 24).map((p, i) => ({ ...p, page: i + 1 })),
      };
      setBook(next);
      try {
        const id = await upsertBook(next, null);
        setBookId(id);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not save to the cloud",
        );
      }
      toast.success(`"${next.title}" is ready. 24 pages written!`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the book");
    } finally {
      setLoading(false);
    }
  }

  async function onIllustrate() {
    if (!book) return;
    if (!sheetLocked) {
      toast.error(
        book.characterSheetPath
          ? "Approve the character sheet before generating page art."
          : "Generate and approve a character sheet first - page art is locked to it.",
      );
      return;
    }
    const referencePath = book.characterSheetPath;
    const total = book.pages.length + 1;
    setImgProgress({ done: 0, total });
    let current = book;
    let id = bookId;
    try {
      if (!id) {
        id = await upsertBook(current, null);
        setBookId(id);
      }
      const cover = await makeImage({
        data: {
          scene: `Book cover illustration. ${book.coverScene}`,
          characterBible: characterBible(book),
          characterSheet: book.characterSheet,
          bookId: id,
          referencePath,
        },
      });
      current = { ...current, coverImage: cover.image };
      setBook(current);
      setImgProgress({ done: 1, total });
      await saveArtwork(id, cover.image, { kind: "cover" });

      for (let i = 0; i < current.pages.length; i++) {
        const page = current.pages[i]!;
        const res = await makeImage({
          data: {
            scene: page.scene,
            characterBible: characterBible(current),
            characterSheet: current.characterSheet,
            bookId: id,
            referencePath,
          },
        });
        const pages = [...current.pages];
        pages[i] = { ...page, image: res.image };
        current = { ...current, pages };
        setBook(current);
        setImgProgress({ done: i + 2, total });
        await saveArtwork(id, res.image, { kind: "page", index: i, page: page.page });
      }
      toast.success("All 25 illustrations generated from the approved reference sheet!");

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Illustration failed");
    } finally {
      setImgProgress(null);
    }
  }


  async function onSaveToLibrary() {
    if (!book) return;
    setSaving(true);
    try {
      const id = await upsertBook(book, bookId, true);
      setBookId(id);
      toast.success("Saved to your library. It will still be here in days.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save to library");
    } finally {
      setSaving(false);
    }
  }

  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setEmail(session?.user.email ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const chapter = useMemo(
    () => (n: number) =>
      n <= 3 ? "Intro" : n <= 18 ? "Challenge" : n <= 22 ? "Lesson" : "Moral",
    [],
  );

  return (
    <main className="min-h-screen bg-background">
      <header className="jungle-gradient text-primary-foreground">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-sunshine text-2xl">
              🐯
            </span>
            <div>
              <h1 className="text-2xl leading-tight font-extrabold">Mawil Kids Global Factory</h1>
              <p className="text-sm opacity-90">Little Zoologists of the World</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {email ? (
              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  toast.success("Signed out");
                }}
                className="cursor-pointer rounded-full bg-background/20 px-4 py-2 text-sm font-bold text-primary-foreground"
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/auth"
                className="rounded-full bg-background/20 px-4 py-2 text-sm font-bold text-primary-foreground"
              >
                Sign in
              </Link>
            )}
            <Link
              to="/library"
              className="rounded-full bg-background/20 px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Library
            </Link>
            <Link
              to="/landing"
              className="rounded-full bg-sunshine px-4 py-2 text-sm font-bold text-accent-foreground"
            >
              View landing page
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-5 px-5 py-6 lg:grid-cols-[320px_minmax(0,1fr)_330px]">
        {/* LEFT: input form */}
        <section className="card-soft h-fit rounded-3xl border border-border bg-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
            <Sparkles className="h-5 w-5 text-primary" /> Book Recipe
          </h2>

          <div className="space-y-4">
            <Field label="Region">
              <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Animal">
              <Select value={animal} onValueChange={setAnimal}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {animals.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Age">
              <Select value={age} onValueChange={setAge}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Language (auto dual)">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-sm font-semibold">
                <Globe2 className="h-4 w-4 text-primary" /> {language.label}
              </div>
            </Field>

            <Field label="Value">
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Button
              onClick={onGenerate}
              disabled={loading || book2Blocked}
              className="w-full rounded-2xl py-6 text-base font-extrabold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Writing 24 pages...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-5 w-5" /> Generate Book Package
                </>
              )}
            </Button>

            <div className="rounded-2xl border border-border bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
              <strong>Book 2 gate:</strong> Book 1 is code-live, not product-live. New books stay
              locked until Book 1&apos;s PDF passes the Amazon KDP validator.
              <label className="mt-2 flex cursor-pointer items-start gap-2 font-semibold">
                <input
                  type="checkbox"
                  className="mt-0.5 cursor-pointer"
                  checked={kdpValidated}
                  onChange={(e) => {
                    setKdpValidated(e.target.checked);
                    try {
                      localStorage.setItem(KDP_VALIDATED_KEY, e.target.checked ? "1" : "0");
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                Book 1 PDF passed the KDP validator (unlocks Book 2)
              </label>
            </div>

            {/* CHARACTER CONSISTENCY */}
            <div className="rounded-2xl border border-border bg-background p-3">
              <p className="text-xs font-bold tracking-wide text-primary uppercase">
                Character consistency
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mechanism in use:{" "}
                <strong className={sheetLocked ? "text-primary" : "text-destructive"}>
                  {sheetLocked ? "reference image (image-to-image)" : "prompt only"}
                </strong>
                .{" "}
                {sheetLocked
                  ? "Every page is drawn from the approved character sheet, not from prompt text."
                  : "Without an approved character sheet the character is held by prompt text only, which drifts across pages."}
              </p>

              <Button
                variant="secondary"
                className="mt-3 w-full rounded-xl font-bold"
                onClick={onGenerateSheet}
                disabled={!book || sheetBusy}
              >
                {sheetBusy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating sheet...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Generate character sheet
                  </>
                )}
              </Button>

              {book?.characterSheetImage ? (
                <>
                  <img
                    src={book.characterSheetImage}
                    alt={`Character turnaround sheet for ${book.characterName || book.animal}`}
                    className="mt-3 w-full rounded-xl border border-border bg-muted object-contain"
                  />
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      className="mt-0.5 cursor-pointer"
                      checked={sheetApproved}
                      onChange={(e) => setSheetApproved(e.target.checked)}
                    />
                    I approve this sheet as the locked reference for every page
                  </label>
                </>
              ) : null}
            </div>

            <p className="rounded-2xl bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
              <strong>Illustration spec (locked):</strong> 1:1 square, upscaled to{" "}
              {PRINT_SPEC.printPx}×{PRINT_SPEC.printPx} for 300 DPI, {PRINT_SPEC.bleedIn}in bleed,{" "}
              {PRINT_SPEC.safeMarginIn}in safe margin. {STYLE_BASE}
            </p>



          </div>
        </section>

        {/* MIDDLE: preview */}
        <section className="card-soft rounded-3xl border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <BookOpen className="h-5 w-5 text-primary" /> Book Preview
              {book ? <span className="text-muted-foreground">· 24 pages</span> : null}
            </h2>
            {book ? (
              <Button
                variant="secondary"
                className="rounded-xl font-bold"
                onClick={onIllustrate}
                disabled={!!imgProgress || !sheetLocked}
              >
                {imgProgress ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {imgProgress.done}/
                    {imgProgress.total}
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />{" "}
                    {sheetLocked
                      ? "Generate All Illustrations (from reference sheet)"
                      : "Character sheet required"}
                  </>
                )}

              </Button>
            ) : null}
          </div>

          {imgProgress ? (
            <Progress
              className="mb-4"
              value={(imgProgress.done / imgProgress.total) * 100}
            />
          ) : null}

          {!book ? (
            <div className="grid place-items-center rounded-2xl border-2 border-dashed border-border p-16 text-center">
              <div className="text-6xl">🌿</div>
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                Pick a region, animal and value, then press{" "}
                <strong>Generate Book Package</strong>. Your 24-page bilingual story appears here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 rounded-2xl bg-secondary p-4 sm:flex-row">
                <div className="aspect-square w-full max-w-[200px] overflow-hidden rounded-xl bg-muted">
                  {book.coverImage ? (
                    <img
                      src={book.coverImage}
                      alt={`Cover of ${book.title}`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-4xl">📕</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold tracking-wide text-primary uppercase">Cover</p>
                  <h3 className="text-2xl font-extrabold">{book.title}</h3>
                  <p className="script-line text-lg font-semibold text-secondary-foreground">
                    {book.titleTranslated}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{book.blurb}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {book.pages.map((p) => (
                  <article
                    key={p.page}
                    className="overflow-hidden rounded-2xl border border-border bg-background"
                  >
                    <div className="relative aspect-square bg-muted">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt={p.scene}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full place-items-center p-4 text-center text-xs text-muted-foreground">
                          {p.scene}
                        </div>
                      )}
                      <span className="absolute top-2 left-2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                        {p.page}
                      </span>
                      <span className="absolute top-2 right-2 rounded-full bg-sunshine px-2 py-0.5 text-xs font-bold text-accent-foreground">
                        {chapter(p.page)}
                      </span>
                    </div>
                    <div className="space-y-2 p-3">
                      <p className="font-bold">{p.en}</p>
                      <p className="script-line text-primary">{p.translated}</p>
                      <p className="rounded-xl bg-secondary p-2 text-xs text-secondary-foreground">
                        🔎 <strong>Fact:</strong> {p.fact}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* RIGHT: exports */}
        <section className="card-soft h-fit rounded-3xl border border-border bg-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
            <Download className="h-5 w-5 text-primary" /> Export Package
          </h2>
          <div className="space-y-3">
            <ExportButton
              icon={<FileText className="h-4 w-4" />}
              title={printing ?? "Build KDP print files"}
              sub="Server-built · embedded fonts · 8.5×8.5in + 0.125in bleed · RGB print-ready"
              onClick={() => void onExportPrintPdf()}

            />
            {printFiles && (
              <div className="grid grid-cols-2 gap-2">
                <ExportButton
                  icon={<FileText className="h-4 w-4" />}
                  title={`Interior (${printFiles.interior.pageCount} pages)`}
                  sub={`${Math.round(printFiles.interior.bytes / 1024)} KB`}
                  onClick={() => printFiles.interior.save()}
                />
                <ExportButton
                  icon={<FileText className="h-4 w-4" />}
                  title="Cover"
                  sub={`${Math.round(printFiles.cover.bytes / 1024)} KB`}
                  onClick={() => printFiles.cover.save()}
                />
                <ExportButton
                  icon={<FileText className="h-4 w-4" />}
                  title="Wraparound cover (17.304×8.75in)"
                  sub={`Back + blank spine + front · ${Math.round(printFiles.wraparound.bytes / 1024)} KB`}
                  onClick={() => printFiles.wraparound.save()}
                />
              </div>
            )}
            <ExportButton
              icon={<Film className="h-4 w-4" />}
              title="Export YouTube Script"
              sub={`3 min voiceover · English + ${language.second}`}
              onClick={() =>
                book ? exportYoutubeScript(book) : toast.error("Generate a book first")
              }
            />
            <ExportButton
              icon={<Sparkles className="h-4 w-4" />}
              title="Export 3 Reels"
              sub="15s each · Hook + Fact + CTA + hashtags"
              onClick={() => (book ? exportReels(book) : toast.error("Generate a book first"))}
            />
            <ExportButton
              icon={<Library className="h-4 w-4" />}
              title={saving ? "Saving..." : "Save to Library"}
              sub="Store this book in the cloud - never resets"
              onClick={() => (book ? onSaveToLibrary() : toast.error("Generate a book first"))}
            />
            <Link to="/landing" className="block">
              <ExportButton
                icon={<Globe2 className="h-4 w-4" />}
                title="Landing Page Link"
                sub="Cover + Amazon.in buy buttons"
              />
            </Link>
          </div>

          {kdpReport && (
            <div className="mt-4 space-y-2 rounded-2xl border border-border bg-background p-3 text-xs">
              <p className="font-bold">
                KDP validator: {kdpReport.pass ? "PASS" : kdpReport.blocksPublish ? "FAIL - publish blocked" : "PASS with warnings"}
              </p>
              {kdpReport.checks.map((c) => (
                <div
                  key={c.id}
                  className={
                    c.pass
                      ? "text-primary"
                      : c.severity === "warning"
                        ? "text-amber-600"
                        : "text-destructive"
                  }
                >
                  <p className="font-semibold">
                    {c.pass ? "✓" : c.severity === "warning" ? "!" : "✕"} {c.label}
                  </p>
                  <p className="text-muted-foreground">{c.detail}</p>
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 rounded-2xl bg-secondary p-3 text-xs text-secondary-foreground">
            Tip: generate illustrations before exporting the PDF so artwork is embedded.
          </p>
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-bold tracking-wide uppercase">{label}</Label>
      {children}
    </div>
  );
}

function ExportButton({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer rounded-2xl border border-border bg-background p-4 text-left transition-colors hover:bg-secondary"
    >
      <span className="flex items-center gap-2 font-extrabold">
        {icon} {title}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}

