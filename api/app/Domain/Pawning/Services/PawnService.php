<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Core\Support\Money;
use App\Domain\Customers\Models\Customer;
use App\Domain\Customers\Services\CustomerExposure;
use App\Domain\Masters\Models\PawnSchemeVersion;
use App\Domain\Pawning\Calculation\CycleDates;
use App\Domain\Pawning\Calculation\InterestTerms;
use App\Domain\Pawning\Calculation\SchemeSelector;
use App\Domain\Pawning\Calculation\Valuation;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTicketEvent;
use App\Domain\Pawning\Models\PawnTransaction;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * New pawns and opening (carried-over) tickets. Every amount is computed
 * here from the articles and today's rates — the client only sends inputs.
 */
class PawnService
{
    public function __construct(
        private ItemValuer $valuer,
        private SchemeSelector $selector,
        private CustomerExposure $exposure,
        private SequenceService $sequences,
        private LedgerPoster $ledger,
        private BranchContext $branch,
    ) {}

    /**
     * Valuation + scheme + term table for the pawn screen.
     *
     * @param  list<array>  $items
     */
    public function quote(array $items, ?string $amount = null): array
    {
        $valuation = $this->valuer->value($items);
        $basis = $amount !== null && Money::isPositive($amount) ? $amount : $valuation['assessed_value'];
        $version = $this->selector->forLoan($basis, $valuation['is_silver']);
        $terms = InterestTerms::fromVersion($version, $version->scheme->interest_method);
        $capacities = Valuation::termCapacities($valuation['assessed_value'], $terms->monthlyRate(), $version->max_term_months);

        return $valuation + [
            'scheme' => ['id' => $version->scheme_id, 'code' => $version->scheme->code, 'name' => $version->scheme->name, 'version_id' => $version->id],
            'monthly_rate' => $terms->monthlyRate(),
            'max_loan' => $valuation['assessed_value'],
            'term_capacities' => $capacities,
            'max_term' => $amount !== null && Money::isPositive($amount)
                ? Valuation::maxTermForLoan($amount, $valuation['assessed_value'], $terms->monthlyRate(), $version->max_term_months)
                : $version->max_term_months,
        ];
    }

    /**
     * @param  array{customer_id:int, items:list<array>, amount:string|float, months:int, remarks?:?string}  $data
     */
    public function create(array $data): PawnTicket
    {
        return DB::transaction(function () use ($data) {
            $customer = Customer::lockForUpdate()->findOrFail($data['customer_id']);
            $amount = Money::of($data['amount']);
            $quote = $this->quote($data['items'], $amount);

            if (Money::compare($amount, $quote['assessed_value']) > 0) {
                throw ValidationException::withMessages([
                    'amount' => 'Loan cannot be more than the article value (Rs. '.number_format((float) $quote['assessed_value'], 2).').',
                ]);
            }
            $months = (int) $data['months'];
            if ($months < 1 || $months > $quote['max_term']) {
                throw ValidationException::withMessages([
                    'months' => $quote['max_term'] > 0
                        ? "For this loan the term can be 1 to {$quote['max_term']} months."
                        : 'The articles do not cover this loan for any term.',
                ]);
            }
            $this->exposure->assertCanBorrow($customer, $amount);

            $version = PawnSchemeVersion::with('scheme')->findOrFail($quote['scheme']['version_id']);
            $today = CarbonImmutable::today();

            return $this->persist($customer, $quote, $version, $amount, $months, $today, false, null, $data['remarks'] ?? null);
        });
    }

