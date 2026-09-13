/**
 * Segment labels on the client — the two places a reference scheme's level
 * TYPE matters here. A level holds any string whatever its type (user
 * decision); the type only says how values sort and what comes next.
 */

/**
 * The label to propose after the one just assigned: the trailing run of
 * digits counted up ("1.5" → "1.6", "45a" stays "45a"'s own thing → "45b"
 * is for letters), or the trailing letter stepped on ("327a" → "327b",
 * "z" → "aa"). Anything else is returned unchanged — there is no sensible
 * next value to guess.
 */
export function nextLabel(label: string): string {
    const digits = label.match(/^(.*?)(\d+)$/u);

    if (digits) {
        return digits[1] + (parseInt(digits[2], 10) + 1);
    }

    const letter = label.match(/^(.*?)([A-Za-z])$/u);

    if (!letter) {
        return label;
    }

    const [, prefix, last] = letter;

    if (last === 'z') {
        return `${prefix}aa`;
    }

    if (last === 'Z') {
        return `${prefix}AA`;
    }

    return prefix + String.fromCharCode(last.charCodeAt(0) + 1);
}

/**
 * A level's value as the server stores it in a segment's address: a number
 * when the text is nothing but digits, the text itself otherwise ("4a" in a
 * number level stays "4a"). Mirrors ReferenceScheme::parseLabel's cast.
 */
export function addressValue(raw: string): number | string {
    return /^\d+$/u.test(raw) ? Number(raw) : raw;
}
