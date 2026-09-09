/**
 * The client side of the bibliography's biblatex vocabulary. The registry
 * itself (types, fields, the standard fields per type) is shipped by the
 * server as a prop — see App\Support\Bibliography\Biblatex, the one source
 * — so this holds only what the item form needs to do locally: read and
 * write biblatex name lists, and preview an entry as biblatex would write
 * it.
 */

export type FieldKind =
    | 'name'
    | 'list'
    | 'literal'
    | 'date'
    | 'range'
    | 'integer'
    | 'verbatim'
    | 'uri'
    | 'key'
    | 'keylist';

export type FieldSpec = {
    name: string;
    kind: FieldKind;
    group: string;
    label: string;
};

export type BiblatexRegistry = {
    types: string[];
    fields: FieldSpec[];
    standard: Record<string, string[]>;
};

export type Name = { family: string; given: string };

/**
 * What the list already records, offered while typing — see
 * App\Support\Bibliography\Suggestions. Names serve every name-list
 * field; the others serve the field of that name.
 */
export type Suggestions = {
    names: Name[];
    publisher: string[];
    journaltitle: string[];
    location: string[];
    series: string[];
};

export function emptySuggestions(): Suggestions {
    return {
        names: [],
        publisher: [],
        journaltitle: [],
        location: [],
        series: [],
    };
}

export const FIELD_GROUP_LABELS: Record<string, string> = {
    names: 'Names',
    titles: 'Titles',
    publication: 'Publication',
    dates: 'Dates',
    identifiers: 'Identifiers',
    notes: 'Notes',
    other: 'Other',
};

function splitOutsideBraces(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth = Math.max(0, depth - 1);
        }

        if (depth === 0 && text.startsWith(separator, i)) {
            parts.push(current);
            current = '';
            i += separator.length - 1;
            continue;
        }

        current += char;
    }

    parts.push(current);

    return parts;
}

function unbrace(text: string): string {
    return text.replace(/[{}]/g, '');
}

/** "Last, First and Last, First" (or "First Last") into family/given pairs. */
export function parseNames(list: string): Name[] {
    const names: Name[] = [];

    for (const raw of splitOutsideBraces(list, ' and ')) {
        const trimmed = raw.trim();

        if (trimmed === '') {
            continue;
        }

        const parts = splitOutsideBraces(trimmed, ',');

        if (parts.length >= 2) {
            names.push({
                family: unbrace(parts[0].trim()),
                given: unbrace(parts.slice(1).join(',').trim()),
            });
            continue;
        }

        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            names.push({ family: unbrace(trimmed), given: '' });
            continue;
        }

        const words = trimmed.split(/\s+/u);
        const family = unbrace(words.pop() ?? '');
        names.push({ family, given: unbrace(words.join(' ')) });
    }

    return names;
}

/** Family/given pairs back into biblatex's unambiguous "Last, First" list. */
export function serializeNames(names: Name[]): string {
    return names
        .filter((name) => name.family.trim() !== '')
        .map((name) => {
            const family = name.family.trim();
            const given = name.given.trim();

            if (given === '') {
                return family.includes(' ') ? `{${family}}` : family;
            }

            return `${family}, ${given}`;
        })
        .join(' and ');
}

/** The entry as biblatex writes it, fields in the registry's order. */
export function biblatexEntry(
    entryType: string,
    citationKey: string,
    fields: Record<string, string>,
    registry: BiblatexRegistry,
): string {
    const lines = registry.fields
        .filter((spec) => (fields[spec.name] ?? '').trim() !== '')
        .map((spec) => `  ${spec.name} = {${fields[spec.name].trim()}}`);

    return `@${entryType}{${citationKey || '…'},\n${lines.join(',\n')}\n}`;
}
