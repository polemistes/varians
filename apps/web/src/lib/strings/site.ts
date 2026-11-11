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
    editions: 'Editions',
    noEditions: 'There are no published editions yet.',

    // For someone signed in: a menu, then their recent work.
    menu: 'Start',
    registerWork: 'Register Work',
    registerWitness: 'Register Witness',
    transcribeWitness: 'Transcribe Witness',
    makeEdition: 'Make New Edition',
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
    none: 'There are no published editions yet.',
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

  import: {
    title: 'Import',
    lead: 'A package or an archive from Varians, from this installation or another. What is already here is brought up to date, never overwritten.',
    file: 'Package or archive (zip)',
    preview: 'Look at what it would do',
    previewing: 'This is what the import would do. Nothing has been changed yet.',
    policy: 'Where the changes made to a text here and in the package cannot be taken together',
    policyReport: 'Leave it as it is, and report it',
    policyKeep: 'Keep the text here; keep the other history beside it',
    policyTake: 'Take the text of the package; keep the text here as a moment',
    run: 'Import',
    done: 'Imported.',
    refused: 'Nothing was imported.',
    checked: 'The checksums of the package are right.',
    unchecked: 'An archive without checksums.',
    work: (title: string) => `Work: ${title}`,
    documents: 'Transcripts and editions',
    results: {
      created: 'new here',
      unchanged: 'unchanged',
      'fast-forward': 'brought up to date',
      merged: 'changes on both sides taken together',
      conflict: 'changed on both sides in the same words: left as it is',
      'conflict:missing-anchor': 'changed there in words removed here: left as it is',
      'conflict:segments':
        'changed on both sides so that words would pass into another segment: left as it is',
      'conflict:history': 'with a history there that does not continue the one here: left as it is',
      kept: 'kept as it is here',
      taken: 'replaced by the text of the package',
      refused: 'not yours to change here: left as it is',
    } as Record<string, string>,
    /**
     * What became of a transcript or edition, in the report's words. A
     * conflict is worded by its reason, as the core's `reconcile` names it:
     * the same words changed on both sides, words changed there that are
     * removed here, words that would pass into another segment, and any
     * other reason, which is a history that does not fit this one.
     */
    result(result: string, reason?: string): string {
      const words = this.results;
      if (result !== 'conflict') return words[result] ?? result;
      if (reason === undefined || reason === 'overlap' || reason === 'inapplicable')
        return words.conflict!;
      return words[`conflict:${reason}`] ?? words['conflict:history']!;
    },
    segments: (labels: string) => `segments ${labels}`,
    matched: (kind: string, by: string) =>
      `${kind === 'work' ? 'Work' : 'Witness'} found here by ${by === 'merge' ? 'an earlier merge' : 'its identifier'}`,
    duplicate: (name: string, other: string) =>
      `The witness ${name} may be the same as ${other} here.`,
    newPersons: (names: string) => `New here, without an account: ${names}.`,
    problems: 'Files that do not follow the format',
    expired: 'The upload is no longer here. Upload the package again.',
    noFile: 'Choose a zip file.',
    tooLarge: 'The file is too large for the web; use the command line.',
    tooOften: 'You have imported several packages in the last hour. Try again later.',
  },

  remotes: {
    title: 'Other installations',
    lead: 'Copies of this work on other installations of Varians: compare, bring their changes here, or send yours there.',
    address: 'Address of the work there',
    addressHint: 'Such as https://example.org/works/iliad',
    token: 'Token of your account there',
    tokenHint: 'Needed to send changes there, and to bring drafts here.',
    add: 'Add',
    none: 'No other installation has been added.',
    compare: 'Compare',
    preview: 'Look at what a pull would do',
    pull: 'Bring changes here',
    push: 'Send changes there',
    remove: 'Remove',
    lastPulled: 'last brought here',
    never: 'not yet',
    every: 'Bring changes here every',
    hours: 'hours',
    byHand: 'By hand only',
    differences: {
      same: 'the same',
      differs: 'differs',
      'only-there': 'only there',
      'only-here': 'only here',
    } as Record<string, string>,
    pushed: 'Sent. The other installation keeps its own text where the two conflict.',
    secretMissing:
      'This installation has no SECRET_KEY setting, so it cannot keep a token of another installation.',
  },

  people: {
    noOrcid: 'No ORCID iD is recorded.',
  },

  terms: {
    title: 'Terms of contribution',
    accept: 'Accept these terms',
    acceptedOn: (version: number) => `You accepted version ${version} of these terms`,
    changed:
      'The terms of contribution have changed since you last accepted them. Accept them to go on editing and publishing; reading needs nothing.',
    first: 'Accept the terms of contribution to edit and publish here; reading needs nothing.',
    required: 'Accept the terms of contribution (at /terms) before you edit or publish.',
    footer: 'Terms',
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
    newEdition: 'Make New Edition',
    newTranscription: 'Transcribe witness',
  },

  start: {
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
