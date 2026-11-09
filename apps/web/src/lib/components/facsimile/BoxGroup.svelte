<script lang="ts">
  /**
   * Word boxes edited together (PLAN 5.6), drawn over the facsimile while
   * two or more are selected. Each handle has its own look and one meaning:
   *
   * - a box: dragging it moves all the boxes; a click picks that box alone;
   * - the bar at the end of a box: resizes it, and the boxes after it on its
   *   line move along without changing size;
   * - the round knob under the gap between two words: moves the boundary
   *   between them, so one ends where the other begins; nothing else moves;
   * - the square handles on the frame: stretch or squeeze all the boxes;
   * - the round handle beyond the end of the frame: turns all the boxes
   *   about the middle of the group, for lines that slope; it stands far
   *   out so the turn is fine, and with Shift it is finer still.
   *
   * Everything is drawn and edited in the group's frame, which slopes with
   * its lines (see $lib/facsimile/group), so a box's end, a boundary or a
   * stretch runs along the line, not across the page. The boxes of one line
   * at a time (the line last pointed at) carry their words as labels, and
   * their knobs; pointing at a handle lights the boxes it changes. The arrow
   * keys move the group while its frame has the focus, and a knob while it
   * has. Rendered in FacsimileViewer's children snippet.
   */
  import type { Point, Rect, ZoneGeometry } from '@varians/core';
  import { boundaryBetween } from '$lib/facsimile/dividers';
  import type { FacsimileApi } from '$lib/facsimile/types';
  import {
    boundaryPairs,
    boundsOf,
    boxesInFrame,
    frameLimits,
    frameOf,
    geometriesFromFrame,
    moveBoundary,
    moveBoxes,
    pointFromFrame,
    pointToFrame,
    rippleResize,
    scaleBoxes,
    turnBoxes,
    type Frame,
    type GroupBox,
    type Side,
  } from '$lib/facsimile/group';

  interface Labels {
    group: string;
    /** What the keys do while the frame has the focus. */
    keys: string;
    resize: (word: string) => string;
    boundary: (first: string, second: string) => string;
    side: Record<Side, string>;
    turn: string;
  }

  interface Props {
    api: FacsimileApi;
    boxes: GroupBox[];
    labels: Labels;
    /** While dragging: the boxes as they would be; null when the drag ends or is given up. */
    onpreview?: (shapes: Map<string, ZoneGeometry> | null) => void;
    /** The new shapes of the boxes that changed, once a drag or a key press is done, and what was done. */
    onchange: (shapes: Map<string, ZoneGeometry>, done: 'move' | 'resize' | 'turn') => void;
    /** A box clicked without dragging; `extend` when Shift was held. */
    onpick?: (id: string, extend: boolean) => void;
  }

  let { api, boxes, labels, onpreview, onchange, onpick }: Props = $props();

  /** Pointer travel, in screen pixels, before a press counts as a drag. */
  const SLOP = 3;
  /** Room between the boxes and the frame, in screen pixels: the labels stand above, the knobs below. */
  const PAD = { side: 8, top: 22, bottom: 26 };
  /** How far below its line a knob stands, in screen pixels. */
  const KNOB_DROP = 13;
  /** How far beyond the end of the frame the turn handle stands, in screen pixels. */
  const TURN_OUT = 30;
  /** With Shift held, a turn goes this many times slower. */
  const FINE = 4;

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

  type Gesture =
    | { kind: 'move'; id: string }
    | { kind: 'ripple'; id: string }
    | { kind: 'boundary'; first: string; second: string }
    | { kind: 'side'; side: Side }
    | { kind: 'turn' };

  interface Drag {
    gesture: Gesture;
    start: { x: number; y: number };
    moved: boolean;
    fine: boolean;
  }

  let drag: Drag | null = null;
  let frameElement = $state<HTMLElement>();
  /** The boxes as the drag has them; null when nothing is being dragged. */
  let draft = $state.raw<Map<string, ZoneGeometry> | null>(null);
  /** The line whose words and knobs are shown. */
  let chosenLine = $state<number | null>(null);
  /** The boxes the handle under the pointer would change. */
  let affected = $state.raw<Set<string>>(new Set());

  const aspect = $derived(api.imageSize.width > 0 ? api.imageSize.height / api.imageSize.width : 1);
  const activeLine = $derived(chosenLine !== null && boxes.some((b) => b.line === chosenLine) ? chosenLine : (boxes[0]?.line ?? 0));
  const word = (box: GroupBox) => box.text ?? '';

  /** The boxes as drawn: as the drag has them, else as they are. */
  const shown = $derived(
    boxes.map((b): GroupBox => {
      const g = draft?.get(b.id);
      return g?.rect ? { ...b, rect: g.rect, rotate: g.rotate } : b;
    }),
  );
  /** The frame the boxes are edited in: from the boxes as they are. */
  const base = $derived(frameOf(boxes, aspect));
  /** The frame as drawn, turning with a turn being dragged. */
  const drawn = $derived(frameOf(shown, aspect));

  /** Screen pixels to one width of the image. */
  function scale(): number {
    void tick;
    return Math.abs(api.toElement([1, 0]).x - api.toElement([0, 0]).x) || 1;
  }

  /** A point of a frame on the screen. */
  function screenOf(point: Point, frame: Frame): { x: number; y: number } {
    void tick;
    return api.toElement(pointFromFrame(point, frame));
  }

  /** A point of the screen in a frame. */
  function frameOfPoint(at: { x: number; y: number }, frame: Frame): Point {
    return pointToFrame(api.fromElement(at), frame);
  }

  function turnOf(point: Point, degrees: number): Point {
    const a = (degrees * Math.PI) / 180;
    return [point[0] * Math.cos(a) - point[1] * Math.sin(a), point[0] * Math.sin(a) + point[1] * Math.cos(a)];
  }

  interface Placed {
    box: GroupBox;
    /** The box: its centre on the screen, its size in pixels, its turn. */
    cx: number;
    cy: number;
    w: number;
    h: number;
    rotate: number;
    /** The middle of its end, and the corner its label stands at. */
    end: { x: number; y: number };
    corner: { x: number; y: number };
  }

  const placed = $derived.by((): Placed[] => {
    const s = scale();
    return shown.map((box) => {
      const r = box.rect;
      const rotate = box.rotate ?? 0;
      const centre: Point = [r.x + r.w / 2, (r.y + r.h / 2) * aspect];
      const at = (offset: Point) => {
        const [dx, dy] = turnOf(offset, rotate);
        void tick;
        return api.toElement([centre[0] + dx, (centre[1] + dy) / aspect]);
      };
      const c = at([0, 0]);
      const half = (r.w / 2) * (box.direction === 'ltr' ? 1 : -1);
      return {
        box,
        cx: c.x,
        cy: c.y,
        w: r.w * s,
        h: r.h * aspect * s,
        rotate,
        end: at([half, 0]),
        corner: at([-r.w / 2, (-r.h * aspect) / 2]),
      };
    });
  });

  /** The rectangle around the boxes in the drawn frame, with the room for labels and knobs. */
  const outline = $derived.by(() => {
    const s = scale();
    const local = boxesInFrame(shown, drawn).map((b) => b.rect);
    const b = boundsOf(local);
    const padded: Rect = {
      x: b.x - PAD.side / s,
      y: b.y - PAD.top / s,
      w: b.w + (2 * PAD.side) / s,
      h: b.h + (PAD.top + PAD.bottom) / s,
    };
    const centre = screenOf([padded.x + padded.w / 2, padded.y + padded.h / 2], drawn);
    const mid = (side: Side): Point =>
      side === 'left'
        ? [padded.x, padded.y + padded.h / 2]
        : side === 'right'
          ? [padded.x + padded.w, padded.y + padded.h / 2]
          : side === 'top'
            ? [padded.x + padded.w / 2, padded.y]
            : [padded.x + padded.w / 2, padded.y + padded.h];
    const sides = (['left', 'right', 'top', 'bottom'] as Side[]).map((side) => ({ side, at: screenOf(mid(side), drawn) }));
    const end = screenOf(mid('right'), drawn);
    const turn = screenOf([padded.x + padded.w + TURN_OUT / s, padded.y + padded.h / 2], drawn);
    return { centre, width: padded.w * s, height: padded.h * s, sides, end, turn };
  });

  const knobs = $derived.by(() => {
    const s = scale();
    const local = new Map(boxesInFrame(shown, drawn).map((b) => [b.id, b] as const));
    return boundaryPairs(boxes)
      .filter(([a]) => a.line === activeLine)
      .map(([a, b]) => {
        const la = local.get(a.id)!.rect;
        const lb = local.get(b.id)!.rect;
        const x = boundaryBetween(la, lb, a.direction);
        const bottom = Math.max(la.y + la.h, lb.y + lb.h);
        const at = screenOf([x, bottom + KNOB_DROP / s], drawn);
        return { first: a, second: b, left: at.x, top: at.y, value: x };
      });
  });

  /** The boxes after `box` on its line, and itself: what its end bar changes. */
  function following(box: GroupBox): Set<string> {
    return new Set(boxes.filter((b) => b.line === box.line && b.at >= box.at).map((b) => b.id));
  }

  function point(to: Set<string>, line?: number) {
    if (drag) return;
    affected = to;
    if (line !== undefined) chosenLine = line;
  }

  function leave() {
    if (!drag) affected = new Set();
  }

  function elementPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = api.viewer.element.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function begin(event: PointerEvent, gesture: Gesture) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    // The keys follow the hand: Delete, the arrows and Ctrl+Z act on these boxes now.
    if (gesture.kind !== 'boundary') frameElement?.focus({ preventScroll: true });
    else (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    drag = { gesture, start: elementPoint(event), moved: gesture.kind !== 'move', fine: false };
  }

  function byId(id: string): GroupBox | undefined {
    return boxes.find((b) => b.id === id);
  }

  /** What the gesture makes of the boxes with the pointer gone from `start` to `to` (screen pixels). */
  function result(gesture: Gesture, start: { x: number; y: number }, to: { x: number; y: number }, fine = false): Map<string, ZoneGeometry> {
    const frame = base;
    if (gesture.kind === 'turn') {
      const pivot = screenOf(frame.pivot, frame);
      const from = Math.atan2(start.y - pivot.y, start.x - pivot.x);
      const now = Math.atan2(to.y - pivot.y, to.x - pivot.x);
      let degrees = ((now - from) * 180) / Math.PI;
      if (degrees > 180) degrees -= 360;
      if (degrees < -180) degrees += 360;
      return turnBoxes(boxes, frame, fine ? degrees / FINE : degrees);
    }
    const local = boxesInFrame(boxes, frame);
    const limits = frameLimits(frame);
    const [x0, y0] = frameOfPoint(start, frame);
    const [x, y] = frameOfPoint(to, frame);
    let rects: Map<string, Rect>;
    if (gesture.kind === 'move') {
      const moved = moveBoxes(local.map((b) => b.rect), x - x0, y - y0, limits);
      rects = new Map(local.map((b, i) => [b.id, moved[i]!] as const));
    } else if (gesture.kind === 'ripple') {
      rects = rippleResize(local, gesture.id, x, undefined, limits);
    } else if (gesture.kind === 'boundary') {
      const first = local.find((b) => b.id === gesture.first);
      const second = local.find((b) => b.id === gesture.second);
      rects = first && second ? moveBoundary(first, second, x) : new Map();
    } else {
      const scaled = scaleBoxes(local.map((b) => b.rect), gesture.side, gesture.side === 'left' || gesture.side === 'right' ? x : y, limits);
      rects = new Map(local.map((b, i) => [b.id, scaled[i]!] as const));
    }
    return geometriesFromFrame(boxes, rects, frame);
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const at = elementPoint(event);
    if (!drag.moved && Math.hypot(at.x - drag.start.x, at.y - drag.start.y) < SLOP) return;
    drag.moved = true;
    draft = result(drag.gesture, drag.start, at, event.shiftKey);
    onpreview?.(draft);
  }

  function end(event: PointerEvent) {
    if (!drag) return;
    event.stopPropagation();
    const { gesture, moved } = drag;
    const changed = draft;
    drag = null;
    draft = null;
    affected = new Set();
    if (!moved) {
      if (gesture.kind === 'move') onpick?.(gesture.id, event.shiftKey);
      onpreview?.(null);
      return;
    }
    if (changed && changed.size) onchange(changed, gesture.kind === 'move' ? 'move' : gesture.kind === 'turn' ? 'turn' : 'resize');
    onpreview?.(null);
  }

  function cancel() {
    drag = null;
    draft = null;
    affected = new Set();
    onpreview?.(null);
  }

  /** The wheel zooms the image, as it does outside the boxes. */
  function wheel(event: WheelEvent) {
    event.preventDefault();
    api.viewer.canvas.dispatchEvent(new WheelEvent('wheel', event));
  }

  const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  function frameKey(event: KeyboardEvent) {
    const step = ARROWS[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const n = event.shiftKey ? 10 : 1;
    const origin = outline.centre;
    onchange(result({ kind: 'move', id: '' }, origin, { x: origin.x + step[0] * n, y: origin.y + step[1] * n }), 'move');
  }

  /** The arrows move a boundary along its line. */
  function knobKey(event: KeyboardEvent, first: string, second: string, left: number, top: number) {
    const step = ARROWS[event.key];
    if (!step || step[0] === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const n = (event.shiftKey ? 10 : 1) * step[0];
    const a = (base.angle * Math.PI) / 180;
    onchange(result({ kind: 'boundary', first, second }, { x: left, y: top }, { x: left + n * Math.cos(a), y: top + n * Math.sin(a) }), 'resize');
  }

  const all = $derived(new Set(boxes.map((b) => b.id)));
  const angleShown = $derived(Math.round(drawn.angle * 10) / 10);
</script>

<div class="group-layer" style:--_turn="{drawn.angle}deg">
  <svg class="stem" aria-hidden="true">
    <line x1={outline.end.x} y1={outline.end.y} x2={outline.turn.x} y2={outline.turn.y} />
  </svg>
  <!-- The frame takes the arrow keys, as the splitter does. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={frameElement}
    class="frame"
    style:left="{outline.centre.x}px"
    style:top="{outline.centre.y}px"
    style:width="{outline.width}px"
    style:height="{outline.height}px"
    role="application"
    aria-roledescription={labels.group}
    aria-label={labels.keys}
    tabindex="0"
    onkeydown={frameKey}
  ></div>
  {#each placed as p (p.box.id)}
    <div
      class="box"
      class:affected={affected.has(p.box.id)}
      data-zone={p.box.id}
      style:left="{p.cx}px"
      style:top="{p.cy}px"
      style:width="{p.w}px"
      style:height="{p.h}px"
      style:--_rotate="{p.rotate}deg"
      role="presentation"
      onpointerenter={() => point(all, p.box.line)}
      onpointerleave={leave}
      onpointerdown={(e) => begin(e, { kind: 'move', id: p.box.id })}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={cancel}
      onwheel={wheel}
    ></div>
    {#if p.box.line === activeLine && word(p.box)}
      <span class="word" style:left="{p.corner.x}px" style:top="{p.corner.y}px" style:--_rotate="{p.rotate}deg" aria-hidden="true">{word(p.box)}</span>
    {/if}
    <div
      class="end"
      style:left="{p.end.x}px"
      style:top="{p.end.y}px"
      style:height="{p.h}px"
      style:--_rotate="{p.rotate}deg"
      role="presentation"
      title={labels.resize(word(p.box))}
      onpointerenter={() => point(following(p.box), p.box.line)}
      onpointerleave={leave}
      onpointerdown={(e) => begin(e, { kind: 'ripple', id: p.box.id })}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={cancel}
      onwheel={wheel}
    ></div>
  {/each}
  {#each knobs as k (k.first.id)}
    <div
      class="knob"
      style:left="{k.left}px"
      style:top="{k.top}px"
      role="slider"
      tabindex="0"
      aria-label={labels.boundary(word(k.first), word(k.second))}
      aria-valuenow={Math.round(k.value * 1000) / 1000}
      aria-valuemin={0}
      aria-valuemax={1}
      title={labels.boundary(word(k.first), word(k.second))}
      onpointerenter={() => point(new Set([k.first.id, k.second.id]))}
      onpointerleave={leave}
      onfocus={() => point(new Set([k.first.id, k.second.id]))}
      onblur={leave}
      onpointerdown={(e) => begin(e, { kind: 'boundary', first: k.first.id, second: k.second.id })}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={cancel}
      onkeydown={(e) => knobKey(e, k.first.id, k.second.id, k.left, k.top)}
      onwheel={wheel}
    >
      <svg viewBox="0 0 16 8" aria-hidden="true"><path d="M1 4h14M1 4l3-3M1 4l3 3M15 4l-3-3M15 4l-3 3" /></svg>
    </div>
  {/each}
  {#each outline.sides as { side, at } (side)}
    <div
      class="side side-{side}"
      style:left="{at.x}px"
      style:top="{at.y}px"
      role="presentation"
      title={labels.side[side]}
      onpointerenter={() => point(all)}
      onpointerleave={leave}
      onpointerdown={(e) => begin(e, { kind: 'side', side })}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={cancel}
      onwheel={wheel}
    ></div>
  {/each}
  <div
    class="turn"
    style:left="{outline.turn.x}px"
    style:top="{outline.turn.y}px"
    role="presentation"
    title={labels.turn}
    onpointerenter={() => point(all)}
    onpointerleave={leave}
    onpointerdown={(e) => begin(e, { kind: 'turn' })}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={cancel}
    onwheel={wheel}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.8h-2.8" /></svg>
  </div>
  {#if angleShown !== 0}
    <span class="angle" style:left="{outline.turn.x}px" style:top="{outline.turn.y}px">{angleShown}°</span>
  {/if}
</div>

<style>
  .group-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    --_accent: var(--color-accent, #2d4b86);
    --_paper: var(--color-surface, #fff);
    font-family: var(--font-sans, system-ui, sans-serif);
  }

  .stem {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .stem line {
    stroke: var(--_accent);
    stroke-width: 1;
    stroke-dasharray: 3 2;
  }

  /* Every piece is placed by its centre (or its anchor) and turned with its box or the frame. */
  .frame {
    position: absolute;
    transform: translate(-50%, -50%) rotate(var(--_turn));
    border: 1px dashed var(--_accent);
    border-radius: 3px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
    outline: none;
  }

  .frame:focus-visible {
    border-style: solid;
    border-width: 2px;
  }

  .box {
    position: absolute;
    transform: translate(-50%, -50%) rotate(var(--_rotate));
    pointer-events: auto;
    cursor: move;
    touch-action: none;
    border: 2px solid var(--_accent);
    background: color-mix(in srgb, var(--_accent) 10%, transparent);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55);
  }

  /* The boxes the handle under the pointer changes. */
  .box.affected {
    background: color-mix(in srgb, var(--_accent) 28%, transparent);
  }

  /* The word a box stands for, just above its first corner. */
  .word {
    position: absolute;
    z-index: 1;
    transform-origin: 0 0;
    transform: rotate(var(--_rotate)) translateY(calc(-100% - 2px));
    padding: 0 0.25rem;
    border-radius: 0.2rem;
    background: color-mix(in srgb, var(--_paper) 88%, transparent);
    color: var(--_accent);
    font-family: var(--font-serif, serif);
    font-size: 0.75rem;
    line-height: 1.35;
    white-space: nowrap;
    pointer-events: none;
  }

  /* The end of a box: a bar on its edge, above the next box, which begins there. */
  .end {
    position: absolute;
    z-index: 2;
    width: 10px;
    transform: translate(-50%, -50%) rotate(var(--_rotate));
    pointer-events: auto;
    cursor: ew-resize;
    touch-action: none;
  }

  .end::before {
    content: '';
    position: absolute;
    left: 3px;
    top: 20%;
    bottom: 20%;
    width: 4px;
    border-radius: 2px;
    background: var(--_accent);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
  }

  /* The boundary between two words: a round knob under their gap. */
  .knob {
    position: absolute;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    transform: translate(-50%, -50%);
    border: 1.5px solid var(--_accent);
    border-radius: 50%;
    background: var(--_paper);
    color: var(--_accent);
    pointer-events: auto;
    cursor: ew-resize;
    touch-action: none;
    outline: none;
  }

  .knob:hover,
  .knob:focus-visible {
    background: var(--_accent);
    color: var(--_paper);
  }

  .knob svg {
    width: 11px;
    height: 6px;
    transform: rotate(var(--_turn));
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .side {
    position: absolute;
    z-index: 3;
    width: 10px;
    height: 10px;
    transform: translate(-50%, -50%) rotate(var(--_turn));
    pointer-events: auto;
    touch-action: none;
    border: 1.5px solid var(--_accent);
    border-radius: 2px;
    background: var(--_paper);
  }

  .side-left,
  .side-right {
    cursor: ew-resize;
    height: 18px;
  }

  .side-top,
  .side-bottom {
    cursor: ns-resize;
    width: 18px;
  }

  /* The turn: a round handle on a stem beyond the end of the frame. */
  .turn {
    position: absolute;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    transform: translate(-50%, -50%);
    border: 1.5px solid var(--_accent);
    border-radius: 50%;
    background: var(--_paper);
    color: var(--_accent);
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
  }

  .turn:hover {
    background: var(--_accent);
    color: var(--_paper);
  }

  .turn svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .angle {
    position: absolute;
    transform: translate(-50%, 14px);
    padding: 0 0.3rem;
    border-radius: 0.2rem;
    background: var(--_accent);
    color: var(--_paper);
    font-size: 0.68rem;
    line-height: 1.5;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
