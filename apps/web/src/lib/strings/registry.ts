/**
 * The strings of the registry pages: works, witnesses, their transcriptions,
 * conjectures and reported readings, maintainers. Imported as `registry`
 * from '$lib/strings/registry'. Plain English, no em dashes.
 */

import { and } from './names';

/**
 * Editions as a refusal names them, in parts: those the person may see by
 * title, and the rest, another person's drafts, only counted.
 */
function editionParts(d: { editions: string[]; hiddenEditions: number }): string[] {
  const parts: string[] = [];
  if (d.editions.length === 1) parts.push(`the edition ${d.editions[0]}`);
  else if (d.editions.length > 1) parts.push(`the editions ${and(d.editions)}`);
  if (d.hiddenEditions) {
    const other = d.editions.length > 0;
    parts.push(
      d.hiddenEditions === 1
        ? `${other ? 'another' : 'an'} edition that is not published`
        : `${d.hiddenEditions} ${other ? 'other ' : ''}editions that are not published`,
    );
  }
  return parts;
}

export const registry = {
  copy: {
    make: 'Make the Copy',
    cancel: 'Cancel',
    failed: 'The copy could not be made.',
    name: 'Name of the Copy',
    title: 'Title of the Copy',
    proposed: (name: string) => `Copy of ${name}`,
    signIn: 'Log in to make a copy.',
    titleRequired: 'Give the copy a title.',
    notAllowed: 'Only a published edition, or one you edit, can be copied.',
    editionTitle: 'Make a Copy of the Edition',
    editionBodyEditor:
      'A draft of your own, from the edition as it stands now: the text, the witnesses, the adopted conjectures, the notes and the settings. The history, collaborators and published versions stay with this edition.',
    editionBodyReader:
      'A draft of your own, from the published version: its text, its witnesses, the adopted conjectures, the notes and the settings. It records where it came from. Witnesses whose transcript you may not see come without one.',
    withoutTranscription: (n: number) =>
      `${n === 1 ? 'One witness comes' : `${n} witnesses come`} without a transcript: you may not see ${n === 1 ? 'it' : 'them'}. Choose others under Witnesses, or ask their owners to publish them.`,
    transcriptionTitle: 'Make a Copy of the Transcript',
    transcriptionBody:
      'A draft of your own, with the text, the works, the settings and the boxes on the images. The history starts afresh, saying where the copy came from.',
  },
  work: {
    newTitle: 'Add New Work',
    editTitle: (title: string) => `Edit ${title}`,
    title: 'Title',
    author: 'Author',
    language: 'Language',
    languageOther: 'Other',
    languageCode: 'Language Code',
    languageCodeHint: 'An ISO 639 code, such as hbo for Biblical Hebrew.',
    identifier: 'Identifier',
    identifierHint:
      'A canonical identifier where one exists, such as a CTS URN: urn:cts:greekLit:tlg0012.tlg001.',
    description: 'Description',
    publicNote:
      'A work is always public and can be listed by all users. Please do not create a duplicate of a work already registered.',
    scheme: 'Reference Scheme',
    create: 'Save',
    save: 'Save',
    saved: 'The work has been saved.',
    created: (title: string) => `${title} has been registered.`,
    schemeSaved: 'The reference scheme has been saved.',
    titleRequired: 'Give the work a title.',
    titleTooLong: 'Use at most 200 characters.',
    tooLong: 'This is too long.',
    languageRequired: 'Choose a language or enter a code.',
    languageInvalid: 'Use a language code of letters and hyphens, such as grc or la.',
    notFound: 'There is no work with this address.',
    unknownAuthor: 'Unknown author',
    newEdition: 'Make New Edition',
    maintainers: 'Maintainers',
    maintainedBy: (names: string) => `Maintained by ${names}`,
    noMaintainers: 'No maintainers',
    detailsSection: 'Details',
    schemeSection: 'Reference Scheme',
    schemeLocked:
      'The work has segments, so the keys and types of its levels are fixed. Labels and separators can still change.',
    maintainersSection: 'Maintainers',
    maintainersHint:
      'Maintainers edit the metadata and the scheme. Using the work needs no permission.',
    editions: 'Editions',
    about: 'About This Work',
    numbering: 'Numbering',
    identifierLabel: 'Identifier',
    maintainersLabel: 'Maintained by',
    noEditions: 'No edition of this work yet.',
    editionEditors: (names: string) => `edited by ${names}`,
    witnesses: 'Witnesses',
    noWitnesses: 'No witness has been transcribed for this work yet.',
    transcribe: 'Make New Transcript…',
    conjectures: 'Conjectures',
    noConjectures: 'No conjecture has been recorded for this work yet.',
    readings: 'Reported Readings',
    noReadings: 'No reading has been reported for this work yet.',
    segments: 'Segments',
    segmentCount: (n: number) => (n === 1 ? '1 segment' : `${n} segments`),
    showSegments: 'Show the Labels',
    noSegments:
      'No segment yet. Segments come into being when text is assigned to them or a conjecture names them.',
    // Complete or partial is a matter of the work: the same codex may hold all of one text and part of another.
    coverage: (n: number, total: number) =>
      total > 0 && n >= total ? `Complete, ${n} of ${total}` : `Partial, ${n} of ${total}`,
    coverageLabel: (n: number, total: number) =>
      total > 0 && n >= total
        ? `Complete: all ${total} passages known here`
        : `Partial: ${n} of ${total} passages known here`,
    coverageTitle: 'Segments transcribed',
    witnessPage: 'About the witness',
    notMaintainer: 'Only the maintainers of this work may edit it.',
    notGoverning: 'Only the creator of the work, or an administrator, may change its maintainers.',
    schemeLockedError: 'The work has segments, so the keys and types of its levels cannot change.',
    labelCollision: (labels: string) =>
      `Two segments would share a label (${labels}). Choose other separators.`,
    removedSelf: 'You no longer maintain this work.',
    inUse: (parts: string) =>
      `This work cannot be deleted while other people's records depend on it: ${parts}.`,
    notCreator: 'Only the creator of the work or an administrator may delete it.',
    editionBy: (name: string) => `owned by ${name}`,
    segmentLabels: 'Labels of the segments',
    archiveFailed: 'The archive could not be written. Try again later.',
    archiveTooOften:
      'The archive has been downloaded several times in the last hour. Try again later.',
    transcribeSignedIn: 'Log in to transcribe a witness of this work.',
  },

  scheme: {
    preset: 'Scheme',
    custom: 'Custom',
    levels: 'Levels',
    level: (n: number) => `Level ${n}`,
    key: 'Key',
    keyHint: 'Lowercase letters, used in files and addresses.',
    label: 'Label',
    type: 'Sorts as',
    number: 'Number',
    text: 'Text',
    separator: 'Separator before',
    separators: {
      '': 'None',
      '.': 'Full stop',
      ':': 'Colon',
      ',': 'Comma',
      '-': 'Hyphen',
      ' ': 'Space',
    } as Record<string, string>,
    addLevel: 'Add a Level',
    removeLevel: 'Remove This Level',
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    sentence: (levels: string, example: string) => `${levels}, as ${example}`,
    example: (label: string) => `Labels look like ${label}.`,
    invalid: 'The scheme is not sound yet.',
    required: 'Choose a scheme.',
    unknownPreset: 'This scheme is not on the list.',
    locked: 'Fixed while the work has segments',
    labelRequired: (n: number) => `Level ${n} has no label.`,
    keyInvalid: (n: number) =>
      `The key of level ${n} must begin with a lowercase letter and use only lowercase letters, digits and hyphens.`,
    firstLevel: 'Printed first',
    editorHint:
      'Keys are used in files and addresses; labels are what readers see. The type decides how values sort.',
    problems: 'Before the scheme can be saved',
    save: 'Save the Scheme',
    exampleOf: (label: string) => `Labels look like ${label}.`,
  },

  witness: {
    newTitle: 'Add New Witness',
    editTitle: (name: string) => `Edit ${name}`,
    siglum: 'Siglum',
    name: 'Name',
    category: 'Category',
    categories: {
      manuscript: 'Manuscript',
      inscription: 'Inscription',
      edition: 'Printed Edition',
      indirect: 'Indirect Source',
      other: 'Other',
    } as Record<string, string>,
    format: 'Format',
    formats: {
      codex: 'Codex',
      roll: 'Roll',
      sheet: 'Single Sheet',
      unknown: 'Not Known',
    } as Record<string, string>,
    sourceAuthor: 'Quoted by',
    sourceWork: 'In the work',
    quotedIn: (author: string, work: string) => [author, work].filter(Boolean).join(', '),
    repository: 'Repository',
    settlement: 'Place',
    shelfmark: 'Shelfmark',
    identifier: 'Identifier',
    date: 'Date',
    material: 'Material',
    materials: {
      papyrus: 'Papyrus',
      parchment: 'Parchment',
      paper: 'Paper',
      'palm-leaf': 'Palm Leaf',
      'birch-bark': 'Birch Bark',
      leather: 'Leather',
      wood: 'Wood',
      'wax-tablet': 'Wax Tablet',
      ostracon: 'Ostracon',
      clay: 'Clay',
      stone: 'Stone',
      metal: 'Metal',
      bone: 'Bone or Ivory',
      textile: 'Textile',
      plaster: 'Plaster',
      other: 'Other',
    } as Record<string, string>,
    materialOther: 'Other Material',
    materialInvalid: 'Choose a material from the list.',
    extent: 'Extent',
    hands: 'Hands',
    handLabel: 'Label',
    handDescription: 'Description',
    handMain: 'Scribe',
    handMainShort: 'the scribe',
    handMainOf: (label: string) =>
      label ? `${label} is the scribe of the text` : 'This hand is the scribe of the text',
    addHand: 'Add Hand',
    removeHand: (label: string) => (label ? `Remove the Hand ${label}` : 'Remove This Hand'),
    handLabelRequired: 'Give every hand a label.',
    handsInvalid: 'The hands could not be read.',
    handsTooMany: (max: number) => `Use at most ${max} hands.`,
    theScribe: 'The scribe',
    anotherHand: 'Another hand',
    handNotKnown: 'Not known',
    provenance: 'Provenance',
    description: 'Description',
    iiif: 'IIIF Manifest',
    create: 'Save',
    save: 'Save',
    saved: 'The witness has been saved.',
    created: (name: string) => `${name} has been registered.`,
    siglumRequired: 'Give the witness a siglum.',
    nameRequired: 'Give the witness a name.',
    tooLong: 'This is too long.',
    notFound: 'There is no witness with this address.',
    detailsSection: 'Description',
    maintainersSection: 'Maintainers',
    maintainersHint:
      'Maintainers edit the description, the pages and the images. Transcribing needs no permission.',
    imagesSection: 'Images',
    imagesHint:
      'The rights statement and credit line new images of the witness are given, unless another is chosen for them.',
    imageRights: 'Rights of Images',
    imageRightsNone: 'None',
    imageAttribution: 'Credit Line',
    applyToPages: (n: number) =>
      n === 1
        ? 'Also give them to the image that has no rights statement'
        : `Also give them to the ${n} images that have no rights statement`,
    imagesSave: 'Save',
    imagesSaved: 'The defaults for images have been saved.',
    imagesApplied: (n: number) =>
      `The defaults for images have been saved and given to ${n === 1 ? '1 image' : `${n} images`}.`,
    pages: 'Pages',
    noPages: 'No pages yet.',
    managePages: 'Manage Pages',
    withImage: 'image',
    withoutImage: 'no image',
    transcriptions: 'Transcripts',
    noTranscriptions: 'Nobody has transcribed this witness yet.',
    newTranscription: 'Make New Transcript…',
    /** The title of the window the button opens: a window's title has no ellipsis. */
    newTranscriptionTitle: 'Make New Transcript',
    works: 'Works',
    noWorks: 'This witness is not connected to any work yet.',
    viaTranscriptions: (n: number) => (n === 1 ? '1 transcript' : `${n} transcripts`),
    viaReadings: (n: number) => (n === 1 ? '1 reported reading' : `${n} reported readings`),
    readings: 'Reported Readings',
    noReadings: 'No reading of this witness has been reported.',
    notMaintainer: 'Only the maintainers of this witness may edit it.',
    notGoverning:
      'Only the creator of the witness, or an administrator, may change its maintainers.',
    removedSelf: 'You no longer maintain this witness.',
    siglumShort: (siglum: string) => `siglum ${siglum}`,
    inUse: (parts: string) => `This witness cannot be deleted while ${parts} depend on it.`,
    notCreator: 'Only the creator of the witness or an administrator may delete it.',
    pageCount: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
    readingsHint: 'Edited on the page of each work.',
  },

  transcription: {
    works: {
      label: 'Works',
      hint: 'The first gives the defaults: the segment labels offered, and the spelling rules for text not yet assigned to a work.',
      none: 'No work chosen.',
      first: 'first',
      find: 'Find a work by title or author',
      add: 'Add',
      remove: 'Remove',
      removeLabel: (title: string) => `Remove ${title}`,
      raise: 'Move Up',
      raiseLabel: (title: string) => `Move ${title} Up`,
      notFound: 'A work chosen does not exist.',
    },
    name: 'Name of Transcript',
    /** The name proposed for a new transcript: it is of its witness, whatever works it has text of. */
    defaultName: (witness: string) => `Transcript of ${witness}`,
    nameRequired: 'Give the transcript a name.',
    keepsWritten: 'Keep a diplomatic form beside the normalized',
    startFrom: 'Start from another transcript',
    /** The name, for a screen reader, of the list shown when that is ticked. */
    startFromWhich: 'Transcript to Start From',
    create: 'Save',
    created: 'The transcript has been created.',
    createdFor: (witness: string) => `A transcript of ${witness} has been created.`,
    /** The refusal to delete a transcript an edition names; the window is the application's (record-actions). */
    inConspectus: (d: { editions: string[]; hiddenEditions: number }) =>
      `This transcript cannot be deleted: it stands behind a siglum in ${and(editionParts(d))}. Remove it from the conspectus first.`,
    notOwner: 'Only the owner or an administrator may do this.',
    notFound: 'This transcript no longer exists.',
    sourceNotAllowed: 'You may not view the transcript to start from.',
    owner: (name: string) => `by ${name}`,
    draft: 'Draft',
    published: 'Published',
    assigns: (work: string, n: number) => `${work}: ${n === 1 ? '1 segment' : `${n} segments`}`,
    unassigned: 'No text assigned to a work yet',
    nameOfWork: (work: string) => work,
    startedFrom: (witness: string, name: string) =>
      `Started from the transcript ${name} of ${witness}.`,
    copiedFrom: (name: string) => `copied from ${name}`,
    work: 'Work',
    witness: 'Witness',
    workNone: 'No Work',
    segmentCount: (n: number) => (n === 1 ? '1 segment' : `${n} segments`),
  },

  picker: {
    title: 'Make New Transcript',
    search: 'Search by name, siglum or shelfmark',
    noMatches: 'No witness matches.',
    typeToSearch: 'Type to search.',
    newWitness: 'Add New Witness',
    create: 'Save',
    chosen: 'Chosen',
    results: 'Witnesses That Match',
  },

  conjecture: {
    add: 'Add New Conjecture…',
    addTitle: 'Add New Conjecture',
    editTitle: 'Edit the Conjecture',
    segment: 'Segment',
    segmentHint: (example: string) => `A label of this work, such as ${example}.`,
    segmentInvalid: 'This label does not fit the scheme of the work.',
    kind: 'Kind',
    kinds: {
      substitution: 'Substitution',
      deletion: 'Deletion',
      addition: 'Addition',
      lacuna: 'Lacuna',
      supplement: 'Supplement',
      transposition: 'Transposition',
    } as Record<string, string>,
    lemma: 'Lemma',
    reading: 'Reading',
    readingHint: 'Empty for a deletion or a lacuna.',
    proposer: 'Proposer',
    note: 'Note',
    extent: 'Extent',
    owner: 'Entered by',
    enteredBy: (name: string) => `entered by ${name}`,
    added: 'The conjecture has been added.',
    updated: 'The conjecture has been saved.',
    save: 'Save',
    notFound: 'This conjecture no longer exists.',
    lemmaRequired: 'Give the words the conjecture concerns.',
    readingRequired: 'Give the proposed words.',
    lacuna: (extent: string | null) => (extent ? `lacuna of ${extent}` : 'lacuna'),
    proposedBy: (name: string) => name,
  },

  reading: {
    add: 'Add New Reported Reading…',
    addTitle: 'Add New Reported Reading',
    editTitle: 'Edit the Reported Reading',
    witness: 'Witness',
    witnessRequired: 'Choose a witness.',
    noWitnesses: 'Register a witness first.',
    lemma: 'Lemma',
    reading: 'Reading',
    source: 'Source',
    note: 'Note',
    added: 'The reading has been reported.',
    updated: 'The reported reading has been saved.',
    notFound: 'This reported reading no longer exists.',
    work: 'Work',
    lemmaOrReading: 'Give the lemma, the reading or both.',
    omits: 'omits',
    chooseWitness: 'Choose a witness',
    save: 'Save',
  },

  maintainers: {
    add: 'Add',
    email: 'Email of the Person to Add',
    added: (name: string) => `${name} now maintains this entry.`,
    removed: (name: string) => `${name} no longer maintains this entry.`,
    noUser: 'No account has this email address.',
    already: 'This person already maintains the entry.',
    creator: 'Creator',
    cannotRemoveCreator: 'The creator cannot be removed.',
    invalidEmail: 'Enter an email address.',
  },

  identifiers: {
    label: 'Identifiers',
    scheme: 'Scheme',
    value: 'Value',
    schemes: {
      cts: 'CTS URN',
      diktyon: 'Diktyon',
      trismegistos: 'Trismegistos',
      wikidata: 'Wikidata',
      viaf: 'VIAF',
      url: 'URL',
      other: 'Other',
    } as Record<string, string>,
    add: 'Add Identifier',
    remove: (value: string) =>
      value ? `Remove the Identifier ${value}` : 'Remove This Identifier',
    schemeOf: (value: string) => (value ? `Scheme of ${value}` : 'Scheme'),
    empty: 'Give a value.',
    tooLong: 'this is too long.',
    unreadable: 'The identifiers could not be read.',
    unknownScheme: 'Choose a scheme from the list.',
    tooMany: (n: number) => `Use at most ${n} identifiers.`,
    problem: (value: string, error: string) => `${value}: ${error}`,
    invalid: {
      cts: 'not a CTS URN of a work, such as urn:cts:greekLit:tlg0012.tlg001.',
      wikidata: 'a Wikidata item is Q followed by digits, such as Q8275.',
      digits: (name: string) => `a ${name} number has digits only.`,
      url: 'an address begins with http:// or https://.',
    },
    lookUp: (scheme: string, value: string) => `${value} in ${scheme}`,
  },

  merge: {
    action: 'Merge into\u2026',
    title: (name: string) => `Merge ${name} into Another Entry`,
    findWork: 'Find the work by title, author or identifier',
    findWitness: 'Find the witness by name, siglum, shelfmark or identifier',
    find: 'Find',
    noMatches: 'No other entry matches.',
    choose: 'Choose',
    chooseLabel: (name: string) => `Merge into ${name}`,
    chooseAnother: 'Choose Another Entry',
    preview: (from: string, into: string) => `${from} into ${into}`,
    survivor: 'The Surviving Entry',
    survivorKeeps:
      'It keeps its own title, description and settings. The identifiers of both entries are kept, and the merged entry is listed on its page.',
    moves: 'What Moves',
    nothingMoves: 'Nothing but the entry itself.',
    blocks: 'What Prevents the Merge',
    transcriptions: (n: number) => (n === 1 ? '1 transcript' : `${n} transcripts`),
    readings: (n: number) => (n === 1 ? '1 reported reading' : `${n} reported readings`),
    conjectures: (n: number) => (n === 1 ? '1 conjecture' : `${n} conjectures`),
    sigla: (editions: string[]) =>
      editions.length === 1
        ? `its siglum in the edition ${editions[0]}`
        : `its sigla in the editions ${and(editions)}`,
    maintainers: (names: string[]) =>
      names.length === 1 ? `${names[0]} as a maintainer` : `${and(names)} as maintainers`,
    pages: (n: number) =>
      n === 1
        ? '1 page, after the pages of the surviving witness'
        : `${n} pages, after the pages of the surviving witness`,
    hands: (labels: string[]) =>
      labels.length === 1 ? `the hand ${labels[0]}` : `the hands ${and(labels)}`,
    identifiers: (values: string[]) =>
      values.length === 1 ? `the identifier ${values[0]}` : `the identifiers ${and(values)}`,
    segmentsMatched: (n: number) =>
      n === 1
        ? '1 segment joined to the segment of the same address'
        : `${n} segments joined to the segments of the same address`,
    segmentsMoved: (n: number) =>
      n === 1
        ? '1 segment the surviving work does not have'
        : `${n} segments the surviving work does not have`,
    editions: (titles: string[]) =>
      titles.length === 1 ? `the edition ${titles[0]}` : `the editions ${and(titles)}`,
    bothInEdition: (titles: string[]) =>
      `The conspectus of ${titles.length === 1 ? `the edition ${titles[0]}` : `the editions ${and(titles)}`} names both witnesses. Remove one of them from it first.`,
    pageConflict: (labels: string[]) =>
      `Both witnesses have ${labels.length === 1 ? `a page labelled ${labels[0]}` : `pages labelled ${and(labels)}`}. Rename, move or delete those pages first.`,
    schemeDiffers:
      'The two works are numbered by reference schemes with different levels, so their segments cannot be matched. Only works whose schemes have the same levels can be merged.',
    labelCollision: (labels: string[]) =>
      `Segments of different addresses would share ${labels.length === 1 ? 'the label' : 'the labels'} ${and(labels)} in the surviving work.`,
    irreversible: 'A merge cannot be undone.',
    confirm: 'Merge',
    done: (from: string, into: string) => `${from} has been merged into ${into}.`,
    notAllowed: 'Only an administrator, or someone who maintains both entries, may merge them.',
    same: 'An entry cannot be merged into itself.',
    gone: 'One of the entries no longer exists.',
    blocked: 'The merge is prevented; see above.',
    mergedHere: 'Merged into this entry',
  },

  search: {
    exists: 'exists; use it?',
    existsPrefix: 'exists;',
    useIt: 'use it?',
    useItLabel: (title: string) => `Use ${title}`,
    searching: 'Searching',
    matches: 'Existing entries that match',
  },

  common: {
    required: 'This field is required.',
    forbidden: 'You are not allowed to do this.',
    signIn: 'Log in to do this.',
    invalidForm: 'Check the fields marked below.',
    actions: 'Actions',
    confirmDelete: 'Delete',
    optional: 'optional',
    none: 'none',
    open: 'Open',
    tooLong: 'This is too long.',
    invalidCitations: 'The citations could not be read; choose them again.',
    cancel: 'Cancel',
    save: 'Save',
    draft: 'Draft',
    published: 'Published',
    and,
    /** What depends on an entry, for the refusal of a deletion. */
    dependents: (d: {
      /** The editions the person may see, by title. */
      editions: string[];
      /** Another person's drafts: counted, never named. */
      hiddenEditions: number;
      transcriptions: number;
      records: number;
      recordsName: 'conjectures' | 'readings';
    }): string => {
      const parts = editionParts(d);
      if (d.transcriptions)
        parts.push(d.transcriptions === 1 ? 'a transcript' : `${d.transcriptions} transcripts`);
      if (d.records) {
        const noun =
          d.recordsName === 'conjectures' ? 'conjecture or reported reading' : 'reported reading';
        const plural =
          d.recordsName === 'conjectures'
            ? 'conjectures or reported readings'
            : 'reported readings';
        parts.push(d.records === 1 ? `a ${noun}` : `${d.records} ${plural}`);
      }
      return and(parts);
    },
  },

  languages: {
    grc: 'Ancient Greek',
    la: 'Latin',
    he: 'Hebrew',
    ar: 'Arabic',
    sa: 'Sanskrit',
    cop: 'Coptic',
    syc: 'Syriac',
    en: 'English',
  } as Record<string, string>,
};

export type RegistryStrings = typeof registry;
