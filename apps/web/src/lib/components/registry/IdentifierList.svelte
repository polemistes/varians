<script lang="ts">
  /** Canonical identifiers as a list: the scheme, and the value linked to its resolver where the scheme has one. */
  import { identifierHref, type CanonicalIdentifier } from '$lib/registry/identifiers';
  import { registry } from '$lib/strings/registry';

  interface Props {
    identifiers: CanonicalIdentifier[];
  }

  let { identifiers }: Props = $props();
  const s = registry.identifiers;
</script>

<ul class="flex flex-col gap-0.5">
  {#each identifiers as identifier (`${identifier.scheme}:${identifier.value}`)}
    {@const href = identifierHref(identifier)}
    {@const scheme = s.schemes[identifier.scheme] ?? identifier.scheme}
    <li>
      <span class="text-ink-soft">{scheme}</span>
      {#if href}
        <a {href} class="font-mono text-xs break-all text-accent hover:underline" rel="noopener noreferrer" aria-label={s.lookUp(scheme, identifier.value)}>{identifier.value}</a>
      {:else}
        <span class="font-mono text-xs break-all text-ink">{identifier.value}</span>
      {/if}
    </li>
  {/each}
</ul>
