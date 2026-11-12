/**
 * The workbench's data as the browser is sent it, for the page of the draft
 * and for the page of a version alike.
 */
import { DEFAULT_MAX_UPLOAD_BYTES } from './images/tiles';
import { pageImage } from './page-source';
import { pageSource } from './pages';
import type { WorkbenchData, WorkbenchPageRow } from './workbench';

/** A page as the browser sees it: its viewer source, and an image to read lines from. */
export function clientPage(page: WorkbenchPageRow) {
  return {
    id: page.id,
    label: page.label,
    width: page.width,
    height: page.height,
    source: pageSource({ ...page, imageWidth: page.width, imageHeight: page.height }),
    image: pageImage(page),
    rights: page.rights,
    attribution: page.attribution,
  };
}

export type ClientPage = ReturnType<typeof clientPage>;

export function clientData(data: WorkbenchData) {
  return {
    transcription: data.transcription,
    witness: data.witness,
    pages: data.pages.map(clientPage),
    works: data.works,
    segments: data.segments,
    canEdit: data.canEdit,
    canDelete: data.canDelete,
    canMaintainWitness: data.canMaintainWitness,
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  };
}

/** The page's crumb: the transcription's first work, else its witness. */
export function workbenchCrumb(data: WorkbenchData) {
  const work = data.works[0];
  return work
    ? { label: work.title, href: `/works/${work.slug}` }
    : { label: data.witness.name, href: `/witnesses/${data.witness.slug}` };
}
