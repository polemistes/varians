<script lang="ts">
  /**
   * The conspectus: which transcripts the apparatus compares, in which
   * order, under which sigla; the further states of each witness collated
   * under sigla of their own; and witnesses known only from reported readings.
   */
  import { enhance } from '$app/forms';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import type { SiglumState, WitnessHand } from '@varians/db';
  import { Button, Checkbox, Dialog, IconButton, Input, Notice, Select } from '$lib/components/ui';
  import { editor } from '$lib/strings/editor';
  import { workbench } from '$lib/strings/workbench';
  import { handOptions } from '$lib/workbench/hands';

  const t = editor.dialogs.sigla;
  const d = editor.dialogs;

  interface Entry {
    witnessId: string;
    transcriptionId: string | null;
    siglum: string;
    states: SiglumState[];
    variantSiglum: string | null;
  }

  interface Candidate {
    transcriptionId: string;
    transcriptionName: string;
    witnessId: string;
    witnessName: string;
    siglum: string;
    segments: number;
  }

  interface Props {
    open: boolean;
    sigla: Entry[];
    candidates: Candidate[];
    reportedOnly: { id: string; name: string; siglum: string }[];
    /** The hands of the witnesses, by witness id, for states that name a hand. */
    witnessHands: Record<string, WitnessHand[]>;
    onsaved?: () => void;
  }

  let { open = $bindable(), sigla, candidates, reportedOnly, witnessHands, onsaved }: Props = $props();

  /** A state as the dialog edits it: every field present, the kind deciding which count. */
  interface StateRow {
    kind: 'original' | 'stage' | 'hand';
    stage: string;
    hand: string;
    siglum: string;
  }

  type Row = Omit<Entry, 'states'> & { states: StateRow[]; name: string; detail: string; included: boolean; withVariants: boolean };

  let rows = $state<Row[]>([]);
  let message = $state<string | null>(null);
  let saving = $state(false);
  let form = $state<HTMLFormElement | null>(null);

  function nameOf(entry: Entry): { name: string; detail: string } {
    const candidate = candidates.find((c) => c.transcriptionId === entry.transcriptionId);
    if (candidate) return { name: candidate.witnessName, detail: `${candidate.transcriptionName} · ${candidate.segments}` };
    const reported = reportedOnly.find((w) => w.id === entry.witnessId);
    return { name: reported?.name ?? entry.witnessId, detail: t.reportedOnly };
  }

  function stateRow(state: SiglumState): StateRow {
    return {
      kind: state.kind,
      stage: state.kind === 'stage' ? String(state.stage) : '',
      hand: state.kind === 'hand' ? state.hand : '',
      siglum: state.siglum,
    };
  }

  // Fill the rows when the dialog opens: the conspectus first, then what could be added.
  $effect(() => {
    if (!open) return;
    message = null;
    const present = sigla.map((x) => ({ ...x, states: x.states.map(stateRow), ...nameOf(x), included: true, withVariants: x.variantSiglum !== null }));
    const more = candidates
      .filter((c) => !sigla.some((x) => x.transcriptionId === c.transcriptionId))
      .map((c) => ({ witnessId: c.witnessId, transcriptionId: c.transcriptionId, siglum: c.siglum, states: [], variantSiglum: null, name: c.witnessName, detail: `${c.transcriptionName} · ${c.segments}`, included: false, withVariants: false }));
    const reported = reportedOnly
      .filter((w) => !sigla.some((x) => x.witnessId === w.id))
      .map((w) => ({ witnessId: w.id, transcriptionId: null, siglum: w.siglum, states: [], variantSiglum: null, name: w.name, detail: t.reportedOnly, included: false, withVariants: false }));
    rows = [...present, ...more, ...reported];
  });

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target]!, next[index]!];
    rows = next;
  }

  const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
  const sup = (n: number) => String(n).split('').map((c) => SUPERSCRIPT[Number(c)] ?? c).join('');

  /** The siglum proposed for a state: A¹ before correction, A² and on after the stages, A with the hand's label otherwise. */
  function proposedSiglum(row: Row, state: StateRow): string {
    const base = row.siglum.trim();
    if (state.kind === 'original') return `${base}${sup(1)}`;
    if (state.kind === 'stage') return `${base}${sup((Number.parseInt(state.stage, 10) || 1) + 1)}`;
    const hands = witnessHands[row.witnessId] ?? [];
    const registered = hands.find((h) => h.id === state.hand);
    const label = registered ? registered.label : state.hand === 'other' ? workbench.hands.other.toLowerCase() : state.hand === 'scribe' ? workbench.hands.scribe.toLowerCase() : state.hand;
    return `${base} ${label}`.trim();
  }

  /** The hands a state may name: the scribe, the registered hands, another hand. */
  function handChoices(row: Row, current: string) {
    return handOptions(witnessHands[row.witnessId] ?? [], workbench.hands, current).filter((o) => o.value !== '');
  }

  /** A change of kind keeps the siglum when the editor typed one, and proposes anew otherwise. */
  function changeKind(row: Row, state: StateRow, kind: StateRow['kind']) {
    const proposed = state.siglum === '' || state.siglum === proposedSiglum(row, state);
    state.kind = kind;
    if (kind === 'stage' && !state.stage) state.stage = String(row.states.filter((s) => s.kind === 'stage' && s !== state).length + 1);
    if (kind === 'hand' && !state.hand) state.hand = handChoices(row, '')[0]?.value ?? 'scribe';
    if (proposed) state.siglum = proposedSiglum(row, state);
  }

  function addState(row: Row) {
    const hasOriginal = row.states.some((s) => s.kind === 'original');
    const nextStage = row.states.filter((s) => s.kind === 'stage').length + 1;
    const state: StateRow = hasOriginal ? { kind: 'stage', stage: String(nextStage), hand: '', siglum: '' } : { kind: 'original', stage: '', hand: '', siglum: '' };
    state.siglum = proposedSiglum(row, state);
    row.states.push(state);
  }

  const payload = $derived(
    JSON.stringify(
      rows
        .filter((r) => r.included)
        .map((r) => ({
          witnessId: r.witnessId,
          transcriptionId: r.transcriptionId,
          siglum: r.siglum.trim(),
          states: r.transcriptionId
            ? r.states.map((s) => {
                const siglum = s.siglum.trim() || proposedSiglum(r, s);
                if (s.kind === 'stage') return { kind: 'stage', stage: Number.parseInt(s.stage, 10) || 1, siglum };
                if (s.kind === 'hand') return { kind: 'hand', hand: s.hand || 'scribe', siglum };
                return { kind: 'original', siglum };
              })
            : [],
          variantSiglum: r.withVariants && r.transcriptionId ? r.variantSiglum?.trim() || `${r.siglum.trim()} v.l.` : null,
        })),
    ),
  );

  const kindOptions = Object.entries(t.stateKinds).map(([value, label]) => ({ value, label }));
