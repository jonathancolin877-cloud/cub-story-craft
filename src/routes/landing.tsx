import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BOOK_STORAGE_KEY, type Book } from "@/lib/book-types";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "Buy the Book | Mawil Kids Little Zoologists" },
      {
        name: "description",
        content:
          "Bilingual English + Hindi picture book for ages 3-5, with real animal facts. Buy now on Amazon.in.",
      },
      { property: "og:title", content: "Mawil Kids - Little Zoologists picture book" },
      {
        property: "og:description",
        content: "Bilingual kids picture book with real zoology facts. Available on Amazon.in.",
      },
      { property: "og:type", content: "book" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOOK_STORAGE_KEY);
      if (raw) setBook(JSON.parse(raw) as Book);
    } catch {
      /* ignore */
    }
  }, []);

  const title = book?.title ?? "Little Zoologists of the World";
  const amazon = `https://www.amazon.in/s?k=${encodeURIComponent(title)}`;

  return (
    <main className="min-h-screen bg-background">
      <div className="jungle-gradient px-5 py-12 text-primary-foreground">
        <div className="mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-2">
          <div className="mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-card/20">
            {book?.coverImage ? (
              <img src={book.coverImage} alt={`Cover of ${title}`} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-7xl">📕</div>
            )}
          </div>
          <div>
            <p className="text-sm font-bold tracking-widest uppercase opacity-90">
              Mawil Kids Global Factory
            </p>
            <h1 className="mt-2 text-4xl font-extrabold">{title}</h1>
            {book ? <p className="mt-1 text-2xl font-bold">{book.titleTranslated}</p> : null}
            <p className="mt-4 text-base opacity-95">
              {book?.blurb ??
                "A warm bilingual picture book with real animal facts on every page."}
            </p>
            <ul className="mt-4 space-y-1 text-sm opacity-95">
              <li>✅ 24 pages · English + {book?.secondLanguage ?? "Hindi"}</li>
              <li>✅ Ages {book?.age ?? "3-5 years"} · Value: {book?.value ?? "Courage"}</li>
              <li>✅ Real zoology fact box on every page</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={amazon}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-sunshine px-6 py-3 text-base font-extrabold text-accent-foreground"
              >
                Buy on Amazon.in
              </a>
              <a
                href={amazon}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border-2 border-primary-foreground px-6 py-3 text-base font-extrabold"
              >
                Kindle edition
              </a>
            </div>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-5xl px-5 py-10">
        <h2 className="text-2xl font-extrabold">Inside the book</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(book?.pages ?? []).slice(0, 6).map((p) => (
            <div key={p.page} className="rounded-2xl border border-border bg-card p-4">
              <p className="font-bold">{p.en}</p>
              <p className="text-primary">{p.translated}</p>
              <p className="mt-2 text-xs text-muted-foreground">🔎 {p.fact}</p>
            </div>
          ))}
        </div>
        <Link to="/" className="mt-8 inline-block font-bold text-primary underline">
          ← Back to the studio
        </Link>
      </section>
    </main>
  );
}
