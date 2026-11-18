<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Core\Support\Money;
use App\Domain\Forfeit\Models\ForfeitPromise;
use App\Domain\Customers\Services\CustomerExposure;
use App\Domain\Pawning\Calculation\CycleDates;
use App\Domain\Pawning\Calculation\InterestTerms;
use App\Domain\Pawning\Calculation\RenewalCalculator;
use App\Domain\Pawning\Calculation\SchemeSelector;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTicketEvent;
use App\Domain\Pawning\Models\PawnTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Renewal (old "repawning"): re-value the articles at today's rates,
 * capitalise everything owed, optionally pay out extra cash, and start a new
 * cycle (next day) with the scheme for the new amount. Not allowed on blocked tickets.
 */
class RenewalService extends TicketActionSupport
{
    public function quote(PawnTicket $ticket, string $extraCash = '0', string $discount = '0', int $months = 1): array
    {
        $this->assertOpen($ticket, false);
        $ticket->loadMissing('items');
        $s = $this->calculator->statement($ticket);
        $stamp = $this->calculator->stampDuty($ticket);

        $valuation = app(ItemValuer::class)->value($ticket->items->map(fn ($i) => [
            'category_id' => $i->category_id, 'karat_id' => $i->karat_id,
            'gross_weight' => (string) $i->gross_weight, 'net_weight' => (string) $i->net_weight,
        ])->all());

        $newPrincipal = RenewalCalculator::newPrincipal($s->principal, $extraCash, $s->interest, $s->serviceCharge, $s->letterCharge, $stamp, $discount);
        $silver = $ticket->isSilver();
        $version = app(SchemeSelector::class)->forLoan($newPrincipal, $silver);
        $terms = InterestTerms::fromVersion($version, $version->scheme->interest_method);
        $validMonths = $silver ? 1 : $version->max_term_months;

        $preview = RenewalCalculator::preview(
            $valuation['assessed_value'], $s->principal, $s->interest, $s->serviceCharge,
            $s->letterCharge, $stamp, $terms->monthlyRate(), $validMonths,
        );

        return [
            'statement' => $s->toArray(),
            'stamp_duty' => Money::of($stamp),
            'preview' => $preview,
            'new_principal' => $newPrincipal,
            'new_scheme' => $version->scheme->code,
            'new_cycle_start' => CycleDates::cycleStartAfterPartPayment(today())->toDateString(),
            'new_maturity' => CycleDates::maturity(today(), $months, $silver, $terms->validDays)->toDateString(),
            '_version' => $version,
            '_valuation' => $valuation,
        ];
    }

    public function renew(int $ticketId, string $extraCash, string $discount, int $months, ?string $remarks = null): PawnTransaction
    {
        return DB::transaction(function () use ($ticketId, $extraCash, $discount, $months, $remarks) {
            $ticket = $this->lock($ticketId, false);
            $extraCash = Money::of($extraCash);
            $discount = Money::of($discount);
            $this->assertDiscountAllowed($discount);
            if (Money::isNegative($extraCash)) {
                throw ValidationException::withMessages(['extra_cash' => 'Extra cash cannot be negative.']);
            }

            $q = $this->quote($ticket, $extraCash, $discount, $months);
            $s = $q['statement'];
            $p = $q['preview'];
            $version = $q['_version'];

            if ($months < 1 || $months > $p['valid_months']) {
                throw ValidationException::withMessages(['months' => "Term must be 1 to {$p['valid_months']} month(s)."]);
            }
            $limit = $p['month_options'][$months];
            if (Money::compare($extraCash, Money::max($limit, 0)) > 0) {
                throw ValidationException::withMessages([
                    'extra_cash' => 'For '.$months.' month(s) the articles cover at most Rs. '.number_format(max(0, (float) $limit), 2).' extra.',
                ]);
            }
            if (Money::isNegative($limit)) {
                throw ValidationException::withMessages(['months' => 'The articles no longer cover the amount owed for this term. Take a part payment or redeem.']);
            }
            $charges = Money::add($s['interest'], $s['service_charge'], $s['letter_charge'], $q['stamp_duty']);
            if (Money::compare($discount, $charges) > 0) {
                throw ValidationException::withMessages(['discount' => 'Discount cannot be more than the interest and charges.']);
            }

            app(CustomerExposure::class)->assertCanBorrow($ticket->customer, Money::sub($q['new_principal'], $s['principal']), 0);

            $added = Money::sub($q['new_principal'], $s['principal']);
            $txn = $this->newTransaction($ticket, PawnTransaction::RENEWAL, [
                'interest_days' => $s['days'],
                'principal_before' => $s['principal'],
                'interest_due' => $s['interest'],
                'interest_capitalised' => $s['interest'],
                'service_charge' => $s['service_charge'],
                'postage_charge' => $s['letter_charge'],
                'stamp_duty' => $q['stamp_duty'],
                'discount' => $discount,
                'principal_added' => $added,
                'principal_after' => $q['new_principal'],
                'cash_paid' => $extraCash,
                'new_maturity_date' => $q['new_maturity'],
                'new_scheme_version_id' => $version->id,
                'remarks' => $remarks,
            ]);

            // Debits = capital added + discount; credits = cash + interest + charges.
            $this->post($txn, $ticket, [
                $this->dr($ticket, 'pawn_loans_receivable', $added, 'Renewal: amount added to capital'),
                $this->dr($ticket, 'discount_allowed', $discount, 'Discount on renewal'),
                $this->cr($ticket, 'cash', $extraCash, 'Extra cash paid on renewal'),
                $this->cr($ticket, 'interest_income', $s['interest'], "Interest {$s['days']} days"),
                $this->cr($ticket, 'service_charge_income', $s['service_charge'], 'Service charge'),
                $this->cr($ticket, 'postage_income', $s['letter_charge'], 'Letter postage'),
                $this->cr($ticket, 'stamp_duty_payable', $q['stamp_duty'], 'Stamp duty'),
            ], "Renewal {$txn->txn_no} on {$ticket->receipt_no}");

            // Re-value articles at today's rates.
            foreach ($ticket->items as $idx => $item) {
                $v = $q['_valuation']['items'][$idx];
                $item->update(['karat_rate_per_8g' => $v['karat_rate_per_8g'], 'assessed_value' => $v['assessed_value'], 'market_value' => $v['market_value']]);
            }

            $ticket->update([
                'principal_current' => $q['new_principal'],
                'interest_paid_cycle' => 0,
                'interest_carried' => 0,
                'cycle_start_date' => $q['new_cycle_start'],
                'maturity_date' => $q['new_maturity'],
                'valid_months' => $months,
                'assessed_value' => $q['_valuation']['assessed_value'],
                'market_value' => $q['_valuation']['market_value'],
                'scheme_id' => $version->scheme_id,
                'scheme_version_id' => $version->id,
                'monthly_interest_rate' => InterestTerms::fromVersion($version, $version->scheme->interest_method)->monthlyRate(),
                'arrears_stage' => 'none',
                'letter_cycle' => $ticket->letter_cycle + 1,
                'forfeit_queued_at' => null,
                'updated_by' => auth()->id(),
            ]);

            ForfeitPromise::markKept($ticket);
            PawnTicketEvent::record($ticket, 'renewed', "Renewal {$txn->txn_no}", $extraCash,
                ['new_principal' => $q['new_principal'], 'maturity' => $q['new_maturity'], 'scheme' => $version->scheme->code]);

            return $txn;
        });
    }
}