    /**
     * A ticket carried over from the paper / old system. The money was lent
     * before this system, so the ledger is credited to the head-office
     * account, not cash.
     *
     * @param  array{customer_id:int, items:list<array>, principal:string|float, pawn_date:string, months:int, legacy_receipt_no:string, remarks?:?string}  $data
     */
    public function createOpening(array $data): PawnTicket
    {
        return DB::transaction(function () use ($data) {
            $customer = Customer::lockForUpdate()->findOrFail($data['customer_id']);
            $principal = Money::of($data['principal']);
            $pawnDate = CarbonImmutable::parse($data['pawn_date'])->startOfDay();

            if (PawnTicket::where('legacy_receipt_no', $data['legacy_receipt_no'])->exists()) {
                throw ValidationException::withMessages(['legacy_receipt_no' => 'This old receipt number is already entered in this branch.']);
            }
            $this->exposure->assertCanBorrow($customer, $principal);

            $quote = $this->quote($data['items'], $principal);
            $version = PawnSchemeVersion::with('scheme')->findOrFail($quote['scheme']['version_id']);

            return $this->persist($customer, $quote, $version, $principal, (int) $data['months'], $pawnDate, true, $data['legacy_receipt_no'], $data['remarks'] ?? null);
        });
    }

    private function persist(
        Customer $customer,
        array $quote,
        PawnSchemeVersion $version,
        string $amount,
        int $months,
        CarbonImmutable $pawnDate,
        bool $opening,
        ?string $legacyNo,
        ?string $remarks,
    ): PawnTicket {
        $terms = InterestTerms::fromVersion($version, $version->scheme->interest_method);
        $branchId = $this->branch->requireId();

        $ticket = PawnTicket::create([
            'branch_id' => $branchId,
            'customer_id' => $customer->id,
            'scheme_id' => $version->scheme_id,
            'scheme_version_id' => $version->id,
            'receipt_no' => $this->sequences->next('receipt'),
            'ticket_no' => $this->sequences->next('ticket'),
            'stock_no' => $this->sequences->next('stock'),
            'pawn_date' => $pawnDate,
            'cycle_start_date' => $pawnDate,
            'maturity_date' => CycleDates::maturity($pawnDate, $months, $terms->isSilver(), $terms->validDays),
            'valid_months' => $months,
            'gross_weight' => $quote['gross_weight'],
            'net_weight' => $quote['net_weight'],
            'assessed_value' => $quote['assessed_value'],
            'market_value' => $quote['market_value'],
            'principal_original' => $amount,
            'principal_current' => $amount,
            'monthly_interest_rate' => $terms->monthlyRate(),
            'is_opening' => $opening,
            'legacy_receipt_no' => $legacyNo,
            'created_by' => auth()->id(),
            'updated_by' => auth()->id(),
        ]);
        $ticket->items()->createMany($quote['items']);

        $type = $opening ? PawnTransaction::OPENING : PawnTransaction::PAWN;
        $txn = PawnTransaction::create([
            'branch_id' => $branchId,
            'pawn_ticket_id' => $ticket->id,
            'txn_no' => $this->sequences->next(PawnTransaction::SEQUENCE[$type]),
            'type' => $type,
            'txn_at' => now(),
            'business_date' => $opening ? today() : $pawnDate,
            'principal_before' => 0,
            'principal_added' => $amount,
            'principal_after' => $amount,
            'cash_paid' => $opening ? 0 : $amount,
            'new_maturity_date' => $ticket->maturity_date,
            'new_scheme_version_id' => $version->id,
            'remarks' => $remarks,
            'created_by' => auth()->id(),
        ]);

        $journal = $this->ledger->post([
            JournalLineData::debit('pawn_loans_receivable', $amount, "Loan {$ticket->receipt_no}", $ticket->id, $customer->id),
            JournalLineData::credit($opening ? 'head_office_current' : 'cash', $amount,
                $opening ? "Opening ticket {$legacyNo}" : "Cash paid {$ticket->receipt_no}", $ticket->id, $customer->id),
        ], ($opening ? 'Opening ticket ' : 'Pawn ').$ticket->receipt_no, today(), $txn, $branchId);
        $txn->update(['journal_entry_id' => $journal->id]);

        PawnTicketEvent::record($ticket, $opening ? 'opening_entered' : 'pawned',
            $opening ? "Opening ticket from old receipt {$legacyNo}" : 'Pawned', $amount,
            ['scheme' => $version->scheme->code, 'months' => $months, 'value' => $quote['assessed_value']]);

        return $ticket;
    }
}
