/**
 * Every offset in the transcript editor counts Unicode code points, because
 * that is what the server's `mb_*` functions count and what every stored
 * span, region and reading is measured in. JavaScript strings count UTF-16
 * units, which differ for anything outside the Basic Multilingual Plane — a
 * papyrus siglum like 𝔓, an acrophonic numeral — so the DOM's `.length` and
 * `.slice` must never meet a stored offset directly. These two helpers are
 * the only bridge.
 */

export function cpLength(text: string): number {
    return [...text].length;
}

export function cpSlice(text: string, start: number, end?: number): string {
    return [...text].slice(start, end).join('');
}
