<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import { Button, Input, Menu, MenuItem, MenuLabel, MenuSeparator } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { site } from '$lib/strings/site';
  import type { CurrentUser } from '$lib/types';

  interface Props {
    user: CurrentUser | null;
    /** The current screen, shown after the wordmark. */
    crumb?: Snippet;
  }

  let { user, crumb }: Props = $props();

  let logoutForm = $state<HTMLFormElement | null>(null);

  /** The query shown in the search field: the one in force on the search page, otherwise nothing. */
  const searchQuery = $derived(
    page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : '',
  );

  /** Where one goes: to read, to find a text or a witness, to the shared bibliography; and, signed in, to one's own work. */
  const links = $derived([
    ...(user ? [{ href: '/mine', label: site.nav.mine }] : []),
    { href: '/editions', label: site.nav.editions },
    { href: '/works', label: site.nav.works },
    { href: '/witnesses', label: site.nav.witnesses },
    { href: '/bibliography', label: site.nav.bibliography },
  ]);

  function current(href: string): boolean {
    const path = page.url.pathname;
    // The editor of an edition is work, not reading: it belongs to no list.
    if (href === '/editions')
      return (
        path === '/editions' ||
        (path.startsWith('/editions/') &&
          !path.endsWith('/edit') &&
          !path.startsWith('/editions/new'))
      );
    return path === href || path.startsWith(`${href}/`);
  }
</script>

<header class="border-b border-line bg-page font-sans">
  <div class="mx-auto flex h-14 w-full max-w-page items-center gap-3 px-6 sm:px-8">
    <a
      href="/"
      class="shrink-0 font-serif text-xl text-ink transition-colors hover:text-accent"
      title={s.shell.library}
    >
      {s.app.name}
    </a>
    {#if crumb}
      <span class="text-ink-muted select-none" aria-hidden="true">/</span>
      <div class="min-w-0 truncate text-sm text-ink-soft">{@render crumb()}</div>
    {/if}

    <nav class="ml-auto hidden shrink-0 items-center gap-1 lg:flex" aria-label={site.nav.label}>
      {#each links as link (link.href)}
        <a
          href={link.href}
          class={[
            'rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-sunken hover:text-ink',
            current(link.href) ? 'font-medium text-ink' : 'text-ink-soft',
          ]}
          aria-current={current(link.href) ? 'page' : undefined}>{link.label}</a
        >
      {/each}
    </nav>

    <form
      method="get"
      action="/search"
      role="search"
      class="ml-auto hidden shrink-0 items-center gap-2 md:flex lg:ml-3"
    >
      <label for="site-search" class="text-sm text-ink-soft">{site.nav.search}</label>
      <Input
        id="site-search"
        name="q"
        type="search"
        value={searchQuery}
        autocomplete="off"
        aria-label={site.nav.searchField}
        class="h-8 w-40 lg:w-52"
      />
    </form>

    <div class="ml-auto flex shrink-0 items-center gap-1 md:ml-2">
      <div class="lg:hidden">
        <Menu label={site.nav.menu} triggerSize="sm" align="end">
          {#snippet trigger()}<MenuIcon class="size-4" aria-hidden="true" />{/snippet}
          {#each links as link (link.href)}
            <MenuItem href={link.href}>{link.label}</MenuItem>
          {/each}
          <MenuSeparator />
          <MenuItem href="/search">{site.search.title}</MenuItem>
        </Menu>
      </div>
      {#if user}
        <form method="post" action="/logout" bind:this={logoutForm} class="hidden"></form>
        <Menu label={s.shell.userMenu} triggerSize="sm" align="end">
          {#snippet trigger()}
            <span class="max-w-40 truncate">{user.name}</span>
            <ChevronDown class="size-4 text-ink-muted" aria-hidden="true" />
          {/snippet}
          <MenuLabel>{user.email}</MenuLabel>
          <MenuItem href="/mine">{site.nav.mine}</MenuItem>
          <MenuItem href="/account">{s.shell.account}</MenuItem>
          <MenuItem href="/import">{s.shell.importPackage}</MenuItem>
          {#if user.role === 'administrator'}
            <MenuItem href="/admin/users">{s.shell.admin}</MenuItem>
          {/if}
          <MenuSeparator />
          <MenuItem onSelect={() => logoutForm?.requestSubmit()}>{s.shell.logOut}</MenuItem>
        </Menu>
      {:else}
        <Button variant="ghost" size="sm" href="/login">{s.shell.logIn}</Button>
        <Button variant="primary" size="sm" href="/register">{s.shell.register}</Button>
      {/if}
    </div>
  </div>
</header>
