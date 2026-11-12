/**
 * Strings of the pages screen of a witness: the list of pages, their images
 * (uploads and IIIF), labels and order. Components import `pageStrings` from
 * '$lib/strings/pages'. Plain English, no em dashes.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const pageStrings = {
  title: (witness: string) => `Pages of ${witness}`,
  /** "12 pages, 10 with an image." */
  summary: (pages: number, withImage: number) => {
    const count = plural(pages, 'page', 'pages');
    if (pages === 0) return 'No pages yet.';
    const images =
      withImage === 0
        ? 'none with an image yet'
        : withImage === pages
          ? pages === 1
            ? 'with an image'
            : 'all with images'
          : `${withImage} with an image`;
    return `${count}, ${images}.`;
  },
  lead: (siglum: string, pages: number, withImage: number) =>
    `Siglum ${siglum}. ${pageStrings.summary(pages, withImage)}`,
  empty: 'No pages yet',
  emptyHint:
    'Add images, one page per file; add pages by their labels and give them images later; or import the pages of a IIIF manifest.',
  gridLabel: 'Pages in order',

  card: {
    noImage: 'No image',
    addImage: 'Add an Image…',
    dropHere: 'Drop the image here',
    current: 'The page shown',
    open: (label: string) => `Go to ${label}`,
    position: (n: number) => `No. ${n}`,
    size: (width: number, height: number) => `${width} × ${height}`,
    iiif: 'IIIF',
    view: (label: string) => `View ${label}`,
    rename: (label: string) => `Rename ${label}`,
    renameField: 'Label',
    /** The accessible name of a card's menu, as every record's is. */
    menu: (label: string) => `Actions: ${label}`,
    zones: (n: number) => plural(n, 'box', 'boxes'),
    breaks: (n: number) => (n === 1 ? 'text in 1 transcript' : `text in ${n} transcripts`),
    /** In the workbench: the page's text in the transcript shown. */
    lines: (n: number) => plural(n, 'line', 'lines'),
    noText: 'No text',
    referencedTitle: 'Boxes drawn on it, or text on it in transcripts',
    working: 'Working',
    uploading: (percent: number) => `Uploading ${percent}%`,
    processing: 'Making tiles',
  },

  menu: {
    view: 'View',
    rename: 'Rename…',
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    moveTo: 'Move to Position…',
    addImage: 'Add an Image…',
    replaceImage: 'Replace Image…',
    removeImage: 'Remove Image…',
    moveImage: 'Move Image to Another Page…',
    shiftImages: 'Shift Images from Here…',
    rights: 'Rights of the Image…',
    remove: 'Remove Page…',
    /** Why an item is disabled. */
    busy: 'A change is under way.',
    first: 'It is the first page.',
    last: 'It is the last page.',
    onlyPage: 'There is only one page.',
  },

  /** The pages tab of the transcription workbench. */
  panel: {
    loading: 'Loading the pages',
    failed: 'The pages could not be loaded.',
    retry: 'Try Again',
    addImages: 'Add Images',
    addPages: 'Add Pages',
    close: 'Close',
    readOnly: 'Only the maintainers of the witness may change its pages.',
    empty: 'This witness has no pages yet.',
    emptyHint:
      'Add images, one page per file; add pages by their labels; or import a IIIF manifest.',
    emptyReadOnly: 'Its maintainers can add some.',
  },

  add: {
    title: 'Add Pages',
    labels: 'Labels',
    labelsHint: 'A range such as 1r-12v, 1-20, p. 1-20 or col. i-iv, or a list: 12r, 12v, 13r.',
    placeholder: '1r-12v',
    placeholderRoll: 'col. i-xii',
    preview: (count: number, first: string, last: string) =>
      count === 1 ? `1 page: ${first}` : `${count} pages: ${first} … ${last}`,
    submit: (count: number) => (count > 1 ? `Add ${count} Pages` : 'Add'),
    added: (count: number, first: string, last: string) =>
      count === 1 ? `Added the page ${first}.` : `Added ${count} pages, ${first} to ${last}.`,
  },

  labels: {
    required: 'Enter at least one label.',
    tooLong: (max: number) => `A label may have at most ${max} characters.`,
    tooMany: (count: number, max: number) =>
      `That makes ${count} pages; at most ${max} can be added at once.`,
    backwards: (range: string) => `The range ${range} runs backwards.`,
    mixed: (range: string) => `The two ends of ${range} are not of the same kind.`,
    prefixes: (range: string) => `The two ends of ${range} have different prefixes.`,
    incomplete: (range: string) => `The range ${range} has only one end.`,
  },

  upload: {
    title: 'Add Images',
    hint: (maxMb: number) =>
      `JPEG, PNG, TIFF or WebP, up to ${maxMb} MB each. One page per file, in the order of the file names.`,
    drop: 'Drop images here',
    dropOr: 'Drop images here, or',
    choose: 'Choose Files',
    files: 'Images',
    labelsFrom: 'Labels',
    byName: 'From the file names, without their extensions',
    bySequence: (next: string) => `Continuing the pages: ${next}, …`,
    submit: (count: number) =>
      count === 0 ? 'Upload' : count === 1 ? 'Upload 1 Image' : `Upload ${count} Images`,
    stop: 'Stop',
    clear: 'Clear the List',
    remove: (name: string) => `Leave Out ${name}`,
    queued: 'Waiting',
    uploading: (percent: number) => `Uploading ${percent}%`,
    processing: 'Making tiles',
    done: (label: string) => `Added as ${label}`,
    stopped: 'Stopped',
    tooLarge: (maxMb: number) => `Larger than ${maxMb} MB.`,
    notImage: 'Not a JPEG, PNG, TIFF or WebP image.',
    noFiles: 'Choose one or more images first.',
    failed: 'The upload failed. Try again.',
    network: 'The connection was lost. Try again.',
    tooLargeForServer: 'The server refused a file this large.',
    added: (count: number) =>
      count === 1 ? 'Added 1 page with its image.' : `Added ${count} pages with their images.`,
    addedSome: (added: number, failed: number) =>
      `Added ${plural(added, 'page', 'pages')}; ${plural(failed, 'file', 'files')} could not be added.`,
    allFailed: 'None of the files could be added.',
    fileFailed: (name: string, message: string) => `${name}: ${message}`,
    errors: {
      'too-large': (maxMb: number) => `The file is larger than ${maxMb} MB.`,
      'unsupported-type': 'Images must be JPEG, PNG, TIFF or WebP.',
      unreadable: 'The file could not be read as an image.',
    },
    replaced: (label: string) => `The image of ${label} has been replaced.`,
    attached: (label: string) => `${label} has an image now.`,
    fileRequired: 'Choose an image.',
    size: (bytes: number) =>
      bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`,
  },

  /** The rights statement, credit line and source of an image. */
  rights: {
    statement: 'Rights Statement',
    choose: 'Choose a statement',
    credit: 'Credit Line',
    source: 'Source',
    sourceHint: 'The address the image was obtained from.',
    notCopyable:
      'An image under this statement is shown here but not copied into archives or downloads.',
    required: 'Choose the rights statement of the image.',
    notListed: 'Choose a statement from the list.',
    creditTooLong: (max: number) => `A credit line may have at most ${max} characters.`,
    sourceInvalid:
      'Enter a full address beginning with http:// or https://, or leave the source empty.',
    missing: 'No rights statement',
    title: (label: string) => `Rights of the Image of ${label}`,
    submit: 'Save',
    saved: (label: string) => `The rights of the image of ${label} have been saved.`,
    noImage: (label: string) => `${label} has no image.`,
  },

  /** Giving one page an image, with its rights. */
  image: {
    addTitle: (label: string) => `An Image for ${label}`,
    replaceTitle: (label: string) => `Replace the Image of ${label}`,
    file: 'Image',
    submit: 'Upload',
  },

  rename: {
    renamed: (from: string, to: string) => `${from} is now ${to}.`,
    cancel: 'Press Escape to cancel',
  },

  move: {
    title: (label: string) => `Move ${label}`,
    description: (count: number) => `Choose its new position, from 1 to ${count}.`,
    position: 'Position',
    submit: 'Move',
    moved: (label: string, position: number) => `${label} is now page ${position}.`,
    invalid: (count: number) => `Enter a number from 1 to ${count}.`,
  },

  replaceImage: {
    zones: (n: number) =>
      `${n === 1 ? 'A zone is' : `${n} zones are`} drawn on it, as parts of the image. On a new image they keep their places, which fit only if it shows the page as the old one did.`,
  },

  moveImage: {
    title: (label: string) => `Move the Image of ${label}`,
    description:
      'The image goes to the page chosen. If that page has an image, the two change places.',
    target: 'To the page',
    withImage: (label: string) => `${label} (has an image)`,
    swaps: (label: string) => `${label} has an image: the two images change places.`,
    zones: (n: number, label: string) =>
      `${n === 1 ? 'A zone is' : `${n} zones are`} drawn on ${label}. Zones stay with their page and will be shown on the image that comes to it.`,
    submit: 'Move Image',
    moved: (from: string, to: string) => `The image of ${from} is now on ${to}.`,
    swapped: (from: string, to: string) => `The images of ${from} and ${to} have changed places.`,
    choose: 'Choose the page the image goes to.',
    noImage: (label: string) => `${label} has no image to move.`,
    samePage: 'Choose another page.',
    otherWitness: 'Both pages must belong to this witness.',
  },

  shiftImages: {
    title: (label: string) => `Shift the Images from ${label} On`,
    description:
      'For a run of images that began one page too early or too late: every image from this page to the end moves one page.',
    later: 'One page later',
    laterHint: (label: string) =>
      `${label} and every page after it take the image of the page before them.`,
    laterAdds: (last: string, next: string) =>
      `A new page ${next} is added at the end for the image of ${last}.`,
    earlier: 'One page earlier',
    earlierHint: (before: string, label: string) =>
      `${before} takes the image of ${label}, and so on to the end.`,
    firstPage: 'There is no page before this one.',
    occupied: (before: string) => `${before} has an image of its own; remove or move it first.`,
    nothing: 'No page from here on has an image.',
    zones: 'Zones stay with their pages and will be shown on the images that come to them.',
    submit: 'Shift Images',
    shifted: (n: number, added: string | null) =>
      added
        ? `${plural(n, 'image', 'images')} moved one page; ${added} was added at the end.`
        : `${plural(n, 'image', 'images')} moved one page.`,
  },

  removeImage: {
    title: 'Remove Image',
    description: (label: string) =>
      `Remove the image of ${label}? The page stays, without an image. An uploaded image is deleted; a IIIF image is only unlinked.`,
    zones: (n: number) =>
      `${n === 1 ? 'The zone drawn on it stays' : `The ${n} zones drawn on it stay`} and will be shown on any image that takes its place.`,
    verb: 'Remove',
    removed: (label: string) => `The image of ${label} has been removed.`,
  },

  remove: {
    title: 'Remove Page',
    /** What the removal says it does, from the words on the page and the boxes drawn on it. */
    description: (
      label: string,
      words: number,
      transcripts: number,
      boxes: number,
      image: boolean,
    ) => {
      const parts: string[] = [`Remove ${label}?`];
      if (words > 0) {
        parts.push(
          `The ${plural(words, 'word', 'words')} on ${label} in ${plural(transcripts, 'transcript', 'transcripts')} ${words === 1 ? 'goes' : 'go'} to Staging.`,
        );
      }
      if (image && boxes > 0)
        parts.push(`The image and its ${plural(boxes, 'box', 'boxes')} are removed.`);
      else if (image) parts.push('The image is removed.');
      else if (boxes > 0) parts.push(`Its ${plural(boxes, 'box', 'boxes')} are removed.`);
      parts.push('This cannot be undone.');
      return parts.join(' ');
    },
    verb: 'Remove',
    removed: (label: string) => `${label} has been removed.`,
    /** After the removal, when text moved. */
    moved: (label: string, words: number, transcripts: number) =>
      `${label} has been removed; ${plural(words, 'word', 'words')} of ${plural(transcripts, 'transcript', 'transcripts')} ${words === 1 ? 'is' : 'are'} now in Staging.`,
    transcription: (name: string, owner: string | null) => (owner ? `${name} (${owner})` : name),
  },

  /** The messages of the changes made to transcripts when the witness's pages change, as the history shows them. */
  history: {
    removed: (label: string) => `Page ${label} removed from the witness; its text is in Staging`,
    reordered: 'Pages reordered',
    reorganized: 'Pages reorganized',
  },

  manifest: {
    open: 'Import IIIF Manifest…',
    title: 'Import a IIIF Manifest',
    description:
      'Each canvas of the manifest becomes a page with its label, its image shown from the library’s IIIF server.',
    url: 'Manifest URL',
    urlHint: 'The address of a IIIF Presentation manifest, version 2 or 3.',
    urlInvalid: 'Enter a full URL beginning with http:// or https://.',
    preview: 'Preview',
    previewing: 'Reading the manifest',
    previewAgain: 'The URL has changed; preview it again before importing.',
    summary: (total: number, withImage: number) =>
      withImage === total
        ? `${plural(total, 'canvas', 'canvases')}, ${total === 1 ? 'with an image' : 'all with images'}.`
        : `${plural(total, 'canvas', 'canvases')}, ${withImage} with an image.`,
    present: (n: number) =>
      n === 1 ? '1 of them is already here.' : `${n} of them are already here.`,
    attachable: (n: number) =>
      n === 1
        ? '1 page without an image has the label of a canvas and takes its image.'
        : `${n} pages without an image have the label of a canvas and take its image.`,
    firstCanvases: (shown: number, total: number) =>
      shown < total ? `The first ${shown}` : 'The canvases',
    noImage: 'No image',
    warnings: 'The manifest has some problems',
    moreWarnings: (n: number) => `and ${n} more`,
    mode: 'Pages Already Here',
    modeNew: 'Keep them, and add the canvases that are not here yet',
    modeNewHint:
      'A canvas whose image a page already shows is skipped; a page without an image takes the image of the canvas with its label.',
    modeReplace: 'Replace them with the canvases',
    modeReplaceHint:
      'Pages that no zone or transcript refers to are removed first, with their uploaded images.',
    import: (n: number) => (n === 1 ? 'Import 1 Canvas' : `Import ${n} Canvases`),
    imported: (summary: {
      added: number;
      attached: number;
      skipped: number;
      removed: number;
      kept: number;
    }) => {
      const parts = [`Added ${plural(summary.added, 'page', 'pages')}`];
      if (summary.attached > 0)
        parts.push(`gave ${plural(summary.attached, 'page', 'pages')} an image`);
      if (summary.skipped > 0)
        parts.push(`skipped ${plural(summary.skipped, 'canvas', 'canvases')} already here`);
      if (summary.removed > 0) parts.push(`removed ${plural(summary.removed, 'page', 'pages')}`);
      if (summary.kept > 0)
        parts.push(`kept ${plural(summary.kept, 'page', 'pages')} that are referred to`);
      return `${parts.join(', ')}.`;
    },
    plainImage: (label: string) =>
      `Canvas "${label}" has a plain image without a IIIF image service; its page was made without an image.`,
    rights: 'Rights',
    credit: 'Credit Line',
    noRights: 'The manifest gives no rights statement; the pages are imported without one.',
    fallbackRights: (label: string) =>
      `The manifest gives no rights statement; the pages take the witness’s, ${label}.`,
    ownStatements: (n: number) =>
      n === 1
        ? '1 canvas has a statement of its own.'
        : `${n} canvases have a statement of their own.`,
    unlistedRights: (uri: string) =>
      `The rights statement ${uri} is not among those Varians lists; the pages it covers are imported without a statement, and with the address as their credit line where the manifest gives none.`,
    errors: {
      invalid: 'This is not a IIIF manifest that can be read.',
      unsupported: 'This is not a IIIF Presentation manifest of version 2 or 3.',
      fetch: 'The manifest could not be fetched.',
      'too-large': 'The manifest is too large.',
      timeout: 'The server of the manifest did not answer in time.',
    },
    errorDetail: (message: string, detail: string) => `${message} ${detail}`,
  },

  viewer: {
    title: (label: string) => label,
    of: (n: number, total: number) => `${n} of ${total}`,
    previous: 'Previous Page (Page Up)',
    next: 'Next Page (Page Down)',
    loading: 'Loading the viewer',
    labels: { zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fit: 'Fit the Page', controls: 'Zoom' },
  },

  errors: {
    witnessNotFound: 'There is no witness with this address.',
    forbidden: 'Only the maintainers of this witness may manage its pages.',
    pageNotFound: 'This page no longer exists.',
    generic: 'Something went wrong. Try again.',
    signIn: 'Your session has ended. Log in again.',
  },
};

export type PageStrings = typeof pageStrings;
