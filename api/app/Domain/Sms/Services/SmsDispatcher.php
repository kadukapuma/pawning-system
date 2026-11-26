<?php

namespace App\Domain\Sms\Services;

use App\Domain\Sms\Models\SmsMessage;
use App\Domain\Sms\Models\SmsSetting;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Validation\ValidationException;

/**
 * Writes messages to the outbox and delivers them. A failed message is never
 * resent on its own (the provider may have accepted it); staff press Retry.
 */
class SmsDispatcher
{
    /** A message still "sending" after this long was interrupted. */
    private const STUCK_MINUTES = 10;

    /** A reminder not delivered within this time is out of date. */
    private const REMINDER_EXPIRY_HOURS = 24;

    public function __construct(private TemplateRenderer $templates, private NotifyLkClient $client) {}

    public function enabled(): bool
    {
        return SmsSetting::current()->enabled;
    }

    public function assertEnabled(): void
    {
        if (! $this->enabled()) {
            throw ValidationException::withMessages(['sms' => 'SMS is switched off. An administrator can turn it on in SMS settings.']);
        }
    }

    /**
     * Write the candidate's message in the customer's language and queue it.
     * Returns null when there is nothing to queue: no usable number, no
     * template, or this reminder already exists.
     *
     * @param  bool  $replaceUnsent  staff chose to send again a failed or cancelled reminder
     */
    public function queue(SmsCandidate $candidate, bool $replaceUnsent = false, ?array $bodies = null, ?string $batch = null): ?SmsMessage
    {
        if (NotifyLkClient::internationalNumber($candidate->customer->phone1) === null) {
            return null;
        }
        $template = $bodies === null
            ? $this->templates->templateFor($candidate->type, $candidate->customer->sms_language)
            : $this->templates->pick($bodies, $candidate->customer->sms_language);
        if (! $template) {
            return null;
        }
        $body = $this->templates->render($template['body'], $candidate->values);

        return $this->store([
            'branch_id' => $candidate->branchId,
            'customer_id' => $candidate->customer->id,
            'pawn_ticket_id' => $candidate->ticket?->id,
            'type' => $candidate->type->value,
            'language' => $template['language'],
            'phone' => $candidate->customer->phone1,
            'body' => $body,
            'dedupe_key' => $candidate->key,
            'batch_ref' => $batch,
        ], $replaceUnsent);
    }

    public function store(array $attributes, bool $replaceUnsent = false): ?SmsMessage
    {
        $attributes += [
            'segments' => SmsText::measure($attributes['body'])['segments'],
            'queued_at' => now(),
            'created_by' => auth()->id(),
        ];

        try {
            return SmsMessage::create($attributes);
        } catch (UniqueConstraintViolationException) {
            if (! $replaceUnsent) {
                return null;
            }
            $existing = SmsMessage::withoutBranchScope()->where('dedupe_key', $attributes['dedupe_key']);
            $changed = (clone $existing)->whereIn('status', [SmsMessage::FAILED, SmsMessage::CANCELLED])
                ->update(['status' => SmsMessage::QUEUED, 'error' => null] + $attributes);

            return $changed ? $existing->first() : null;
        }
    }

    /**
     * Deliver one queued message. Safe to call twice: only the caller that
     * moves it from queued to sending sends it.
     *
     * @param  bool  $evenIfDisabled  used by the settings page test message
     */
    public function send(int $messageId, bool $evenIfDisabled = false): ?SmsMessage
    {
        if (! $evenIfDisabled && ! $this->enabled()) {
            return null;
        }
        $claimed = SmsMessage::withoutBranchScope()->whereKey($messageId)->where('status', SmsMessage::QUEUED)
            ->update(['status' => SmsMessage::SENDING]);
        if (! $claimed) {
            return null;
        }
        $message = SmsMessage::withoutBranchScope()->findOrFail($messageId);

        try {
            $this->client->send($message->phone, $message->body);
            $message->update(['status' => SmsMessage::SENT, 'sent_at' => now(), 'error' => null]);
        } catch (SmsGatewayException $e) {
            $message->update(['status' => SmsMessage::FAILED, 'error' => $e->getMessage()]);
        } catch (\Throwable $e) {
            report($e);
            $message->update(['status' => SmsMessage::FAILED, 'error' => 'Unexpected error while sending. See the server log.']);
        }

        return $message;
    }

    /**
     * Deliver queued messages, oldest first, until the count or time limit.
     * Inside a request only the working branch's messages are picked.
     *
     * @param  list<int>|null  $only
     * @return array{sent: int, failed: int}
     */
    public function flush(int $limit = 50, int $seconds = 20, ?array $only = null): array
    {
        $result = ['sent' => 0, 'failed' => 0];
        if (! $this->enabled()) {
            return $result;
        }
        $this->tidy();
        $deadline = microtime(true) + $seconds;

        $ids = SmsMessage::query()->where('status', SmsMessage::QUEUED)
            ->when($only !== null, fn ($q) => $q->whereIn('id', $only))
            ->orderBy('queued_at')->orderBy('id')->limit($limit)->pluck('id');

        foreach ($ids as $id) {
            if (microtime(true) >= $deadline) {
                break;
            }
            $message = $this->send($id);
            if ($message) {
                $result[$message->status === SmsMessage::SENT ? 'sent' : 'failed']++;
            }
        }

        return $result;
    }

    /** Close off interrupted sends and out-of-date reminders. */
    public function tidy(): void
    {
        SmsMessage::query()->where('status', SmsMessage::SENDING)
            ->where('updated_at', '<', now()->subMinutes(self::STUCK_MINUTES))
            ->update(['status' => SmsMessage::FAILED, 'error' => 'Sending was interrupted. It may have reached the customer; check before retrying.']);

        SmsMessage::query()->where('status', SmsMessage::QUEUED)
            ->where('type', '!=', 'custom')
            ->where('queued_at', '<', now()->subHours(self::REMINDER_EXPIRY_HOURS))
            ->update(['status' => SmsMessage::CANCELLED, 'error' => 'Not sent within 24 hours.']);
    }
}
