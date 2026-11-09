/**
 * Annotorious draws with concrete colours (hex or rgb), not CSS variables, so
 * the design tokens from app.css are resolved here through a canvas, which
 * understands whatever colour syntax the browser does (oklch included).
 */

export const DEFAULT_COLORS = {
  accent: '#2563eb',
  line: '#6b7280',
  feature: '#b45309',
} as const;

let scratch: CanvasRenderingContext2D | null | undefined;

/** A colour string the browser accepted, normalized to #rrggbb or rgba(); null when it cannot be parsed. */
export function normalizeColor(value: string): string | null {
  if (typeof document === 'undefined') return null;
  if (scratch === undefined) {
    scratch = document.createElement('canvas').getContext('2d');
  }
  if (!scratch) return null;
  scratch.fillStyle = '#010203';
  scratch.fillStyle = value;
  const result = scratch.fillStyle;
  // An unparseable value leaves the sentinel in place.
  if (result === '#010203' && value.trim().toLowerCase() !== '#010203') return null;
  return typeof result === 'string' ? result : null;
}

/** The value of a CSS custom property on `element`, resolved to a colour, or `fallback`. */
export function resolveToken(element: Element, token: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const raw = getComputedStyle(element).getPropertyValue(token).trim();
  if (!raw) return fallback;
  return normalizeColor(raw) ?? fallback;
}
