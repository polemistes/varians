<?php

namespace App\Support\Bibliography;

/**
 * The biblatex vocabulary: every entry type and every data field the
 * standard defines, with the field's kind (how its value is written) and,
 * per type, the handful of fields an editor is shown by default. Anything
 * not here is refused at validation — the whole point of keeping the list
 * in biblatex's terms is that it exports to a .bib file nothing has to
 * translate.
 *
 * Kinds follow the biblatex manual's data types: a `name` list ("Last,
 * First and Last, First"), a literal `list` ("Oxford and New York"), a
 * `literal`, a `date` (ISO 8601-2: 1927, 1927-05, 1927/1930), a page
 * `range` ("45--47"), an `integer`, `verbatim` (doi, file), a `uri`, a
 * `key` (a fixed biblatex keyword such as `pubstate=inpress`) or a
 * `keylist`. The client mirrors nothing: the registry is shipped as a prop.
 *
 * @phpstan-type FieldSpec array{name: string, kind: string, group: string, label: string}
 */
class Biblatex
{
    /**
     * Entry types, biblatex 3 standard set (aliases such as `phdthesis`
     * map onto these on import).
     *
     * @var list<string>
     */
    private const TYPES = [
        'article', 'book', 'mvbook', 'inbook', 'bookinbook', 'suppbook', 'booklet',
        'collection', 'mvcollection', 'incollection', 'suppcollection', 'dataset',
        'manual', 'misc', 'online', 'patent', 'periodical', 'suppperiodical',
        'proceedings', 'mvproceedings', 'inproceedings', 'reference', 'mvreference',
        'inreference', 'report', 'set', 'software', 'thesis', 'unpublished',
    ];

