# The example archive

`iliad/` is a complete archive in the Varians Data Format, version 2: the opening of Iliad 1 in three transcribed witnesses and one known from a reported reading, an edition with its apparatus, a conjecture adopted and one not, a note citing the literature, a zone on a page with a small image, an alignment constraint, sites looked at and classed, review positions, a named and a published moment, and a collaborator.

It is the conformance target for other implementations: every JSON file in it is valid against its schema, every TEI file against varians.rng, and Varians reads it back. It is written by `pnpm --filter @varians/web cli write-example` from the application's sample, so its ids and times change each time it is written. The words, readings and image are examples, not a verified text.
