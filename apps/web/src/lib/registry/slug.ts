/**
 * Slugs for registry entries: ASCII, lowercase, hyphenated. Titles in
 * other scripts fall back to the kind of the entry; uniqueSlug on the server
 * then numbers duplicates.
 */

/** Latin letters that Unicode does not decompose into a base letter and a mark. */
const LETTERS: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  đ: 'd',
  ı: 'i',
};

/** Lowercase ASCII where the text is Latin: accents dropped, ligatures spelled out. */
export function asciiFold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[æœøßðþłđı]/g, (c) => LETTERS[c] ?? c);
}

export function slugify(text: string, fallback = 'entry'): string {
  const base = asciiFold(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || fallback;
}
