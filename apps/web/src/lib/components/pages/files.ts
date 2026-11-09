/**
 * Image files as the browser hands them over. The server decides what a file
 * really is; these checks only keep obvious mistakes (a PDF, a video) from
 * being sent at all.
 */

/** The largest image file accepted, unless the server is told otherwise. */
export const DEFAULT_MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/** For the accept attribute of file inputs: the formats an upload may have. */
export const ACCEPT_IMAGES = 'image/jpeg,image/png,image/tiff,image/webp,.jpg,.jpeg,.png,.tif,.tiff,.webp';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/tiff', 'image/webp']);
const EXTENSIONS = /\.(jpe?g|png|tiff?|webp)$/iu;

/** Whether a file looks like an image the server accepts, by its type or, when the browser gives none, its name. */
export function isImageFile(file: { name: string; type: string }): boolean {
  if (file.type) return TYPES.has(file.type.toLowerCase());
  return EXTENSIONS.test(file.name);
}
