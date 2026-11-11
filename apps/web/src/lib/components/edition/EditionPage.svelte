<script lang="ts">
  /**
   * Make New Edition and Edition Settings: one page in two states, its parts
   * in the order of the work. The work, chosen from the registry or added in
   * a window; the name and the editors; for an edition that exists, its
   * preface, sources and note on rights; the witnesses; for an edition that
   * exists, the conventions of its text and of its print apparatus. One Save
   * for the whole page. Leaving it with changes unsaved asks first.
   */
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import type { EditionConventions } from '@varians/db';
  import { SchemeEditor, Section, WorkFields } from '$lib/components/registry';
  import { PageFrame } from '$lib/components/shell';
  import {
    Button,
    Checkbox,
    Dialog,
    Field,
    Input,
    Select,
    Textarea,
    toasts,
  } from '$lib/components/ui';
  import type { ConspectusRow, ConspectusWitness, SuggestedWitness } from '$lib/edition/conspectus';
  import { ALL_WORDS, REST_WORDS } from '$lib/edition/conventions';
  import type { GroupDraft } from '$lib/edition/groups';
  import type { TranscriptionOption } from '$lib/registry/types';
  import { edition as s } from '$lib/strings/edition';
  import { registry } from '$lib/strings/registry';
  import ConspectusEditor from './ConspectusEditor.svelte';
  import EditorsField from './EditorsField.svelte';
  import RecordWindow from './RecordWindow.svelte';

  interface WorkItem {
    id: string;
    slug: string;
    title: string;
    author: string | null;
  }

  interface Props {
    /** Make New Edition, or the settings of an edition that exists. */
    mode: 'new' | 'settings';
    /** The edition's work, or none chosen yet. */
    work: WorkItem | null;
    /** The registry's works to choose from, while none is chosen. */
    works?: WorkItem[];
    /** What the list of works is filtered by. */
    q?: string;
    edition?: {
      slug: string;
      title: string;
      editors: string[];
      preface: string | null;
      sources: string | null;
      rightsNote: string | null;
      licence: string | null;
      installationLicence: string;
      conventions: EditionConventions;
    };
    /** The editors the page starts with. */
    editors: string[];
    conspectus: {
      rows: ConspectusRow[];
      witnesses: Record<string, ConspectusWitness>;
      groups: GroupDraft[];
    };
    suggestions: SuggestedWitness[];
    sources: TranscriptionOption[];
    /** The errors of the last attempt to save, by field. */
    errors?: Record<string, string[] | undefined>;
  }

  let {
    mode,
    work,
    works = [],
    q = '',
    edition,
    editors,
    conspectus,
    suggestions,
    sources,
    errors = {},
  }: Props = $props();

  const here = $derived(mode === 'new' ? '/editions/new' : `/editions/${edition!.slug}/settings`);

  let title = $state(untrack(() => edition?.title ?? ''));
  let query = $state(untrack(() => q));
  let saving = $state(false);
  let formDirty = $state(false);
  let conspectusDirty = $state(false);
  const dirty = $derived(formDirty || conspectusDirty);
  /** Bumped by Cancel on Edition Settings: the page starts again from what is saved. */
  let generation = $state(0);
  let addingWork = $state(false);
  let leaveOpen = $state(false);
  let leaving = false;
  let pending: string | null = null;

  // The list of works follows what is typed, a moment after the typing stops.
  $effect(() => {
    const wanted = query.trim();
    if (mode !== 'new' || work || wanted === untrack(() => q)) return;
    const timer = setTimeout(() => {
      const target = wanted ? `/editions/new?q=${encodeURIComponent(wanted)}` : '/editions/new';
      void goto(target, { keepFocus: true, noScroll: true, replaceState: true });
    }, 250);
    return () => clearTimeout(timer);
  });

  function chooseWork(slug: string) {
    void goto(`/editions/new?work=${encodeURIComponent(slug)}`, { noScroll: true });
  }

  beforeNavigate((navigation) => {
    if (!dirty || leaving) return;
    // Choosing a work and searching the works stay on the page and keep what it holds.
    if (navigation.to && navigation.to.url.pathname === page.url.pathname) return;
    navigation.cancel();
    if (navigation.type === 'leave' || !navigation.to) return;
    pending = navigation.to.url.pathname + navigation.to.url.search + navigation.to.url.hash;
    leaveOpen = true;
  });

  function leave() {
    leaving = true;
    leaveOpen = false;
    if (pending) void goto(pending);
  }

  function cancel() {
    if (mode === 'new') {
      void goto('/');
      return;
    }
    generation += 1;
    formDirty = false;
    title = edition?.title ?? '';
  }

  /** Any change of a field of the page, but not the search for a work. */
  function changed(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-search]')) return;
    formDirty = true;
  }

  const wordOptions = (words: readonly string[]) => [
    { value: '', label: s.wordNone },
    ...words.map((word) => ({ value: word, label: word })),
  ];
  const conventions = $derived(edition?.conventions);
</script>

