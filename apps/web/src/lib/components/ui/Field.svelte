<script lang="ts">
  import type { Snippet } from 'svelte';

  /** What the field hands its control: spread it onto Input, Select or Textarea. */
  export interface FieldControl {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: 'true';
  }

  interface Props {
    label: string;
    hint?: string;
    /** The first message is shown; validation returns lists. */
    error?: string | string[] | null;
    required?: boolean;
    /** The control's id; generated when omitted. */
    id?: string;
    class?: string;
    children: Snippet<[FieldControl]>;
  }

  const generated = $props.id();
  let { label, hint, error, required = false, id = `field-${generated}`, class: className, children }: Props = $props();

  const message = $derived(Array.isArray(error) ? error[0] : error || undefined);
  const hintId = $derived(`${id}-hint`);
  const errorId = $derived(`${id}-error`);
  const describedBy = $derived(
    [hint ? hintId : null, message ? errorId : null].filter(Boolean).join(' ') || undefined,
  );
  const control = $derived<FieldControl>({
    id,
    'aria-describedby': describedBy,
    'aria-invalid': message ? 'true' : undefined,
  });
</script>

<div class={['flex flex-col gap-1.5 font-sans', className]}>
  <label for={id} class="text-sm font-medium text-ink">
    {label}{#if required}<span class="text-ink-muted" aria-hidden="true"> *</span>{/if}
  </label>
  {@render children(control)}
  {#if hint}<p id={hintId} class="text-xs text-ink-soft">{hint}</p>{/if}
  {#if message}<p id={errorId} class="text-xs text-danger" role="alert">{message}</p>{/if}
</div>
