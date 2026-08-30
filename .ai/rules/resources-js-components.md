---
paths:
  - resources/js/components/AlignableText.vue
---

# Resources Js Components

## Selection listener must be document-scoped, not bound to the inline text span
`AlignableText.vue`'s `mouseup` handler is registered on `document` (via `onMounted`/`onUnmounted`), not via `@mouseup` on the inline `<span ref="containerEl">` itself. This was a real bug, not a style choice: a drag-select that ends in the thin sliver of space just past the last character of a line can release the pointer over the *parent* block (`elementFromPoint` confirmed this — the point lands on the wrapping `<div class="font-serif...">`, not on any element inside `containerEl`). Since that parent is not a descendant of `containerEl`, a listener scoped to the span never sees the event, and the selection is silently dropped — the "assign citation / align to image" popover just never appears, with no error.

The existing `containerEl.value.contains(anchorNode/focusNode)` guard already scopes a document-level listener correctly, so there's no precision lost by listening globally — only the previously-missing coverage restored. If this handler is ever refactored, keep it document-scoped; re-binding it to the local element will reintroduce the bug (reproduce by dragging to end a selection ~2px past a line's last character and checking whether the popover appears).
