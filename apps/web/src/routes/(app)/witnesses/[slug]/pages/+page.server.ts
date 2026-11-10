/**
 * The pages of a witness: listed in order, added by label or from images,
 * given images (upload or IIIF), renamed, moved and removed.
 * Maintainers only; every action checks again, since actions run without
 * the load.
 */
import { error, fail } from '@sveltejs/kit';
import {
  labelFromFileName,
  labelProblem,
  labelsAfter,
  sortByName,
} from '$lib/components/pages/labels';
import type { ImportSummaryView, ManifestPreviewView } from '$lib/components/pages/types';
import { canMaintainWitness } from '$lib/server/authz';
import { requireUser } from '$lib/server/guards';
import { storageDir } from '$lib/server/images/storage';
import { DEFAULT_MAX_UPLOAD_BYTES } from '$lib/server/images/tiles';
import {
  ManifestError,
  PageError,
  UploadError,
  addImagePage,
  addPages,
  attachUpload,
  detachImage,
  expandLabels,
  importManifest,
  maintainerIdsOf,
  manifestErrorMessage,
  moveImage,
  movePage,
  pageOfWitness,
  parseImageRights,
  pageViewsOf,
  pagesOfWitness,
  previewManifest,
  removePage,
  renamePage,
  shiftImages,
  updatePageRights,
  uploadErrorMessage,
  witnessBySlug,
} from '$lib/server/pages';
import { pageStrings as t } from '$lib/strings/pages';
import type { Actions, PageServerLoad } from './$types';

/** The witness, when the user maintains it: 404 when there is none, 403 for anyone else. */
async function maintainedWitness(locals: App.Locals, slug: string, returnTo?: string) {
  const user = requireUser(locals, returnTo);
  const witness = await witnessBySlug(locals.db, slug);
  if (!witness) error(404, t.errors.witnessNotFound);
  const maintainers = await maintainerIdsOf(locals.db, witness.id);
  if (!canMaintainWitness(user, witness, maintainers)) error(403, t.errors.forbidden);
  return witness;
}

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

/**
 * The body of an action as form data, or null when the client went away
 * while sending it (an upload stopped halfway), which is no error of ours.
 */
async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** The files of a field, leaving out the empty part a file input sends when nothing was chosen. */
function filesOf(form: FormData, name = 'file'): File[] {
  return form
    .getAll(name)
    .filter((value): value is File => value instanceof File && value.size > 0);
}

/** The rights statement, credit line and source an upload or a page's rights form sends. */
function rightsOf(form: FormData) {
  return parseImageRights({
    rights: text(form, 'rights'),
    attribution: text(form, 'attribution'),
    imageSource: text(form, 'imageSource'),
  });
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const witness = await maintainedWitness(locals, params.slug, url.pathname);
  const pages = await pageViewsOf(locals.db, witness.id);
  return {
    crumb: { label: witness.name, href: `/witnesses/${witness.slug}` },
    witness: {
      slug: witness.slug,
      name: witness.name,
      siglum: witness.siglum,
      iiifManifest: witness.iiifManifest,
      roll: witness.category === 'manuscript' && witness.format === 'roll',
      imageDefaults: { rights: witness.imageRights, attribution: witness.imageAttribution },
    },
    pages,
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  };
};

