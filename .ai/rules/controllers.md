---
paths:
  - app/Http/Controllers/EditionController.php
---

# Controllers

## needs_review requires an actual witness reading to reconcile against
`annotatePassageStatus()`'s `needs_review` check (`$total > 0 && ! $anchored->contains($base->transcription_id)`) must also require `$anchored->isNotEmpty()`. Without that guard, a whole-line lacuna at an ordinary canonical number that no witness ever attests (see the `new_passage` placement rule above) has zero transcription-sourced readings, so it's *never* anchored to any base and gets permanently stuck at `needs_review` — even though there's nothing to reconcile, since it was never aligned against a base transcription in the first place. `needs_review` only makes sense for a passage that actually has some witness reading to check the current base against.
