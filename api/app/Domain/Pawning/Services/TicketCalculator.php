<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Masters\Models\PawnSchemeVersion;
use App\Domain\Pawning\Calculation\InterestTerms;
use App\Domain\Pawning\Calculation\SchemeSelector;
use App\Domain\Pawning\Calculation\TicketStatement;
use App\Domain\Pawning\Models\ArrearsLetter;
use App\Domain\Pawning\Models\PawnTicket;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Feeds a ticket from the database into the pure calculation engine.
 * - Interest terms: the ticket's frozen scheme version.
 * - Service charge, stamp duty, postage: the scheme version in force on the
 *   date (old "forward terms"), falling back to the ticket's version.
 * - Letter postage: letters actually issued in the ticket's current cycle.
 */
class TicketCalculator
{
    public function __construct(private SchemeSelector $selector) {}

    public function terms(PawnTicket $t): InterestTerms
    {
        $t->loadMissing(['schemeVersion', 'scheme']);

        return InterestTerms::fromVersion($t->schemeVersion, $t->scheme->interest_method);
    }

    /** Version whose non-interest terms apply on $date. */
    public function chargesVersion(PawnTicket $t, CarbonInterface|string|null $date = null): PawnSchemeVersion
    {
        $date = CarbonImmutable::parse($date ?? today())->toDateString();
        $key = $t->scheme_id.'|'.$date;

        // Memoised per request: letter queues calculate hundreds of tickets.
        if (! array_key_exists($key, $this->versionCache)) {
            $this->versionCache[$key] = $this->selector->versionOn($t->scheme_id, $date);
        }

        return $this->versionCache[$key] ?? $t->schemeVersion;
    }

    /** @var array<string, ?PawnSchemeVersion> */
    private array $versionCache = [];

    /** @return array<int, string> letter_no => postage for the current cycle */
    public function letterCharges(PawnTicket $t): array
    {
        if ($t->relationLoaded('letters')) {
            return $t->letters->where('cycle_no', $t->letter_cycle)
                ->mapWithKeys(fn ($l) => [$l->letter_no => (string) $l->postage_charge])->all();
        }

        return ArrearsLetter::withoutBranchScope()
            ->where('pawn_ticket_id', $t->id)
            ->where('cycle_no', $t->letter_cycle)
            ->pluck('postage_charge', 'letter_no')
            ->map(fn ($v) => (string) $v)
            ->all();
    }

    public function statement(PawnTicket $t, CarbonInterface|string|null $asOf = null): TicketStatement
    {
        $asOf = CarbonImmutable::parse($asOf ?? today())->startOfDay();

        return TicketStatement::calculate(
            principal: (string) $t->principal_current,
            cycleStart: $t->cycle_start_date,
            asOf: $asOf,
            terms: $this->terms($t),
            interestPaidThisCycle: (string) $t->interest_paid_cycle,
            carriedInterest: (string) $t->interest_carried,
            serviceCharge: (string) $this->chargesVersion($t, $asOf)->service_charge,
            letterCharges: $this->letterCharges($t),
        );
    }

    public function stampDuty(PawnTicket $t, CarbonInterface|string|null $date = null): string
    {
        return (string) $this->chargesVersion($t, $date)->stamp_duty;
    }
}
