# The Greek forms and dictionaries

The reader's dictionary, and the workbench's tools for normalizing diacritics, use a lexicon of Greek
word forms and two dictionaries. They are not part of the repository (some 126 MB); they are loaded
into the database once:

    pnpm --filter @varians/web lexicon:import /path/to/lexicon.sqlite

The file is the lexicon the Anagnosis pipeline builds (`data/lexicon.sqlite`, see the Anagnosis
repository). The import replaces whatever was loaded before, in one transaction, and takes a few
seconds. Without it Varians works as before: the dictionary finds nothing and the tools propose nothing.

What the lexicon holds, and under which licences, is listed on the page Sources and licences
(`/sources`, from `apps/web/src/lib/sources.ts`): the morphological analyses of the open Perseus
corpus made with Morpheus, the analyses of the Ancient Greek Dependency Treebank, and the
dictionaries of Liddell, Scott and Jones (1940) and Liddell and Scott (1889). All of it is under
Creative Commons Attribution-ShareAlike licences: what is made from it must say so and be shared
alike.

The tables are `greek_forms` (a word's letters alone, as the key, with its analyses), `lexicons` and
`lexicon_entries` (packages/db/src/schema.ts).
