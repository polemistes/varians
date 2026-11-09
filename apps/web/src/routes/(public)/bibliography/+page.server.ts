import { fail } from '@sveltejs/kit';
import { serializeBiblatex } from '@varians/core';
import { referencePieces } from '$lib/bibliography/format';
import { canDeleteBibItem, canEditBibItem, deleteEntry, entryOf, importBibliography, listBibliography, saveEntry } from '$lib/server/bibliography';
import { requireUser } from '$lib/server/guards';
import { bibStrings as t } from '$lib/strings/bibliography';
import type { Actions, PageServerLoad } from './$types';

const PER_PAGE = 50;
const MAX_TEXT = 100_000;
const MAX_IMPORT = 5_000_000;

export const load: PageServerLoad = async ({ locals, url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1);
  const { items, total } = await listBibliography(locals.db, { q, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
  return {
    crumb: { label: t.title },
    q,
    page,
    pages: Math.max(1, Math.ceil(total / PER_PAGE)),
    total,
    items: items.map((item) => ({
      id: item.id,
      key: item.citationKey,
      label: item.label,
      pieces: referencePieces(entryOf(item)),
      bib: serializeBiblatex([entryOf(item)]).trim(),
      cited: item.cited,
      canEdit: canEditBibItem(locals.user, item),
      canDelete: canDeleteBibItem(locals.user, item),
    })),
    canAdd: !!locals.user,
  };
};

export const actions: Actions = {
  save: async ({ locals, request, url }) => {
    const user = requireUser(locals, url.pathname);
    const form = await request.formData();
    const id = String(form.get('id') ?? '') || null;
    const text = String(form.get('bib') ?? '');
    if (text.length > MAX_TEXT) return fail(400, { form: 'save' as const, message: 'The entry is too long.' });
    const result = await saveEntry(locals.db, id, text, user);
    if (!result.ok) return fail(400, { form: 'save' as const, message: result.message });
    return { form: 'save' as const, ok: true, key: result.item.citationKey };
  },

  import: async ({ locals, request, url }) => {
    const user = requireUser(locals, url.pathname);
    const form = await request.formData();
    const file = form.get('file');
    let text = String(form.get('text') ?? '');
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMPORT) return fail(400, { form: 'import' as const, message: 'The file is larger than 5 MB.' });
      text = await file.text();
    }
    if (text.length > MAX_IMPORT) return fail(400, { form: 'import' as const, message: 'The text is longer than 5 MB.' });
    const summary = await importBibliography(locals.db, text, user);
    const read = summary.created.length + summary.updated.length + summary.unchanged.length + summary.kept.length;
    if (read === 0) return fail(400, { form: 'import' as const, message: summary.warnings[0] ?? t.importDialog.nothing });
    return { form: 'import' as const, ok: true, summary };
  },

  delete: async ({ locals, request, url }) => {
    const user = requireUser(locals, url.pathname);
    const id = String((await request.formData()).get('id') ?? '');
    const result = await deleteEntry(locals.db, id, user);
    if (!result.ok) {
      const message = result.error === 'cited' ? t.deleteDialog.cited(result.cited ?? 0) : result.error === 'forbidden' ? t.deleteDialog.forbidden : 'That entry no longer exists.';
      return fail(400, { form: 'delete' as const, message });
    }
    return { form: 'delete' as const, ok: true };
  },
};
