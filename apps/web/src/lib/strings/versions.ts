/**
 * What the server says of versions: the note a transcript's version gets when
 * an edition publishes it, and why publishing or withdrawing is refused.
 */
export const versionStrings = {
  /** The note on a transcript's version made by publishing an edition that compares it. */
  publishedWith: (title: string, number: number) =>
    `Published with the edition ${title}, version ${number}`,
  /** Publishing an edition is refused while it compares another person's transcripts that have no version at the text compared. */
  othersUnpublished: (witnesses: string[]) =>
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
