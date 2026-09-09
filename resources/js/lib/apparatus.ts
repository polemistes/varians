/**
 * What the tradition has at one word, in the reader's terms — the pure
 * helpers behind the edition page's hover apparatus and the split-citation
 * notices. Kept out of the page component so they can be read (and
 * reasoned about) on their own.
 */

import type { Candidate, DiscontinuousWitness, Run } from '@/types/edition';

// A range-shaped candidate's own text is just its proposed replacement —
// nothing there says how many (or which) words it would consume if picked.
// Prefixing the original span it replaces disambiguates that at a glance;
// a plain single-word candidate needs no such prefix, since the run it's
// already offered on is its whole scope.
export function candidateSummary(candidate: Candidate): string {
    return candidate.replaced_text !== null
        ? `${candidate.replaced_text} → ${candidateText(candidate)}`
        : candidateText(candidate);
}

/**
 * A candidate's wording, in words where it has none: a witness's omission
 * reads "omitted", a deletion conjecture "deleted" — full words, never
 * sigla-style abbreviations (user decision).
 */
export function candidateText(candidate: Candidate): string {
    if (!candidate.omitted) {
        return candidate.text;
    }

    return candidate.conjecture_id !== null ? 'deleted' : 'omitted';
}

// The grouping key of every witness that omits the word — no manuscript
// wording can collide with it.
const OMITTED_KEY = '\u0000omitted';

/**
 * What the tradition has at one word, for the reader's tooltip.
 *
 * Readings are grouped by wording rather than listed per witness, the way an
 * apparatus entry names a reading once and then its sigla — three manuscripts
 * agreeing is one line, not three. The manuscripts' own spellings are grouped
 * the same way, and collapse to a single line whenever they agree, which is
 * the common case.
 */
export type ReadingGroup = {
    text: string;
    sigla: string[];
    printed: boolean;
    // The witnesses in this group have no word here — see
    // LemmaReading::$omitted. `text` reads "omitted".
    omitted: boolean;
};

export function groupBy(
    candidates: Candidate[],
    textOf: (candidate: Candidate) => string | null,
    printedText: string,
    withOmissions = false,
): ReadingGroup[] {
    const groups = new Map<string, string[]>();

    for (const candidate of candidates) {
        if (candidate.transcription_layer_id === null) {
            continue;
        }

        // A witness omitting the word is a reading in its own right — the
        // apparatus names it beside the wordings — but only where wording
        // is what is being grouped: it has no "as written" form.
        const text =
            candidate.omitted && withOmissions
                ? OMITTED_KEY
                : textOf(candidate);

        // Empty is not a reading — a flagged remnant of edited-away text,
        // not something a manuscript says (see hasVariation).
        if (text === null || text === '') {
            continue;
        }

        groups.set(text, [...(groups.get(text) ?? []), candidate.label]);
    }

    // Keys are NFC (see sameReading); the printed text must be compared in
    // the same form, or an NFD base reading is never marked as printed.
    const printed = sameReading(printedText);

    return [...groups.entries()].map(([text, sigla]) => ({
        text: text === OMITTED_KEY ? 'omitted' : text,
        sigla: [...new Set(sigla)].sort(),
        // An omission is what is printed exactly when nothing is.
        printed: text === OMITTED_KEY ? printed === '' : text === printed,
        omitted: text === OMITTED_KEY,
    }));
}

/**
 * Readings are grouped by what they say, so the key has to be normalized:
 * text pasted or imported is stored in whatever Unicode form it arrived in,
 * and NFC "ἄειδε" and NFD "ἄειδε" are the same word rendered identically but
 * different strings. Ungrouped, one manuscript would be listed twice over a
 * difference nobody can see. Collation already compares in this form — see
 * PassageAligner::comparisonForm.
 */
export function sameReading(text: string | null): string | null {
    return text === null ? null : text.normalize('NFC');
}

export function witnessReadings(run: Run): ReadingGroup[] {
    return groupBy(run.candidates, (c) => sameReading(c.text), run.text, true);
}

export function manuscriptReadings(run: Run): ReadingGroup[] {
    return groupBy(run.candidates, (c) => sameReading(c.diplomatic), '\u0000');
}

/**
 * What the manuscripts themselves say about a difference, where they can be
 * consulted: 'agree' when every known diplomatic reading is the same,
 * 'differ' when they are not, and 'none' when fewer than two witnesses have a
 * visible diplomatic layer and the question cannot be put to them.
 */
export function manuscriptEvidence(run: Run): 'agree' | 'differ' | 'none' {
    const known = run.candidates.filter(
        (candidate) =>
            candidate.transcription_layer_id !== null &&
            candidate.diplomatic !== null,
    );

    if (known.length < 2) {
        return 'none';
    }

    return new Set(known.map((candidate) => candidate.diplomatic)).size === 1
        ? 'agree'
        : 'differ';
}

/**
 * Where a difference came from, in the reader's terms, or null when there is
 * nothing to say.
 *
 * The manuscripts settle it wherever they can be consulted. Where they cannot,
 * a difference of accent, breathing or pointing is still not attributable to
 * them: collation reads the normalized layer, and those marks are supplied in
 * normalizing, so such a difference belongs to the editor until a diplomatic
 * layer shows otherwise.
 */
export function differenceProvenance(run: Run): string | null {
    const evidence = manuscriptEvidence(run);

    if (evidence === 'agree') {
        return 'The manuscripts agree here — this difference was made in normalizing, not by the scribes.';
    }

    if (evidence === 'differ' && run.orthographic_variation) {
        return 'The manuscripts themselves differ in accent or pointing here.';
    }

    if (evidence === 'none' && run.orthographic_variation) {
        return 'Accents, breathings and pointing are supplied in normalizing. With no diplomatic layer to check against, this difference cannot be traced to the manuscripts.';
    }

    return null;
}

// "B has this passage in 2 places (part 1 follows 41, part 2 follows 44)" —
// the sub-passage transposition story, one sentence per witness. Shown in
// the ⇄ marker's click panel and, joined up, as its hover title.
export function discontinuitySentence(witness: DiscontinuousWitness): string {
    const parts = witness.parts
        .map((part) =>
            part.after_label
                ? `part ${part.part} follows ${part.after_label}`
                : `part ${part.part} stands first`,
        )
        .join(', ');

    return `${witness.siglum} has this passage in ${witness.parts.length} places (${parts})`;
}

// Prefer the apparatus statements ('R2: 4 2/2 "πάρεστιν ἐνταυθοῖ γυνή·"
// has exchanged places with 5 2/2 "κωμῆτις ἥδʼ ἐξέρχεται."') — the
// scholarly reading of the split — falling back to the mechanical per-part
// sentence when nothing is actually displaced (parts merely separated).
export function discontinuityLines(witness: DiscontinuousWitness): string[] {
    return witness.statements.length > 0
        ? witness.statements
        : [discontinuitySentence(witness)];
}

export function discontinuityTitle(witnesses: DiscontinuousWitness[]): string {
    return witnesses.flatMap(discontinuityLines).join('; ');
}

/** The conjectures proposed at this word, for the tooltip's second list. */
export function conjectureCandidates(run: Run): Candidate[] {
    return run.candidates.filter(
        (candidate) => candidate.conjecture_id !== null,
    );
}
