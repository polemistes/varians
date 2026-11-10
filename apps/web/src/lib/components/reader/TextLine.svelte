<script lang="ts">
  /**
   * One line of the edition: its label in the margin on the start side, a
   * speaker in a margin of its own where the edition sets it so, and the
   * printed words, each a span with its token id. Words at a variant site
   * carry the keys of their sites, and once the page is live the first word
   * of each site is a stop for the keyboard. A variant at a point between
   * two words has a small mark there, which opens it like a word and takes
   * the keyboard's focus. A variant over whole lines has a mark in the margin
   * before the line's words, the part of it that stands on this line.
   */
  import type { LayoutLine } from '@varians/core';
  import type { MarginPart } from '$lib/reader/line-marks';
  import type { Printed } from '$lib/reader/marks';
  import type { PointMark } from '$lib/reader/sites';
  import { gapSign, VACAT_TEXT } from '$lib/reader/marks';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    line: LayoutLine;
    index: number;
    pieces: Printed[];
    label: string | null;
    labelHref: string | null;
    speakerDisplay: 'inline' | 'margin' | 'own-line';
    /** Segments that begin on this line. */
    starts: string[];
    /** Site keys of each word at a site. */
    sitesOf: Map<string, string>;
    /** Words whose site has an entry: underlined and clickable. */
    marked: Set<string>;
    /** The first word of each site: reachable by Tab once the page is live. */
    tabStops: Set<string>;
    /** The marks of variants at a point between two words, by the word each follows. */
    pointsAfter: Map<string, PointMark>;
    /** The marks that precede the first word of a segment, by that word. */
    pointsBefore: Map<string, PointMark>;
    /** The parts of the marks in the margin that stand on this line. */
    margin: MarginPart[];
    underline: boolean;
    interactive: boolean;
    /** Mid-line segment starts, labelled in the line: item id to label. */
    inlineLabels: Map<string, string>;
    /** The segment of each item, for the permalink highlight. */
    segmentOf: Map<string, string | null>;
    focusSegment: string | null;
    /** The whole line belongs to the permalink's segment: it is lit as one. */
    focusLine: boolean;
    /** Words a search matched. */
    matches: Set<string>;
    hit: boolean;
    currentHit: boolean;
  }

  let {
    line,
    index,
    pieces,
    label,
    labelHref,
    speakerDisplay,
    starts,
    sitesOf,
    marked,
    tabStops,
    pointsAfter,
    pointsBefore,
    margin,
    underline,
    interactive,
    inlineLabels,
    segmentOf,
    focusSegment,
    focusLine,
    matches,
    hit,
    currentHit,
  }: Props = $props();

  /**
   * A speaker who opens the line stands in the margin or on a line of its
   * own, as the edition sets it; a speaker within the line (a shared verse)
   * stays where it stands.
   */
  const speakers = $derived.by(() => {
    if (speakerDisplay === 'inline') return [];
    const firstWord = pieces.findIndex((p) => p.kind === 'token');
    return pieces.filter(
      (p, i) => p.kind === 'paratext' && p.type === 'speaker' && (firstWord < 0 || i < firstWord),
    );
  });
  const flow = $derived(speakers.length ? pieces.filter((p) => !speakers.includes(p)) : pieces);
  const dir = $derived(line.rend === 'rtl' || line.rend === 'ltr' ? line.rend : 'auto');
  const heading = $derived(
    flow.length > 0 && flow.every((p) => p.kind === 'paratext' && p.type === 'head'),
  );

  function pointName(mark: PointMark): string {
    return mark.side === 'after'
      ? r.variant.pointAfter(mark.word)
      : r.variant.pointBefore(mark.word);
  }

  function gapTitle(piece: Extract<Printed, { kind: 'gap' }>): string {
    if (piece.untranscribed) return r.text.notTranscribed;
    return piece.quantity !== null
      ? r.text.gapOf(piece.quantity, piece.unit ?? 'characters')
      : r.text.gap;
  }
</script>

