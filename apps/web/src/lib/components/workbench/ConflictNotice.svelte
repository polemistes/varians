<script lang="ts">
  /** After a conflict (PLAN 7.3): the other editor's text stands, and what of ours was set aside is named. */
  import type { Op } from '@varians/core';
  import { Button, Notice } from '$lib/components/ui';
  import { describeSetAside } from '$lib/workbench/view';
  import { workbench as t } from '$lib/strings/workbench';

  interface Props {
    ops: Op[];
    ondismiss: () => void;
  }

  let { ops, ondismiss }: Props = $props();

  const aside = $derived(describeSetAside(ops));
</script>

<div class="border-b border-line bg-page px-4 py-2">
  <Notice kind="warning" title={t.conflict.title}>
    <p>{t.conflict.body(ops.length)}</p>
    <ul class="mt-1 list-disc pl-5">
      {#if aside.words.length}<li class="font-serif">{t.conflict.words(aside.words.slice(0, 20).join(', '))}</li>{/if}
      {#if aside.removed}<li>{t.conflict.removed(aside.removed)}</li>{/if}
      {#if aside.other}<li>{t.conflict.other(aside.other)}</li>{/if}
    </ul>
    <Button size="sm" variant="ghost" class="mt-2" onclick={ondismiss}>{t.conflict.dismiss}</Button>
  </Notice>
</div>