</script>

<Dialog bind:open title={t.title} size="lg">
  <form
    method="POST"
    action="?/sigla"
    bind:this={form}
    use:enhance={() => {
      saving = true;
      return async ({ result, update }) => {
        saving = false;
        if (result.type === 'failure') {
          message = (result.data as { message?: string } | undefined)?.message ?? d.notSaved;
          return;
        }
        open = false;
        onsaved?.();
        await update({ reset: false });
      };
    }}
  >
    <input type="hidden" name="sigla" value={payload} />
    {#if message}<Notice kind="error">{message}</Notice>{/if}
    <table class="mt-2 w-full border-collapse font-sans text-sm">
      <thead>
        <tr class="text-left text-xs text-ink-soft">
          <th class="py-1 pr-2 font-medium">{t.included}</th>
          <th class="py-1 pr-2 font-medium">{t.siglum}</th>
          <th class="py-1 pr-2 font-medium">{t.witness}</th>
          <th class="py-1 pr-2 font-medium" title={t.variantsHint}>{t.variants}</th>
          <th class="py-1 font-medium"><span class="sr-only">{t.order}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, index (row.witnessId + (row.transcriptionId ?? ''))}
          <tr class="border-t border-line">
            <td class="py-1.5 pr-2"><Checkbox bind:checked={row.included} aria-label={t.include(row.name)} /></td>
            <td class="py-1.5 pr-2"><Input bind:value={row.siglum} class="w-20 font-serif" aria-label={t.siglum} disabled={!row.included} /></td>
            <td class="py-1.5 pr-2"><span class="font-serif text-ink">{row.name}</span> <span class="text-xs text-ink-soft">{row.detail}</span></td>
            <td class="py-1.5 pr-2">
              {#if row.transcriptionId}
                <Checkbox bind:checked={row.withVariants} disabled={!row.included} aria-label={t.variantsLabel} />
              {/if}
            </td>
            <td class="py-1.5 whitespace-nowrap">
              <IconButton label={t.moveUp} size="sm" onclick={() => move(index, -1)}>↑</IconButton>
              <IconButton label={t.moveDown} size="sm" onclick={() => move(index, 1)}>↓</IconButton>
            </td>
          </tr>
          {#if row.included && row.transcriptionId}
            <tr>
              <td></td>
              <td colspan="4" class="pb-2">
                <div class="flex flex-col gap-1.5" title={t.statesHint}>
                  {#each row.states as state, k (k)}
                    <div class="flex items-center gap-2">
                      <div class="w-40 shrink-0">
                        <Select value={state.kind} options={kindOptions} aria-label={t.states} onchange={(e) => changeKind(row, state, e.currentTarget.value as StateRow['kind'])} />
                      </div>
                      {#if state.kind === 'stage'}
                        <div class="w-16 shrink-0"><Input type="number" min="1" max="9" bind:value={state.stage} aria-label={t.stateStage} /></div>
                      {:else if state.kind === 'hand'}
                        <div class="w-44 shrink-0"><Select bind:value={state.hand} options={handChoices(row, state.hand)} aria-label={t.stateHand} /></div>
                      {/if}
                      <div class="w-28 shrink-0"><Input bind:value={state.siglum} class="font-serif" aria-label={t.stateSiglum} /></div>
                      <IconButton label={t.removeState} size="sm" onclick={() => row.states.splice(k, 1)}><X aria-hidden="true" /></IconButton>
                    </div>
                  {/each}
                  <div>
                    <Button type="button" variant="ghost" size="sm" onclick={() => addState(row)}>
                      <Plus class="size-4" aria-hidden="true" />
                      {t.addState}
                    </Button>
                  </div>
                </div>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{d.cancel}</Button>
    <Button variant="primary" loading={saving} onclick={() => form?.requestSubmit()}>{d.save}</Button>
  {/snippet}
</Dialog>
