<script lang="ts">
  /**
   * The conspectus: one row per witness, in the order the apparatus cites
   * them, with the siglum it goes by in the edition and the transcript
   * collated (or none, for a witness known from reported readings); the
   * further states of a witness collated under sigla of their own, and the
   * variants it notes; and the groups, sigla that stand for several
   * witnesses together. Witnesses are chosen from the registry's list on the
   * page or registered in a window, transcripts made in a window, each saved
   * with its window.
   *
   * Placed inside a form, it sends the rows as `sigla` and the groups as
   * `groups`, both JSON. Make New Edition, Edition Settings and the editor's
   * Witnesses and Sigla window all use it.
   */
  import { untrack } from 'svelte';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import type { SiglumState } from '@varians/db';
  import { NewTranscriptionForm, WitnessFields } from '$lib/components/registry';
  import { Button, Checkbox, IconButton, Input, Notice, Select } from '$lib/components/ui';
  import {
    newRow,
    type ConspectusRow,
    type ConspectusWitness,
    type SuggestedWitness,
    type TranscriptChoice,
  } from '$lib/edition/conspectus';
  import type { GroupDraft } from '$lib/edition/groups';
  import type { SearchHit, TranscriptionOption } from '$lib/registry/types';
  import { edition } from '$lib/strings/edition';
  import { workbench } from '$lib/strings/workbench';
  import { handOptions } from '$lib/workbench/hands';
  import RecordWindow from './RecordWindow.svelte';
  import WitnessChooser from './WitnessChooser.svelte';

  const t = edition.conspectus;

  interface Props {
    rows: ConspectusRow[];
    /** The witnesses the rows name, with the transcripts each may collate. */
    witnesses: Record<string, ConspectusWitness>;
    groups: GroupDraft[];
    /** The edition's work; a transcript is made for it, so none is made before it is chosen. */
    work: { id: string; title: string } | null;
    /** Offered first when a witness is added. */
    suggestions: SuggestedWitness[];
    /** The transcripts a new one may start from. */
    sources: TranscriptionOption[];
    /** The page whose form actions make the records of the windows (addWitness, newTranscript). */
    actions: string;
    /** Why the conspectus was not saved. */
    error?: string | null;
    /** Whether the conspectus differs from what it was given. */
    dirty?: boolean;
    /** Add New Witness… above the list; false where the page has the button in the section's heading. */
    newWitnessButton?: boolean;
    /**
     * Whether the finer points of how the apparatus cites a witness are set here: its states under
     * sigla of their own, the variants it notes, the groups. The editor's Witnesses and Sigla window
     * has them; the page on which an edition is made asks only which witnesses, under which sigla,
     * with which transcripts, and keeps the rest as it is.
     */
    finer?: boolean;
  }

  let {
    rows: initialRows,
    witnesses: initialWitnesses,
    groups: initialGroups,
    work,
    suggestions,
    sources,
    actions,
    error = null,
    dirty = $bindable(false),
    newWitnessButton = true,
    finer = false,
  }: Props = $props();

  /** A state as the rows edit it: every field present, the kind deciding which count. */
  interface StateRow {
    kind: 'original' | 'stage' | 'hand';
    stage: string;
    hand: string;
    siglum: string;
  }

  interface Row {
    witnessId: string;
    /** The transcript's id, or '' for none. */
    transcript: string;
    siglum: string;
    states: StateRow[];
    withVariants: boolean;
    variantSiglum: string;
  }

  /** A group as the rows edit it: its members are witnesses, shown under the sigla they have in the rows. */
  interface GroupRow {
    siglum: string;
    note: string;
    witnessIds: string[];
  }

  function stateRow(state: SiglumState): StateRow {
    return {
      kind: state.kind,
      stage: state.kind === 'stage' ? String(state.stage) : '',
      hand: state.kind === 'hand' ? state.hand : '',
      siglum: state.siglum,
    };
  }

  function row(entry: ConspectusRow): Row {
    return {
      witnessId: entry.witnessId,
      transcript: entry.transcriptionId ?? '',
      siglum: entry.siglum,
      states: entry.states.map(stateRow),
      withVariants: entry.variantSiglum !== null,
      variantSiglum: entry.variantSiglum ?? '',
    };
  }

  // What the component was given is where it starts; from then on it owns the rows.
  let rows = $state<Row[]>(untrack(() => initialRows.map(row)));
  let known = $state<Record<string, ConspectusWitness>>(untrack(() => ({ ...initialWitnesses })));
  let groupRows = $state<GroupRow[]>(
    untrack(() =>
      initialGroups.map((g) => ({
        siglum: g.siglum,
        note: g.note ?? '',
        witnessIds: [...g.witnessIds],
      })),
    ),
  );

  let registering = $state(false);

  /** Opens the window in which a witness is registered; for a button outside the component. */
  export function addNewWitness() {
    registering = true;
  }
  let transcribing = $state(false);
  let transcriptFor = $state<string | null>(null);

  const nameOf = (witnessId: string) => known[witnessId]?.name ?? witnessId;

  function transcriptOptions(r: Row) {
    return [
      { value: '', label: t.noTranscript },
      ...(known[r.witnessId]?.transcripts ?? []).map((c) => ({
        value: c.id,
        label: t.transcriptOption(c),
      })),
    ];
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target]!, next[index]!];
    rows = next;
  }

  function remove(index: number) {
    const [gone] = rows.splice(index, 1);
    if (!gone) return;
    for (const group of groupRows)
      group.witnessIds = group.witnessIds.filter((id) => id !== gone.witnessId);
  }

  function add(witness: ConspectusWitness) {
    known[witness.id] = witness;
    if (rows.some((r) => r.witnessId === witness.id)) return;
    rows.push(row(newRow(witness)));
  }

  /** A witness chosen in the registry, with the transcripts of it this person may use. */
  async function choose(hit: SearchHit) {
    const query = work ? `?work=${encodeURIComponent(work.id)}` : '';
    const response = await fetch(`/api/witnesses/${encodeURIComponent(hit.id)}/conspectus${query}`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? response.statusText);
    }
    add((await response.json()) as ConspectusWitness);
  }

  function makeTranscript(witnessId: string) {
    transcriptFor = witnessId;
    transcribing = true;
  }

  function transcriptMade(transcript: TranscriptChoice) {
    const witnessId = transcriptFor;
    if (!witnessId) return;
    known[witnessId]?.transcripts.push(transcript);
    const target = rows.find((r) => r.witnessId === witnessId);
    if (target) target.transcript = transcript.id;
  }

  function toggleMember(group: GroupRow, witnessId: string) {
    group.witnessIds = group.witnessIds.includes(witnessId)
      ? group.witnessIds.filter((id) => id !== witnessId)
      : [...group.witnessIds, witnessId];
  }

  const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
  const sup = (n: number) =>
    String(n)
      .split('')
      .map((c) => SUPERSCRIPT[Number(c)] ?? c)
      .join('');

  /** The siglum proposed for a state: A¹ before correction, A² and on after the stages, A with the hand's label otherwise. */
  function proposedSiglum(r: Row, state: StateRow): string {
    const base = r.siglum.trim();
    if (state.kind === 'original') return `${base}${sup(1)}`;
    if (state.kind === 'stage') return `${base}${sup((Number.parseInt(state.stage, 10) || 1) + 1)}`;
    const hands = known[r.witnessId]?.hands ?? [];
    const registered = hands.find((h) => h.id === state.hand);
    const label = registered
      ? registered.label
      : state.hand === 'other'
        ? workbench.hands.other.toLowerCase()
        : state.hand === 'scribe'
          ? workbench.hands.scribe.toLowerCase()
          : state.hand;
    return `${base} ${label}`.trim();
  }

  /** The hands a state may name: the scribe, the registered hands, another hand. */
  function handChoices(r: Row, current: string) {
    return handOptions(known[r.witnessId]?.hands ?? [], workbench.hands, current).filter(
      (o) => o.value !== '',
    );
  }

  /** A change of kind keeps the siglum when the editor typed one, and proposes anew otherwise. */
  function changeKind(r: Row, state: StateRow, kind: StateRow['kind']) {
    const proposed = state.siglum === '' || state.siglum === proposedSiglum(r, state);
    state.kind = kind;
    if (kind === 'stage' && !state.stage)
      state.stage = String(r.states.filter((s) => s.kind === 'stage' && s !== state).length + 1);
    if (kind === 'hand' && !state.hand) state.hand = handChoices(r, '')[0]?.value ?? 'scribe';
    if (proposed) state.siglum = proposedSiglum(r, state);
  }

  function addState(r: Row) {
    const hasOriginal = r.states.some((s) => s.kind === 'original');
    const nextStage = r.states.filter((s) => s.kind === 'stage').length + 1;
    const state: StateRow = hasOriginal
      ? { kind: 'stage', stage: String(nextStage), hand: '', siglum: '' }
      : { kind: 'original', stage: '', hand: '', siglum: '' };
    state.siglum = proposedSiglum(r, state);
    r.states.push(state);
  }

  const payload = $derived(
    JSON.stringify(
      rows.map((r) => ({
        witnessId: r.witnessId,
        transcriptionId: r.transcript || null,
        siglum: r.siglum.trim(),
        states: r.transcript
          ? r.states.map((s) => {
              const siglum = s.siglum.trim() || proposedSiglum(r, s);
              if (s.kind === 'stage')
                return { kind: 'stage', stage: Number.parseInt(s.stage, 10) || 1, siglum };
              if (s.kind === 'hand') return { kind: 'hand', hand: s.hand || 'scribe', siglum };
              return { kind: 'original', siglum };
            })
          : [],
        variantSiglum:
          r.withVariants && r.transcript
            ? r.variantSiglum.trim() || `${r.siglum.trim()} v.l.`
            : null,
      })),
    ),
  );

  /** The groups as the form carries them; a row with nothing in it is no group. */
  const groupsPayload = $derived(
    JSON.stringify(
      groupRows
        .filter((g) => g.siglum.trim() !== '' || g.note.trim() !== '' || g.witnessIds.length > 0)
        .map((g) => ({
          siglum: g.siglum.trim(),
          ...(g.note.trim() ? { note: g.note.trim() } : {}),
          witnessIds: g.witnessIds,
        })),
    ),
  );

  const startedAs = untrack(() => [payload, groupsPayload]);
  $effect(() => {
    dirty = payload !== startedAs[0] || groupsPayload !== startedAs[1];
  });

  const kindOptions = Object.entries(t.stateKinds).map(([value, label]) => ({ value, label }));
