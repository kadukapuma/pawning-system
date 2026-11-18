<?php

namespace App\Domain\Core\Services;

use App\Domain\Core\Models\DocumentSequence;
use App\Domain\Core\Support\BranchContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Issues document numbers (receipt, ticket, journal, ...) per branch.
 *
 * The counter row is locked with SELECT ... FOR UPDATE. When called inside a
 * larger transaction the lock is held until that transaction commits, so a
 * rolled-back document does not burn a number and two cashiers can never get
 * the same number.
 */
class SequenceService
{
    public function __construct(private BranchContext $context) {}

    public function next(string $docType, ?int $branchId = null): string
    {
        $branchId ??= $this->context->requireId();

        return DB::transaction(function () use ($docType, $branchId) {
            $sequence = DocumentSequence::query()
                ->where('branch_id', $branchId)
                ->where('doc_type', $docType)
                ->lockForUpdate()
                ->first();

            if ($sequence === null) {
                throw new RuntimeException("No document sequence [{$docType}] for branch {$branchId}.");
            }

            $number = $sequence->next_number;
            $sequence->next_number = $number + 1;
            $sequence->save();

            return $sequence->prefix.str_pad((string) $number, $sequence->padding, '0', STR_PAD_LEFT);
        });
    }

    /** Next number without consuming it (for display only — never store this). */
    public function peek(string $docType, ?int $branchId = null): string
    {
        $branchId ??= $this->context->requireId();
        $sequence = DocumentSequence::query()
            ->where('branch_id', $branchId)
            ->where('doc_type', $docType)
            ->firstOrFail();

        return $sequence->prefix.str_pad((string) $sequence->next_number, $sequence->padding, '0', STR_PAD_LEFT);
    }
}
