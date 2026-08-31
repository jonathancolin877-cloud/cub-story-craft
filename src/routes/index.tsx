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
import { generateBook, generateIllustration } from "@/lib/book.functions";
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
  imagePrompt,
  type Book,
  type Region,
} from "@/lib/book-types";
import { exportPdf, exportReels, exportYoutubeScript } from "@/lib/exports";
import { fetchLastBook, upsertBook } from "@/lib/book-store";
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

  useEffect(() => {
    try {
      setKdpValidated(localStorage.getItem(KDP_VALIDATED_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const book2Blocked = Boolean(book) && !kdpValidated;


  const makeBook = useServerFn(generateBook);
  const makeImage = useServerFn(generateIllustration);

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
    const total = book.pages.length + 1;
    setImgProgress({ done: 0, total });
    let current = book;
    try {
      const cover = await makeImage({
        data: { prompt: `Book cover illustration. ${imagePrompt(book, book.coverScene)}` },
      });
      current = { ...current, coverImage: cover.image };
      setBook(current);
      setImgProgress({ done: 1, total });

      for (let i = 0; i < current.pages.length; i++) {
        const page = current.pages[i]!;
        const res = await makeImage({ data: { prompt: imagePrompt(current, page.scene) } });
        const pages = [...current.pages];
        pages[i] = { ...page, image: res.image };
        current = { ...current, pages };
        setBook(current);
        setImgProgress({ done: i + 2, total });
      }
      try {
        const id = await upsertBook(current, bookId);
        setBookId(id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save to the cloud");
      }
      toast.success("All 25 illustrations generated!");
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

            <p className="rounded-2xl bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
              <strong>Illustration spec (locked):</strong> 1:1 square, min{" "}
              {PRINT_SPEC.minPx}px, upscaled to {PRINT_SPEC.printPx}×{PRINT_SPEC.printPx} for 300
              DPI, {PRINT_SPEC.bleedIn}in bleed. {STYLE_BASE}
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
                disabled={!!imgProgress}
              >
                {imgProgress ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {imgProgress.done}/
                    {imgProgress.total}
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Generate All Illustrations
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
                      className="h-full w-full object-cover"
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
                    <div className="relative aspect-[4/3] bg-muted">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt={p.scene}
                          className="h-full w-full object-cover"
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
              title="Export PDF"
              sub="24 pages + cover · 8.5×8.5in KDP India"
              onClick={() => {
                if (!book) {
                  toast.error("Generate a book first");
                  return;
                }
                const missing = !book.coverImage || book.pages.some((p) => !p.image);
                if (missing) toast("Exporting with current images");
                exportPdf(book);
              }}

            />
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

