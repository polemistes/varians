/**
 * The facsimile viewer's source for a page, from its stored image: a Deep
 * Zoom pyramid for an upload, the info.json of a IIIF Image API service.
 */
export type PageSource = { kind: 'dzi'; url: string } | { kind: 'iiif'; infoUrl: string };

export function pageSource(page: {
  id: string;
  imageKind: string | null;
  imageIiif: string | null;
}): PageSource | null {
  if (page.imageKind === 'upload') return { kind: 'dzi', url: `/media/tiles/${page.id}/image.dzi` };
  if (page.imageKind === 'iiif' && page.imageIiif)
    return { kind: 'iiif', infoUrl: `${page.imageIiif.replace(/\/+$/, '')}/info.json` };
  return null;
}

/** The image itself, for reading lines from it: the uploaded file, or the IIIF image service. */
export function pageImage(page: {
  imageKind: string | null;
  imagePath: string | null;
  imageIiif: string | null;
}): { kind: 'file' | 'iiif'; url: string } | null {
  if (page.imageKind === 'upload' && page.imagePath)
    return { kind: 'file', url: `/media/${page.imagePath}` };
  if (page.imageKind === 'iiif' && page.imageIiif)
    return { kind: 'iiif', url: page.imageIiif.replace(/\/+$/, '') };
  return null;
}
