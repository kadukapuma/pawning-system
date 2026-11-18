<?php

namespace App\Domain\Arrears\Services;

use App\Domain\Pawning\Calculation\ArrearsSchedule;
use App\Domain\Pawning\Models\ArrearsLetter;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTicketEvent;
use App\Domain\Pawning\Services\TicketCalculator;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Arrears letters 1–3 (old RedeemLateLettersController / ArrearsLetterService).
 * Letters belong to the ticket's current cycle; a part payment or renewal
 * starts a new cycle, so old letters never count again.
 * Printing a letter is a POST that records it once — the unique key
 * (ticket, cycle, letter) guarantees postage is charged only once.
 */
class ArrearsService
{
    public function __construct(private TicketCalculator $calculator) {}

    /**
     * Where a ticket is in its letter schedule.
     *
     * @return array{printed: array<int,string>, next_letter: ?int, next_due: ?string, eligible: bool,
     *               reminder_due_date: ?string, reminder_due: bool, intervals: array}
     */
    public function schedule(PawnTicket $t, ?CarbonImmutable $today = null): array
    {
        $today ??= CarbonImmutable::today();
        $v = $this->calculator->chargesVersion($t, $today);
        $printed = $this->printed($t);
        $intervals = [2 => (int) $v->letter_2_days, 3 => (int) $v->letter_3_days];
        $next = collect([1, 2, 3])->first(fn ($n) => empty($printed[$n]));

        $due = $next ? ArrearsSchedule::dueDate($next, $t->maturity_date, $printed, $intervals) : null;
        $reminderDate = ArrearsSchedule::reminderDueDate($printed[3] ?? null, (int) $v->forfeit_reminder_days);

        return [
            'printed' => $printed,
            'next_letter' => $next,
            'next_due' => $due?->toDateString(),
            'eligible' => $next !== null && ArrearsSchedule::isEligible($next, $t->maturity_date, $printed, $intervals, $today),
            'reminder_due_date' => $reminderDate?->toDateString(),
            'reminder_due' => ArrearsSchedule::reminderIsDue(
                $printed[3] ?? null, (int) $v->forfeit_reminder_days, $t->maturity_date, $t->cycle_start_date, null, $today,
            ),
            'intervals' => $intervals,
        ];
    }

    /** @return array<int, string> letter_no => print date (current cycle) */
    public function printed(PawnTicket $t): array
    {
        $letters = $t->relationLoaded('letters')
            ? $t->letters
            : ArrearsLetter::withoutBranchScope()->where('pawn_ticket_id', $t->id)->get();

        return $letters->where('cycle_no', $t->letter_cycle)
            ->mapWithKeys(fn ($l) => [$l->letter_no => $l->issued_at->toDateString()])->all();
    }

    /** Active, matured tickets in the working branch that are due letter $letterNo today. */
    public function due(int $letterNo, ?CarbonImmutable $today = null): Collection
    {
        $today ??= CarbonImmutable::today();

        return PawnTicket::active()
            ->with(['customer', 'scheme', 'schemeVersion', 'letters'])
            ->where('maturity_date', '<=', $today)
            ->whereNull('forfeit_queued_at')
            ->orderBy('maturity_date')
            ->get()
            ->map(fn (PawnTicket $t) => ['ticket' => $t, 'schedule' => $this->schedule($t, $today)])
            ->filter(fn ($r) => $r['schedule']['eligible'] && $r['schedule']['next_letter'] === $letterNo)
            ->values();
    }