<PageFrame title={mode === 'new' ? s.newTitle : (edition?.title ?? '')} width="reading">
  {#snippet actions()}
    {#if mode === 'settings' && edition}
      <Button href={`/editions/${edition.slug}`} variant="secondary" size="sm">{s.read}</Button>
      <Button href={`/editions/${edition.slug}/edit`} variant="secondary" size="sm"
        >{s.editText}</Button
      >
    {/if}
  {/snippet}
  <form
    method="POST"
    action={mode === 'new' ? '?/create' : '?/save'}
    novalidate
    class="flex flex-col gap-12"
    oninput={changed}
    onchange={changed}
    use:enhance={() => {
      saving = true;
      return async ({ result, update }) => {
        saving = false;
        if (result.type === 'redirect' || result.type === 'success') {
          toasts.success(s.saved);
          leaving = true;
          formDirty = false;
          await update({ reset: false, invalidateAll: true });
          leaving = false;
          return;
        }
        if (result.type === 'failure') toasts.error(s.notSaved);
        await update({ reset: false });
      };
    }}
  >
    <input type="hidden" name="workId" value={work?.id ?? ''} />

    {#if work}
      <Section title={s.work}>
        {#snippet actions()}
          {#if mode === 'new'}
            <Button
              variant="secondary"
              size="sm"
              onclick={() => goto('/editions/new', { noScroll: true })}>{s.change}</Button
            >
          {/if}
        {/snippet}
        <div class="flex flex-col">
          <span class="font-sans text-xs text-ink-muted">{work.author ?? s.unknownAuthor}</span>
          {#if mode === 'settings'}
            <a href={`/works/${work.slug}`} class="font-serif text-lg text-ink hover:text-accent"
              >{work.title}</a
            >
          {:else}
            <span class="font-serif text-lg text-ink">{work.title}</span>
          {/if}
        </div>
      </Section>
    {:else}
      <Section title={s.chooseWork}>
        {#snippet actions()}
          <Button variant="secondary" size="sm" onclick={() => (addingWork = true)}>
            <Plus class="size-4" aria-hidden="true" />
            {s.addWork}
          </Button>
        {/snippet}
        <div class="flex flex-col gap-3" data-search>
          <div class="relative">
            <label for="work-search" class="sr-only">{s.searchWorks}</label>
            <Search
              class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <Input
              id="work-search"
              type="search"
              bind:value={query}
              autocomplete="off"
              class="pl-9"
              placeholder={s.searchWorks}
            />
          </div>
          {#if errors.work}
            <p class="font-sans text-xs text-danger" role="alert">{errors.work[0]}</p>
          {/if}
          {#if works.length}
            <ul class="divide-y divide-line rounded-lg border border-line bg-surface">
              {#each works as item (item.id)}
                <li class="flex items-center gap-4 px-4 py-2.5">
                  <span class="min-w-0 flex-1">
                    <span class="block font-sans text-xs text-ink-muted"
                      >{item.author ?? s.unknownAuthor}</span
                    >
                    <span class="font-serif text-base text-ink">{item.title}</span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`${s.choose}: ${item.title}`}
                    onclick={() => chooseWork(item.slug)}>{s.choose}</Button
                  >
                </li>
              {/each}
            </ul>
          {:else}
            <p class="font-sans text-sm text-ink-soft">
              {q ? s.noWorksFor(q) : s.noWorks}
            </p>
          {/if}
        </div>
      </Section>
    {/if}

    {#key generation}
      <Section title={s.nameAndEditors}>
        <div class="flex flex-col gap-5">
          <Field label={s.title} error={errors.title} required>
            {#snippet children(control)}
              <Input
                {...control}
                name="title"
                bind:value={title}
                autocomplete="off"
                class="font-serif text-base"
                maxlength={200}
                required
              />
            {/snippet}
          </Field>
          <EditorsField names={editors} error={errors.editors} />
        </div>
      </Section>

      {#if mode === 'settings' && edition}
        <Section title={s.preface}>
          <div class="flex flex-col gap-1.5 font-sans">
            <Textarea
              name="preface"
              value={edition.preface ?? ''}
              rows={6}
              aria-label={s.preface}
              aria-describedby="preface-hint"
            />
            <p id="preface-hint" class="text-xs text-ink-soft">{s.prefaceHint}</p>
          </div>
        </Section>

        <Section title={s.sourcesAndRights}>
          <div class="flex flex-col gap-5">
            <Field label={s.sources} hint={s.sourcesHint} error={errors.sources}>
              {#snippet children(control)}
                <Textarea {...control} name="sources" value={edition.sources ?? ''} rows={3} />
              {/snippet}
            </Field>
            <Field
              label={s.rightsNote}
              error={errors.rightsNote}
              hint={edition.licence
                ? s.licenceFixed(edition.licence)
                : s.licenceToCome(edition.installationLicence)}
            >
              {#snippet children(control)}
                <Input
                  {...control}
                  name="rightsNote"
                  value={edition.rightsNote ?? ''}
                  maxlength={300}
                />
              {/snippet}
            </Field>
          </div>
        </Section>
      {/if}

      <Section title={s.witnesses}>
        <ConspectusEditor
          rows={conspectus.rows}
          witnesses={conspectus.witnesses}
          groups={conspectus.groups}
          {work}
          {suggestions}
          {sources}
          actions={here}
          error={errors.sigla?.[0] ?? null}
          bind:dirty={conspectusDirty}
        />
      </Section>

      {#if mode === 'settings' && conventions}
        <Section title={s.conventions}>
          <div class="flex flex-col gap-5 font-sans text-sm">
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-1.5 font-medium text-ink">{s.lineation}</legend>
              {#each ['verse', 'prose'] as const as kind (kind)}
                <label class="flex items-center gap-2"
                  ><input
                    type="radio"
                    class="accent-accent"
                    name="lineation"
                    value={kind}
                    checked={conventions.lineation === kind}
                  />
                  {s[kind]}</label
                >
              {/each}
            </fieldset>
            <Field label={s.numberEvery} error={errors.numberEvery}>
              {#snippet children(control)}
                <span class="flex items-center gap-2">
                  <span class="w-20"
                    ><Input
                      {...control}
                      name="numberEvery"
                      type="number"
                      min="1"
                      max="100"
                      value={String(conventions.numberEvery)}
                    /></span
                  >
                  <span class="text-ink-soft">{s.numberEveryUnit}</span>
                </span>
              {/snippet}
            </Field>
            <Field label={s.speakers}>
              {#snippet children(control)}
                <Select
                  {...control}
                  name="speakerDisplay"
                  value={conventions.speakerDisplay}
                  options={[
                    { value: 'margin', label: s.speakerMargin },
                    { value: 'inline', label: s.speakerInline },
                    { value: 'own-line', label: s.speakerOwnLine },
                  ]}
                />
              {/snippet}
            </Field>
          </div>
        </Section>

        <Section title={s.printApparatus}>
          <div class="flex flex-col gap-5 font-sans text-sm">
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-1.5 font-medium text-ink">{s.apparatusForm}</legend>
              {#each ['positive', 'negative'] as const as form (form)}
                <label class="flex items-center gap-2"
                  ><input
                    type="radio"
                    class="accent-accent"
                    name="apparatus"
                    value={form}
                    checked={conventions.apparatus === form}
                  />
                  {s[form]}</label
                >
              {/each}
              <Checkbox name="latin" checked={conventions.latin}>{s.latin}</Checkbox>
            </fieldset>
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-1.5 font-medium text-ink">{s.interpretative}</legend>
              {#each ['apparatus', 'separate', 'none'] as const as placement (placement)}
                <label class="flex items-center gap-2"
                  ><input
                    type="radio"
                    class="accent-accent"
                    name="interpretative"
                    value={placement}
                    checked={(conventions.interpretative ?? 'separate') === placement}
                  />
                  {s.interpretativeOptions[placement]}</label
                >
              {/each}
              <p class="text-xs text-ink-soft">{s.interpretativeHint}</p>
            </fieldset>
            <Field label={s.rest} hint={s.restHint} error={errors.rest}>
              {#snippet children(control)}
                <Select
                  {...control}
                  name="rest"
                  value={conventions.rest ?? ''}
                  options={wordOptions(REST_WORDS)}
                />
              {/snippet}
            </Field>
            <Field label={s.all} hint={s.allHint} error={errors.all}>
              {#snippet children(control)}
                <Select
                  {...control}
                  name="all"
                  value={conventions.all ?? ''}
                  options={wordOptions(ALL_WORDS)}
                />
              {/snippet}
            </Field>
          </div>
        </Section>
      {/if}
    {/key}

    <div
      class="sticky bottom-0 flex items-center gap-3 border-t border-line bg-page py-4"
      style="padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px))"
    >
      <Button type="submit" variant="primary" loading={saving}>{s.save}</Button>
      <Button variant="ghost" onclick={cancel} disabled={mode === 'settings' && !dirty}
        >{s.cancel}</Button
      >
    </div>
  </form>
</PageFrame>

{#if mode === 'new'}
  <RecordWindow
    bind:open={addingWork}
    title={s.addWork}
    description={registry.work.publicNote}
    action={`${here}?/addWork`}
    onsaved={(data) => {
      const made = data.work as WorkItem;
      toasts.success(registry.work.created(made.title));
      chooseWork(made.slug);
    }}
  >
    {#snippet fields(fieldErrors)}
      <WorkFields errors={fieldErrors} search />
      <SchemeEditor error={fieldErrors.scheme} />
    {/snippet}
  </RecordWindow>
{/if}

<Dialog bind:open={leaveOpen} title={s.leave.title} description={s.leave.body} size="sm">
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (leaveOpen = false)}>{s.leave.stay}</Button>
    <Button variant="danger" onclick={leave}>{s.leave.leave}</Button>
  {/snippet}
</Dialog>
