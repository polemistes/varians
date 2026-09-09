<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Enums\GreekFont;
use App\Enums\Role;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property string $name
 * @property string $email
 * @property Carbon|null $email_verified_at
 * @property string $password
 * @property Role $role
 * @property string|null $remember_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'email', 'password', 'greek_font'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Mirrors the column default, so an unsaved (or not-yet-refreshed)
     * instance reads the same font choice a stored one would.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'greek_font' => 'eb-garamond',
    ];

    /**
     * @return HasMany<Work, $this>
     */
    public function works(): HasMany
    {
        return $this->hasMany(Work::class);
    }

    /**
     * @return HasMany<Witness, $this>
     */
    public function witnesses(): HasMany
    {
        return $this->hasMany(Witness::class);
    }

    /**
     * The editions this member owns.
     *
     * @return HasMany<Edition, $this>
     */
    public function editions(): HasMany
    {
        return $this->hasMany(Edition::class);
    }

    /**
     * The editions other members have invited this one to edit.
     *
     * @return BelongsToMany<Edition, $this>
     */
    public function editableEditions(): BelongsToMany
    {
        return $this->belongsToMany(Edition::class, 'edition_editors')
            ->withPivot('granted_by_id')
            ->withTimestamps();
    }

    /**
     * Offers of editions made to this member — open and settled.
     *
     * @return HasMany<EditionOwnershipTransfer, $this>
     */
    public function ownershipOffers(): HasMany
    {
        return $this->hasMany(EditionOwnershipTransfer::class, 'to_user_id');
    }

    /**
     * Whether this user's role satisfies at least the given minimum level.
     * `role` is deliberately excluded from #[Fillable] — never mass-assignable
     * from user-controlled input — so this is the only place that reads it
     * for authorization decisions.
     */
    public function hasRole(Role $minimum): bool
    {
        return $this->role->atLeast($minimum);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'role' => Role::class,
            'greek_font' => GreekFont::class,
        ];
    }
}
