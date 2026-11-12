/**
 * What is said of versions: by the windows that publish and withdraw them,
 * the lists and menus that show them, the badges of the lists, and the
 * server (the note a transcript's version gets when an edition publishes it,
 * and why publishing or withdrawing is refused).
 */
export const versionStrings = {
  /** The note on a transcript's version made by publishing an edition that compares it. */
  publishedWith: (title: string, number: number) =>
    `Published with the edition ${title}, version ${number}`,
  /** Publishing an edition is refused while it compares another person's transcripts that have no version at the text compared. */
  othersNotPublished: (witnesses: string[]) =>
    `${witnesses.join(', ')} ${witnesses.length === 1 ? 'is' : 'are'} compared at a text its owner has not published. Ask them to publish it, or take it out of the witnesses.`,
  /** A witness as the refusal names it: its siglum and its name. */
  witnessNamed: (siglum: string, name: string) => `${siglum} (${name})`,
  /** The name of the published moment that marks a version in the history. */
  momentName: (number: number, date: string) => `Version ${number} (${date})`,
  noSuchVersion: 'There is no such version.',
  alreadyWithdrawn: 'That version is withdrawn already.',
  onlyOwner: 'Only the owner or an administrator publishes and withdraws versions.',
  noteTooLong: (max: number) => `A note has at most ${max} characters.`,
} as const;

/** Words of a count, by its number. */
const words = (n: number) => (n === 1 ? '1 word' : `${n} words`);

export const versions = {
  /** The badge of a record in a list and in the workbench. */
  version: (n: number) => `Version ${n}`,
  draft: 'Draft',
  /** The line that says which version is shown, before its date. */
  published: (n: number) => `Version ${n}, published`,

  /** The Versions menu of the reader and the workbench. */
  menu: {
    label: 'Versions',
    none: 'No Versions',
    current: 'latest',
    withdrawn: 'withdrawn',
    whatChanged: 'What Changed',
    whatChangedOf: (n: number) => `What Changed in Version ${n}`,
    showDraft: 'Show the Draft',
  },

  /** The list of changes since the version before, in Publish… and What Changed. */
  changes: {
    since: (n: number | null) => (n === null ? 'Changes' : `Changes since Version ${n}`),
    totals: (added: number, changed: number, removed: number) =>
      `${words(added)} added, ${changed} changed, ${removed} removed`,
    none: 'No words changed.',
    segment: 'Segment',
    noSegment: 'No Segment',
    added: 'Added',
    changed: 'Changed',
    removed: 'Removed',
    loading: 'Reading the history',
    failed: 'The changes could not be read.',
  },

  /** Publish…, for an edition and a transcript alike. */
  publish: {
    edition: 'Publish Edition',
    transcription: 'Publish Transcript',
    body: (kind: 'edition' | 'transcription', n: number) =>
      `Publish the ${kind === 'edition' ? 'edition' : 'transcript'} as it stands now as version ${n}? Readers will see this version, and it stays as it is when you go on editing.`,
    withTranscripts:
      'Your transcripts that the edition compares are published with it, each as a version of its own.',
    note: 'Note on the Version',
    verb: 'Publish',
    done: (n: number) => `Published as version ${n}.`,
  },

  /** Withdraw Version…, for an edition and a transcript alike. */
  withdraw: {
    title: 'Withdraw Version',
    body: 'Withdraw a version? Its address stays and gives its citation and your note, and no longer its text. A withdrawn version is not brought back; publish a new one instead.',
    which: 'Version',
    option: (n: number, date: string) => `Version ${n}, published ${date}`,
    note: 'Note for Readers',
    verb: 'Withdraw',
    done: (n: number) => `Version ${n} has been withdrawn.`,
    /** The menu item's reason when no version stands. */
    nothing: 'No version to withdraw.',
    loading: 'Reading the versions',
    failed: 'The versions could not be read.',
  },

  /** The page of a withdrawn version. */
  withdrawnPage: {
    withdrawn: 'Withdrawn',
    readLatest: 'Read the latest version',
    /** Above a transcript's name: its witness. */
    witness: (siglum: string, name: string) => `${siglum} · ${name}`,
    /** A transcript as its citation names it. */
    transcript: (witness: string, name: string) => `${witness}, ${name}`,
    cite: 'How to cite',
  },
} as const;
