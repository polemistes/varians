/**
 * The normalization profile: how a read form is proposed from a written form
 * where that is mechanical, and how read forms are folded for comparison.
 */

import { fold, greekLower, isAllCaps, type FoldOptions, defaultFold } from './fold.ts';
import type { Mark } from '../stream/items.ts';

export interface NormalizationProfile {
  language: string;
  fold: FoldOptions;
  /** Lowercase written forms that are entirely in capitals (majuscule scripts). */
  lowercaseCapitals: boolean;
  /** Place the final sigma when lowercasing Greek. */
  finalSigma: boolean;
  /** Use an abbreviation mark's expansion as the read form. */
  expandAbbreviations: boolean;
  /** Latin: `v` written for `u` and `j` for `i` are read as u and i. */
  latinUV: boolean;
}

export function defaultProfile(language: string): NormalizationProfile {
  const lang = language.toLowerCase().split('-')[0] ?? language;
  const greek = lang === 'grc' || lang === 'el';
  return {
    language,
    fold: defaultFold(language),
    lowercaseCapitals: true,
    finalSigma: greek,
    expandAbbreviations: true,
    latinUV: lang === 'la' || lang === 'lat',
  };
}

/**
 * The read form the profile proposes for a written form, or undefined when
 * the written form stands as it is. Only mechanical steps: it never adds
 * accents, breathings or punctuation.
 */
export function proposeReadForm(
  form: string,
  marks: Mark[] | undefined,
  profile: NormalizationProfile,
): string | undefined {
  let out = form.normalize('NFC');
  if (profile.expandAbbreviations && marks) {
    const expansion = marks.find((m) => m.kind === 'abbr' && typeof m.attrs?.expan === 'string');
    if (expansion && (expansion.from === undefined || expansion.to === undefined)) {
      out = String(expansion.attrs!.expan);
    } else if (expansion) {
      const chars = Array.from(out);
      out =
        chars.slice(0, expansion.from).join('') +
        String(expansion.attrs!.expan) +
        chars.slice(expansion.to).join('');
    }
  }
  if (profile.lowercaseCapitals && isAllCaps(out)) {
    out = profile.finalSigma ? greekLower(out) : out.toLowerCase();
  }
  if (profile.latinUV)
    out = out.replace(/v/g, 'u').replace(/j/g, 'i').replace(/V/g, 'U').replace(/J/g, 'I');
  return out === form ? undefined : out;
}

/** Whether a written form and a read form agree once folded: the pair needs no checking. */
export function agreeUnderFold(form: string, norm: string, profile: NormalizationProfile): boolean {
  return (
    fold(form, { ...profile.fold, stripDiacritics: true }) ===
    fold(norm, { ...profile.fold, stripDiacritics: true })
  );
}

/** A remembered written-to-read pair confirmed by an editor. */
export interface MemoryEntry {
  form: string;
  norm: string;
  count: number;
}

/** The normalization memory of a transcription: confirmed pairs, most used first. */
export class NormalizationMemory {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(entries: MemoryEntry[] = []) {
    for (const entry of entries) this.entries.set(entry.form, { ...entry });
  }

  remember(form: string, norm: string): void {
    const key = form.normalize('NFC');
    const existing = this.entries.get(key);
    if (existing && existing.norm === norm) existing.count++;
    else this.entries.set(key, { form: key, norm, count: 1 });
  }

  forget(form: string): void {
    this.entries.delete(form.normalize('NFC'));
  }

  propose(form: string): string | undefined {
    return this.entries.get(form.normalize('NFC'))?.norm;
  }

  toJSON(): MemoryEntry[] {
    return [...this.entries.values()].sort((a, b) => b.count - a.count);
  }
}
