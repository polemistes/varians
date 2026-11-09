<script lang="ts">
  /**
   * Draggable vertical dividers between adjacent word boxes on one line
   * (PLAN 5.6): one gesture per boundary instead of resizing two boxes.
   * Rendered inside FacsimileViewer's children snippet, positioned from the
   * api and re-placed whenever the view moves. On release it reports the new
   * boundary; the owner updates both rects (see applyBoundary in
   * $lib/facsimile/dividers).
   */
  import type { Rect } from '@varians/core';
  import type { FacsimileApi } from '$lib/facsimile/types';
  import {
    MIN_WORD_WIDTH,
    boundariesOf,
    clampBoundary,
    type Direction,
  } from '$lib/facsimile/dividers';

  interface WordBox {
    id: string;
    rect: Rect;
  }

  interface Props {
    api: FacsimileApi;
    /** The line the words sit on; dividers span its height. */
    line: Rect;
    /** The line's words in reading order. */
    words: WordBox[];
    direction?: Direction;
    /** The least width a word keeps, as a fraction of the image. */
    minWidth?: number;
    /** Accessible name of the dividers; owners pass a translated string. */
    label?: string;
    onchange?: (wordId: string, neighbourId: string, newBoundaryX: number) => void;
    /** Fired while dragging, for owners that want to show the boxes moving. */
    onpreview?: (wordId: string, neighbourId: string, x: number) => void;
  }

  let {
    api,
    line,
    words,
    direction = 'ltr',
    minWidth = MIN_WORD_WIDTH,
    label = 'Boundary between words',
    onchange,
    onpreview,
  }: Props = $props();

  // Bumped (at most once a frame) when the view moves, so positions are recomputed.
  let tick = $state(0);
  $effect(() => {
    let frame = 0;
    const unsubscribe = api.onViewportChange(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        tick += 1;
      });
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  });

  let drag = $state<{ index: number; x: number } | null>(null);

  const boundaries = $derived(boundariesOf(words.map((w) => w.rect), direction));

  interface Placed {
    index: number;
    left: number;
    top: number;
    height: number;
    value: number;
  }

  const placed = $derived.by((): Placed[] => {
    void tick;
    return boundaries.map((boundary, index) => {
      const value = drag?.index === index ? drag.x : boundary;
      const top = api.toElement([value, line.y]);
      const bottom = api.toElement([value, line.y + line.h]);
      return { index, left: top.x, top: top.y, height: Math.max(2, bottom.y - top.y), value };
    });
  });

  function elementPoint(event: PointerEvent) {
    const bounds = api.viewer.element.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function clampAt(index: number, x: number): number {
    return clampBoundary(x, words[index].rect, words[index + 1].rect, direction, minWidth);
  }

  function start(event: PointerEvent, index: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { index, x: boundaries[index] };
  }

  function move(event: PointerEvent, index: number) {
    if (!drag || drag.index !== index) return;
    event.preventDefault();
    event.stopPropagation();
    const [x] = api.fromElement(elementPoint(event));
    const clamped = clampAt(index, x);
    drag = { index, x: clamped };
    onpreview?.(words[index].id, words[index + 1].id, clamped);
  }

  function end(event: PointerEvent, index: number) {
    if (!drag || drag.index !== index) return;
    event.stopPropagation();
    const x = drag.x;
    drag = null;
    onchange?.(words[index].id, words[index + 1].id, x);
  }

  function cancel() {
    drag = null;
  }

  /** One screen pixel as a fraction of the image width, at the current zoom. */
  function pixelStep(): number {
    const [a] = api.fromElement({ x: 0, y: 0 });
    const [b] = api.fromElement({ x: 1, y: 0 });
    return Math.abs(b - a) || 0.001;
  }

  function key(event: KeyboardEvent, index: number) {
    let delta = 0;
    if (event.key === 'ArrowLeft') delta = -1;
    else if (event.key === 'ArrowRight') delta = 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const step = (event.shiftKey ? 10 : 1) * pixelStep();
    const x = clampAt(index, boundaries[index] + delta * step);
    onchange?.(words[index].id, words[index + 1].id, x);
  }
</script>

<div class="dividers">
  {#each placed as p (words[p.index].id)}
    <div
      class="divider"
      class:dragging={drag?.index === p.index}
      style:left="{p.left}px"
      style:top="{p.top}px"
      style:height="{p.height}px"
      role="slider"
      aria-label="{label} {p.index + 1}"
      aria-valuenow={Math.round(p.value * 1000) / 1000}
      aria-valuemin={0}
      aria-valuemax={1}
      tabindex="0"
      onpointerdown={(e) => start(e, p.index)}
      onpointermove={(e) => move(e, p.index)}
      onpointerup={(e) => end(e, p.index)}
      onpointercancel={cancel}
      onkeydown={(e) => key(e, p.index)}
    ></div>
  {/each}
</div>

<style>
  .dividers {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .divider {
    position: absolute;
    width: 11px;
    margin-left: -5px;
    pointer-events: auto;
    cursor: col-resize;
    touch-action: none;
  }

  .divider::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 5px;
    width: 1px;
    background: var(--color-accent, #2563eb);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
  }

  .divider:hover::before,
  .divider.dragging::before,
  .divider:focus-visible::before {
    left: 4px;
    width: 3px;
  }

  .divider:focus-visible {
    outline: none;
  }

  .divider:focus-visible::before {
    box-shadow: 0 0 0 2px var(--color-surface, #ffffff);
  }
</style>
