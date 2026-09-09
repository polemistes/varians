<?php

namespace App\Support\Bibliography;

use App\Models\BibliographyItem;

/**
 * The full reference as the edition's bibliography prints it, in a plain
 * author–year style: names, year, title, then whatever locates the work
 * — journal, volume and pages for an article; the containing book and
 * its editors for a chapter; publisher and place for a book. Not a CSL
 * engine; enough to read, and every field it ignores is still in the
 * export.
 *
 * The result is a list of runs so the client can italicize the parts a
 * reference italicizes (book and journal titles) without the formatter
 * emitting markup.
 *
 * @phpstan-type Run array{text: string, italic: bool}
 */
class ReferenceFormatter
{
    /**
     * @return list<Run>
     */
    public static function runs(BibliographyItem $item): array
    {
        $runs = [];
        $plain = function (string $text) use (&$runs): void {
            if ($text !== '') {
                $runs[] = ['text' => $text, 'italic' => false];
            }
        };
        $italic = function (string $text) use (&$runs): void {
            if ($text !== '') {
                $runs[] = ['text' => $text, 'italic' => true];
            }
        };

        $type = $item->entry_type;
        $year = CitationLabel::year($item->fields);
        $names = self::names($item);
        $title = self::title($item);
        $editors = $item->field('editor') !== null
            ? self::nameString($item->field('editor'))
            : null;

        $plain($names !== '' ? self::sentence($names).' ' : '');
        $plain($year !== '' ? $year.'. ' : '');

        $containerTitle = self::containerTitle($item);

        if ($containerTitle !== null) {
            // The work is part of something: its own title plain, the
            // container's in italics.
            $plain($title !== '' ? self::sentence($title).' ' : '');

            if ($type === 'article' || $type === 'suppperiodical') {
                $italic($containerTitle);
                $plain(self::articleLocator($item).'. ');
            } else {
                $plain('In ');
                $italic($containerTitle);
                $plain(($editors !== null && $names !== $editors ? ', ed. '.$editors : '').self::bookDetails($item, withPages: true).'. ');
            }
        } else {
            $italic($title);
            $plain(($title !== '' ? '' : '').self::bookDetails($item, withPages: false).'. ');
        }

        foreach (['doi' => 'doi:', 'url' => ''] as $field => $prefix) {
            $value = $item->field($field);

            if ($value !== null) {
                $plain($prefix.$value.'.');

                break;
            }
        }

        return array_values(array_filter($runs, fn (array $run) => trim($run['text']) !== ''));
    }

    /** The plain-text form, for places that cannot italicize. */
    public static function text(BibliographyItem $item): string
    {
        return trim(implode('', array_map(fn (array $run) => $run['text'], self::runs($item))));
    }

    private static function names(BibliographyItem $item): string
    {
        foreach (['author', 'editor', 'translator'] as $field) {
            $value = $item->field($field);

            if ($value !== null) {
                $names = self::nameString($value);

                return $field === 'author' ? $names : $names.' ('.($field === 'editor' ? 'ed.' : 'tr.').')';
            }
        }

        foreach (['organization', 'institution'] as $field) {
            $value = $item->field($field);

            if ($value !== null) {
                return trim(explode(' and ', $value)[0]);
            }
        }

        return '';
    }

    /** "Dover, K. J., and J. Henderson" — the first name inverted, the rest not. */
    private static function nameString(string $list): string
    {
        $names = NameList::parse($list);
        $parts = [];

        foreach ($names as $index => $name) {
            $given = $name['given'];
            $family = $name['family'];

            if ($given === '') {
                $parts[] = $family;
            } elseif ($index === 0) {
                $parts[] = $family.', '.$given;
            } else {
                $parts[] = $given.' '.$family;
            }
        }

        return match (count($parts)) {
            0 => '',
            1 => $parts[0],
            2 => $parts[0].' and '.$parts[1],
            default => implode(', ', array_slice($parts, 0, -1)).', and '.$parts[count($parts) - 1],
        };
    }

    private static function title(BibliographyItem $item): string
    {
        $title = $item->field('title') ?? '';
        $subtitle = $item->field('subtitle');

        return $subtitle !== null ? $title.': '.$subtitle : $title;
    }

    private static function containerTitle(BibliographyItem $item): ?string
    {
        $journal = $item->field('journaltitle');

        if ($journal !== null) {
            return $journal;
        }

        $book = $item->field('booktitle');

        if ($book !== null) {
            $sub = $item->field('booksubtitle');

            return $sub !== null ? $book.': '.$sub : $book;
        }

        return null;
    }

    private static function articleLocator(BibliographyItem $item): string
    {
        $volume = $item->field('volume');
        $number = $item->field('number') ?? $item->field('issue');
        $pages = $item->field('pages');

        $text = $volume !== null ? ' '.$volume : '';
        $text .= $number !== null ? ' ('.$number.')' : '';
        $text .= $pages !== null ? ': '.self::pages($pages) : '';

        return $text;
    }

    private static function bookDetails(BibliographyItem $item, bool $withPages): string
    {
        $parts = [];

        $series = $item->field('series');
        $volume = $item->field('volume');

        if ($series !== null) {
            $parts[] = $series.($volume !== null ? ' '.$volume : '');
        } elseif ($volume !== null) {
            $parts[] = 'vol. '.$volume;
        }

        $edition = $item->field('edition');

        if ($edition !== null) {
            $parts[] = is_numeric($edition) ? $edition.'. ed.' : $edition;
        }

        $type = $item->field('type');
        $institution = $item->field('institution');

        if ($item->entry_type === 'thesis' || $item->entry_type === 'report') {
            $parts[] = trim(($type ?? ucfirst($item->entry_type)).($institution !== null ? ', '.str_replace(' and ', ', ', $institution) : ''));
        }

        $publisher = $item->field('publisher');
        $location = $item->field('location');

        if ($publisher !== null || $location !== null) {
            $parts[] = trim(($location !== null ? str_replace(' and ', ', ', $location) : '')
                .($location !== null && $publisher !== null ? ': ' : '')
                .($publisher !== null ? str_replace(' and ', ', ', $publisher) : ''));
        }

        $howPublished = $item->field('howpublished');

        if ($howPublished !== null) {
            $parts[] = $howPublished;
        }

        if ($withPages && $item->field('pages') !== null) {
            $parts[] = self::pages((string) $item->field('pages'));
        }

        return $parts === [] ? '' : '. '.implode(', ', $parts);
    }

    /** A sentence ends in one stop: "Dover, K. J." gets no second period. */
    private static function sentence(string $text): string
    {
        return in_array(mb_substr($text, -1), ['.', '?', '!'], true) ? $text : $text.'.';
    }

    private static function pages(string $pages): string
    {
        return str_replace('--', '–', $pages);
    }
}
