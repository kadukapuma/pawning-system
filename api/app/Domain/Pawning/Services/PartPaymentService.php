<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Core\Support\Money;
use App\Domain\Forfeit\Models\ForfeitPromise;
use App\Domain\Pawning\Calculation\CycleDates;
use App\Domain\Pawning\Calculation\InterestTerms;
use App\Domain\Pawning\Calculation\PartPaymentAllocation;
use App\Domain\Pawning\Calculation\SchemeSelector;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTicketEvent;
use App\Domain\Pawning\Models\PawnTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Part payment: settles interest and letter postage, reduces capital with the
 * rest, starts a new interest cycle the next day and resets the arrears stage.
 * Allowed on blocked tickets (old changelog).
 */
class PartPaymentService extends TicketActionSupport
{
    public function quote(PawnTicket $ticket, string $amount, string $discount = '0', int $months = 1): array
    {
        $this->assertOpen($ticket, true);
        $statement = $this->calculator->statement($ticket);
        $allocation = PartPaymentAllocation::calculate(
            principal: $statement->principal,
            interest: $statement->interest,
            serviceCharge: 0,                 // no service charge on part payments
            letterCharge: $statement->letterCharge,
            stampDuty: 0,
            payment: $amount,
            discount: $discount,
        );

        $silver = $ticket->isSilver();
        $newVersion = Money::isPositive($allocation->newPrincipal)
            ? app(SchemeSelector::class)->forLoan($allocation->newPrincipal, $silver)
            : $ticket->schemeVersion;
        $terms = InterestTerms::fromVersion($newVersion, $newVersion->scheme->interest_method);

        return [
            'statement' => $statement->toArray(),
            'allocation' => $allocation->toArray(),
            'new_scheme' => $newVersion->scheme->code,
            'new_cycle_start' => CycleDates::cycleStartAfterPartPayment(today())->toDateString(),
            'new_maturity' => CycleDates::maturity(today(), $months, $silver, $terms->validDays)->toDateString(),
            'min_capital' => (string) $newVersion->min_capital_after_part_payment,
            '_allocation' => $allocation,
            '_version' => $newVersion,
        ];
    }

    public function pay(int $ticketId, string $amount, string $discount, int $months, ?string $remarks = null): PawnTransaction
    {
        return DB::transaction(function () use ($ticketId, $amount, $discount, $months, $remarks) {
            $ticket = $this->lock($ticketId, true);
            $discount = Money::of($discount);
            $this->assertDiscountAllowed($discount);
            if (! Money::isPositive($amount)) {
                throw ValidationException::withMessages(['amount' => 'Enter the amount paid.']);
            }

            $q = $this->quote($ticket, $amount, $discount, $months);
            /** @var PartPaymentAllocation $a */
            $a = $q['_allocation'];
            $a->assertAllowed($q['min_capital']);
            $s = $q['statement'];
            $version = $q['_version'];
            if ($months < 1 || $months > $version->max_term_months) {
                throw ValidationException::withMessages(['months' => "Term must be 1 to {$version->max_term_months} months."]);
            }
            if (Money::compare($discount, Money::add($s['interest'], $s['letter_charge'])) > 0) {
                throw ValidationException::withMessages(['discount' => 'Discount cannot be more than the interest and postage due.']);
            }

            $txn = $this->newTransaction($ticket, PawnTransaction::PART_PAYMENT, [
                'interest_days' => $s['days'],
                'principal_before' => $s['principal'],
                'interest_due' => $s['interest'],
                'interest_paid' => $a->paidInterest,
                'interest_capitalised' => $a->capitalisedInterest,
                'postage_charge' => $s['letter_charge'],
                'discount' => $discount,
                'principal_paid' => $a->principalPaid,
                'principal_added' => Money::add($a->capitalisedInterest, $a->capitalisedCharges),
                'principal_after' => $a->newPrincipal,
                'cash_received' => $a->paymentReceived,
                'new_maturity_date' => $q['new_maturity'],
                'new_scheme_version_id' => $version->id,
                'remarks' => $remarks,
            ]);

            // Debits = cash + discount + capitalised amounts; credits = interest + postage + capital repaid.
            $this->post($txn, $ticket, [
                $this->dr($ticket, 'cash', $a->paymentReceived, 'Part payment received'),
                $this->dr($ticket, 'discount_allowed', $discount, 'Discount on part payment'),
                $this->dr($ticket, 'pawn_loans_receivable', Money::add($a->capitalisedInterest, $a->capitalisedCharges), 'Unpaid interest/charges added to capital'),
                $this->cr($ticket, 'interest_income', $s['interest'], "Interest {$s['days']} days"),
                $this->cr($ticket, 'postage_income', $s['letter_charge'], 'Letter postage'),
                $this->cr($ticket, 'pawn_loans_receivable', $a->principalPaid, 'Capital repaid'),
            ], "Part payment {$txn->txn_no} on {$ticket->receipt_no}");

            $lettersIssued = Money::isPositive($s['letter_charge']) || $ticket->arrears_stage !== 'none';
            $ticket->update([
                'principal_current' => $a->newPrincipal,
                'interest_paid_cycle' => 0,
                'interest_carried' => 0,
                'cycle_start_date' => $q['new_cycle_start'],
                'maturity_date' => $q['new_maturity'],
                'valid_months' => $months,
                'scheme_id' => $version->scheme_id,
                'scheme_version_id' => $version->id,
                'monthly_interest_rate' => InterestTerms::fromVersion($version, $version->scheme->interest_method)->monthlyRate(),
                'arrears_stage' => 'none',
                'letter_cycle' => $lettersIssued ? $ticket->letter_cycle + 1 : $ticket->letter_cycle,
                'forfeit_queued_at' => null,
                'updated_by' => auth()->id(),
            ]);

            ForfeitPromise::markKept($ticket);
            PawnTicketEvent::record($ticket, 'part_payment', "Part payment {$txn->txn_no}", $a->paymentReceived,
                ['new_principal' => $a->newPrincipal, 'maturity' => $q['new_maturity']]);

            return $txn;
        });
    }
}
