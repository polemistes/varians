/**
 * The editors' names as a form sends them: one field per name. Blank fields
 * are dropped and runs of spaces tidied; the order is kept.
 */
export function editorNames(values: FormDataEntryValue[]): string[] {
  return values
    .map((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''))
    .filter((v) => v !== '');
}
