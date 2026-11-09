# Changes to the Varians Data Format

## Version 2 (2026)

The format becomes a specification ([specification.md](specification.md)) with JSON Schemas at stable addresses, a TEI customization (ODD and RelaxNG), an example archive, and a versioning policy. The differences from version 1:

**Breaking**

- Authorship points at persons, not accounts: `history.ndjson`, `moments.json`, notes, collaborators, site reviews, site kinds and review positions name `personId`; `userId` and `userName` are gone from them. The new `persons.json` lists every person the files refer to, with their ORCID where known.
- Every JSON file is an object whose first member is `$schema`, the `$id` of its schema. The files that were arrays become objects with a named list: `conjectures.json` (`conjectures`), `reported-readings.json` (`readings`), `bibliography.json` (`items`), `citations.json` (`citations`), `pages.json` (`pages`), `zones.json` (`zones`), `memory.json` (`entries`), `moments.json` (`moments`).
- Changesets name their parent (`parentId`) and, for a merge, what they bring in (`merged`); `version` is the installation's local order and may be null for a changeset kept but not applied.
- The free-text `licence` of transcriptions and editions becomes `rightsNote`; `licence` is now an SPDX identifier fixed at publication.
- Edition `adoptions` are objects `{ conjectureId, at }`, not bare ids.

**Added**

- `alignment.json` and `reviews.json` in edition directories, `reviews.json` in transcription directories where someone has a review position.
- Creation times on every record; the maintainers of works and witnesses with their dates; who set a site kind and when; moments with their basis.
- `identifiers` on works and witnesses (typed: CTS URN, Diktyon, Trismegistos, Wikidata, VIAF, URL).
- `urn` in `segments.tsv`, and the CTS URN of each segment on the edition TEI's `<ab>`.
- `head` on transcriptions and editions.
- Rights per image (`rights`, `attribution`, `source` in `pages.json`), image defaults on witnesses, and `LICENSE.md` at the archive's root; images whose rights do not allow copying are not copied.
- `licence` in `work.json` for the records without one of their own.
- In TEI: `<listPrefixDef>` resolving `tok:`, `seg:`, `wit:`, `conj:` and `person:` to the installation's `/id/` addresses; every edition word as `<w>` with `corresp` or `source`; `<availability><licence>`; `<respStmt>` with ORCID.
- Packages: BagIt with RO-Crate 1.2 metadata.

## Version 1 (October 2026)

The first archive layout, described in the README of each archive.
