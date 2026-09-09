<?php

use App\Support\Bibliography\BiblatexReader;

test('a standard entry reads with every value form: braced, quoted, bare and concatenated', function () {
    $result = BiblatexReader::read(<<<'BIB'
    @string{cq = "Classical Quarterly"}
    @comment{ignored}
    @article{dover1972,
      author = {Dover, K. J. and {Oxford Classical Texts}},
      title  = "Aristophanes {and} the {Clouds}",
      journaltitle = cq,
      volume = 22,
      pages = {1--10},
      date = "19" # "72",
    }
    BIB);

    expect($result['warnings'])->toBe([])
        ->and($result['entries'])->toBe([[
            'entry_type' => 'article',
            'citation_key' => 'dover1972',
            'fields' => [
                'author' => 'Dover, K. J. and {Oxford Classical Texts}',
                'title' => 'Aristophanes {and} the {Clouds}',
                'journaltitle' => 'Classical Quarterly',
                'volume' => '22',
                'pages' => '1--10',
                'date' => '1972',
            ],
        ]]);
});

test('bibtex aliases map onto biblatex, unknown fields are dropped and reported', function () {
    $result = BiblatexReader::read(<<<'BIB'
    @phdthesis{smith2001,
      author = {Smith, Jane},
      title = {A Thesis},
      school = {Oxford},
      address = {Oxford},
      journal = {Nowhere},
      year = {2001},
      colour = {blue},
    }
    BIB);

    expect($result['entries'][0]['entry_type'])->toBe('thesis')
        ->and($result['entries'][0]['fields'])->toBe([
            'author' => 'Smith, Jane',
            'title' => 'A Thesis',
            'institution' => 'Oxford',
            'location' => 'Oxford',
            'journaltitle' => 'Nowhere',
            'year' => '2001',
            'type' => 'phdthesis',
        ])
        ->and($result['warnings'])->toBe(['“smith2001”: not biblatex fields, dropped — colour.']);
});

test('an unreadable entry is skipped and reported, the rest still land', function () {
    $result = BiblatexReader::read(<<<'BIB'
    @gadget{x1, title = {Not a type}}
    @book{notitle, author = {Nobody}}
    @book{, title = {No key}}
    @book(paren1, title = {Parentheses work}, date = 1900)
    BIB);

    expect(collect($result['entries'])->pluck('citation_key')->all())->toBe(['paren1'])
        ->and($result['warnings'])->toBe([
            '@gadget is not a biblatex entry type — “x1” was skipped.',
            '“notitle” has no title and was skipped.',
            'An @book entry without a key was skipped.',
        ]);
});
