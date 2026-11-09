<script lang="ts">
  /**
   * The divider between two panes. Drag it with the mouse or a finger, or
   * focus it and use the arrow keys (with Shift for larger steps, Home and End
   * for the limits); a double click or Enter puts the default back. It sizes
   * the pane on one side of it, given as a PaneSize; the pane's size is also
   * kept within the container, so that the other pane never disappears.
   */
  import type { PaneSize } from '$lib/layout/pane-size.svelte';

  interface Props {
    pane: PaneSize;
    /** 'x': a vertical bar between panes side by side; 'y': a horizontal bar between panes one above the other. */
    axis: 'x' | 'y';
    /** Which side of the bar the sized pane is on: before it (left, above) or after it (right, below). */
    side: 'before' | 'after';
    /** The element both panes fill: the pane may take at most `share` of it. */
    container: HTMLElement | null;
    share?: number;
    label: string;
    class?: string;
  }

  let { pane, axis, side, container, share = 0.75, label, class: className }: Props = $props();

  let dragging = $state(false);

  /** The largest size the container allows now. */
  function limit(): number {
    if (!container) return pane.max;
    const rect = container.getBoundingClientRect();
    return Math.min(pane.max, (axis === 'x' ? rect.width : rect.height) * share);
  }

  function setSize(size: number) {
    pane.set(Math.min(size, limit()));
  }

  function sizeAt(event: PointerEvent): number {
    const rect = container!.getBoundingClientRect();
    if (axis === 'x') return side === 'after' ? rect.right - event.clientX : event.clientX - rect.left;
    return side === 'after' ? rect.bottom - event.clientY : event.clientY - rect.top;
  }

  function pointerdown(event: PointerEvent) {
    if (!container || event.button !== 0) return;
    event.preventDefault();
    const bar = event.currentTarget as HTMLElement;
    bar.setPointerCapture(event.pointerId);
    dragging = true;
    // Nothing gets selected and the cursor stays the same while dragging over the panes.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
  }

  function pointermove(event: PointerEvent) {
    if (!dragging || !container) return;
    setSize(sizeAt(event));
  }

  function pointerup(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }

  function keydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    // Arrows move the bar; the pane grows when the bar moves away from it.
    const grow = side === 'after' ? -1 : 1;
    let next: number | null = null;
    if (axis === 'x' && event.key === 'ArrowLeft') next = pane.value - step * grow;
    else if (axis === 'x' && event.key === 'ArrowRight') next = pane.value + step * grow;
    else if (axis === 'y' && event.key === 'ArrowUp') next = pane.value - step * grow;
    else if (axis === 'y' && event.key === 'ArrowDown') next = pane.value + step * grow;
    else if (event.key === 'Home') next = pane.min;
    else if (event.key === 'End') next = limit();
    else if (event.key === 'Enter') {
      event.preventDefault();
      pane.reset();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setSize(next);
  }
</script>

<!-- A focusable separator is interactive by ARIA: it takes the arrow keys. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
  aria-label={label}
  aria-valuenow={pane.value}
  aria-valuemin={pane.min}
  aria-valuemax={pane.max}
  tabindex="0"
  title={label}
  class={['splitter', axis === 'x' ? 'splitter-x' : 'splitter-y', dragging && 'dragging', className]}
  onpointerdown={pointerdown}
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={pointerup}
  ondblclick={() => pane.reset()}
  onkeydown={keydown}
></div>

<style>
  /* A hairline to look at, a wider strip to take hold of. */
  .splitter {
    position: relative;
    z-index: 5;
    flex-shrink: 0;
    background: var(--color-line);
    touch-action: none;
    outline: none;
    transition: background-color 120ms;
  }

  .splitter::before {
    position: absolute;
    content: '';
  }

  .splitter-x {
    width: 1px;
    cursor: col-resize;
  }

  .splitter-x::before {
    inset: 0 -4px;
  }

  .splitter-y {
    height: 1px;
    cursor: row-resize;
  }

  .splitter-y::before {
    inset: -4px 0;
  }

  .splitter:hover,
  .splitter:focus-visible,
  .splitter.dragging {
    background: var(--color-accent);
  }

  .splitter-x:hover,
  .splitter-x:focus-visible,
  .splitter-x.dragging {
    box-shadow: 0 0 0 1px var(--color-accent);
  }

  .splitter-y:hover,
  .splitter-y:focus-visible,
  .splitter-y.dragging {
    box-shadow: 0 0 0 1px var(--color-accent);
  }
</style>
