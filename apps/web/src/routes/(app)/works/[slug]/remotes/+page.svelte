<script lang="ts">
  import { enhance } from '$app/forms';
  import { PageFrame } from '$lib/components/shell';
  import { Button, LocalDate, Notice } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const t = site.remotes;
  const results = site.import.results;
</script>

<PageFrame title={t.title} lead={t.lead} width="reading">
  {#if form && 'error' in form && form.error}
    <Notice kind="error" class="mb-6">{form.error}</Notice>
  {/if}
  {#if form && 'done' in form && form.done === 'push'}
    <Notice class="mb-6">{t.pushed}</Notice>
  {/if}

  {#if data.remotes.length === 0}
    <p class="font-sans text-sm text-ink-soft">{t.none}</p>
  {/if}
  <ul class="flex flex-col gap-6 font-sans text-sm">
    {#each data.remotes as remote (remote.id)}
      <li class="flex flex-col gap-2 border-b border-line pb-5">
        <p>
          <a
            href="{remote.origin}/works/{remote.slug}"
            rel="external"
            class="font-medium text-ink underline">{remote.origin}/works/{remote.slug}</a
          >
        </p>
        <p class="text-ink-soft">
          {t.lastPulled}: {#if remote.lastPulledAt}<LocalDate
              date={remote.lastPulledAt}
            />{:else}{t.never}{/if}
        </p>
        <div class="flex flex-wrap gap-2">
          <form method="POST" action="?/compare" use:enhance>
            <input type="hidden" name="id" value={remote.id} /><Button
              size="sm"
              variant="ghost"
              type="submit">{t.compare}</Button
            >
          </form>
          <form method="POST" action="?/pull" use:enhance>
            <input type="hidden" name="id" value={remote.id} /><input
              type="hidden"
              name="preview"
              value="1"
            /><Button size="sm" variant="secondary" type="submit">{t.preview}</Button>
          </form>
          {#if remote.hasToken}
            <form method="POST" action="?/push" use:enhance>
              <input type="hidden" name="id" value={remote.id} /><Button
                size="sm"
                variant="secondary"
                type="submit">{t.push}</Button
              >
            </form>
          {/if}
          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="id" value={remote.id} /><Button
              size="sm"
              variant="ghost"
              type="submit">{t.remove}</Button
            >
          </form>
        </div>
        {#if form && 'remoteId' in form && form.remoteId === remote.id}
          {#if form.done === 'compare' && 'differences' in form}
            <ul class="text-ink-soft">
              {#each form.differences as d (d.id)}<li>
                  {d.kind} <code class="text-xs">{d.id}</code>: {t.differences[d.difference]}
                </li>{/each}
            </ul>
          {:else if form.done === 'pull' && 'report' in form}
            {#if form.report.refused}<Notice kind="error"
                >{site.import.refused} {form.report.refused}</Notice
              >{/if}
            <ul class="text-ink-soft">
              {#each form.report.documents as d (d.kind + d.name)}<li>
                  <span class="font-serif text-ink">{d.name}</span>
                  {results[d.result] ?? d.result}{d.segments.length
                    ? `, ${site.import.segments(d.segments.join(', '))}`
                    : ''}
                </li>{/each}
            </ul>
            {#if form.preview && !form.report.refused}
              <form method="POST" action="?/pull" use:enhance class="mt-2 flex flex-col gap-1.5">
                <input type="hidden" name="id" value={remote.id} />
                <span class="font-medium text-ink">{site.import.policy}</span>
                <label class="flex gap-2"
                  ><input type="radio" name="policy" value="report" checked />
                  {site.import.policyReport}</label
                >
                <label class="flex gap-2"
                  ><input type="radio" name="policy" value="keep" /> {site.import.policyKeep}</label
                >
                <label class="flex gap-2"
                  ><input type="radio" name="policy" value="take" /> {site.import.policyTake}</label
                >
                <div><Button size="sm" variant="primary" type="submit">{t.pull}</Button></div>
              </form>
            {/if}
          {/if}
        {/if}
        <form
          method="POST"
          action="?/schedule"
          use:enhance
          class="flex flex-wrap items-center gap-2 text-ink-soft"
        >
          <input type="hidden" name="id" value={remote.id} />
          <label class="flex items-center gap-2"
            >{t.every}
            <select name="hours" class="rounded border border-line px-1 py-0.5">
              <option value="" selected={!remote.pullEveryHours}>{t.byHand}</option>
              {#each [1, 6, 24, 168] as h (h)}<option
                  value={h}
                  selected={remote.pullEveryHours === h}>{h} {t.hours}</option
                >{/each}
            </select>
          </label>
          <Button size="sm" variant="ghost" type="submit">{s.account.save}</Button>
        </form>
      </li>
    {/each}
  </ul>

  <form method="POST" action="?/add" use:enhance class="mt-8 flex flex-col gap-3 font-sans text-sm">
    <label class="flex flex-col gap-1"
      ><span class="font-medium text-ink">{t.address}</span><input
        name="address"
        type="url"
        required
        placeholder={t.addressHint}
        class="rounded border border-line px-2 py-1"
      /></label
    >
    <label class="flex flex-col gap-1"
      ><span class="font-medium text-ink">{t.token}</span><input
        name="token"
        autocomplete="off"
        class="rounded border border-line px-2 py-1 font-mono text-xs"
      /><span class="text-xs text-ink-soft">{t.tokenHint}</span></label
    >
    <div><Button type="submit" variant="primary">{t.add}</Button></div>
  </form>
</PageFrame>
