/**
 * Strings of the bibliography: the shared list, its dialogs, and the
 * citation picker used where conjectures and notes are written. Plain
 * English, no em dashes.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const bibStrings = {
  title: 'Bibliography',
  add: 'Add entry',
  import: 'Import .bib',
  download: 'Download .bib',
  clear: 'Clear',
  count: (shown: number, total: number) =>
    shown === total ? plural(total, 'entry', 'entries') : `${shown} of ${total} entries`,
  empty: 'The bibliography is empty',
  noResults: (q: string) => `Nothing matches “${q}”.`,
  cited: (n: number) => (n === 0 ? 'Not cited yet' : `Cited ${plural(n, 'time', 'times')}`),
  actions: (label: string) => `Actions for ${label}`,
  edit: 'Edit',
  remove: 'Delete',
  previous: 'Previous',
  next: 'Next',
  page: (n: number, of: number) => `Page ${n} of ${of}`,

  entry: {
    addTitle: 'Add an entry',
    editTitle: 'Edit the entry',
    description:
      'The label the apparatus cites by, such as “West 1998”, is made from the names and the year.',
    field: 'biblatex',
    template:
      '@book{key,\n  author = {Family, Given},\n  title = {Title},\n  date = {2000},\n  location = {Place},\n  publisher = {Publisher},\n}',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Entry saved.',
  },

  importDialog: {
    title: 'Import a .bib file',
    description:
      'Entries with new keys are added. Your own entries with a key that exists are updated; entries someone else added are kept as they are.',
    file: 'File',
    text: 'Or paste biblatex',
    run: 'Import',
    cancel: 'Cancel',
    summary: (created: number, updated: number, unchanged: number, kept: number) =>
      [
        created ? `${plural(created, 'entry', 'entries')} added` : '',
        updated ? `${updated} updated` : '',
        unchanged ? `${unchanged} already there` : '',
        kept ? `${kept} kept as someone else entered them` : '',
      ]
        .filter(Boolean)
        .join(', ') + '.',
    nothing: 'Nothing could be read from that text.',
  },

  deleteDialog: {
    title: (label: string) => `Delete ${label}?`,
    description: 'The entry leaves the bibliography for everyone.',
    confirm: 'Delete',
    cancel: 'Cancel',
    cited: (n: number) =>
      `It is cited ${plural(n, 'time', 'times')}; remove those citations first.`,
    forbidden: 'Only whoever added the entry, or a site editor, may delete it.',
    deleted: 'Entry deleted.',
  },

  picker: {
    label: 'References',
    search: 'Find in the bibliography',
    placeholder: 'Author, title or year',
    none: 'Nothing found. Add it on the bibliography page first.',
    prenote: 'Before',
    prenotePlaceholder: 'cf.',
    postnote: 'Pages',
    postnotePlaceholder: '45–47',
    remove: (label: string) => `Remove ${label}`,
    manage: 'Open the bibliography',
  },

  worksCited: 'Works cited',
};
