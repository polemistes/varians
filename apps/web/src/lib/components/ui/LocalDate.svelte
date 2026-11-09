<script lang="ts">
  import { formatLocal, isoDate, toDate, type DateFormat } from '$lib/dates';

  interface Props {
    date: string | Date;
    format?: DateFormat;
    class?: string;
  }

  let { date, format = 'date', class: className }: Props = $props();

  const value = $derived(toDate(date));
  /** Filled in the browser after mount, so that the server markup matches. */
  let local = $state<string | null>(null);

  $effect(() => {
    local = formatLocal(value, format, navigator.language);
  });
</script>

<time datetime={value.toISOString()} class={className}>{local ?? isoDate(value)}</time>
