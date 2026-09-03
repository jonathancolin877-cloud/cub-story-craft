import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";

import { fetchLibrary, type LibraryEntry } from "@/lib/book-store";
import { STATUS_LABEL, type BookStatus } from "@/lib/book-types";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Book Library - Little Zoologists" },
      {
        name: "description",
        content:
          "Every Little Zoologists picture book in one place - live titles first, with book numbers and production status.",
      },
      { property: "og:title", content: "Book Library - Little Zoologists" },
      {
        property: "og:description",
        content: "Browse all Little Zoologists books, sorted with live titles first.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

function StatusBadge({ status }: { status: BookStatus }) {
  const tone =
    status === "live"
      ? "bg-green-600 text-white"
      : status === "in_production"
        ? "bg-sunshine text-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wide ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLibrary()
      .then((res) => !cancelled && setEntries(res))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <header className="jungle-gradient text-primary-foreground">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-5 py-6">
          <div>
            <h1 className="text-2xl font-extrabold">Book Library</h1>
            <p className="text-sm opacity-90">Live titles first · Little Zoologists</p>
          </div>
          <Link
            to="/"
            className="rounded-2xl bg-sunshine px-4 py-2 text-sm font-extrabold text-foreground"
          >
            Back to Studio
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-5 py-8">
        {entries === null ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your library...
          </p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground">No books yet. Generate your first one in the studio.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => {
              const status = entry.book.status ?? "draft";
              return (
                <li
                  key={entry.id}
                  className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"
                >
                  <div className="aspect-square w-full bg-secondary">
                    {entry.book.coverImage ? (
                      <img
                        src={entry.book.coverImage}
                        alt={`Cover illustration for ${entry.book.title}`}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-muted-foreground">
                        <BookOpen className="h-8 w-8" />
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                        {entry.book.bookNumber != null
                          ? `Book ${entry.book.bookNumber}`
                          : "Unnumbered"}
                      </span>
                      <StatusBadge status={status} />
                    </div>
                    <h2 className="text-lg leading-tight font-extrabold">
                      {entry.book.title || "Untitled book"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {entry.book.region} · {entry.book.animal} · {entry.book.value}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
