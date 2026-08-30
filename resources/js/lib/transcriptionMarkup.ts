/**
 * Mirrors App\Support\TranscriptionMarkup\MarkupParser for client-side rendering.
 * Unlike the PHP parser, this is intentionally lenient — malformed markup (e.g.
 * an unclosed bracket while the scholar is still typing) falls back to plain
 * text rather than throwing. The PHP parser is the authority on validity; this
 * one only needs to render something reasonable for an in-progress edit.
 */

export type MarkupToken =
    | { type: 'text'; start: number; end: number; text: string }
    | { type: 'supplied'; start: number; end: number; text: string }
    | { type: 'unclear'; start: number; end: number; text: string }
    | {
          type: 'gap';
          start: number;
          end: number;
          reason: 'lost' | 'illegible';
          quantity: number | null;
      };

const TOKEN_PATTERN = /(\[[^[\]]*\]|\{[^{}]*\}|_[^_]*_)/gu;

export function parseTranscriptionMarkup(text: string): MarkupToken[] {
    const tokens: MarkupToken[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;

    TOKEN_PATTERN.lastIndex = 0;

    while ((match = TOKEN_PATTERN.exec(text))) {
        if (match.index > cursor) {
            tokens.push({
                type: 'text',
                start: cursor,
                end: match.index,
                text: text.slice(cursor, match.index),
            });
        }

        const start = match.index;
        const end = start + match[0].length;
        tokens.push(classify(match[0], start, end));
        cursor = end;
    }

    if (cursor < text.length) {
        tokens.push({
            type: 'text',
            start: cursor,
            end: text.length,
            text: text.slice(cursor),
        });
    }

    return tokens;
}

function classify(token: string, start: number, end: number): MarkupToken {
    const outer = token[0];
    const inner = token.slice(1, -1);

    if (outer === '_') {
        return { type: 'unclear', start, end, text: inner };
    }

    const reason: 'lost' | 'illegible' = outer === '[' ? 'lost' : 'illegible';

    if (inner === '?') {
        return { type: 'gap', start, end, reason, quantity: null };
    }

    if (/^\d+$/.test(inner)) {
        return {
            type: 'gap',
            start,
            end,
            reason,
            quantity: parseInt(inner, 10),
        };
    }

    return { type: 'supplied', start, end, text: inner };
}
