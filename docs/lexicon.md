# The Greek forms and dictionaries

The reader's dictionary, the workbench's tools for normalizing diacritics, and the relations the apparatus draws between readings use a lexicon of Greek word forms and two dictionaries, kept in the database. It is not part of Varians: its sources are some 370 MB, and built it is 29 MB. Like Anagnosis, which builds the same lexicon for its reader, Varians builds it once, from the sources, and ships the result as one file that every installation imports.

    varians lexicon                                   import the lexicon published for this Varians
    varians lexicon import FILE|URL [--sha256 HEX]    import a lexicon exported elsewhere
    varians lexicon export FILE                       write the lexicon in the database to a file
    varians lexicon build [options]                   build it from its sources

In a checkout the same commands are `pnpm --filter @varians/web lexicon …`. Each replaces what was loaded before, in one transaction, and nothing is written until everything has been read, so a file or a source that fails leaves the dictionaries as they were. Without a lexicon Varians works as before: the dictionary finds nothing and the tools propose nothing.

## Importing

`varians lexicon` imports the published lexicon: a file made by `export`, put up as a release asset of the repository, and named with its SHA-256 in `apps/web/scripts/lexicon/sources.ts` (`PUBLISHED_LEXICON`). Until one is published, the command says so. `import` takes any such file or https address and checks it against `--sha256` when given. The import takes about a quarter of a minute.

The file is gzip-compressed JSON lines: a header naming the format, the dictionaries with their sources and licences, when it was made and the counts; then one line per entry and per word key. The import refuses a file whose counts do not match its header, so a truncated download changes nothing.

## Building

`build` reads the sources from a directory: in a checkout `apps/web/lexicon-sources/` (not in git), otherwise a temporary one, or the `--sources DIR` given. What is not there is downloaded, from commits pinned in sources.ts so that a build from downloads is the same everywhere; a file already there is used as it is. The layout:

- `lsj/grc.lsj.perseus-eng1.xml` … `eng27.xml`: Liddell, Scott, Jones, *A Greek-English Lexicon* (1940), the TEI of the Perseus Digital Library, [PerseusDL/lexica](https://github.com/PerseusDL/lexica). CC BY-SA 4.0.
- `middle-liddell.xml`: Liddell and Scott, *An Intermediate Greek-English Lexicon* (1889), the TEI P4 of the Perseus Digital Library (`ml.xml` of its hopper-texts tarball). The tarball is no longer served, so a download takes the mirror [blinskey/middle-liddell](https://github.com/blinskey/middle-liddell), the hopper's export of the same XML with a few typographical corrections, checked against its SHA-256. CC BY-SA 3.0 US.
- `treebanks/<text>.tb.xml`: the Ancient Greek Dependency Treebank, version 2.1, [PerseusDL/treebank_data](https://github.com/PerseusDL/treebank_data): the lemma and tag of every word of its texts, given by hand. CC BY-SA 3.0 US.
- `morpheus-analyses.tsv.gz`: the analyses Morpheus gives every distinct word form of the open Perseus corpus (PerseusDL/canonical-greekLit) and of the treebank, made by the Anagnosis pipeline (`build-morpheus-forms`): Morpheus ([perseids-tools/morpheus](https://github.com/perseids-tools/morpheus), MPL 2.0) compiled and run over the corpus, its analyses converted to the treebank's tags. One analysis a line: form, lemma, tag, the dialects it holds in, and the form with its vowel length. It is not downloadable, and Varians does not make it, since that needs Morpheus compiled and the 77 MB corpus; `--without-morpheus` builds from the treebank's analyses alone, `--morpheus FILE` takes it from elsewhere. CC BY-SA 4.0, derived from the corpus.

The owner's checkout holds a copy of the Anagnosis pipeline's cache of all four (its `pipeline/sources/` and `pipeline/build/`), so a build there downloads nothing and takes under a minute: 116,497 LSJ and 36,490 Middle Liddell entries, and 406,100 word keys with 476,012 treebank and 1,059,068 Morpheus analyses.

The entries are rendered, and the forms packed, as the Anagnosis pipeline does it (`lexicon.py`, `forms.py`), from which the code is ported (`apps/web/scripts/lexicon/`): the two read alike, and the pipeline's rendering is the test fixture (`fixtures/`). The Greek of the lexica is Beta Code, converted with the table of beta-code-json.

## Publishing a lexicon

For the maintainer of Varians. After a build, export it and put the file up as an asset of a release of the repository made for it, named by the month:

    pnpm --filter @varians/web lexicon export lexicon.jsonl.gz
    sha256sum lexicon.jsonl.gz
    gh release create lexicon-2026-11 lexicon.jsonl.gz --title "The lexicon, November 2026" --notes "..."

Then set `PUBLISHED_LEXICON` in sources.ts to the asset's address (`https://github.com/polemistes/varians/releases/download/lexicon-2026-11/lexicon.jsonl.gz`) and its SHA-256, and release Varians: from then on `varians lexicon` imports it. The release notes of the asset should name the sources and their licences as this page does; the file's header does so too, and the page Sources and licences of every installation lists them.

## In the database

The tables are `greek_forms` (a word's letters alone, as the key, with its analyses packed one a line: form, lemma, tag, source), `lexicons` and `lexicon_entries` (packages/db/src/schema.ts). The server reads them in `apps/web/src/lib/server/lexicon.ts`; `/api/greek/words` gives the analyses of words and `/api/greek/entries` the entries of a lemma. All of the data is under Creative Commons Attribution-ShareAlike licences, so what is made from it must say so and be shared alike.
