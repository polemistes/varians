---
paths:
  - routes/web.php
---

# Routes

## Register literal-segment routes before wildcard routes at the same path depth
Laravel matches routes in registration order. `GET /works/create` must be registered before `GET /works/{work:slug}` (same for `/witnesses/create` vs `/witnesses/{witness}`) — otherwise "create" gets swallowed by the wildcard, tried as a slug/id, and 404s via ModelNotFoundException. This bit us when grouping routes by required role (auth/editor/admin) reordered them by group instead of by path. Fix: keep same-depth literal-vs-wildcard GET route pairs adjacent and correctly ordered in the file regardless of which middleware group they logically belong to; apply `->middleware('role:editor')` inline to the individual route if needed rather than moving it into a separate group block.
