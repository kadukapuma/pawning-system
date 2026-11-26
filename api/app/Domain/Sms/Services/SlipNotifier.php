<?php

namespace App\Domain\Sms\Services;

use App\Domain\Pawning\Models\PawnTransaction;
use App\Domain\Sms\Enums\SmsType;
use App\Domain\Sms\Models\SmsMessage;
use App\Domain\Sms\Models\SmsRule;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Payment slips by SMS. */
class SlipNotifier
{
    public function __construct(private SmsDispatcher $dispatcher, private SmsValues $values) {}

    /**
     * Send the slip for a transaction that has just been saved, if switched on.
     * Never throws: an SMS problem must not look like a failed payment.
     */
    public function afterTransaction(?PawnTransaction $txn): void
    {
        try {
            $type = $txn ? SmsType::forTransaction($txn->type) : null;
            if (! $type || ! $this->dispatcher->enabled() || SmsRule::for($type)->mode !== SmsType::MODE_AUTO) {
                return;
            }
            $message = $this->dispatcher->queue($this->candidate($type, $txn, "slip:{$txn->id}"));
            if ($message) {
                $this->sendAfterResponse($message->id);
            }
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** Staff pressed "Send SMS slip" (allowed again and again). */
    public function resend(PawnTransaction $txn): SmsMessage
    {
        $this->dispatcher->assertEnabled();
        $type = SmsType::forTransaction($txn->type)
            ?? throw ValidationException::withMessages(['sms' => 'There is no SMS slip for this kind of transaction.']);

        $message = $this->dispatcher->queue($this->candidate($type, $txn, null))
            ?? throw ValidationException::withMessages(['sms' => 'The customer has no valid mobile number, or the slip template is empty.']);

        return $this->dispatcher->send($message->id) ?? $message;
    }

    private function candidate(SmsType $type, PawnTransaction $txn, ?string $key): SmsCandidate
    {
        // A copy, so the loaded relations do not appear in the caller's API response.
        $txn = $txn->withoutRelations();
        $ticket = $txn->load(['ticket.customer', 'ticket.branch'])->ticket;

        return new SmsCandidate($type, $key, $ticket->customer, $txn->branch_id, $this->values->for($ticket->customer, $ticket->branch) + [
            'receipt_no' => $ticket->receipt_no,
            'txn_no' => $txn->txn_no,
            'date' => $txn->business_date->toDateString(),
            'maturity_date' => ($txn->new_maturity_date ?? $ticket->maturity_date)->toDateString(),
            'capital' => SmsValues::money($txn->principal_after),
            'interest' => SmsValues::money($txn->interest_paid),
            'amount_paid' => SmsValues::money($txn->cash_received),
            'amount_given' => SmsValues::money($txn->cash_paid),
        ], $ticket);
    }

    private function sendAfterResponse(int $messageId): void
    {
        dispatch(function () use ($messageId) {
            try {
                app(SmsDispatcher::class)->send($messageId);
            } catch (Throwable $e) {
                report($e); // still queued; the scheduler will pick it up
            }
        })->afterResponse();
    }
}
