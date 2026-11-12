/**
 * What is said of versions: by the windows that publish, withdraw and delete
 * them, the lists and menus that show them, the badges of the lists, and the
 * server (the note a transcript's version gets when an edition publishes it,
 * and why publishing, withdrawing or deleting is refused).
 */
import { and } from './names.ts';

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
  onlyAdministrator: 'Only an administrator deletes a version.',
  /** A version of an edition as a refusal names it. */
  versionOf: (number: number, title: string) => `version ${number} of ${title}`,
  /** Deleting a transcript's version is refused while versions of editions compare it. */
  compared: (versions: string[]) => {
    const list = and(versions);
    return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${versions.length === 1 ? 'compares' : 'compare'} this version of the transcript. Delete ${versions.length === 1 ? 'that version' : 'those versions'} first.`;
  },
  noteTooLong: (max: number) => `A note has at most ${max} characters.`,
} as const;

/** Words of a count, by its number. */
const words = (n: number) => (n === 1 ? '1 word' : `${n} words`);

export const versions = {
  /** The badge of a record in a list and in the workbench. */
  version: (n: number) => `Version ${n}`,
  draft: 'Draft',
  /** The badge beside a withdrawn version shown in the workbench. */
  withdrawn: 'Withdrawn',
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
    body: 'Withdraw a version? Someone may have cited it: its address stays, and its text is read there under a warning with your note. A withdrawn version is not brought back; publish a new one instead.',
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

  /** Delete Version…, an administrator's alone, for an edition and a transcript alike. */
  delete: {
    title: 'Delete Version',
    body: 'Delete a version? Its text and its address are gone for good, and whoever has cited it finds nothing there. A version is withdrawn where a warning is enough.',
    which: 'Version',
    option: (n: number, date: string) => `Version ${n}, published ${date}`,
    optionWithdrawn: (n: number, date: string) => `Version ${n}, published ${date}, withdrawn`,
    verb: 'Delete',
    done: (n: number) => `Version ${n} has been deleted.`,
    loading: 'Reading the versions',
    failed: 'The versions could not be read.',
  },

  /** The warning on a withdrawn version, which is still read at its address. */
  withdrawnNotice: {
    /** Before the date of the withdrawal. */
    withdrawn: (n: number) => `Version ${n} was withdrawn`,
    /** In the line that says which version is shown, before the date of the withdrawal. */
    line: 'withdrawn',
    /** The link to the version that stands in its place. */
    readLatest: (n: number) => `Read version ${n}, the latest`,
  },

  /** A transcript as the citation of its version names it. */
  transcriptCited: (witness: string, name: string) => `${witness}, ${name}`,
} as const;
