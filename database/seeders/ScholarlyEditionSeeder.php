<?php

namespace Database\Seeders;

use App\Enums\ConjectureType;
use App\Enums\Layer;
use App\Enums\Visibility;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptPage;
use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use App\Support\Transcription\GreekText;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Illustrative sample data for developing the transcription editor against:
 * one work per reference scheme, each with a manuscript witness, placeholder
 * folio images, and a transcription. Not a verified critical text.
 */
class ScholarlyEditionSeeder extends Seeder
{
    public function run(): void
    {
        $scholar = User::first() ?? User::factory()->create();

        $this->seedIliad($scholar);
        $this->seedApology($scholar);
    }

    private function seedIliad(User $scholar): void
    {
        $scheme = ReferenceScheme::create([
            'name' => 'Book and line numbering',
            'levels' => [
                ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => ''],
                ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => '.'],
            ],
        ]);

        $work = Work::create([
            'reference_scheme_id' => $scheme->id,
            'title' => 'Iliad',
            'author' => 'Homer',
            'language' => 'grc',
            'slug' => 'iliad',
        ]);

        $lines = [
            1 => 'μῆνιν [ἄειδε] θεὰ Πηληϊάδεω Ἀχιλῆος',
            2 => 'οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,',
            3 => 'πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν',
            4 => 'ἡρώων, αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν',
            5 => 'οἰωνοῖσί τε πᾶσι, Διὸς δ᾽ {3} ἐτελείετο βουλή,',
            6 => 'ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε',
            7 => 'Ἀτρεΐδης τε ἄναξ ἀνδρῶν καὶ δῖος _Ἀχιλλεύς_.',
            8 => 'τίς τ᾽ ἄρ σφωε θεῶν ἔριδι ξυνέηκε μάχεσθαι;',
            9 => 'Λητοῦς καὶ Διὸς υἱός: ὁ γὰρ βασιλῆϊ χολωθεὶς',
            10 => 'νοῦσον ἀνὰ στρατὸν ὄρσε κακήν, ὀλέκοντο δὲ λαοί,',
        ];

        /** @var array<int, CanonicalPassage> $passages */
        $passages = [];

        foreach ($lines as $line => $text) {
            $formatted = $scheme->format(['book' => 1, 'line' => $line]);

            $passages[$line] = CanonicalPassage::create([
                'work_id' => $work->id,
                'address' => ['book' => 1, 'line' => $line],
                'sort_key' => $formatted['sort_key'],
                'label' => $formatted['label'],
            ]);
        }

        $witness = Witness::create([
            'siglum' => 'A',
            'label' => 'Venetus A',
            'repository' => 'Biblioteca Nazionale Marciana',
            'shelfmark' => 'Marc. gr. Z. 454',
            'date_text' => 's. X',
            'description' => 'The principal manuscript of the Iliad, containing extensive scholia.',
        ]);

        $pages = [];

        foreach (['12r', '12v'] as $index => $folio) {
            $pages[$folio] = $witness->pages()->create([
                'label' => $folio,
                'position' => $index + 1,
            ]);

            ManuscriptImage::create([
                'witness_id' => $witness->id,
                'manuscript_page_id' => $pages[$folio]->id,
                'path' => $this->placeholderImage($witness->shelfmark, $folio),
                'position' => $index + 1,
            ]);
        }

        // A third page nobody has photographed, so that the two-pane view has
        // the ordinary case to show: a page whose text is transcribed from
        // something other than an image.
        $pages['13r'] = $witness->pages()->create(['label' => '13r', 'position' => 3]);

        // Both layers of the same witness — the case that motivated
        // Layer. Only the normalized one is collated; without
        // that filter this witness would appear twice in its own apparatus,
        // disagreeing with itself.
        // Markup belongs to the diplomatic layer — what is lost or illegible —
        // and is resolved away in the normalized one, which is what collation
        // reads. Line 5 deliberately loses a word between the layers (the
        // illegible {3} has no normalized counterpart), so the reader view has
        // one line where the two cannot be lined up word by word.
        $normalized = [
            1 => 'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος',
            2 => 'οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,',
            3 => 'πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν',
            4 => 'ἡρώων, αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν',
            5 => 'οἰωνοῖσί τε πᾶσι, Διὸς δ᾽ ἐτελείετο βουλή,',
            6 => 'ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε',
            7 => 'Ἀτρεΐδης τε ἄναξ ἀνδρῶν καὶ δῖος Ἀχιλλεύς.',
            8 => 'τίς τ᾽ ἄρ σφῶε θεῶν ἔριδι ξυνέηκε μάχεσθαι;',
            9 => 'Λητοῦς καὶ Διὸς υἱός· ὁ γὰρ βασιλῆϊ χολωθεὶς',
            10 => 'νοῦσον ἀνὰ στρατὸν ὄρσε κακήν, ὀλέκοντο δὲ λαοί,',
        ];

        $transcriptionA = $this->startTranscription($witness);
        $this->createTranscription($transcriptionA, $scholar, $this->entriesFor($lines, $passages), Layer::Diplomatic);
        $baseA = $this->createTranscription($transcriptionA, $scholar, $this->entriesFor($normalized, $passages), Layer::Normalized);

        // Divide both layers onto the pages: five lines to 12r, three to 12v,
        // the last two to the unphotographed 13r. Each layer is divided on its
        // own offsets, since the two texts differ.
        $this->divideOntoPages($transcriptionA, $pages, [1 => '12r', 6 => '12v', 9 => '13r']);

        $this->seedIliadWitnesses($scholar, $passages, $normalized);
        $this->seedIliadEdition($work, $scholar, $passages, $baseA);
    }

    /**
     * A second and third witness, differing from A in the ways an apparatus
     * exists to report: a word substituted, a phrase transposed, a line
     * missing altogether, and — the case worth telling apart from the rest —
     * a difference of accent alone.
     *
     * @param  array<int, CanonicalPassage>  $passages
     * @param  array<int, string>  $normalized
     */
    private function seedIliadWitnesses(User $scholar, array $passages, array $normalized): void
    {
        $b = Witness::create([
            'siglum' => 'B',
            'label' => 'Venetus B',
        ]);

        $bNormalized = $normalized;
        $bNormalized[2] = 'οὐλομένην, ἣ μυρία Ἀχαιοῖς ἄλγεα θῆκε,';   // ἄλγε᾽ ἔθηκε
        $bNormalized[4] = 'ἡρώων, αὐτοὺς δὲ ἕλωρα τεῦχε κύνεσσιν';     // ἑλώρια
        // Ionic ξυν- against Attic συν-: a real difference in what the scribe
        // wrote, visible in both layers. Not an accent difference — B's
        // scribe supplies no accents at all, so any accent this edition
        // prints for B is the editor's own and must not be reported as B's
        // reading (see the note on 1.8).
        $bNormalized[8] = 'τίς τ᾽ ἄρ σφῶε θεῶν ἔριδι συνέηκε μάχεσθαι;';
        $bNormalized[9] = 'Διὸς καὶ Λητοῦς υἱός· ὁ γὰρ βασιλῆϊ χολωθεὶς'; // transposed

        // B's scribe writes without accents or breathings, so its diplomatic
        // layer differs from its own normalized text in nearly every word
        // while saying the same thing — which is what the reader toggle is for.
        $bDiplomatic = array_map(fn (string $line) => GreekText::stripDiacritics($line), $bNormalized);

        $transcriptionB = $this->startTranscription($b);
        $this->createTranscription($transcriptionB, $scholar, $this->entriesFor($bDiplomatic, $passages), Layer::Diplomatic);
        $this->createTranscription($transcriptionB, $scholar, $this->entriesFor($bNormalized, $passages), Layer::Normalized);

        $c = Witness::create([
            'siglum' => 'C',
            'label' => 'Codex Laurentianus',
        ]);

        // Fragmentary: lines 3 and 6 are lost. Absence is the gap — C simply
        // has no reading there, which is not the same as omitting the words.
        $cNormalized = $normalized;
        unset($cNormalized[3], $cNormalized[6]);
        $cNormalized[10] = 'νοῦσον ἀνὰ στρατὸν ὄρσε κακά, ὀλέκοντο δὲ λαοί,';

        $this->createTranscription($this->startTranscription($c), $scholar, $this->entriesFor($cNormalized, $passages), Layer::Normalized);
    }

    /**
     * An edition over the whole ten lines, based throughout on A: a worked
     * example with the apparatus already carrying witness variants, two
     * conjectures — one adopted, one merely catalogued — a reading taken from
     * B against A, and the editor's own notes.
     *
     * @param  array<int, CanonicalPassage>  $passages
     */
    private function seedIliadEdition(Work $work, User $scholar, array $passages, TranscriptionLayer $baseA): void
    {
        $edition = Edition::create([
            'work_id' => $work->id,
            'user_id' => $scholar->id,
            'title' => 'Iliad I, a working edition',
            'description' => 'The opening of the Iliad, collated from three witnesses.',
            'visibility' => Visibility::Published,
        ]);

        $position = 1.0;

        foreach ($passages as $passage) {
            $segment = TranscriptionSegment::where('transcription_layer_id', $baseA->id)
                ->where('canonical_passage_id', $passage->id)
                ->sole();

            PassageAdder::add($edition, $segment, $position++);
        }

        // Zenodotus read δαῖτα here, reported by Athenaeus — a genuine
        // ancient variant, and one this edition adopts, so the printed line
        // departs from every surviving manuscript.
        $daita = Conjecture::create([
            'canonical_passage_id' => $passages[5]->id,
            'user_id' => $scholar->id,
            'type' => ConjectureType::Substitution,
            'text' => 'δαῖτα,',
            'proposed_by' => 'Zenodotus',
            'bibliography' => 'Athenaeus, Deipnosophistae 1.12e',
            'note' => 'Reported as the reading of Zenodotus; no surviving manuscript has it.',
        ]);

        $this->adopt($edition, $this->columnFor($passages[5], $baseA, 'πᾶσι,'), $daita);

        // The seeding editor's own, catalogued as a candidate but not adopted:
        // recording a conjecture and printing it are separate acts.
        $heloria = Conjecture::create([
            'canonical_passage_id' => $passages[4]->id,
            'user_id' => $scholar->id,
            'type' => ConjectureType::Substitution,
            'text' => 'ἑλώριον',
            'note' => 'Offered for the sake of the metre; not adopted here.',
        ]);

        $this->place($this->columnFor($passages[4], $baseA, 'ἑλώρια'), $heloria);

        // A decision in B's favour against the base, so the edition is
        // genuinely eclectic rather than a copy of one witness.
        $this->adoptWitness($edition, $this->columnFor($passages[2], $baseA, 'ἄλγε᾽'), 'B');

        EditionComment::create([
            'edition_id' => $edition->id,
            'canonical_passage_id' => $passages[8]->id,
            'lemma_id' => $this->columnFor($passages[8], $baseA, 'ξυνέηκε')?->id,
            'user_id' => $scholar->id,
            'note' => 'B has the Attic συν- for the Ionic ξυν-. Printed as ξυν- throughout with A and C.',
        ]);

        EditionComment::create([
            'edition_id' => $edition->id,
            'canonical_passage_id' => $passages[9]->id,
            'user_id' => $scholar->id,
            'note' => 'B transposes Διὸς and Λητοῦς. The order printed here follows A and C.',
        ]);
    }

    /** The column whose reading in the base is exactly this word. */
    private function columnFor(CanonicalPassage $passage, TranscriptionLayer $base, string $word): ?Lemma
    {
        return Lemma::where('canonical_passage_id', $passage->id)
            ->orderBy('position')
            ->with('readings')
            ->get()
            ->first(function (Lemma $lemma) use ($base, $word) {
                $reading = $lemma->readings->firstWhere('transcription_layer_id', $base->id);

                return $reading !== null && mb_substr(
                    $base->text,
                    $reading->start_offset,
                    $reading->end_offset - $reading->start_offset,
                ) === $word;
            });
    }

    /** Attach a conjecture to a column as one more candidate there. */
    private function place(?Lemma $lemma, Conjecture $conjecture): ?LemmaReading
    {
        return $lemma?->readings()->create(['conjecture_id' => $conjecture->id]);
    }

    /** Attach a conjecture and let this edition print it. */
    private function adopt(Edition $edition, ?Lemma $lemma, Conjecture $conjecture): void
    {
        $reading = $this->place($lemma, $conjecture);

        if ($reading !== null) {
            EditionLemma::create([
                'edition_id' => $edition->id,
                'lemma_id' => $lemma->id,
                'selected_reading_id' => $reading->id,
            ]);
        }
    }

    /** Print the named witness's reading at this column instead of the base's. */
    private function adoptWitness(Edition $edition, ?Lemma $lemma, string $siglum): void
    {
        $reading = $lemma?->readings->first(
            fn (LemmaReading $candidate) => $candidate->transcriptionLayer?->transcription?->witness?->siglum === $siglum,
        );

        if ($reading !== null) {
            EditionLemma::create([
                'edition_id' => $edition->id,
                'lemma_id' => $lemma->id,
                'selected_reading_id' => $reading->id,
            ]);
        }
    }

    /**
     * @param  array<int, string>  $lines
     * @param  array<int, CanonicalPassage>  $passages
     * @return list<array{text: string, passage: CanonicalPassage}>
     */
    private function entriesFor(array $lines, array $passages): array
    {
        return array_values(collect($lines)->map(fn (string $text, int $line) => [
            'text' => $text,
            'passage' => $passages[$line],
        ])->all());
    }

    private function seedApology(User $scholar): void
    {
        $scheme = ReferenceScheme::create([
            'name' => 'Stephanus pagination',
            'levels' => [
                ['key' => 'page', 'label' => 'Page', 'type' => 'integer', 'separator' => ''],
                ['key' => 'section', 'label' => 'Section', 'type' => 'string', 'separator' => ''],
            ],
        ]);

        $work = Work::create([
            'reference_scheme_id' => $scheme->id,
            'title' => 'Apology',
            'author' => 'Plato',
            'language' => 'grc',
            'slug' => 'apology',
        ]);

        $sections = [
            ['page' => 17, 'section' => 'a', 'text' => 'Ὅτι μὲν ὑμεῖς, ὦ ἄνδρες Ἀθηναῖοι, πεπόνθατε ὑπὸ τῶν ἐμῶν κατηγόρων,'],
            ['page' => 17, 'section' => 'b', 'text' => 'οὐκ οἶδα: ἐγὼ δ᾽ οὖν καὶ αὐτὸς ὑπ᾽ αὐτῶν ὀλίγου ἐμαυτοῦ ἐπελαθόμην,'],
            ['page' => 17, 'section' => 'c', 'text' => 'οὕτω πιθανῶς ἔλεγον. καίτοι ἀληθές γε ὡς ἔπος εἰπεῖν οὐδὲν εἰρήκασιν.', 'paragraphBreakBefore' => true],
            ['page' => 17, 'section' => 'd', 'text' => 'μάλιστα δὲ αὐτῶν ἓν ἐθαύμασα τῶν πολλῶν ὧν ἐψεύσαντο,'],
            ['page' => 17, 'section' => 'e', 'text' => 'τοῦτο ἐν ᾧ ἔλεγον ὡς χρῆν ὑμᾶς εὐλαβεῖσθαι μὴ ὑπ᾽ ἐμοῦ ἐξαπατηθῆτε.'],
            ['page' => 18, 'section' => 'a', 'text' => 'ὡς δεινοῦ ὄντος λέγειν. τὸ γὰρ μὴ αἰσχυνθῆναι ὅτι αὐτίκα ὑπ᾽ ἐμοῦ ἐξελεγχθήσονται ἔργῳ,'],
            ['page' => 18, 'section' => 'b', 'text' => 'ἐπειδὰν μηδ᾽ ὁπωστιοῦν φαίνωμαι δεινὸς λέγειν, τοῦτό μοι ἔδοξεν αὐτῶν ἀναισχυντότατον εἶναι,'],
            ['page' => 18, 'section' => 'c', 'text' => 'εἰ μὴ ἄρα δεινὸν καλοῦσιν οὗτοι λέγειν τὸν τἀληθῆ λέγοντα:'],
            ['page' => 18, 'section' => 'd', 'text' => 'εἰ μὲν γὰρ τοῦτο λέγουσιν, ὁμολογοίην ἂν ἔγωγε οὐ κατὰ τούτους εἶναι ῥήτωρ.'],
            ['page' => 18, 'section' => 'e', 'text' => 'οὗτοι μὲν οὖν, ὥσπερ ἐγὼ λέγω, ἤ τι ἢ οὐδὲν ἀληθὲς εἰρήκασιν,'],
        ];

        $witness = Witness::create([
            'siglum' => 'B',
            'label' => 'Codex Clarkianus',
            'repository' => 'Bodleian Library',
            'shelfmark' => 'MS. E. D. Clarke 39',
            'date_text' => 'AD 895',
            'description' => 'Copied for Arethas of Patras; the primary witness for much of the Platonic corpus.',
        ]);

        ManuscriptImage::create([
            'witness_id' => $witness->id,
            'manuscript_page_id' => $witness->pages()->create([
                'label' => '1r',
                'position' => 1,
            ])->id,
            'path' => $this->placeholderImage($witness->shelfmark, '1r'),
            'position' => 1,
        ]);

        $entries = collect($sections)->map(function (array $section) use ($scheme, $work) {
            $formatted = $scheme->format(['page' => $section['page'], 'section' => $section['section']]);

            $passage = CanonicalPassage::create([
                'work_id' => $work->id,
                'address' => ['page' => $section['page'], 'section' => $section['section']],
                'sort_key' => $formatted['sort_key'],
                'label' => $formatted['label'],
            ]);

            return [
                'text' => $section['text'],
                'passage' => $passage,
                // Demonstrates that paragraphing is an editorial call, not derived
                // from the Stephanus structure: this break falls mid-page, at 17c.
                'paragraphBreakBefore' => $section['paragraphBreakBefore'] ?? false,
            ];
        });

        $entries = array_values($entries->all());

        // Normalized: this is the Apology edition's own base, and only the
        // collatable layer may be one.
        $this->createTranscription($this->startTranscription($witness), $scholar, $entries, Layer::Normalized);
    }

    /**
     * Place pages in a transcription, given which line each page starts on.
     * One division for both layers: a page holds a stretch of the manuscript,
     * and a line of the transcription is a line of the manuscript in either
     * layer.
     *
     * @param  array<string, ManuscriptPage>  $pages
     * @param  array<int, string>  $startsAtLine  Line number => page label.
     */
    private function divideOntoPages(Transcription $transcription, array $pages, array $startsAtLine): void
    {
        foreach ($startsAtLine as $lineNumber => $label) {
            if (isset($pages[$label])) {
                $transcription->pageBreaks()->create([
                    'manuscript_page_id' => $pages[$label]->id,
                    'start_line' => $lineNumber - 1,
                ]);
            }
        }
    }

    /** A witness's transcription, whose two layers are then filled separately. */
    private function startTranscription(Witness $witness): Transcription
    {
        return Transcription::create([
            'witness_id' => $witness->id,
            'name' => 'Transcription',
            'position' => 1,
            'visibility' => Visibility::Published,
        ]);
    }

    /**
     * Join entries into one continuous text (a blank line between entries
     * flagged `paragraphBreakBefore`), then record each entry as a citation
     * span over that text — mirroring how a real transcription is built up:
     * one continuous document, annotated with spans afterward.
     *
     * @param  list<array{text: string, passage: CanonicalPassage, paragraphBreakBefore?: bool}>  $entries
     */
    private function createTranscription(Transcription $parent, User $scholar, array $entries, Layer $layer): TranscriptionLayer
    {
        $text = '';
        $spans = [];

        foreach ($entries as $entry) {
            if ($text !== '') {
                $text .= ($entry['paragraphBreakBefore'] ?? false) ? "\n\n" : "\n";
            }

            $start = mb_strlen($text);
            $text .= $entry['text'];
            $spans[] = ['start' => $start, 'end' => mb_strlen($text), 'passage' => $entry['passage']];
        }

        $transcription = TranscriptionLayer::create([
            'transcription_id' => $parent->id,
            'user_id' => $scholar->id,
            'layer' => $layer,
            'text' => $text,
        ]);

        foreach ($spans as $span) {
            $transcription->segments()->create([
                'canonical_passage_id' => $span['passage']->id,
                'start_offset' => $span['start'],
                'end_offset' => $span['end'],
            ]);
        }

        return $transcription;
    }

    private function placeholderImage(string $shelfmark, string $folio): string
    {
        $svg = <<<SVG
        <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
            <rect width="900" height="1200" fill="#e9dcc0" />
            <rect x="20" y="20" width="860" height="1160" fill="none" stroke="#a08c5f" stroke-width="2" />
            <text x="450" y="80" font-family="serif" font-size="28" fill="#5b4a2f" text-anchor="middle">{$shelfmark}</text>
            <text x="450" y="120" font-family="serif" font-size="22" fill="#5b4a2f" text-anchor="middle">fol. {$folio}</text>
            <text x="450" y="620" font-family="serif" font-size="16" fill="#a08c5f" text-anchor="middle">(placeholder facsimile image)</text>
        </svg>
        SVG;

        $filename = 'manuscript-images/'.Str::slug($shelfmark.'-'.$folio).'.svg';

        Storage::disk('public')->put($filename, $svg);

        return $filename;
    }
}
