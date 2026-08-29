export const REGIONS = ["India", "MENA", "Europe", "USA"] as const;
export type Region = (typeof REGIONS)[number];

export const ANIMALS_BY_REGION: Record<Region, string[]> = {
  India: ["Tiger", "Elephant", "Peacock"],
  MENA: ["Oryx", "Falcon", "Gazelle"],
  Europe: ["Fox", "Bear", "Wolf"],
  USA: ["Eagle", "Bison", "Wolf"],
};

export const LANGUAGE_BY_REGION: Record<Region, { label: string; second: string }> = {
  India: { label: "English + Hindi", second: "Hindi" },
  MENA: { label: "English + Arabic", second: "Arabic" },
  Europe: { label: "English + Spanish", second: "Spanish" },
  USA: { label: "English + Spanish", second: "Spanish" },
};

export const VALUES = ["Courage", "Patience", "Kindness", "Teamwork"] as const;
export const AGES = ["3-5 years", "6-8 years"] as const;

export const STYLE_BASE =
  "cute baby, big eyes, consistent character, kids book illustration, soft colors, Pixar style --ar 4:3";

export type BookPage = {
  page: number;
  en: string;
  translated: string;
  fact: string;
  scene: string;
  image?: string;
};

export type Book = {
  title: string;
  titleTranslated: string;
  characterName: string;
  characterSheet: string;
  animal: string;
  region: Region;
  value: string;
  age: string;
  secondLanguage: string;
  coverScene: string;
  coverImage?: string;
  blurb: string;
  pages: BookPage[];
};

export const BOOK_STORAGE_KEY = "mawil-current-book";

const REGION_SETTING: Record<Region, string> = {
  India: "in Indian jungle",
  MENA: "in a desert oasis",
  Europe: "in a European forest",
  USA: "in an American national park",
};

export function imagePrompt(book: Book, scene: string) {
  return `cute baby ${book.animal} named ${book.characterName}, big eyes, consistent character, ${REGION_SETTING[book.region]}, kids book illustration, soft colors, Pixar style, ${scene}. Character sheet: ${book.characterSheet}. ${STYLE_BASE}`;
}
