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

  work: {
    edit: 'Edit',
    /** Edit in a list, where several rows have it. */
    editOf: (title: string) => `Edit: ${title}`,

    remotes: 'Other Installations',
    download: 'Download',
    package: 'Package',
    archive: 'Archive with History',
    merge: 'Merge into…',
    delete: 'Delete Work…',

    deleteTitle: 'Delete Work',
    deleteBody:
      'Delete this work? Its segments, its editions with their history, its conjectures and its reported readings go with it. Transcripts keep their text.',
    deleteVerb: 'Delete',
    deleted: (title: string) => `${title} has been deleted.`,
  },

  witness: {
    edit: 'Edit',
    editOf: (name: string) => `Edit: ${name}`,

    merge: 'Merge into…',
    delete: 'Delete Witness…',

    deleteTitle: 'Delete Witness',
    deleteBody: 'Delete this witness? Its pages, its images and your transcripts of it go with it.',
    deleteVerb: 'Delete',
    deleted: (name: string) => `${name} has been deleted.`,
  },

  /** A transcript: read where it is edited, so it has no Read and Edit buttons. */
  transcription: {
    settings: 'Settings…',
    copy: 'Make a Copy…',
    download: 'Download',
    tei: 'TEI XML',
    leiden: 'Leiden+',
    delete: 'Delete Transcript…',

    deleteTitle: 'Delete Transcript',
    deleteBody:
      'Delete this transcript? Its text and history go with it. The witness and its pages stay.',
    deleteVerb: 'Delete',
    deleted: 'The transcript has been deleted.',
  },

  /** A smaller record, which has no page: its row's menu opens with Edit and ends with Delete. */
  conjecture: {
    edit: 'Edit…',
    delete: 'Delete…',
    deleteTitle: 'Delete Conjecture',
    deleteBody:
      'Delete this conjecture? It leaves the catalogue of the work and every edition that adopted it.',
    deleteVerb: 'Delete',
    deleted: 'The conjecture has been deleted.',
  },
  reading: {
    edit: 'Edit…',
    delete: 'Delete…',
    deleteTitle: 'Delete Reported Reading',
    deleteBody:
      'Delete this reported reading? It leaves the catalogue of the work and the apparatus of every edition that reports it.',
    deleteVerb: 'Delete',
    deleted: 'The reported reading has been deleted.',
  },
  bibliography: {
    edit: 'Edit…',
    delete: 'Delete…',
    deleteTitle: 'Delete Entry',
    deleteBody: (label: string) =>
      `Delete ${label}? The entry leaves the bibliography for everyone.`,
    deleteVerb: 'Delete',
    deleted: 'The entry has been deleted.',
  },

  /** What is taken out of a list or ended, and asks first. */
  note: {
    delete: 'Delete…',
    deleteOf: (segment: string) => `Delete the note on ${segment}`,
    deleteTitle: 'Delete Note',
    deleteBody: 'Delete this note? It leaves the edition.',
    deleteVerb: 'Delete',
    deleted: 'The note has been deleted.',
  },
  maintainer: {
    remove: (name: string) => `Remove ${name}`,
    removeTitle: 'Remove Maintainer',
    removeBody: (name: string, entry: 'work' | 'witness') =>
      `Remove ${name} from the maintainers? They will no longer edit this ${entry}.`,
    removeSelfBody: (entry: 'work' | 'witness') =>
      `Remove yourself from the maintainers? You will no longer edit this ${entry}.`,
    removeVerb: 'Remove',
  },
  remote: {
    remove: 'Remove…',
    removeOf: (address: string) => `Remove ${address}`,
    removeTitle: 'Remove Installation',
    removeBody:
      'Remove this installation from the list? The work there stays as it is, and the schedule and the token kept for it here are forgotten.',
    removeVerb: 'Remove',
    removed: 'The installation has been removed.',
  },
  token: {
    revoke: 'Revoke…',
    revokeOf: (name: string) => `Revoke ${name}`,
    revokeTitle: 'Revoke Token',
    revokeBody: (name: string) =>
      `Revoke the token ${name}? Whatever uses it will be refused from now on.`,
    revokeVerb: 'Revoke',
  },

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