    /**
     * Issue letter $letterNo for each ticket. Already-issued letters are
     * returned as they are (safe to retry); ineligible tickets are skipped.
     *
     * @param  list<int>  $ticketIds
     * @return array{letters: list<ArrearsLetter>, skipped: list<array{ticket_id:int, receipt_no:?string, reason:string}>}
     */
    public function issue(array $ticketIds, int $letterNo): array
    {
        $letters = [];
        $skipped = [];

        foreach (array_unique($ticketIds) as $id) {
            DB::transaction(function () use ($id, $letterNo, &$letters, &$skipped) {
                $t = PawnTicket::with(['scheme', 'schemeVersion', 'letters'])->lockForUpdate()->find($id);
                if (! $t) {
                    $skipped[] = ['ticket_id' => $id, 'receipt_no' => null, 'reason' => 'Ticket not found in this branch.'];

                    return;
                }

                $existing = $t->letters->first(fn ($l) => $l->cycle_no === $t->letter_cycle && $l->letter_no === $letterNo);
                if ($existing) {
                    $letters[] = $existing;

                    return;
                }
                if (! $t->isActive()) {
                    $skipped[] = ['ticket_id' => $id, 'receipt_no' => $t->receipt_no, 'reason' => "Ticket is {$t->status}."];

                    return;
                }

                $schedule = $this->schedule($t);
                if (! $schedule['eligible'] || $schedule['next_letter'] !== $letterNo) {
                    $skipped[] = ['ticket_id' => $id, 'receipt_no' => $t->receipt_no,
                        'reason' => $schedule['next_due'] ? "Letter {$letterNo} is not due (next letter {$schedule['next_letter']} due {$schedule['next_due']})." : 'All letters already issued.'];

                    return;
                }

                $version = $this->calculator->chargesVersion($t);
                $letter = ArrearsLetter::create([
                    'pawn_ticket_id' => $t->id,
                    'branch_id' => $t->branch_id,
                    'cycle_no' => $t->letter_cycle,
                    'letter_no' => $letterNo,
                    'due_date' => $schedule['next_due'],
                    'issued_at' => now(),
                    'postage_charge' => $version->postage_charge,
                    'service_charge' => $letterNo === 1 ? $version->service_charge : 0,
                    'issued_by' => auth()->id(),
                ]);
                $t->update(['arrears_stage' => "letter_{$letterNo}"]);
                PawnTicketEvent::record($t, "letter_{$letterNo}_issued", "Arrears letter {$letterNo} issued", (string) $version->postage_charge,
                    ['cycle' => $t->letter_cycle, 'due_date' => $schedule['next_due']]);

                $letters[] = $letter;
            });
        }

        return ['letters' => $letters, 'skipped' => $skipped];
    }

    /** Data for printing letters (and counting reprints of ones printed before). */
    public function printData(array $letterIds, bool $countReprint): Collection
    {
        $letters = ArrearsLetter::with(['ticket.customer', 'ticket.branch', 'ticket.scheme', 'ticket.schemeVersion', 'ticket.letters'])
            ->whereIn('id', $letterIds)->orderBy('id')->get();

        if ($countReprint) {
            ArrearsLetter::whereIn('id', $letters->pluck('id'))->update([
                'reprint_count' => DB::raw('reprint_count + 1'), 'last_reprinted_at' => now(),
            ]);
        }

        return $letters->map(function (ArrearsLetter $l) {
            $s = $this->calculator->statement($l->ticket);

            return [
                'id' => $l->id,
                'letter_no' => $l->letter_no,
                'issued_at' => $l->issued_at->toDateString(),
                'ticket' => [
                    'receipt_no' => $l->ticket->receipt_no,
                    'stock_no' => $l->ticket->stock_no,
                    'pawn_date' => $l->ticket->pawn_date->toDateString(),
                    'maturity_date' => $l->ticket->maturity_date->toDateString(),
                ],
                'branch' => ['code' => $l->ticket->branch->code, 'name' => $l->ticket->branch->name,
                    'address' => $l->ticket->branch->address, 'phone' => $l->ticket->branch->phone],
                'customer' => [
                    'name' => trim(($l->ticket->customer->title ? $l->ticket->customer->title.' ' : '').$l->ticket->customer->full_name),
                    'address' => array_values(array_filter([$l->ticket->customer->address_line1, $l->ticket->customer->address_line2, $l->ticket->customer->city])),
                ],
                'capital' => $s->principal,
                'interest' => $s->interest,
                'service_charge' => $s->serviceCharge,
                'letter_charge' => $s->letterCharge,
                'arrears' => $s->arrearsTotal,
                'total' => $s->redemptionTotal,
            ];
        });
    }
}
