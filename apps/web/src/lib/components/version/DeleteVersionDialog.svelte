<script lang="ts">
  /**
   * Delete Version…, an administrator's alone, for an edition and a
   * transcript alike: which version, of all there are, withdrawn ones among
   * them (the latest chosen to begin with). The list is empty where the
   * record has none. A refusal stays in the window. Someone reading the
   * version deleted is taken to the record's own address.
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { formatLocal } from '$lib/dates';
  import { Button, Dialog, Field, Notice, Select, Spinner, toasts } from '$lib/components/ui';
  import { recordActions } from '$lib/strings/record-actions';
  import { versions as v } from '$lib/strings/versions';

  interface Props {
    open?: boolean;
    kind: 'edition' | 'transcription';
    id: string;
  }

  let { open = $bindable(false), kind, id }: Props = $props();

  type Listed = { number: number; at: string; withdrawn: unknown };

  const base = $derived(
    `/api/${kind === 'edition' ? 'editions' : 'transcriptions'}/${encodeURIComponent(id)}`,
  );
  let listed = $state<Listed[] | null>(null);
  let failed = $state(false);
  let chosen = $state('');
  let refusal = $state<string | null>(null);
  let submitting = $state(false);
  let opening = 0;

  $effect(() => {
    if (open) void prepare();
  });

  async function prepare() {
    const mine = ++opening;
    listed = null;
    failed = false;
    refusal = null;
    try {
      const response = await fetch(`${base}/versions`);
      if (!response.ok) throw new Error(response.statusText);
      const body = (await response.json()) as { versions: Listed[] };
      if (mine !== opening) return;
      // Newest first, as the server lists them.
      listed = body.versions;
      chosen = listed[0] ? String(listed[0].number) : '';
    } catch {
      if (mine === opening) failed = true;
    }
  }

  async function remove() {
    const number = Number(chosen);
    if (!number) return;
    submitting = true;
    try {
      const response = await fetch(`${base}/versions/${number}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        refusal = body?.message ?? recordActions.failed;
        return;
      }
      toasts.success(v.delete.done(number));
      open = false;
      // The address of the version deleted no longer exists: its reader goes to the record's own.
      const own = page.url.pathname.replace(new RegExp(`/v/${number}(/.*)?$`), '');
      if (own !== page.url.pathname) await goto(own, { invalidateAll: true });
      else await invalidateAll();
    } catch {
      refusal = recordActions.failed;
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog bind:open title={v.delete.title} description={v.delete.body} size="md">
  {#if failed}
    <Notice kind="error">{v.delete.failed}</Notice>
  {:else if !listed}
    <p class="flex items-center gap-2 text-ink-soft"><Spinner size="sm" /> {v.delete.loading}</p>
  {:else}
    <div class="space-y-4">
      <Field label={v.delete.which}>
        {#snippet children(control)}
          <Select
            {...control}
            bind:value={chosen}
            onchange={() => (refusal = null)}
            options={listed!.map((x) => ({
              value: String(x.number),
              label: x.withdrawn
                ? v.delete.optionWithdrawn(x.number, formatLocal(x.at))
                : v.delete.option(x.number, formatLocal(x.at)),
            }))}
          />
        {/snippet}
      </Field>
      {#if refusal}<Notice kind="error">{refusal}</Notice>{/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{recordActions.cancel}</Button>
    <Button variant="danger" loading={submitting} disabled={!chosen || !!refusal} onclick={remove}
      >{v.delete.verb}</Button
    >
  {/snippet}
</Dialog>
