/**
 * What may be done with a record, wherever it stands: the buttons beside its
 * name, its menu, and the windows that ask before an action. One label for
 * one thing; each kind of record has its own part.
 */
export const recordActions = {
  /** The accessible name of a record's ⋯ menu; in a list, with the record's name. */
  menu: 'Actions',
  menuOf: (name: string) => `Actions: ${name}`,
  cancel: 'Cancel',
  /** When the server gives no reason. */
  failed: 'That could not be done.',

  edition: {
    read: 'Read',
    edit: 'Edit',
    /** Read and Edit in a list, where several rows have them. */
    readOf: (title: string) => `Read: ${title}`,
    editOf: (title: string) => `Edit: ${title}`,

    settings: 'Edition Settings',
    publish: 'Publish…',
    unpublish: 'Unpublish…',
    copy: 'Make a Copy…',
    download: 'Download',
    plainText: 'Plain Text with Apparatus',
    tei: 'TEI XML',
    package: 'Package',
    delete: 'Delete Edition…',

    /** The editor's own button, besides the menu's item. */
    publishButton: 'Publish',

    publishTitle: 'Publish Edition',
    publishBody:
      'Publish the edition as it stands now? Readers will see this version, and it stays citable when you go on editing.',
    publishVerb: 'Publish',
    published: (n: number) => `Published as version ${n}.`,
    unpublishTitle: 'Unpublish Edition',
    unpublishBody: 'Take the edition back to a draft? Readers will no longer find it.',
    unpublishVerb: 'Unpublish',
    unpublished: 'The edition is a draft again.',
    deleteTitle: 'Delete Edition',
    deleteBody:
      'Delete this edition? Its text, notes and history go with it. The witnesses and conjectures stay.',
    deleteVerb: 'Delete',
    deleted: (title: string) => `${title} has been deleted.`,
    onlyOwner: 'Only the owner may do that.',

    /** Edition Settings: who owns the edition and who edits it with the owner. */
    people: {
      title: 'Owner and Collaborators',
      owner: 'Owner',
      collaborators: 'Collaborators',
      collaboratorsHint:
        "Collaborators edit the edition, its witnesses' transcripts and the owner's conjectures on the work. Only the owner publishes, invites and deletes.",
      nobody: 'Nobody yet.',
      invite: 'Invite by email',
      inviteAction: 'Invite',
      invited: (name: string) => `${name} may now edit the edition.`,
      remove: 'Remove',
      removeOf: (name: string) => `Remove ${name}`,
      removeTitle: 'Remove Collaborator',
      removeBody: (name: string) =>
        `Remove ${name} from the collaborators? They will no longer edit the edition.`,
      removeVerb: 'Remove',
      removed: (name: string) => `${name} has been removed.`,
      offer: 'Offer ownership to',
      offerHint:
        'The person named becomes the owner when they accept on their account page. You stay on as a collaborator.',
      offerAction: 'Offer',
      offered: 'Offered. Ownership moves when it is accepted.',
      openOffer: (name: string) => `Offered to ${name}; it can be withdrawn on your account page.`,
      // Refusals.
      emailRequired: 'Give an email address.',
      noAccount: 'Nobody with that address has an account.',
      isOwner: 'That is the owner.',
      already: 'Already a collaborator.',
      notACollaborator: 'Not a collaborator.',
      ownsAlready: 'You own it already.',
      offerOpen: 'An offer is already open; withdraw it on your account page first.',
    },
  },
};
