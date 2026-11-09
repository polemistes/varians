/** "a", "a and b", "a, b and c": a list of names as prose. */
export function and(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
