<?php

namespace App\Domain\Sms\Services;

use App\Domain\Core\Support\BranchContext;
use App\Domain\Customers\Models\Customer;
use App\Domain\Forfeit\Models\ForfeitPromise;
use App\Domain\Forfeit\Services\ForfeitService;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Services\TicketCalculator;
use App\Domain\Sms\Enums\SmsType;
use App\Domain\Sms\Models\SmsRule;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Who is due a reminder today. Inside a request this covers the working
 * branch; from the scheduler (no branch selected) it covers every branch.
 * Each candidate carries a key so the same reminder is never sent twice.
 */
class ReminderFinder
{
    /** A reminder missed because the server was off is still sent this many days late. */
    public const CATCH_UP_DAYS = 3;

    public function __construct(
        private TicketCalculator $calculator,
        private ForfeitService $forfeit,
        private SmsValues $values,
        private BranchContext $branch,
    ) {}

    /** @return Collection<int, SmsCandidate> */
    public function find(SmsRule $rule, ?CarbonImmutable $today = null): Collection
    {
        $today ??= CarbonImmutable::today();
        $type = SmsType::from($rule->type);

        return match ($type) {
            SmsType::Birthday => $this->birthdays($today),
            SmsType::DueReminder => $this->due($rule->days(), $today),
            SmsType::ArrearsReminder => $this->arrears($rule->days(), $today),
            SmsType::ForfeitWarning => $this->forfeitWarnings($today),
            SmsType::PromiseReminder => $this->promises($rule->days(), $today),
            default => throw new \InvalidArgumentException("{$type->value} is not a reminder."),
        };
    }

    private function birthdays(CarbonImmutable $today): Collection
    {
        // People born on 29 February are greeted on the 28th in other years.
        $days = [$today->day];
        if ($today->month === 2 && $today->day === 28 && ! $today->isLeapYear()) {
            $days[] = 29;
        }

        return Customer::query()
            ->with('branch')
            ->where('status', Customer::STATUS_ACTIVE)
            ->whereNotNull('date_of_birth')
            ->whereMonth('date_of_birth', $today->month)
            ->where(fn ($q) => collect($days)->each(fn ($d) => $q->orWhereDay('date_of_birth', $d)))
            // Customers are shared between branches, so limit to where they registered.
            ->when($this->branch->id(), fn ($q, $id) => $q->where('branch_id', $id))
            ->orderBy('first_name')
            ->get()
            ->map(fn (Customer $c) => new SmsCandidate(
                SmsType::Birthday, "birthday:{$c->id}:{$today->year}", $c, $c->branch_id,
                $this->values->for($c, $c->branch),
            ));
    }

    /** @param  list<int>  $offsets  days before maturity */
    private function due(array $offsets, CarbonImmutable $today): Collection
    {
        if ($offsets === []) {
            return collect();
        }
        sort($offsets);

        return $this->tickets()
            ->whereBetween('maturity_date', [$today->toDateString(), $today->addDays(max($offsets))->toDateString()])
            ->get()
            ->map(function (PawnTicket $t) use ($offsets, $today) {
                $left = (int) $today->diffInDays($t->maturity_date);
                $offset = collect($offsets)->first(fn (int $o) => $o >= $left);

                return $offset === null || $offset - $left > self::CATCH_UP_DAYS ? null
                    : $this->forTicket(SmsType::DueReminder, "due:{$t->id}:{$t->maturity_date->toDateString()}:{$offset}", $t, $today, ['days_left' => $left]);
            })
            ->filter()->values();
    }

    /** @param  list<int>  $offsets  days after maturity */
    private function arrears(array $offsets, CarbonImmutable $today): Collection
    {
        if ($offsets === []) {
            return collect();
        }
        rsort($offsets);

        return $this->tickets()
            ->whereNull('forfeit_queued_at')
            ->whereBetween('maturity_date', [
                $today->subDays(max($offsets) + self::CATCH_UP_DAYS)->toDateString(),
                $today->subDays(min($offsets))->toDateString(),
            ])
            ->get()
            ->map(function (PawnTicket $t) use ($offsets, $today) {
                $overdue = (int) $t->maturity_date->diffInDays($today);
                $offset = collect($offsets)->first(fn (int $o) => $o <= $overdue);

                return $offset === null || $overdue - $offset > self::CATCH_UP_DAYS ? null
                    : $this->forTicket(SmsType::ArrearsReminder, "arrears:{$t->id}:{$t->maturity_date->toDateString()}:{$offset}", $t, $today, ['days_overdue' => $overdue]);
            })
            ->filter()->values();
    }

    /** The forfeit reminder list, leaving out customers whose promise date has not passed. */
    private function forfeitWarnings(CarbonImmutable $today): Collection
    {
        return $this->forfeit->reminders($today)
            ->reject(fn (array $r) => $r['promise']
                && $r['promise']->status === ForfeitPromise::PENDING
                && $r['promise']->promise_date->gte($today))
            ->map(function (array $r) use ($today) {
                /** @var PawnTicket $t */
                $t = $r['ticket']->loadMissing('branch');

                return $this->forTicket(SmsType::ForfeitWarning, "forfeit:{$t->id}:{$t->letter_cycle}", $t, $today,
                    ['days_overdue' => (int) $t->maturity_date->diffInDays($today)]);
            })
            ->values();
    }

    /** @param  list<int>  $offsets  days before the promised date */
    private function promises(array $offsets, CarbonImmutable $today): Collection
    {
        if ($offsets === []) {
            return collect();
        }
        sort($offsets);
        $tickets = $this->tickets()
            ->whereNull('forfeit_queued_at')
            ->whereIn('id', ForfeitPromise::where('status', ForfeitPromise::PENDING)
                ->whereBetween('promise_date', [$today->toDateString(), $today->addDays(max($offsets))->toDateString()])
                ->select('pawn_ticket_id'))
            ->get();

        return $tickets->map(function (PawnTicket $t) use ($offsets, $today) {
            $promise = $this->forfeit->currentPromise($t);
            if (! $promise || $promise->status !== ForfeitPromise::PENDING || $promise->promise_date->lt($today)) {
                return null;
            }
            $left = (int) $today->diffInDays($promise->promise_date);
            $offset = collect($offsets)->first(fn (int $o) => $o >= $left);

            return $offset === null || $offset - $left > self::CATCH_UP_DAYS ? null
                : $this->forTicket(SmsType::PromiseReminder, "promise:{$promise->id}:{$offset}", $t, $today,
                    ['promise_date' => $promise->promise_date->toDateString()]);
        })->filter()->values();
    }

    private function tickets()
    {
        return PawnTicket::active()
            ->with(['customer', 'branch', 'scheme', 'schemeVersion', 'letters'])
            ->whereHas('customer')
            ->orderBy('maturity_date')
            ->orderBy('id');
    }

    private function forTicket(SmsType $type, string $key, PawnTicket $t, CarbonImmutable $today, array $extra): SmsCandidate
    {
        $s = $this->calculator->statement($t, $today);

        return new SmsCandidate($type, $key, $t->customer, $t->branch_id, $extra + $this->values->for($t->customer, $t->branch) + [
            'receipt_no' => $t->receipt_no,
            'date' => $today->toDateString(),
            'maturity_date' => $t->maturity_date->toDateString(),
            'capital' => SmsValues::money($s->principal),
            'interest' => SmsValues::money($s->interest),
            'arrears' => SmsValues::money($s->arrearsTotal),
            'total_due' => SmsValues::money($s->redemptionTotal),
        ], $t);
    }
}
