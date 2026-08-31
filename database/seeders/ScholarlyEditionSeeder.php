<?php

namespace Database\Seeders;

use App\Enums\TranscriptionLayer;
use App\Enums\Visibility;
use App\Enums\WitnessType;
use App\Models\CanonicalPassage;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\ReferenceScheme;
use App\Models\Tag;
use App\Models\Transcription;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
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
            'type' => WitnessType::Manuscript,
            'siglum' => 'A',
            'label' => 'Venetus A',
        ]);

        $manuscript = Manuscript::create([
            'witness_id' => $witness->id,
            'repository' => 'Biblioteca Nazionale Marciana',
            'shelfmark' => 'Marc. gr. Z. 454',
            'date_text' => 's. X',
            'notes' => 'The principal manuscript of the Iliad, containing extensive scholia.',
        ]);

        foreach (['12r', '12v'] as $index => $folio) {
            ManuscriptImage::create([
                'manuscript_id' => $manuscript->id,
                'folio_label' => $folio,
                'path' => $this->placeholderImage($manuscript->shelfmark, $folio),
                'position' => $index + 1,
            ]);
        }

        // Both layers of the same witness — the case that motivated
        // TranscriptionLayer. Only the normalized one is collated; without
        // that filter this witness would appear twice in its own apparatus,
        // disagreeing with itself.
        $layers = [
            [TranscriptionLayer::Diplomatic, ['diplomatic']],
            [TranscriptionLayer::Normalized, ['normalized', 'punctuated']],
        ];

        foreach ($layers as [$layer, $tagNames]) {
            $entries = array_values(collect($lines)->map(fn (string $text, int $line) => [
                'text' => $text,
                'passage' => $passages[$line],
            ])->all());

            $this->createTranscription($witness, $scholar, $entries, $tagNames, $layer);
        }
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
            'type' => WitnessType::Manuscript,
            'siglum' => 'B',
            'label' => 'Codex Clarkianus',
        ]);

        $manuscript = Manuscript::create([
            'witness_id' => $witness->id,
            'repository' => 'Bodleian Library',
            'shelfmark' => 'MS. E. D. Clarke 39',
            'date_text' => 'AD 895',
            'notes' => 'Copied for Arethas of Patras; the primary witness for much of the Platonic corpus.',
        ]);

        ManuscriptImage::create([
            'manuscript_id' => $manuscript->id,
            'folio_label' => '1r',
            'path' => $this->placeholderImage($manuscript->shelfmark, '1r'),
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
        $this->createTranscription($witness, $scholar, $entries, ['normalized'], TranscriptionLayer::Normalized);
    }

    /**
     * Join entries into one continuous text (a blank line between entries
     * flagged `paragraphBreakBefore`), then record each entry as a citation
     * span over that text — mirroring how a real transcription is built up:
     * one continuous document, annotated with spans afterward.
     *
     * @param  list<array{text: string, passage: CanonicalPassage, paragraphBreakBefore?: bool}>  $entries
     * @param  list<string>  $tagNames
     */
    private function createTranscription(Witness $witness, User $scholar, array $entries, array $tagNames, TranscriptionLayer $layer): Transcription
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

        $transcription = Transcription::create([
            'witness_id' => $witness->id,
            'user_id' => $scholar->id,
            'layer' => $layer,
            'text' => $text,
            'visibility' => Visibility::Published,
        ]);

        foreach ($spans as $span) {
            $transcription->segments()->create([
                'canonical_passage_id' => $span['passage']->id,
                'start_offset' => $span['start'],
                'end_offset' => $span['end'],
            ]);
        }

        $transcription->tags()->attach(
            collect($tagNames)->map(fn (string $name) => Tag::firstOrCreate(['name' => $name])->id),
        );

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