</script>

<input type="hidden" name="sigla" value={payload} />
<input type="hidden" name="groups" value={groupsPayload} />

<div class="flex flex-col gap-5 font-sans text-sm">
  {#if error}<Notice kind="error">{error}</Notice>{/if}

  {#if rows.length}
    <table class="w-full border-collapse">
      <thead>
        <tr class="text-left text-xs text-ink-soft">
          <th class="w-24 pr-3 pb-2 font-medium">{t.siglum}</th>
          <th class="pr-3 pb-2 font-medium">{t.witness}</th>
          <th class="w-64 pr-3 pb-2 font-medium">{t.transcript}</th>
          <th class="w-24 pb-2"><span class="sr-only">{t.order}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r, index (r.witnessId)}
          {@const name = nameOf(r.witnessId)}
          <tr class="border-t border-line align-top" data-witness={r.witnessId}>
            <td class="pt-3 pr-3">
              <Input
                bind:value={r.siglum}
                class="font-serif text-base"
                aria-label={`${t.siglum}: ${name}`}
                maxlength={20}
              />
            </td>
            <td class="pt-3 pr-3">
              <span class="flex min-h-9 items-center font-serif text-base text-ink">{name}</span>
            </td>
            <td class="pt-3 pr-3">
              <Select
                bind:value={r.transcript}
                options={transcriptOptions(r)}
                aria-label={`${t.transcript}: ${name}`}
              />
            </td>
            <td class="pt-3">
              <span class="flex min-h-9 items-center justify-end gap-0.5">
                <IconButton
                  label={t.moveUp(name)}
                  size="sm"
                  disabled={index === 0}
                  onclick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></IconButton
                >
                <IconButton
                  label={t.moveDown(name)}
                  size="sm"
                  disabled={index === rows.length - 1}
                  onclick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></IconButton
                >
                <IconButton label={t.remove(name)} size="sm" onclick={() => remove(index)}
                  ><X aria-hidden="true" /></IconButton
                >
              </span>
            </td>
          </tr>
          <tr class="align-top">
            <td></td>
            <td colspan="3" class="pt-1 pb-3">
              <div class="-ml-2.5 flex flex-wrap items-center gap-x-1 gap-y-1">
                {#if finer && r.transcript}
                  <Button href={`/transcriptions/${r.transcript}`} variant="ghost" size="sm"
                    >{t.openTranscript}</Button
                  >
                {/if}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => makeTranscript(r.witnessId)}
                  aria-label={`${t.makeTranscript}: ${name}`}
                >
                  <Plus class="size-4" aria-hidden="true" />
                  {t.makeTranscript}
                </Button>
                {#if finer && r.transcript}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => addState(r)}
                    title={t.statesHint}
                    aria-label={`${t.addState}: ${name}`}
                  >
                    <Plus class="size-4" aria-hidden="true" />
                    {t.addState}
                  </Button>
                  <span class="ml-2.5" title={t.variantsHint}>
                    <Checkbox bind:checked={r.withVariants}>{t.variants}</Checkbox>
                  </span>
                {/if}
              </div>
              {#if finer && r.transcript && r.states.length}
                <div
                  class="mt-2 flex flex-col gap-1.5"
                  role="group"
                  aria-label={`${t.states}: ${name}`}
                >
                  {#each r.states as state, k (k)}
                    <div class="flex items-center gap-2">
                      <div class="w-44 shrink-0">
                        <Select
                          value={state.kind}
                          options={kindOptions}
                          aria-label={t.states}
                          onchange={(e) =>
                            changeKind(r, state, e.currentTarget.value as StateRow['kind'])}
                        />
                      </div>
                      {#if state.kind === 'stage'}
                        <div class="w-16 shrink-0">
                          <Input
                            type="number"
                            min="1"
                            max="9"
                            bind:value={state.stage}
                            aria-label={t.stateStage}
                          />
                        </div>
                      {:else if state.kind === 'hand'}
                        <div class="w-44 shrink-0">
                          <Select
                            bind:value={state.hand}
                            options={handChoices(r, state.hand)}
                            aria-label={t.stateHand}
                          />
                        </div>
                      {/if}
                      <div class="w-28 shrink-0">
                        <Input
                          bind:value={state.siglum}
                          class="font-serif"
                          aria-label={t.stateSiglum}
                        />
                      </div>
                      <IconButton
                        label={t.removeState}
                        size="sm"
                        onclick={() => r.states.splice(k, 1)}><X aria-hidden="true" /></IconButton
                      >
                    </div>
                  {/each}
                </div>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if finer && (rows.length >= 2 || groupRows.length)}
    <section class="flex flex-col gap-2" aria-labelledby="conspectus-groups">
      <h3 id="conspectus-groups" class="text-sm font-semibold text-ink" title={t.groupsHint}>
        {t.groups}
      </h3>
      {#if groupRows.length}
        <ul class="flex flex-col gap-2">
          {#each groupRows as group, g (g)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2">
              <Input
                bind:value={group.siglum}
                class="w-20 font-serif"
                aria-label={t.groupSiglum}
                maxlength={20}
              />
              <span
                class="flex flex-wrap gap-x-3 gap-y-1"
                role="group"
                aria-label={t.groupWitnesses}
              >
                {#each rows as member (member.witnessId)}
                  <Checkbox
                    class="font-serif"
                    checked={group.witnessIds.includes(member.witnessId)}
                    onchange={() => toggleMember(group, member.witnessId)}>{member.siglum}</Checkbox
                  >
                {/each}
              </span>
              <Input
                bind:value={group.note}
                class="min-w-40 flex-1"
                aria-label={t.groupNote}
                maxlength={200}
              />
              <IconButton label={t.removeGroup} size="sm" onclick={() => groupRows.splice(g, 1)}
                ><X aria-hidden="true" /></IconButton
              >
            </li>
          {/each}
        </ul>
      {/if}
      <div class="-ml-2.5">
        <Button
          variant="ghost"
          size="sm"
          onclick={() => groupRows.push({ siglum: '', note: '', witnessIds: [] })}
        >
          <Plus class="size-4" aria-hidden="true" />
          {t.addGroup}
        </Button>
      </div>
    </section>
  {/if}

  {#if newWitnessButton}
    <div class="flex justify-end">
      <Button variant="secondary" size="sm" onclick={addNewWitness}>
        <Plus class="size-4" aria-hidden="true" />
        {t.addNewWitness}
      </Button>
    </div>
  {/if}
  <WitnessChooser present={rows.map((r) => r.witnessId)} {suggestions} onchoose={choose} />
</div>

<RecordWindow
  bind:open={registering}
  title={t.addNewWitnessTitle}
  action={`${actions}?/addWitness`}
  onsaved={(data) => add(data.witness as ConspectusWitness)}
>
  {#snippet fields(errors)}
    <WitnessFields {errors} search />
  {/snippet}
</RecordWindow>

<NewTranscriptionForm
  bind:open={transcribing}
  title={t.makeTranscriptTitle}
  action={`${actions}?/newTranscript`}
  {work}
  witness={transcriptFor ? { id: transcriptFor, name: nameOf(transcriptFor) } : null}
  {sources}
  oncreated={transcriptMade}
/>
