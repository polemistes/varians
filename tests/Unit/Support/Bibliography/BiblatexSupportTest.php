<?php

use App\Models\BibliographyItem;
use App\Support\Bibliography\Biblatex;
use App\Support\Bibliography\BiblatexWriter;
use App\Support\Bibliography\CitationLabel;
use App\Support\Bibliography\NameList;
use App\Support\Bibliography\ReferenceFormatter;

test('a name list parses both biblatex forms and serializes to the unambiguous one', function () {
    $names = NameList::parse('Wilamowitz-Moellendorff, Ulrich von and Kenneth Dover and {Oxford Classical Texts}');

    expect($names)->toBe([
        ['family' => 'Wilamowitz-Moellendorff', 'given' => 'Ulrich von'],
        ['family' => 'Dover', 'given' => 'Kenneth'],
        ['family' => 'Oxford Classical Texts', 'given' => ''],
    ])->and(NameList::serialize($names))
        ->toBe('Wilamowitz-Moellendorff, Ulrich von and Dover, Kenneth and {Oxford Classical Texts}');
});

test('the label is author–year, two authors joined, three or more et al., year taken from date', function () {
    expect(CitationLabel::base('book', ['author' => 'Wilamowitz, Ulrich', 'date' => '1927-05']))->toBe('Wilamowitz 1927')
        ->and(CitationLabel::base('book', ['author' => 'Dover, K. and Henderson, J.', 'year' => '1987']))->toBe('Dover and Henderson 1987')
        ->and(CitationLabel::base('book', ['author' => 'A, X and B, Y and C, Z', 'date' => '2001/2003']))->toBe('A et al. 2001')
        ->and(CitationLabel::base('collection', ['editor' => 'Page, D. L.', 'date' => '1962']))->toBe('Page 1962')
        ->and(CitationLabel::base('misc', ['title' => 'Suda On Line']))->toBe('Suda On Line');
});

test('a taken label gets a letter suffix', function () {
    expect(CitationLabel::disambiguate('Henderson 1987', []))->toBe('Henderson 1987')
        ->and(CitationLabel::disambiguate('Henderson 1987', ['Henderson 1987']))->toBe('Henderson 1987a')
        ->and(CitationLabel::disambiguate('Henderson 1987', ['Henderson 1987', 'Henderson 1987a']))->toBe('Henderson 1987b');
});

test('the registry knows every standard type and only biblatex fields', function () {
    expect(Biblatex::isType('incollection'))->toBeTrue()
        ->and(Biblatex::isType('phdthesis'))->toBeFalse()
        ->and(Biblatex::isField('journaltitle'))->toBeTrue()
        ->and(Biblatex::isField('journal'))->toBeFalse()
        ->and(Biblatex::kind('author'))->toBe('name')
        ->and(Biblatex::standardFields('article'))->toContain('journaltitle', 'pages');
});

test('an entry is written as biblatex, fields in registry order', function () {
    $item = new BibliographyItem([
        'entry_type' => 'article',
        'citation_key' => 'dover1987',
        'fields' => ['pages' => '45--67', 'title' => 'Aristophanes', 'author' => 'Dover, K. J.', 'journaltitle' => 'CQ', 'date' => '1987'],
    ]);

    expect(BiblatexWriter::entry($item))->toBe(
        "@article{dover1987,\n  author = {Dover, K. J.},\n  title = {Aristophanes},\n  journaltitle = {CQ},\n  pages = {45--67},\n  date = {1987}\n}"
    );
});

test('a reference reads author–year style, italicizing the journal or book title', function () {
    $article = new BibliographyItem([
        'entry_type' => 'article',
        'citation_key' => 'dover1987',
        'fields' => ['author' => 'Dover, K. J.', 'title' => 'Aristophanes', 'journaltitle' => 'CQ', 'date' => '1987', 'volume' => '37', 'pages' => '45--67'],
    ]);
    $book = new BibliographyItem([
        'entry_type' => 'book',
        'citation_key' => 'henderson1987',
        'fields' => ['editor' => 'Henderson, Jeffrey', 'title' => 'Lysistrata', 'publisher' => 'Clarendon Press', 'location' => 'Oxford', 'date' => '1987'],
    ]);

    expect(ReferenceFormatter::text($article))->toBe('Dover, K. J. 1987. Aristophanes. CQ 37: 45–67.')
        ->and(collect(ReferenceFormatter::runs($article))->firstWhere('italic', true)['text'])->toBe('CQ')
        ->and(ReferenceFormatter::text($book))->toBe('Henderson, Jeffrey (ed.). 1987. Lysistrata. Oxford: Clarendon Press.')
        ->and(collect(ReferenceFormatter::runs($book))->firstWhere('italic', true)['text'])->toBe('Lysistrata');
});
