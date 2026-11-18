<?php

namespace App\Domain\Core\Concerns;

use App\Domain\Core\Models\AuditLog;
use App\Domain\Core\Support\BranchContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Arr;

/**
 * Writes created / updated / deleted rows to audit_logs.
 * Models can list extra fields to hide via `protected array $auditExclude`.
 */
trait Auditable
{
    private const AUDIT_ALWAYS_EXCLUDED = ['password', 'remember_token', 'updated_at', 'created_at'];

    public static function bootAuditable(): void
    {
        static::created(fn (Model $m) => $m->writeAudit('created', [], $m->getAttributes()));

        static::updated(function (Model $m) {
            $changes = $m->getChanges();
            if (Arr::except($changes, array_merge(self::AUDIT_ALWAYS_EXCLUDED, $m->auditExclude ?? [])) === []) {
                return;
            }
            $m->writeAudit('updated', Arr::only($m->getOriginal(), array_keys($changes)), $changes);
        });

        static::deleted(fn (Model $m) => $m->writeAudit('deleted', $m->getOriginal(), []));
    }

    /** Record a domain event (blocked, approved, ...) against this model. */
    public function writeAudit(string $event, array $old = [], array $new = []): void
    {
        $exclude = array_merge(self::AUDIT_ALWAYS_EXCLUDED, $this->auditExclude ?? []);
        $request = app()->runningInConsole() ? null : request();

        AuditLog::create([
            'user_id' => auth()->id(),
            'branch_id' => $this->getAttribute('branch_id') ?? app(BranchContext::class)->id(),
            'auditable_type' => $this->getMorphClass(),
            'auditable_id' => $this->getKey(),
            'event' => $event,
            'old_values' => Arr::except($old, $exclude) ?: null,
            'new_values' => Arr::except($new, $exclude) ?: null,
            'ip_address' => $request?->ip(),
            'user_agent' => $request ? substr((string) $request->userAgent(), 0, 255) : null,
        ]);
    }
}
