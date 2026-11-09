<script lang="ts">
  import { page } from '$app/state';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import { s } from '$lib/strings';

  /** The default texts SvelteKit gives when the server named no reason. */
  const GENERIC = new Set(['Not Found', 'Forbidden', 'Unauthorized', 'Bad Request', 'Internal Error']);

  const text = $derived.by(() => {
    // A reason the server gave for refusing ("Only maintainers manage the pages") says more than the generic text.
    const reason = page.status >= 400 && page.status < 500 && page.error?.message && !GENERIC.has(page.error.message) ? page.error.message : null;
    switch (page.status) {
      case 404:
        return { title: s.errors.notFoundTitle, body: reason ?? s.errors.notFoundText };
      case 401:
        return { title: s.errors.unauthorizedTitle, body: reason ?? s.errors.unauthorizedText };
      case 403:
        return { title: s.errors.forbiddenTitle, body: reason ?? s.errors.forbiddenText };
      default:
        return { title: s.errors.genericTitle, body: reason ?? s.errors.genericText };
    }
  });
</script>

<svelte:head>
  <title>{text.title} · {s.app.name}</title>
</svelte:head>

<PageFrame title={text.title} width="narrow">
  <p class="font-serif text-reading text-ink-soft">{text.body}</p>
  <p class="mt-3 font-sans text-xs text-ink-muted">
    {s.errors.status(page.status)}{#if page.error?.message && page.status >= 500}: {page.error.message}{/if}
  </p>
  <div class="mt-8">
    <Button href="/" variant="secondary">{s.common.backToLibrary}</Button>
  </div>
</PageFrame>