export const actions: Actions = {
  /** Pages without images, from a label pattern. */
  add: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'add' as const, ok: false as const, error: t.upload.network });
    const spec = text(form, 'labels');
    const expanded = expandLabels(spec);
    if (!expanded.ok) {
      return fail(400, {
        action: 'add' as const,
        ok: false as const,
        errors: { labels: [expanded.error] },
        values: { labels: spec },
      });
    }
    const added = await addPages(locals.db, witness.id, expanded.labels);
    return {
      action: 'add' as const,
      ok: true as const,
      message: t.add.added(added.length, added[0]!.label, added.at(-1)!.label),
    };
  },

  /**
   * New pages from images, one per file. With script, one file per request
   * with its label; without, all files at once in the order of their names,
   * labelled from the names or continuing the last page's label.
   */
  upload: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'upload' as const, ok: false as const, error: t.upload.network });
    const files = filesOf(form);
    if (files.length === 0) {
      return fail(400, {
        action: 'upload' as const,
        ok: false as const,
        error: t.upload.noFiles,
        failed: [],
      });
    }
    const rights = rightsOf(form);
    if (!rights.ok)
      return fail(400, {
        action: 'upload' as const,
        ok: false as const,
        error: rights.error,
        failed: [],
      });
    const given = form.getAll('label').map(String);
    /** Each file with its label, or null for the next label of the sequence. */
    let queue: { file: File; label: string | null }[];
    let cursor: string | null = null;
    if (given.length === files.length) {
      const problem = given.map(labelProblem).find((p) => p !== null);
      if (problem)
        return fail(400, {
          action: 'upload' as const,
          ok: false as const,
          error: problem,
          failed: [],
        });
      queue = files.map((file, i) => ({ file, label: given[i]! }));
    } else {
      const sequence = text(form, 'labelMode') === 'sequence';
      if (sequence) cursor = (await pagesOfWitness(locals.db, witness.id)).at(-1)?.label ?? null;
      const continues = sequence && labelsAfter(cursor, 0) !== null;
      queue = sortByName(files).map((file) => ({
        file,
        label: continues ? null : labelFromFileName(file.name),
      }));
    }

    const added: string[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const { file, label } of queue) {
      // A sequence continues from the last page added, so that a file that fails leaves no gap.
      const wanted = label ?? labelsAfter(cursor, 1)?.[0] ?? labelFromFileName(file.name);
      try {
        const page = await addImagePage(
          locals.db,
          witness.id,
          wanted,
          file,
          rights.value,
          storageDir(),
        );
        added.push(page.label);
        cursor = page.label;
      } catch (cause) {
        if (cause instanceof UploadError)
          failed.push({ name: file.name, error: uploadErrorMessage(cause) });
        else if (cause instanceof PageError) failed.push({ name: file.name, error: cause.message });
        else throw cause;
      }
    }
    if (added.length === 0) {
      return fail(400, {
        action: 'upload' as const,
        ok: false as const,
        error: failed.length === 1 ? failed[0]!.error : t.upload.allFailed,
        failed,
      });
    }
    return {
      action: 'upload' as const,
      ok: true as const,
      message:
        failed.length > 0
          ? t.upload.addedSome(added.length, failed.length)
          : t.upload.added(added.length),
      labels: added,
      failed,
    };
  },

  /** An uploaded image for an existing page, in place of any it had. */
  replaceImage: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, {
        action: 'replaceImage' as const,
        ok: false as const,
        error: t.upload.network,
      });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'replaceImage' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const [file] = filesOf(form);
    if (!file) {
      return fail(400, {
        action: 'replaceImage' as const,
        ok: false as const,
        pageId: page.id,
        error: t.upload.fileRequired,
      });
    }
    const rights = rightsOf(form);
    if (!rights.ok)
      return fail(400, {
        action: 'replaceImage' as const,
        ok: false as const,
        pageId: page.id,
        error: rights.error,
      });
    try {
      const updated = await attachUpload(locals.db, page.id, file, rights.value, storageDir());
      if (!updated)
        return fail(404, {
          action: 'replaceImage' as const,
          ok: false as const,
          error: t.errors.pageNotFound,
        });
    } catch (cause) {
      if (!(cause instanceof UploadError)) throw cause;
      return fail(400, {
        action: 'replaceImage' as const,
        ok: false as const,
        pageId: page.id,
        error: uploadErrorMessage(cause),
      });
    }
    return {
      action: 'replaceImage' as const,
      ok: true as const,
      message: page.imageKind ? t.upload.replaced(page.label) : t.upload.attached(page.label),
    };
  },

  /** The rights statement, credit line and source of a page's image. */
  rights: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'rights' as const, ok: false as const, error: t.upload.network });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'rights' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    if (!page.imageKind)
      return fail(400, {
        action: 'rights' as const,
        ok: false as const,
        pageId: page.id,
        error: t.rights.noImage(page.label),
      });
    const rights = rightsOf(form);
    if (!rights.ok) {
      return fail(400, {
        action: 'rights' as const,
        ok: false as const,
        pageId: page.id,
        error: rights.error,
        errors: { [rights.field]: [rights.error] },
      });
    }
    const updated = await updatePageRights(locals.db, page.id, rights.value);
    if (!updated)
      return fail(404, {
        action: 'rights' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    return { action: 'rights' as const, ok: true as const, message: t.rights.saved(page.label) };
  },

  /** The image of one page to another page of the witness; the two change places when both have one. */
  moveImage: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, {
        action: 'moveImage' as const,
        ok: false as const,
        error: t.upload.network,
      });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'moveImage' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const target = await pageOfWitness(locals.db, witness.id, text(form, 'toPageId'));
    if (!target)
      return fail(400, {
        action: 'moveImage' as const,
        ok: false as const,
        pageId: page.id,
        error: t.moveImage.choose,
      });
    const result = await moveImage(locals.db, page.id, target.id, storageDir());
    if (!result.ok) {
      const messages = {
        'not-found': t.errors.pageNotFound,
        'no-image': t.moveImage.noImage(page.label),
        'same-page': t.moveImage.samePage,
        'other-witness': t.moveImage.otherWitness,
      };
      const status = result.reason === 'not-found' ? 404 : 400;
      return fail(status, {
        action: 'moveImage' as const,
        ok: false as const,
        pageId: page.id,
        error: messages[result.reason],
      });
    }
    return {
      action: 'moveImage' as const,
      ok: true as const,
      message: result.swapped
        ? t.moveImage.swapped(page.label, target.label)
        : t.moveImage.moved(page.label, target.label),
    };
  },

  /** Every image from a page to the end one page later or earlier. */
  shiftImages: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, {
        action: 'shiftImages' as const,
        ok: false as const,
        error: t.upload.network,
      });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'shiftImages' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const direction = text(form, 'direction') === 'earlier' ? 'earlier' : 'later';
    const list = await pagesOfWitness(locals.db, witness.id);
    const before = list[list.findIndex((p) => p.id === page.id) - 1];
    const result = await shiftImages(locals.db, page.id, direction, storageDir());
    if (!result.ok) {
      const messages = {
        'not-found': t.errors.pageNotFound,
        'first-page': t.shiftImages.firstPage,
        occupied: t.shiftImages.occupied(before?.label ?? ''),
        nothing: t.shiftImages.nothing,
      };
      const status = result.reason === 'not-found' ? 404 : 400;
      return fail(status, {
        action: 'shiftImages' as const,
        ok: false as const,
        pageId: page.id,
        error: messages[result.reason],
      });
    }
    return {
      action: 'shiftImages' as const,
      ok: true as const,
      message: t.shiftImages.shifted(result.moved, result.added?.label ?? null),
    };
  },

  removeImage: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, {
        action: 'removeImage' as const,
        ok: false as const,
        error: t.upload.network,
      });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'removeImage' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    await detachImage(locals.db, page.id, storageDir());
    return {
      action: 'removeImage' as const,
      ok: true as const,
      message: t.removeImage.removed(page.label),
    };
  },

  rename: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'rename' as const, ok: false as const, error: t.upload.network });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'rename' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const label = text(form, 'label');
    const problem = labelProblem(label);
    if (problem) {
      return fail(400, {
        action: 'rename' as const,
        ok: false as const,
        pageId: page.id,
        error: problem,
        values: { label },
      });
    }
    const renamed = await renamePage(locals.db, page.id, label);
    if (!renamed)
      return fail(404, {
        action: 'rename' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    return {
      action: 'rename' as const,
      ok: true as const,
      message: renamed.label === page.label ? '' : t.rename.renamed(page.label, renamed.label),
    };
  },

  /** To a position from 1. */
  move: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'move' as const, ok: false as const, error: t.upload.network });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'move' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const count = (await pagesOfWitness(locals.db, witness.id)).length;
    const to = Number(text(form, 'to'));
    if (!Number.isInteger(to) || to < 1 || to > count) {
      return fail(400, {
        action: 'move' as const,
        ok: false as const,
        pageId: page.id,
        error: t.move.invalid(count),
      });
    }
    const list = await movePage(locals.db, page.id, to - 1, locals.user?.id ?? null);
    if (!list)
      return fail(404, {
        action: 'move' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const position = list.findIndex((p) => p.id === page.id) + 1;
    return {
      action: 'move' as const,
      ok: true as const,
      message: t.move.moved(page.label, position),
    };
  },

  /** The page's text goes to Not on a page in every transcript; its image and zones go with it. */
  remove: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'remove' as const, ok: false as const, error: t.upload.network });
    const page = await pageOfWitness(locals.db, witness.id, text(form, 'pageId'));
    if (!page)
      return fail(404, {
        action: 'remove' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const result = await removePage(locals.db, page.id, storageDir(), locals.user?.id ?? null);
    if (!result.ok)
      return fail(404, {
        action: 'remove' as const,
        ok: false as const,
        error: t.errors.pageNotFound,
      });
    const { words, transcriptions } = result.moved;
    return {
      action: 'remove' as const,
      ok: true as const,
      message:
        words > 0
          ? t.remove.moved(page.label, words, transcriptions)
          : t.remove.removed(page.label),
    };
  },

  preview: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'preview' as const, ok: false as const, error: t.upload.network });
    const manifestUrl = text(form, 'manifestUrl').trim();
    if (!httpUrl(manifestUrl)) {
      return fail(400, {
        action: 'preview' as const,
        ok: false as const,
        errors: { manifestUrl: [t.manifest.urlInvalid] },
        values: { manifestUrl },
      });
    }
    try {
      const existing = await pagesOfWitness(locals.db, witness.id);
      const found = await previewManifest(manifestUrl, existing, witness.imageRights);
      const preview: ManifestPreviewView = {
        url: found.url,
        label: found.label,
        total: found.total,
        withImage: found.withImage,
        present: found.present,
        attachable: found.attachable,
        canvases: found.canvases,
        rights: found.rights,
        warnings: found.warnings,
      };
      return { action: 'preview' as const, ok: true as const, preview };
    } catch (cause) {
      if (!(cause instanceof ManifestError)) throw cause;
      return fail(400, {
        action: 'preview' as const,
        ok: false as const,
        errors: { manifestUrl: [manifestErrorMessage(cause)] },
        values: { manifestUrl },
      });
    }
  },

  /** `mode`: `new` (the default) skips canvases already here; `replace` removes what nothing refers to first. */
  import: async ({ request, locals, params }) => {
    const witness = await maintainedWitness(locals, params.slug);
    const form = await readForm(request);
    if (!form)
      return fail(400, { action: 'import' as const, ok: false as const, error: t.upload.network });
    const manifestUrl = text(form, 'manifestUrl').trim();
    if (!httpUrl(manifestUrl)) {
      return fail(400, {
        action: 'import' as const,
        ok: false as const,
        errors: { manifestUrl: [t.manifest.urlInvalid] },
        values: { manifestUrl },
      });
    }
    const replace = text(form, 'mode') === 'replace';
    try {
      const found = await importManifest(locals.db, witness.id, manifestUrl, {
        replace,
        onlyNew: !replace,
        storageRoot: storageDir(),
        actor: locals.user?.id ?? null,
      });
      const summary: ImportSummaryView = { ...found };
      return {
        action: 'import' as const,
        ok: true as const,
        message: t.manifest.imported(summary),
        summary,
      };
    } catch (cause) {
      if (!(cause instanceof ManifestError)) throw cause;
      return fail(400, {
        action: 'import' as const,
        ok: false as const,
        errors: { manifestUrl: [manifestErrorMessage(cause)] },
        values: { manifestUrl },
      });
    }
  },
};
