/**
 * Strings of the site's front door: the navigation, the front page, the
 * lists of editions, works and witnesses, "Your work", the search and the
 * two starts. Imported as `site` from '$lib/strings/site'. Plain English,
 * no em dashes.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const site = {
  nav: {
    label: 'Main',
    editions: 'Editions',
    works: 'Works',
    witnesses: 'Witnesses',
    bibliography: 'Bibliography',
    mine: 'Your Work',
    menu: 'Menu',
    search: 'Search:',
    searchField: 'Search Varians',
  },

  home: {
    // For visitors.
    title: 'Scholarly digital editions of ancient texts',
    lead: 'Varians is a workbench for creating and presenting scholarly digital editions of ancient texts. It provides the fundamental tools for transcribing witnesses, collecting conjectures and assembling editions based on this.',
    read: 'Read the editions',
    logIn: 'Log in',
    register: 'Create an account',
    recent: 'Recently published',
    allEditions: 'All editions',
    noEditions: 'No edition has been published yet.',

    // For someone signed in: a menu, then their recent work.
    menu: 'Start',
    readEdition: 'Read Edition',
    registerWork: 'Register Work',
    registerWitness: 'Register Witness',
    transcribeWitness: 'Transcribe Witness',
    makeEdition: 'Make Edition',
    continue: 'Continue',
    allYourWork: (n: number) => `All your work (${n})`,
    edition: 'Edition',
    transcription: 'Transcript',
    shared: 'shared with you',
    draft: 'Draft',
    published: 'Published',
    editionOf: (work: string) => `of ${work}`,
    transcriptionOf: (witness: string) => `of ${witness}`,
    changed: 'changed',
  },

  editions: {
    title: 'Editions',
    none: 'No edition has been published yet.',
    editedBy: (names: string) => `edited by ${names}`,
    count: (n: number) => plural(n, 'edition', 'editions'),
  },

  works: {
    title: 'Works',
    search: 'Search the works',
    placeholder: 'Title or author',
    none: 'No work has been registered yet.',
    newWork: 'New work',
    unknownAuthor: 'Unknown author',
    private: 'Private',
  },

  witnesses: {
    title: 'Witnesses',
    search: 'Search the witnesses',
    placeholder: 'Name, siglum, place or shelfmark',
    none: 'No witness has been registered yet.',
    newWitness: 'New witness',
  },

  sources: {
    title: 'Sources and licences',
    lead: 'The licences of Varians itself, and the data and resources that come with it, with where they come from and the licences they are used under. Each edition and transcript names its own sources and licence in its description.',
    varians: 'Varians',
    resources: 'Data and resources',
    use: 'Used for',
    source: 'Source',
    licence: 'Licence',
    footer: 'Sources and licences',
  },

  footer: {
    /** The link to the source of the running version. */
    source: 'Source code',
  },

  guide: {
    title: 'Guide',
    contents: 'Contents',
  },

  formats: {
    title: 'Data format',
    files: 'Files',
    schemas: 'JSON Schemas',
    tei: 'TEI customization (ODD) and RelaxNG schema',
    changelog: 'Changes',
    example: 'Example archive',
  },

  search: {
    title: 'Search',
    action: 'Search',
    clear: 'Clear',
    resultsFor: (q: string) => `Results for “${q}”`,
    none: (q: string) => `Nothing matches “${q}”.`,
    editions: 'Editions',
    works: 'Works',
    witnesses: 'Witnesses',
    bibliography: 'Bibliography',
    allBibliography: (n: number) => `All ${n} matching entries in the bibliography`,
  },

  mine: {
    title: 'Your work',
    editions: 'Your editions',
    transcriptions: 'Your transcripts',
    shared: 'Shared with you',
    noEditions: 'No editions yet.',
    noTranscriptions: 'No transcripts yet.',
    noShared: 'Nothing has been shared with you.',
    newEdition: 'Make edition',
    newTranscription: 'Transcribe witness',
  },

  start: {
    edition: {
      title: 'Make an edition',
      choose: 'Make edition',
      register: 'Register the work',
    },
    transcription: {
      title: 'Transcribe a witness',
      choose: 'Transcribe witness',
      register: 'Register the witness',
    },
    search: 'Search',
    noneFor: (q: string) => `Nothing matches “${q}”.`,
    none: 'Nothing has been registered yet.',
  },
};
