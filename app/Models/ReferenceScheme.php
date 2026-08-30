<?php

namespace App\Models;

use Database\Factories\ReferenceSchemeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property string $name
 * @property array<int, array{key: string, label: string, type: string, separator?: string}> $levels
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'levels'])]
class ReferenceScheme extends Model
{
    /** @use HasFactory<ReferenceSchemeFactory> */
    use HasFactory;

    /**
     * @return HasMany<Work, $this>
     */
    public function works(): HasMany
    {
        return $this->hasMany(Work::class);
    }

    /**
     * Compute the sortable key and display label for an address under this scheme.
     *
     * @param  array<string, int|string>  $address
     * @return array{sort_key: string, label: string}
     */
    public function format(array $address): array
    {
        $sortParts = [];
        $labelParts = [];

        foreach ($this->levels as $index => $level) {
            $value = $address[$level['key']] ?? null;

            if ($value === null) {
                continue;
            }

            // Case is kept as typed (not lowercased): by convention, an uppercase
            // suffix marks a part of the preceding unit (e.g. "45A"/"45B" for a
            // line split between speakers) while a lowercase suffix marks a new
            // unit inserted between two numbered ones (e.g. a conjectured line
            // "45a" between 45 and 46). ASCII orders space < 'A'..'Z' < 'a'..'z',
            // so plain padding alone sorts unsuffixed < uppercase < lowercase.
            $sortParts[] = match ($level['type']) {
                'integer' => self::padIntegerLevel((string) $value),
                default => str_pad((string) $value, 8, ' ', STR_PAD_RIGHT),
            };

            $separator = $index === 0 ? '' : ($level['separator'] ?? '.');
            $labelParts[] = $separator.$value;
        }

        return [
            'sort_key' => implode('.', $sortParts),
            'label' => implode('', $labelParts),
        ];
    }

    /**
     * Pad the leading digit run of an "integer" level's value so it sorts
     * numerically, leaving any alphabetic suffix (e.g. the "a"/"A" in "4a")
     * appended literally — editors are free to cite a segment like "4a"
     * even though the level is typed "integer".
     */
    private static function padIntegerLevel(string $value): string
    {
        preg_match('/^(\d*)(.*)$/u', $value, $matches);

        return str_pad($matches[1] ?? '', 8, '0', STR_PAD_LEFT).($matches[2] ?? '');
    }

    /**
     * Parse a citation label back into an address, given this scheme's levels.
     * Inverse of format() — only reliable for labels this scheme would itself produce.
     *
     * @return array<string, int|string>|null null if the label doesn't match the scheme
     */
    public function parseLabel(string $label): ?array
    {
        $pattern = '';

        foreach ($this->levels as $index => $level) {
            $separator = $index === 0 ? '' : ($level['separator'] ?? '.');
            $pattern .= preg_quote($separator, '/');
            $pattern .= $level['type'] === 'integer' ? '(\d+[A-Za-z]*)' : '([^\d]+)';
        }

        if (! preg_match('/^'.$pattern.'$/u', $label, $matches)) {
            return null;
        }

        $address = [];

        foreach ($this->levels as $index => $level) {
            $value = $matches[$index + 1];
            $address[$level['key']] = $level['type'] === 'integer' && ctype_digit($value) ? (int) $value : $value;
        }

        return $address;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'levels' => 'array',
        ];
    }
}
