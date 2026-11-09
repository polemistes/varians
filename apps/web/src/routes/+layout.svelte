<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import favicon from '$lib/assets/favicon.svg';
  import { Header } from '$lib/components/shell';
  import { Toaster } from '$lib/components/ui';
  import { applyPreferences } from '$lib/preferences';
  import { s } from '$lib/strings';
  import { site } from '$lib/strings/site';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  /** The workbench and the edition editor fill the window: no footer under them. */
  const fullHeight = $derived(page.url.pathname.startsWith('/transcriptions/') || /^\/editions\/[^/]+\/edit$/.test(page.url.pathname));

  // The server stamps data-theme and data-font on <html> for the first paint;
  // this keeps them current when the preferences change without a reload.
  $effect(() => {
    applyPreferences(document.documentElement, data.user?.preferences);
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>{page.data.crumb ? `${page.data.crumb.label} · ${s.app.name}` : s.app.name}</title>
</svelte:head>

{#snippet crumb()}
  {#if page.data.crumb?.href}
    <a href={page.data.crumb.href} class="hover:text-ink">{page.data.crumb.label}</a>
  {:else if page.data.crumb}
    <span>{page.data.crumb.label}</span>
  {/if}
{/snippet}

<a
  href="#main"
  class="sr-only z-[70] rounded-md bg-surface px-3 py-2 font-sans text-sm text-ink shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
>
  {s.shell.skipToContent}
</a>

<div class="flex min-h-dvh flex-col">
  <Header user={data.user} crumb={page.data.crumb ? crumb : undefined} />
  <main id="main" class="flex flex-1 flex-col">
    {@render children()}
  </main>
  {#if !fullHeight}
    <footer class="border-t border-line px-6 py-4 font-sans text-xs text-ink-muted sm:px-8">
      <div class="mx-auto flex w-full max-w-page flex-wrap gap-x-4 gap-y-1">
        <span>{s.app.name} {data.release.version}</span>
        <a href="/guide" class="hover:text-ink">{site.guide.title}</a>
        <a href="/sources" class="hover:text-ink">{site.sources.footer}</a>
        <a href="/terms" class="hover:text-ink">{site.terms.footer}</a>
        <a href="/formats" class="hover:text-ink">{site.formats.title}</a>
        <a href={data.release.source} class="hover:text-ink" rel="external">{site.footer.source}</a>
      </div>
    </footer>
  {/if}
</div>

<Toaster />
