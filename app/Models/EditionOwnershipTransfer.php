<?php

namespace App\Models;

use Database\Factories\EditionOwnershipTransferFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An offer to hand an edition to another member. Ownership moves only when
 * she accepts (`outcome` "accepted"); she may decline, and the offerer or
 * an administrator may withdraw it. `resolved_at` null means the offer is
 * still open — at most one per edition at a time.
 *
 * @property int $id
 * @property int $edition_id
 * @property int $from_user_id
 * @property int $to_user_id
 * @property string|null $outcome
 * @property Carbon|null $resolved_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'from_user_id', 'to_user_id', 'outcome', 'resolved_at'])]
class EditionOwnershipTransfer extends Model
{
    /** @use HasFactory<EditionOwnershipTransferFactory> */
    use HasFactory;

    public const ACCEPTED = 'accepted';

    public const DECLINED = 'declined';

    public const WITHDRAWN = 'withdrawn';

    /**
     * @return BelongsTo<Edition, $this>
     */
    public function edition(): BelongsTo
    {
        return $this->belongsTo(Edition::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function fromUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'from_user_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function toUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'to_user_id');
    }

    public function isOpen(): bool
    {
        return $this->resolved_at === null;
    }

    /**
     * @param  Builder<EditionOwnershipTransfer>  $query
     */
    #[Scope]
    protected function open(Builder $query): void
    {
        $query->whereNull('resolved_at');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'resolved_at' => 'datetime',
        ];
    }
}
