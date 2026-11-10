<script lang="ts">
  /**
   * Read forms proposed: from the profile where the step is
   * mechanical and from the memory of pairs confirmed before. The editor
   * picks which to accept; each accepted pair is remembered.
   */
  import { untrack } from 'svelte';
  import { acceptProposals, type Proposal } from '@varians/core';
  import { Badge, Button, Dialog, toasts } from '$lib/components/ui';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    open: boolean;
  }

  let { wb, open = $bindable(false) }: Props = $props();

  let scope = $state<'page' | 'whole'>('page');
  let chosen = $state<Record<string, boolean>>({});
  /** The list stays as it was when the dialog opened, so that ticking does not reorder it. */
  let list = $state.raw<Proposal[]>([]);

  $effect(() => {
    if (!open) return;
    const which = scope;
    untrack(() => {
      list = which === 'page' ? wb.proposals : wb.proposalsEverywhere();
      chosen = Object.fromEntries(list.map((p) => [p.tokenId, true]));
    });
  });

  const selected = $derived(list.filter((p) => chosen[p.tokenId]));

  function setAll(value: boolean) {
    chosen = Object.fromEntries(list.map((p) => [p.tokenId, value]));
  }

  function accept() {
    const picked = selected;
    if (picked.length === 0) return;
    if (wb.apply(acceptProposals(picked))) {
      wb.remember(
        picked.map((p) => ({ form: p.form, norm: p.norm })).filter((p) => p.norm !== p.form),
      );
      toasts.success(t.proposals.accepted(picked.length));
    }
    open = false;
  }
</script>

<Dialog bind:open title={t.proposals.title} description={t.proposals.description} size="lg">
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <div
        class="inline-flex rounded-md border border-line p-0.5"
        role="group"
        aria-label={t.proposals.scope}
      >
        {#each [{ value: 'page', label: t.proposals.page }, { value: 'whole', label: t.proposals.whole }] as option (option.value)}
          <button
            type="button"
            aria-pressed={scope === option.value}
            class={[
              'h-7 rounded px-2.5 text-sm',
              scope === option.value
                ? 'bg-accent text-accent-ink'
                : 'text-ink-soft hover:bg-sunken',
            ]}
            onclick={() => (scope = option.value as 'page' | 'whole')}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <div class="ml-auto flex gap-2 text-sm">
        <button type="button" class="text-accent hover:underline" onclick={() => setAll(true)}
          >{t.proposals.all}</button
        >
        <button type="button" class="text-accent hover:underline" onclick={() => setAll(false)}
          >{t.proposals.none}</button
        >
      </div>
    </div>
    {#if list.length === 0}
      <p class="text-ink-soft">{t.proposals.empty}</p>
    {:else}
      <div class="max-h-[50vh] overflow-y-auto rounded-md border border-line">
        <table class="w-full border-collapse text-sm">
          <thead class="sticky top-0 bg-sunken text-left text-xs text-ink-soft">
            <tr>
              <th class="w-8 px-2 py-1.5"><span class="sr-only">{t.proposals.accept(0)}</span></th>
              <th class="px-2 py-1.5 font-medium">{t.proposals.written}</th>
              <th class="px-2 py-1.5 font-medium">{t.proposals.proposed}</th>
              <th class="px-2 py-1.5 font-medium">{t.proposals.source}</th>
            </tr>
          </thead>
          <tbody>
            {#each list as proposal (proposal.tokenId)}
              <tr class="border-t border-line">
                <td class="px-2 py-1">
                  <input
                    type="checkbox"
                    class="size-4"
                    bind:checked={chosen[proposal.tokenId]}
                    aria-label={`${proposal.form} → ${proposal.norm}`}
                  />
                </td>
                <td class="px-2 py-1 font-serif text-base">{proposal.form}</td>
                <td class="px-2 py-1 font-serif text-base">{proposal.norm}</td>
                <td class="px-2 py-1">
                  <Badge tone={proposal.source === 'memory' ? 'accent' : 'neutral'}>
                    {proposal.source === 'memory' ? t.proposals.memory : t.proposals.profile}
                  </Badge>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{t.proposals.cancel}</Button>
    <Button variant="primary" disabled={selected.length === 0} onclick={accept}
      >{t.proposals.accept(selected.length)}</Button
    >
  {/snippet}
</Dialog>
