export const REGIONS = ["India", "MENA", "Africa", "Europe", "USA"] as const;
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
  Africa: [...ANIMALS],
  Europe: [...ANIMALS],
  USA: [...ANIMALS],
};


export const LANGUAGE_BY_REGION: Record<Region, { label: string; second: string }> = {
  India: { label: "English + Hindi", second: "Hindi" },
  MENA: { label: "English + Arabic", second: "Arabic" },
  Africa: { label: "English + Swahili", second: "Swahili" },
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
  Pangolin:
    "Cute baby pangolin named Tumbi, storybook character proportions with a noticeably large rounded head and large dark shining friendly eyes on a small body, warm mid earth-brown scales with soft olive undertones and paler edges overlapping like rounded artichoke leaves, pale cream face and scale-free belly, small rounded ears, a narrow gentle snout, a long heavy tapering scaled tail as long as his body, a long low body carried close to the ground, short sturdy legs with curled-under front claws, walks low on all fours and rears up on his hind legs to look at something, exactly the same warm earth-brown colour in every image - never orange, never grey, never green, same proportions every page, Pixar storybook 2D, soft colours, warm African savanna and open woodland background, no text in image",
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
  /** Amazon marketplace host this edition is sold on. Defaults to amazon.com. */
  marketplace?: string;
};

/** KDP prints and ships in these marketplaces; amazon.in is not one of them. */
export const AMAZON_MARKETPLACES = [
  "www.amazon.com",
  "www.amazon.co.uk",
  "www.amazon.ca",
  "www.amazon.com.au",
  "www.amazon.de",
  "www.amazon.fr",
  "www.amazon.es",
  "www.amazon.it",
  "www.amazon.nl",
  "www.amazon.pl",
  "www.amazon.se",
  "www.amazon.co.jp",
] as const;

export const DEFAULT_MARKETPLACE = "www.amazon.com";

export function amazonSearchUrl(title: string, marketplace?: string) {
  const host = marketplace?.trim() || DEFAULT_MARKETPLACE;
  return `https://${host}/s?k=${encodeURIComponent(title)}`;
}

export const BOOK_STORAGE_KEY = "mawil-current-book";
/** Book 1 must pass the KDP validator before Book 2 may be generated. */
export const KDP_VALIDATED_KEY = "mawil-book1-kdp-validated";

const REGION_SETTING: Record<Region, string> = {
  India: "in Indian jungle",
  MENA: "in a desert oasis",
  Africa: "in a warm African savanna and open woodland",
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

