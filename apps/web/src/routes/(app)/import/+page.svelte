<script lang="ts">
  import { enhance } from '$app/forms';
  import { PageFrame } from '$lib/components/shell';
  import { Button, Notice } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
  let busy = $state(false);
  const t = site.import;
  const report = $derived(form && 'report' in form ? form.report : null);
  const submit = () => {
    busy = true;
    return async ({ update }: { update: (options?: { reset?: boolean }) => Promise<void> }) => {
      busy = false;
      await update({ reset: false });
    };
  };
</script>

<PageFrame title={t.title} lead={t.lead} width="reading">
  {#if form && 'error' in form && form.error}
    <Notice kind="error" class="mb-6">{form.error}</Notice>
  {/if}

  {#if !report || form?.stage === 'done'}
    <form
      method="POST"
      action="?/preview"
      enctype="multipart/form-data"
      class="flex flex-col gap-4 font-sans text-sm"
      use:enhance={submit}
    >
      <label class="flex flex-col gap-1.5">
        <span class="font-medium text-ink">{t.file}</span>
        <input type="file" name="package" accept=".zip,application/zip" required />
      </label>
      <div>
        <Button type="submit" variant={report ? 'secondary' : 'primary'} loading={busy}
          >{t.preview}</Button
        >
      </div>
    </form>
  {/if}

  {#if report}
    <section class="mt-8 flex flex-col gap-4 font-sans text-sm">
      {#if report.refused}
        <Notice kind="error">{t.refused} {report.refused}</Notice>
      {:else}
        <Notice kind={form?.stage === 'done' ? 'success' : 'info'}
          >{form?.stage === 'done' ? t.done : t.previewing}</Notice
        >
      {/if}
      <p class="text-ink-soft">{report.bag ? t.checked : t.unchecked}</p>
      {#if report.problems.length}
        <h2 class="font-semibold text-ink">{t.problems}</h2>
        <ul class="list-disc pl-5 text-ink-soft">
          {#each report.problems as p (p.file + p.message)}<li>
              <code>{p.file}</code>: {p.message}
            </li>{/each}
        </ul>
      {/if}
      {#each report.works as w (w.workId)}
        <div class="flex flex-col gap-2">
          <h2 class="font-semibold text-ink">{t.documents}</h2>
          <ul class="flex flex-col gap-1">
            {#each w.documents as d (d.kind + d.name)}
              <li>
                <span class="font-serif text-ink">{d.name}</span>
                <span class="text-ink-soft"
                  >{t.result(d.result, d.reason)}{d.segments.length
                    ? `, ${t.segments(d.segments.join(', '))}`
                    : ''}</span
                >
              </li>
            {/each}
          </ul>
          {#each w.matches as m (m.incomingId)}<p class="text-ink-soft">
              {t.matched(m.kind, m.by)}{m.value ? `: ${m.value}` : ''}
            </p>{/each}
          {#each w.possibleDuplicates as d (d.incomingId)}<p class="text-ink-soft">
              {t.duplicate(d.name, d.localName)}
            </p>{/each}
          {#if w.createdPersons.length}<p class="text-ink-soft">
              {t.newPersons(w.createdPersons.join(', '))}
            </p>{/if}
          {#each w.warnings as warning (warning)}<p class="text-ink-muted">{warning}</p>{/each}
        </div>
      {/each}

      {#if form?.stage === 'preview' && form.token}
        <form method="POST" action="?/run" class="mt-4 flex flex-col gap-3" use:enhance={submit}>
          <input type="hidden" name="token" value={form.token} />
          <input type="hidden" name="name" value={form.name} />
          <fieldset class="flex flex-col gap-1.5">
            <legend class="mb-1 font-medium text-ink">{t.policy}</legend>
            <label class="flex gap-2"
              ><input type="radio" name="policy" value="report" checked /> {t.policyReport}</label
            >
            <label class="flex gap-2"
              ><input type="radio" name="policy" value="keep" /> {t.policyKeep}</label
            >
            <label class="flex gap-2"
              ><input type="radio" name="policy" value="take" /> {t.policyTake}</label
            >
          </fieldset>
          <div><Button type="submit" variant="primary" loading={busy}>{t.run}</Button></div>
        </form>
      {/if}
    </section>
  {/if}
</PageFrame>
