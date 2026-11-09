# A Varians archive

This directory is the archive of one work, written by Varians: the work, its witnesses, transcriptions and editions, with their full history, as open files. It is a git repository of its own: every commit is a named moment, a publication or a nightly state.

The files follow the **Varians Data Format, version 2**, specified at <https://varians.eu/formats/2/> (every installation of Varians serves the same documents at `/formats/2/`). `formatVersion` in `work.json` says which version an archive follows.

```
work.json, persons.json, segments.tsv     the work, the persons named, its segments
conjectures.json, reported-readings.json  conjectures and reported readings
bibliography.json, citations.json         what the records cite
witnesses/<witness>/                      witness.json, pages.json, images/, transcriptions/<name>/
editions/<edition>/                       edition.json, edition.tei.xml, edition.txt, alignment.json, history
LICENSE.md                                the licences of the files
schemas/                                  the JSON Schemas, for reference
```

Every JSON file names its schema in its first member, `$schema`. The `.txt` and `.md` files are for reading; the JSON files are complete, and the TEI files carry the text and apparatus for other tools.