    /**
     * The data fields, in the order a .bib entry lists them. `group` is the
     * heading the "Add field…" picker files a field under.
     *
     * @var array<string, array{0: string, 1: string, 2: string}> name => [kind, group, label]
     */
    private const FIELDS = [
        // Names
        'author' => ['name', 'names', 'Author'],
        'editor' => ['name', 'names', 'Editor'],
        'editora' => ['name', 'names', 'Editor (secondary)'],
        'editorb' => ['name', 'names', 'Editor (tertiary)'],
        'editorc' => ['name', 'names', 'Editor (further)'],
        'translator' => ['name', 'names', 'Translator'],
        'commentator' => ['name', 'names', 'Commentator'],
        'annotator' => ['name', 'names', 'Annotator'],
        'introduction' => ['name', 'names', 'Introduction by'],
        'foreword' => ['name', 'names', 'Foreword by'],
        'afterword' => ['name', 'names', 'Afterword by'],
        'bookauthor' => ['name', 'names', 'Book author'],
        'holder' => ['name', 'names', 'Patent holder'],
        'shortauthor' => ['name', 'names', 'Short author'],
        'shorteditor' => ['name', 'names', 'Short editor'],
        'nameaddon' => ['literal', 'names', 'Name addon'],
        'authortype' => ['key', 'names', 'Author type'],
        'editortype' => ['key', 'names', 'Editor type'],
        'editoratype' => ['key', 'names', 'Editor (secondary) type'],
        'editorbtype' => ['key', 'names', 'Editor (tertiary) type'],
        'editorctype' => ['key', 'names', 'Editor (further) type'],
        // Titles
        'title' => ['literal', 'titles', 'Title'],
        'subtitle' => ['literal', 'titles', 'Subtitle'],
        'titleaddon' => ['literal', 'titles', 'Title addon'],
        'shorttitle' => ['literal', 'titles', 'Short title'],
        'sorttitle' => ['literal', 'titles', 'Sort title'],
        'indextitle' => ['literal', 'titles', 'Index title'],
        'indexsorttitle' => ['literal', 'titles', 'Index sort title'],
        'origtitle' => ['literal', 'titles', 'Original title'],
        'reprinttitle' => ['literal', 'titles', 'Reprint title'],
        'booktitle' => ['literal', 'titles', 'Book title'],
        'booksubtitle' => ['literal', 'titles', 'Book subtitle'],
        'booktitleaddon' => ['literal', 'titles', 'Book title addon'],
        'maintitle' => ['literal', 'titles', 'Main title'],
        'mainsubtitle' => ['literal', 'titles', 'Main subtitle'],
        'maintitleaddon' => ['literal', 'titles', 'Main title addon'],
        'journaltitle' => ['literal', 'titles', 'Journal'],
        'journalsubtitle' => ['literal', 'titles', 'Journal subtitle'],
        'journaltitleaddon' => ['literal', 'titles', 'Journal title addon'],
        'shortjournal' => ['literal', 'titles', 'Short journal'],
        'issuetitle' => ['literal', 'titles', 'Issue title'],
        'issuesubtitle' => ['literal', 'titles', 'Issue subtitle'],
        'issuetitleaddon' => ['literal', 'titles', 'Issue title addon'],
        'eventtitle' => ['literal', 'titles', 'Event title'],
        'eventtitleaddon' => ['literal', 'titles', 'Event title addon'],
        'series' => ['literal', 'titles', 'Series'],
        'shortseries' => ['literal', 'titles', 'Short series'],
        // Publication
        'publisher' => ['list', 'publication', 'Publisher'],
        'location' => ['list', 'publication', 'Place'],
        'institution' => ['list', 'publication', 'Institution'],
        'organization' => ['list', 'publication', 'Organization'],
        'origpublisher' => ['list', 'publication', 'Original publisher'],
        'origlocation' => ['list', 'publication', 'Original place'],
        'edition' => ['literal', 'publication', 'Edition'],
        'volume' => ['literal', 'publication', 'Volume'],
        'volumes' => ['literal', 'publication', 'Number of volumes'],
        'part' => ['literal', 'publication', 'Part'],
        'number' => ['literal', 'publication', 'Number'],
        'issue' => ['literal', 'publication', 'Issue'],
        'eid' => ['literal', 'publication', 'Electronic id'],
        'chapter' => ['literal', 'publication', 'Chapter'],
        'pages' => ['range', 'publication', 'Pages'],
        'pagetotal' => ['literal', 'publication', 'Total pages'],
        'pagination' => ['key', 'publication', 'Pagination'],
        'bookpagination' => ['key', 'publication', 'Book pagination'],
        'howpublished' => ['literal', 'publication', 'How published'],
        'type' => ['literal', 'publication', 'Type'],
        'venue' => ['literal', 'publication', 'Venue'],
        'version' => ['literal', 'publication', 'Version'],
        'pubstate' => ['key', 'publication', 'Publication state'],
        'entrysubtype' => ['literal', 'publication', 'Entry subtype'],
        // Dates
        'date' => ['date', 'dates', 'Date'],
        'year' => ['literal', 'dates', 'Year'],
        'month' => ['literal', 'dates', 'Month'],
        'origdate' => ['date', 'dates', 'Original date'],
        'eventdate' => ['date', 'dates', 'Event date'],
        'urldate' => ['date', 'dates', 'Accessed'],
        // Identifiers
        'doi' => ['verbatim', 'identifiers', 'DOI'],
        'url' => ['uri', 'identifiers', 'URL'],
        'isbn' => ['literal', 'identifiers', 'ISBN'],
        'issn' => ['literal', 'identifiers', 'ISSN'],
        'ismn' => ['literal', 'identifiers', 'ISMN'],
        'isrn' => ['literal', 'identifiers', 'ISRN'],
        'isan' => ['literal', 'identifiers', 'ISAN'],
        'iswc' => ['literal', 'identifiers', 'ISWC'],
        'eprint' => ['verbatim', 'identifiers', 'Eprint'],
        'eprinttype' => ['literal', 'identifiers', 'Eprint type'],
        'eprintclass' => ['literal', 'identifiers', 'Eprint class'],
        'library' => ['literal', 'identifiers', 'Library'],
        'shorthand' => ['literal', 'identifiers', 'Shorthand'],
        'shorthandintro' => ['literal', 'identifiers', 'Shorthand intro'],
        'label' => ['literal', 'identifiers', 'Label'],
        // Notes
        'note' => ['literal', 'notes', 'Note'],
        'addendum' => ['literal', 'notes', 'Addendum'],
        'annotation' => ['literal', 'notes', 'Annotation'],
        'abstract' => ['literal', 'notes', 'Abstract'],
        'file' => ['verbatim', 'notes', 'File'],
        // Other
        'language' => ['keylist', 'other', 'Language'],
        'origlanguage' => ['keylist', 'other', 'Original language'],
        'langid' => ['key', 'other', 'Language id'],
        'keywords' => ['keylist', 'other', 'Keywords'],
        'ids' => ['keylist', 'other', 'Alternative keys'],
        'related' => ['keylist', 'other', 'Related entries'],
        'relatedtype' => ['key', 'other', 'Relation type'],
        'relatedstring' => ['literal', 'other', 'Relation string'],
        'sortkey' => ['literal', 'other', 'Sort key'],
        'sortname' => ['name', 'other', 'Sort name'],
        'sortyear' => ['literal', 'other', 'Sort year'],
    ];

