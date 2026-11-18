<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Core\Support\Money;
use App\Domain\Forfeit\Models\ForfeitPromise;
use App\Domain\Pawning\Calculation\RedemptionCalculator;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTicketEvent;
use App\Domain\Pawning\Models\PawnTransaction;
use Illuminate\Support\Facades\DB;

/**
 * Redemption: capital + interest + charges − discount, cash rounding under
 * Rs. 5 booked separately, ticket and articles closed. Not allowed on blocked tickets.
 */
class RedemptionService extends TicketActionSupport
{
    public function quote(PawnTicket $ticket, string $discount = '0'): array
    {
        $this->assertOpen($ticket, false);
        $s = $this->calculator->statement($ticket);

        return [
            'statement' => $s->toArray(),
            'totals' => RedemptionCalculator::totals($s, $this->calculator->stampDuty($ticket), $discount),
        ];
    }

    public function redeem(int $ticketId, string $discount, ?string $cashReceived = null, ?string $remarks = null): PawnTransaction
    {
        return DB::transaction(function () use ($ticketId, $discount, $cashReceived, $remarks) {
            $ticket = $this->lock($ticketId, false);
            $discount = Money::of($discount);
            $this->assertDiscountAllowed($discount);

            $q = $this->quote($ticket, $discount);
            $s = $q['statement'];
            $t = $q['totals'];
            $cash = Money::of($cashReceived ?? $t['payable']);
            $rounding = RedemptionCalculator::roundingAdjustment($t['payable'], $cash);

            $txn = $this->newTransaction($ticket, PawnTransaction::REDEMPTION, [
                'interest_days' => $s['days'],
                'principal_before' => $s['principal'],
                'interest_due' => $s['interest'],
                'interest_paid' => $s['interest'],
                'service_charge' => $s['service_charge'],
                'postage_charge' => $s['letter_charge'],
                'stamp_duty' => $t['stamp_duty'],
                'discount' => $discount,
                'principal_paid' => $s['principal'],
                'principal_after' => 0,
                'cash_received' => $t['payable'],
                'remarks' => $remarks,
            ]);

            $lines = [
                $this->dr($ticket, 'cash', $t['payable'], 'Redemption received'),
                $this->dr($ticket, 'discount_allowed', $discount, 'Discount on redemption'),
                $this->cr($ticket, 'pawn_loans_receivable', $s['principal'], 'Capital repaid'),
                $this->cr($ticket, 'interest_income', $s['interest'], "Interest {$s['days']} days"),
                $this->cr($ticket, 'service_charge_income', $s['service_charge'], 'Service charge'),
                $this->cr($ticket, 'postage_income', $s['letter_charge'], 'Letter postage'),
                $this->cr($ticket, 'stamp_duty_payable', $t['stamp_duty'], 'Stamp duty'),
            ];
            $this->post($txn, $ticket, $lines, "Redemption {$txn->txn_no} of {$ticket->receipt_no}");

            if ($rounding !== null) {
                // Customer paid more (positive) or less (negative) than payable by under Rs. 5.
                $abs = Money::isNegative($rounding) ? Money::sub(0, $rounding) : $rounding;
                $roundTxn = $this->newTransaction($ticket, PawnTransaction::ROUNDING, [
                    'principal_after' => 0,
                    'cash_received' => Money::isPositive($rounding) ? $abs : 0,
                    'discount' => Money::isNegative($rounding) ? $abs : 0,
                    'remarks' => 'Cash rounding on '.$txn->txn_no,
                ]);
                $this->post($roundTxn, $ticket, Money::isPositive($rounding)
                    ? [$this->dr($ticket, 'cash', $abs, 'Cash rounding'), $this->cr($ticket, 'rounding', $abs, 'Cash rounding')]
                    : [$this->dr($ticket, 'rounding', $abs, 'Cash rounding'), $this->cr($ticket, 'cash', $abs, 'Cash rounding')],
                    "Cash rounding {$roundTxn->txn_no}");
            }

            $ticket->update([
                'status' => PawnTicket::STATUS_REDEEMED,
                'principal_current' => 0,
                'interest_paid_cycle' => 0,
                'interest_carried' => 0,
                'redeemed_at' => now(),
                'arrears_stage' => 'none',
                'forfeit_queued_at' => null,
                'updated_by' => auth()->id(),
            ]);
            $ticket->items()->update(['status' => 'redeemed']);

            ForfeitPromise::markKept($ticket);
            PawnTicketEvent::record($ticket, 'redeemed', "Redeemed {$txn->txn_no}", $cash, ['rounding' => $rounding]);

            return $txn;
        });
    }
}
