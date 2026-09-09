/**
 * Reading an order-report block as an apparatus would: one candidate order
 * is ONE statement of a minimal move against the printed order, never a
 * sequence to mentally diff. Pure; the edition page renders the result.
 */

/**
 * A candidate order as a statement of what moves, not a sequence to
 * mentally diff — "8 comes after 2", "12–19 come after 4" — the way an
 * apparatus reports a transposition.
 *
 * `movedLabels` is the MINIMAL displaced set, and the description is
 * anchored on a neighbour, never on block-relative ends: a witness reading
 * 4 before 1 moved ONE line, even though every line between shifts an
 * index to make room — describing (or colouring) the slid lines as
 * transposed is technically true and intuitively wrong. The single-move
 * search therefore tries the shortest lifted run first, so "4 comes before
 * 1" wins over the equally-valid "1–3 come after 4". Falls back to plainer
 * statements for arrangements no single move produces.
 */
export type SequenceAnalysis = { text: string; movedLabels: Set<string> };

export function analyzeSequence(
    current: string[],
    proposed: string[],
    beforeLabel: string | null = null,
): SequenceAnalysis {
    const n = current.length;

    if (current.join('\u0000') === proposed.join('\u0000')) {
        return { text: "matches the edition's order", movedLabels: new Set() };
    }

    const pos = current.map((label) => proposed.indexOf(label));

    const displaced = current
        .map((label, index) => index)
        .filter((index) => pos[index] !== index);

    const fallback: SequenceAnalysis = {
        text: 'orders these lines differently',
        movedLabels: new Set(displaced.map((index) => current[index])),
    };

    if (pos.includes(-1)) {
        return fallback;
    }

    // One contiguous run lifted out and reinserted elsewhere — shortest
    // run first. Blocks are small, so the search is cheap.
    for (let length = 1; length < n; length++) {
        for (let a = 0; a + length <= n; a++) {
            const run = current.slice(a, a + length);
            const rest = [...current.slice(0, a), ...current.slice(a + length)];

            for (let k = 0; k <= rest.length; k++) {
                const rearranged = [
                    ...rest.slice(0, k),
                    ...run,
                    ...rest.slice(k),
                ];

                if (rearranged.join('\u0000') !== proposed.join('\u0000')) {
                    continue;
                }

                const runLabel =
                    length === 1 ? run[0] : `${run[0]}–${run[run.length - 1]}`;
                const verb = length === 1 ? 'comes' : 'come';
                // A run at the head of the block still FOLLOWS whatever is
                // printed just before the block, and that is the natural
                // anchor — "8 comes after 2", not "8 comes before 3".
                // "Before" appears only at the very start of the edition.
                const text =
                    k > 0
                        ? `${runLabel} ${verb} after ${rest[k - 1]}`
                        : beforeLabel !== null
                          ? `${runLabel} ${verb} after ${beforeLabel}`
                          : `${runLabel} ${verb} before ${rest[0]}`;

                return { text, movedLabels: new Set(run) };
            }
        }
    }

    if (displaced.length === 2) {
        const [i, j] = displaced;

        if (pos[i] === j && pos[j] === i) {
            return {
                text: `${current[i]} and ${current[j]} have exchanged places`,
                movedLabels: new Set([current[i], current[j]]),
            };
        }
    }

    const first = displaced[0];
    const last = displaced[displaced.length - 1];
    let reversed = last > first + 1;

    for (let k = first; k <= last && reversed; k++) {
        reversed = pos[k] === first + last - k;
    }

    if (reversed) {
        return {
            text: `${current[first]}–${current[last]} come in reverse order`,
            movedLabels: new Set(current.slice(first, last + 1)),
        };
    }

    return fallback;
}
