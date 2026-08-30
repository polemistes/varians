/**
 * Builds a plain-language warning before a destructive delete of a Witness,
 * Transcription, or ManuscriptImage — these are the only three deletes in
 * the app whose cascades reach beyond their own immediate children (see
 * App\Support\DeletionImpact, which computes the counts this describes).
 */

export function pluralize(
    count: number,
    singular: string,
    plural: string = `${singular}s`,
): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

export type DeletionImpactPart<T> = {
    key: keyof T;
    label: (count: number) => string;
};

export function describeDeletionImpact<
    T extends Record<string, number | undefined>,
>(impact: T | undefined, parts: DeletionImpactPart<T>[]): string[] {
    if (!impact) {
        return [];
    }

    return parts
        .filter((part) => (impact[part.key] ?? 0) > 0)
        .map((part) => part.label(impact[part.key] ?? 0));
}

export function confirmDeletion(subject: string, parts: string[]): boolean {
    const message =
        parts.length === 0
            ? `Delete ${subject}?`
            : `Delete ${subject}? This will also permanently delete ${parts.join(', ')}.`;

    return window.confirm(message);
}
