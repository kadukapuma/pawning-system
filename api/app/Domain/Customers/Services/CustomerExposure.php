<?php

namespace App\Domain\Customers\Services;

use App\Domain\Core\Support\Money;
use App\Domain\Customers\Models\Customer;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A customer's open pawn exposure across ALL branches, and the limit rules
 * (old CustomerPawnPolicy): a new pawn or a larger renewal may not push the
 * customer over their amount / count limit, and a limit cannot be set below
 * what is already outstanding.
 */
class CustomerExposure
{
    /** @return array{active_tickets: int, outstanding_principal: string} */
    public function for(Customer $customer): array
    {
        $row = DB::table('pawn_tickets')
            ->where('customer_id', $customer->id)
            ->where('status', 'active')
            ->selectRaw('COUNT(*) AS cnt, COALESCE(SUM(principal_current), 0) AS total')
            ->first();

        return [
            'active_tickets' => (int) $row->cnt,
            'outstanding_principal' => Money::of($row->total),
        ];
    }

    /**
     * Throws when taking $additionalAmount more (and $additionalTickets more
     * tickets) would break the customer's limits.
     */
    public function assertCanBorrow(Customer $customer, string|float $additionalAmount, int $additionalTickets = 1): void
    {
        if (! $customer->isActive()) {
            throw ValidationException::withMessages(['customer_id' => "Customer is {$customer->status} and cannot pawn."]);
        }

        $exposure = $this->for($customer);

        if ($customer->pawn_count_limit !== null && $additionalTickets > 0
            && $exposure['active_tickets'] + $additionalTickets > $customer->pawn_count_limit) {
            throw ValidationException::withMessages([
                'customer_id' => "Customer already has {$exposure['active_tickets']} active tickets (limit {$customer->pawn_count_limit}).",
            ]);
        }

        if ($customer->pawn_amount_limit !== null) {
            $after = Money::add($exposure['outstanding_principal'], $additionalAmount);
            if (Money::compare($after, $customer->pawn_amount_limit) > 0) {
                throw ValidationException::withMessages([
                    'amount' => 'This exceeds the customer\'s pawn limit of Rs. '.number_format((float) $customer->pawn_amount_limit, 2)
                        .' (outstanding Rs. '.number_format((float) $exposure['outstanding_principal'], 2).').',
                ]);
            }
        }
    }

    /** Limits may not be set below what the customer already owes. */
    public function assertLimitsCoverExposure(Customer $customer, ?string $amountLimit, ?int $countLimit): void
    {
        $exposure = $this->for($customer);
        $errors = [];

        if ($amountLimit !== null && Money::compare($amountLimit, $exposure['outstanding_principal']) < 0) {
            $errors['pawn_amount_limit'] = 'Amount limit cannot be below the outstanding principal (Rs. '
                .number_format((float) $exposure['outstanding_principal'], 2).').';
        }
        if ($countLimit !== null && $countLimit < $exposure['active_tickets']) {
            $errors['pawn_count_limit'] = "Ticket limit cannot be below the {$exposure['active_tickets']} active tickets.";
        }

        if ($errors) {
            throw ValidationException::withMessages($errors);
        }
    }
}