<!-- A variant at a point between two words: a mark of no width in the space there, a button once the page is live. -->
{#snippet point(mark: PointMark)}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><span
    class={['point', mark.side, underline && 'drawn']}
    data-sites={mark.keys}
    role={interactive ? 'button' : undefined}
    tabindex={interactive ? 0 : undefined}
    aria-haspopup={interactive ? 'dialog' : undefined}
    aria-label={interactive ? pointName(mark) : undefined}
    title={pointName(mark)}
  ></span>{/snippet}

{#if speakerDisplay === 'own-line' && speakers.length}
  <div class={['line', 'speaker-line', line.paragraph && index > 0 && 'paragraph']} {dir}>
    <span class="label"></span>
    <span class="words"
      ><span class="speaker"
        >{#each speakers as speaker (speaker.id)}{#if speaker.kind === 'paratext'}{speaker.text}{/if}{/each}</span
      ></span
    >
  </div>
{/if}
<div
  class={[
    'line',
    line.paragraph &&
      index > 0 &&
      !(speakerDisplay === 'own-line' && speakers.length) &&
      'paragraph',
    heading && 'heading-line',
  ]}
  data-line={index}
  data-starts={starts.length ? starts.join(' ') : undefined}
  data-hit={hit ? '' : undefined}
  data-hit-current={currentHit ? '' : undefined}
  {dir}
>
  <span class="label"
    >{#if label}{#if labelHref}<a
          href={labelHref}
          data-sveltekit-noscroll
          aria-label={r.text.permalink(label)}>{label}</a
        >{:else}{label}{/if}{/if}</span
  >
  {#if speakerDisplay === 'margin'}<span class="speaker-margin"
      >{#each speakers as speaker (speaker.id)}{#if speaker.kind === 'paratext'}{speaker.text}{/if}{/each}</span
    >{/if}
  <span class="words"
    ><span class="run" data-focus={focusLine ? '' : undefined}
      >{#each flow as piece, n (piece.id)}{#if n > 0 && piece.space && !(piece.kind === 'paratext' && piece.type === 'head')}{' '}{/if}{#if inlineLabels.has(piece.id)}<sup
            class="inline-label">{inlineLabels.get(piece.id)}</sup
          >{/if}{#if piece.kind === 'token'}{@const keys = sitesOf.get(piece.id)}{@const live =
            interactive && marked.has(piece.id)}{#if pointsBefore.has(piece.id)}{@render point(
              pointsBefore.get(piece.id)!,
            )}{/if}{piece.before}<!-- The word is a button exactly when it takes focus. --><!-- svelte-ignore a11y_no_noninteractive_tabindex --><span
            data-token={piece.id}
            data-sites={keys}
            data-focus={!focusLine &&
            focusSegment !== null &&
            segmentOf.get(piece.id) === focusSegment
              ? ''
              : undefined}
            class={[
              'w',
              marked.has(piece.id) && 'variant',
              marked.has(piece.id) && underline && 'dotted',
              matches.has(piece.id) && 'match',
            ]}
            role={live ? 'button' : undefined}
            tabindex={live ? (tabStops.has(piece.id) ? 0 : -1) : undefined}
            aria-haspopup={live ? 'dialog' : undefined}
            >{#each piece.parts as part, k (k)}{#if part.struck}<s>{part.text}</s
                >{:else}{part.text}{/if}{/each}</span
          >{piece.after}{#if pointsAfter.has(piece.id)}{@render point(
              pointsAfter.get(piece.id)!,
            )}{/if}{:else if piece.kind === 'lacuna'}<span
            class="lacuna"
            title={piece.extent ? r.text.lacunaOf(piece.extent) : r.text.lacuna}>{piece.text}</span
          >{:else if piece.kind === 'gap'}<span
            class={['gap', piece.untranscribed && 'untranscribed']}
            title={gapTitle(piece)}>{gapSign(piece)}</span
          >{:else if piece.kind === 'space'}<span class="vacat" title={r.text.space}
            >{VACAT_TEXT}</span
          >{:else if piece.kind === 'note'}<span
            class="note-mark"
            title={piece.text}
            aria-label={`${r.text.note}: ${piece.text}`}>°</span
          >{:else if piece.kind === 'paratext'}{#if piece.type === 'head'}<span
              class="head"
              role="heading"
              aria-level="2">{piece.text}</span
            >{:else if piece.type === 'speaker'}<span class="speaker">{piece.text}</span
            >{:else if piece.type === 'stage'}<span class="stage">{piece.text}</span>{:else}<span
              class="paratext">{piece.text}</span
            >{/if}{/if}{/each}</span
    ></span
  >
  {#each margin as part, n (n)}<!-- The first part of a mark is its button, once the page is live; the others answer the pointer and stay out of the way of a screen reader. --><!-- svelte-ignore a11y_no_noninteractive_tabindex --><span
      class={['mm', part.kind, part.edge, underline && 'drawn']}
      style:--lane={part.lane}
      data-sites={part.keys}
      role={interactive && part.first ? 'button' : undefined}
      tabindex={interactive && part.first ? 0 : undefined}
      aria-haspopup={interactive && part.first ? 'dialog' : undefined}
      aria-label={interactive && part.first ? part.name : undefined}
      aria-hidden={part.first ? undefined : 'true'}
      title={part.name}><span class="stroke"></span></span
    >{/each}
</div>

<style>
  .line {
    position: relative;
    display: grid;
    grid-template-columns: var(--label-column) var(--speaker-column, 0) minmax(0, 1fr);
    align-items: baseline;
    scroll-margin-top: 6rem;
  }

  .paragraph {
    margin-top: 0.85em;
  }

  .label {
    grid-column: 1;
    padding-inline-end: calc(1rem + var(--marks-room, 0rem));
    font-family: var(--font-sans);
    font-size: 0.7em;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    color: var(--color-ink-muted);
    text-align: end;
    white-space: nowrap;
    user-select: none;
  }

  .label a {
    color: inherit;
    text-decoration: none;
  }

  .label a:hover {
    color: var(--color-accent);
    text-decoration: underline;
  }

  .speaker-margin {
    grid-column: 2;
    padding-inline-end: 0.75rem;
    font-variant-caps: small-caps;
    letter-spacing: 0.03em;
    color: var(--color-ink-soft);
    text-align: end;
  }

  .words {
    grid-column: 3;
    /* Long lines wrap with a hanging indent, as verse is printed. */
    padding-inline-start: 1.25em;
    text-indent: -1.25em;
    text-align: start;
  }

  .heading-line .words {
    padding-block: 0.6em 0.3em;
    text-align: center;
  }

  .w {
    border-radius: 0.15em;
    transition: background-color 120ms ease-out;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .variant {
    cursor: pointer;
  }

  .dotted {
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-decoration-thickness: 1px;
    text-decoration-color: color-mix(in srgb, var(--color-ink-muted) 75%, transparent);
    text-underline-offset: 0.22em;
  }

  .variant:hover {
    text-decoration-color: var(--color-accent);
    color: var(--color-accent);
  }

  .variant:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  /*
   * The mark of a variant at a point between two words stands in the space
   * there and has no net width: its box is as wide as the space and the same
   * width is taken off its margin, so that the words stay where they are and
   * the line breaks where it did. A little caret under the line, with a hit
   * area that takes in the space. It follows the word before the point
   * (its box extends forward over the space) or, at the start of a segment,
   * precedes the first word (its box extends back over the space before it).
   */
  .point {
    position: relative;
    display: inline-block;
    width: 0.32em;
    height: 1.1em;
    vertical-align: -0.3em;
    cursor: pointer;
    color: transparent;
    text-indent: 0;
  }

  .point.after {
    margin-inline-end: -0.32em;
  }

  .point.before {
    margin-inline-start: -0.32em;
  }

  .point::before {
    content: '';
    position: absolute;
    bottom: 0.04em;
    inset-inline-start: 50%;
    width: 0.26em;
    height: 0.26em;
    border-top: 1px solid currentColor;
    border-inline-start: 1px solid currentColor;
    transform: translateX(-50%) rotate(45deg);
    transform-origin: center;
    opacity: 0;
  }

  .point.drawn {
    color: color-mix(in srgb, var(--color-ink-muted) 80%, transparent);
  }

  .point.drawn::before,
  .point:hover::before,
  .point:focus-visible::before,
  .point:global([data-active])::before,
  .point:global([data-lit])::before {
    opacity: 1;
  }

  .point:hover,
  .point:global([data-active]),
  .point:global([data-lit]) {
    color: var(--color-accent);
  }

  .point:global([data-active])::after,
  .point:global([data-lit])::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 0.2em;
    background-color: var(--color-accent-soft);
    z-index: -1;
  }

  .point:global([data-active])::after {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .point:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 0;
    border-radius: 0.15em;
    color: var(--color-accent);
  }

  /*
   * The marks of variants over whole lines stand in the margin on the start
   * side, in the space between the labels and the words, so that they are
   * beside the lines they mark and the labels are not crowded: the label's
   * padding leaves room for one lane, and the text makes room for a second
   * (`--marks-room`) where two marks meet. Each part is a box as tall as its
   * line, one lane wide, with the stroke drawn inside it: a plain rule for a
   * line some witnesses do not have, a bracket opening toward the text for
   * lines in another order, a caret pointing into the text between two lines
   * for a line the edition does not print. The parts of one mark are on
   * consecutive lines and join.
   */
  .mm {
    --lane-width: 0.65rem;
    position: absolute;
    /* Above the next line, which the caret reaches into. */
    z-index: 1;
    inset-block: 0;
    inset-inline-start: calc(
      var(--label-column) - 0.15rem - var(--lane-width) * (var(--lane, 0) + 1)
    );
    width: var(--lane-width);
    cursor: pointer;
    color: transparent;
    border-radius: 0.2em;
    text-indent: 0;
  }

  .mm .stroke {
    position: absolute;
    inset-block: 0.3em;
    inset-inline: 0.2rem 0.1rem;
    border-inline-start: 1px solid currentColor;
  }

  .mm.wanting .stroke {
    inset-inline: 0.325rem 0.2rem;
  }

  .mm.order.start .stroke,
  .mm.order.solo .stroke {
    border-block-start: 1px solid currentColor;
  }

  .mm.order.end .stroke,
  .mm.order.solo .stroke {
    border-block-end: 1px solid currentColor;
  }

  /* A mark over several lines is drawn through the space between blocks, so that it stays one. */
  .mm.start .stroke {
    inset-block-end: -0.4em;
  }

  .mm.end .stroke {
    inset-block-start: 0;
  }

  .mm.middle .stroke {
    inset-block: 0 -0.4em;
  }

  /* The caret stands on the boundary below its line. */
  .mm.unprinted {
    inset-block: auto -0.7em;
    height: 1.4em;
  }

  .mm.unprinted .stroke {
    inset: auto;
    top: 50%;
    inset-inline-start: 50%;
    width: 0.42em;
    height: 0.42em;
    border-inline-start: 0;
    border-inline-end: 1px solid currentColor;
    border-block-end: 1px solid currentColor;
    transform: translate(-70%, -50%) rotate(-45deg);
  }

  .mm.unprinted .stroke:dir(rtl) {
    transform: translate(70%, -50%) rotate(45deg);
  }

  .mm.drawn {
    color: color-mix(in srgb, var(--color-ink-muted) 80%, transparent);
  }

  .mm:hover,
  .mm:global([data-active]),
  .mm:global([data-lit]),
  .mm:focus-visible {
    color: var(--color-accent);
  }

  .mm:global([data-active]),
  .mm:global([data-lit]) {
    background-color: var(--color-accent-soft);
  }

  .mm:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 0;
  }

  .w:global([data-lit]) {
    background-color: var(--color-accent-soft);
  }

  .w:global([data-active]) {
    background-color: var(--color-accent-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .match {
    background-color: var(--color-warning-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-warning) 25%, transparent);
  }

  [data-hit-current] .match {
    background-color: color-mix(in srgb, var(--color-warning) 30%, var(--color-warning-soft));
  }

  .run {
    border-radius: 0.2em;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .w:global([data-focus]),
  .run:global([data-focus]) {
    animation: focus-fade 2.6s ease-out 0.2s both;
  }

  @keyframes focus-fade {
    from {
      background-color: color-mix(in srgb, var(--color-accent) 22%, transparent);
    }
    to {
      background-color: transparent;
    }
  }

  .lacuna {
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }

  .gap,
  .vacat {
    color: var(--color-ink-muted);
  }

  .vacat,
  .untranscribed {
    font-style: italic;
  }

  .note-mark {
    font-family: var(--font-sans);
    font-size: 0.7em;
    vertical-align: super;
    color: var(--color-accent);
    cursor: help;
  }

  .inline-label {
    margin-inline: 0.15em 0.2em;
    font-family: var(--font-sans);
    font-size: 0.55em;
    font-variant-numeric: tabular-nums;
    color: var(--color-ink-muted);
  }

  .head {
    display: block;
    text-indent: 0;
    font-weight: 600;
    font-size: 1.08em;
    letter-spacing: 0.01em;
  }

  .speaker {
    font-variant-caps: small-caps;
    letter-spacing: 0.03em;
    color: var(--color-ink-soft);
  }

  .stage,
  .paratext {
    font-style: italic;
    color: var(--color-ink-soft);
  }

  @media print {
    .line {
      break-inside: avoid;
    }

    .dotted {
      text-decoration: none;
    }

    .variant:hover {
      color: inherit;
    }

    .point,
    .mm {
      display: none;
    }

    .w:global([data-lit]),
    .w:global([data-active]),
    .w:global([data-focus]),
    .run:global([data-focus]),
    .match {
      background: none;
      box-shadow: none;
      animation: none;
    }

    .label,
    .speaker,
    .speaker-margin,
    .lacuna,
    .gap,
    .vacat,
    .stage,
    .paratext {
      color: inherit;
    }

    .note-mark {
      display: none;
    }
  }
</style>