    /**
     * What an editor sees first for each type — the fields that identify
     * the commonest references. Everything else is one "Add field…" away.
     *
     * @var array<string, list<string>>
     */
    private const STANDARD = [
        'article' => ['author', 'title', 'journaltitle', 'date', 'volume', 'number', 'pages', 'doi'],
        'book' => ['author', 'editor', 'title', 'subtitle', 'publisher', 'location', 'date', 'series', 'volume', 'edition'],
        'mvbook' => ['author', 'editor', 'title', 'subtitle', 'publisher', 'location', 'date', 'volumes'],
        'inbook' => ['author', 'title', 'booktitle', 'bookauthor', 'publisher', 'location', 'date', 'pages'],
        'bookinbook' => ['author', 'title', 'booktitle', 'publisher', 'location', 'date', 'pages'],
        'suppbook' => ['author', 'title', 'booktitle', 'publisher', 'location', 'date', 'pages'],
        'booklet' => ['author', 'title', 'howpublished', 'location', 'date'],
        'collection' => ['editor', 'title', 'subtitle', 'publisher', 'location', 'date', 'series', 'volume'],
        'mvcollection' => ['editor', 'title', 'subtitle', 'publisher', 'location', 'date', 'volumes'],
        'incollection' => ['author', 'title', 'editor', 'booktitle', 'publisher', 'location', 'date', 'pages'],
        'suppcollection' => ['author', 'title', 'editor', 'booktitle', 'publisher', 'location', 'date', 'pages'],
        'dataset' => ['author', 'title', 'publisher', 'date', 'url', 'doi'],
        'manual' => ['author', 'title', 'organization', 'date', 'url'],
        'misc' => ['author', 'title', 'howpublished', 'date', 'note'],
        'online' => ['author', 'title', 'date', 'url', 'urldate'],
        'patent' => ['author', 'title', 'number', 'holder', 'date'],
        'periodical' => ['editor', 'title', 'issuetitle', 'date', 'volume', 'number'],
        'suppperiodical' => ['author', 'title', 'journaltitle', 'date', 'volume', 'pages'],
        'proceedings' => ['editor', 'title', 'eventtitle', 'publisher', 'location', 'date'],
        'mvproceedings' => ['editor', 'title', 'eventtitle', 'publisher', 'location', 'date', 'volumes'],
        'inproceedings' => ['author', 'title', 'editor', 'booktitle', 'publisher', 'location', 'date', 'pages'],
        'reference' => ['editor', 'title', 'publisher', 'location', 'date', 'edition'],
        'mvreference' => ['editor', 'title', 'publisher', 'location', 'date', 'volumes'],
        'inreference' => ['author', 'title', 'editor', 'booktitle', 'publisher', 'location', 'date', 'pages'],
        'report' => ['author', 'title', 'type', 'institution', 'location', 'date', 'number'],
        'set' => ['title', 'note'],
        'software' => ['author', 'title', 'version', 'organization', 'date', 'url'],
        'thesis' => ['author', 'title', 'type', 'institution', 'location', 'date'],
        'unpublished' => ['author', 'title', 'howpublished', 'date', 'note'],
    ];

    /**
     * @return list<string>
     */
    public static function types(): array
    {
        return self::TYPES;
    }

    public static function isType(string $type): bool
    {
        return in_array($type, self::TYPES, true);
    }

    /**
     * @return list<string>
     */
    public static function fieldNames(): array
    {
        return array_keys(self::FIELDS);
    }

    public static function isField(string $name): bool
    {
        return array_key_exists($name, self::FIELDS);
    }

    public static function kind(string $name): ?string
    {
        return self::FIELDS[$name][0] ?? null;
    }

    /**
     * @return list<string>
     */
    public static function standardFields(string $type): array
    {
        return self::STANDARD[$type] ?? self::STANDARD['misc'];
    }

    /**
     * The registry as the client receives it, one prop for the item form.
     *
     * @return array{types: list<string>, fields: list<FieldSpec>, standard: array<string, list<string>>}
     */
    public static function registry(): array
    {
        $fields = [];

        foreach (self::FIELDS as $name => [$kind, $group, $label]) {
            $fields[] = ['name' => $name, 'kind' => $kind, 'group' => $group, 'label' => $label];
        }

        return ['types' => self::TYPES, 'fields' => $fields, 'standard' => self::STANDARD];
    }
}
