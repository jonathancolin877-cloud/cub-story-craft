export const REGIONS = ["India", "MENA", "Europe", "USA"] as const;
export type Region = (typeof REGIONS)[number];

/**
 * The series is global: every animal is selectable in every region.
 * Region stays a setting (background, culture), never a filter.
 */
export const ANIMALS = [
  "Tiger",
  "Pangolin",
  "Elephant",
  "Peacock",
  "Oryx",
  "Falcon",
  "Gazelle",
  "Fox",
  "Bear",
  "Wolf",
  "Eagle",
  "Bison",
] as const;

/** Kept for compatibility - the same global list for every region. */
export const ANIMALS_BY_REGION: Record<Region, string[]> = {
  India: [...ANIMALS],
  MENA: [...ANIMALS],
  Europe: [...ANIMALS],
  USA: [...ANIMALS],
};


export const LANGUAGE_BY_REGION: Record<Region, { label: string; second: string }> = {
  India: { label: "English + Hindi", second: "Hindi" },
  MENA: { label: "English + Arabic", second: "Arabic" },
  Europe: { label: "English + Spanish", second: "Spanish" },
  USA: { label: "English + Spanish", second: "Spanish" },
};

export const VALUES = ["Courage", "Patience", "Kindness", "Teamwork"] as const;
export const AGES = ["3-5 years", "6-8 years"] as const;

/** IMMUTABLE PRINT SPEC - all illustrations are 1:1 square. */
export const PRINT_SPEC = {
  aspect: "1:1",
  printPx: 2625, // 8.75in (trim + bleed) @ 300 DPI
  trimIn: 8.5,
  bleedIn: 0.125,
  safeMarginIn: 0.5,
} as const;


export const STYLE_BASE =
  "square 1:1 composition, full square frame, nothing important near the edges (0.125 inch bleed safe), kids book illustration, soft colors, Pixar storybook 2D, no text in image";

/** Locked character bible - keeps every page on-model. */
export const CHARACTER_BIBLE: Record<string, string> = {
  Tiger:
    "Cute baby tiger cub Sheru, orange with black stripes, white belly, pink nose, small rounded ears, big amber eyes, same proportions every page, Pixar storybook 2D, soft colors, lush Indian jungle background, no text in image",
};


export type BookPage = {
  page: number;
  en: string;
  translated: string;
  fact: string;
  scene: string;
  image?: string | undefined;
};

export const BOOK_STATUSES = ["draft", "in_production", "live"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

export const STATUS_LABEL: Record<BookStatus, string> = {
  draft: "DRAFT",
  in_production: "IN PRODUCTION",
  live: "LIVE",
};

export type Book = {
  status?: BookStatus;
  bookNumber?: number | null;
  title: string;
  titleTranslated: string;
  characterName: string;
  characterSheet: string;
  /** Storage path of the approved character reference sheet (book-art bucket). */
  characterSheetPath?: string | undefined;
  /** Displayable (signed or data) URL for that reference sheet. */
  characterSheetImage?: string | undefined;
  animal: string;
  region: Region;

  value: string;
  age: string;
  secondLanguage: string;
  coverScene: string;
  coverImage?: string | undefined;
  blurb: string;
  /** Optional second-language back-cover copy for the wraparound cover. */
  blurbTranslated?: string;
  affirmationEn?: string;
  affirmationTranslated?: string;
  pages: BookPage[];
};

export const BOOK_STORAGE_KEY = "mawil-current-book";
/** Book 1 must pass the KDP validator before Book 2 may be generated. */
export const KDP_VALIDATED_KEY = "mawil-book1-kdp-validated";

const REGION_SETTING: Record<Region, string> = {
  India: "in Indian jungle",
  MENA: "in a desert oasis",
  Europe: "in a European forest",
  USA: "in an American national park",
};

export function characterBible(book: Book) {
  return (
    CHARACTER_BIBLE[book.animal] ??
    `Cute baby ${book.animal} named ${book.characterName}, big eyes, same proportions every page, Pixar storybook 2D, soft colors, ${REGION_SETTING[book.region]} background, no text in image`
  );
}

export function imagePrompt(book: Book, scene: string) {
  return `${characterBible(book)}. Scene: ${scene}. Character sheet: ${book.characterSheet}. ${STYLE_BASE}`;
}

