<?php

namespace App\Domain\Sms\Enums;

use App\Domain\Pawning\Models\PawnTransaction;

/** Every kind of SMS the system sends, and what each one allows. */
enum SmsType: string
{
    case Birthday = 'birthday';
    case DueReminder = 'due_reminder';
    case ArrearsReminder = 'arrears_reminder';
    case ForfeitWarning = 'forfeit_warning';
    case PromiseReminder = 'promise_reminder';
    case SlipPawn = 'slip_pawn';
    case SlipPartPayment = 'slip_part_payment';
    case SlipRenewal = 'slip_renewal';
    case SlipRedemption = 'slip_redemption';
    case Custom = 'custom';

    public const MODE_OFF = 'off';

    public const MODE_AUTO = 'auto';

    public const MODE_MANUAL = 'manual';

    public const LANGUAGES = ['en', 'si', 'ta'];

    public function label(): string
    {
        return match ($this) {
            self::Birthday => 'Birthday wishes',
            self::DueReminder => 'Due date reminder',
            self::ArrearsReminder => 'Arrears reminder',
            self::ForfeitWarning => 'Forfeit warning',
            self::PromiseReminder => 'Payment promise reminder',
            self::SlipPawn => 'New pawn slip',
            self::SlipPartPayment => 'Part payment slip',
            self::SlipRenewal => 'Renewal slip',
            self::SlipRedemption => 'Redemption slip',
            self::Custom => 'Custom message',
        };
    }

    public function isReminder(): bool
    {
        return in_array($this, self::reminders(), true);
    }

    public function isSlip(): bool
    {
        return str_starts_with($this->value, 'slip_');
    }

    /** @return list<self> */
    public static function reminders(): array
    {
        return [self::Birthday, self::DueReminder, self::ArrearsReminder, self::ForfeitWarning, self::PromiseReminder];
    }

    /** Types an administrator configures (everything except custom messages). @return list<self> */
    public static function configurable(): array
    {
        return array_values(array_filter(self::cases(), fn (self $t) => $t !== self::Custom));
    }

    /** @return list<string> */
    public function modes(): array
    {
        // A slip goes with its transaction; "manual" is the button on the ticket.
        return $this->isSlip()
            ? [self::MODE_OFF, self::MODE_AUTO]
            : [self::MODE_OFF, self::MODE_AUTO, self::MODE_MANUAL];
    }

    /** Allowed day offsets [min, max], or null when the type has none. */
    public function offsetRange(): ?array
    {
        return match ($this) {
            self::DueReminder => [0, 90],
            self::ArrearsReminder => [1, 365],
            self::PromiseReminder => [0, 30],
            default => null,
        };
    }

    /** @return list<string> */
    public function placeholders(): array
    {
        $common = ['customer_name', 'first_name', 'company', 'branch', 'branch_phone'];
        $owed = ['receipt_no', 'date', 'maturity_date', 'capital', 'interest', 'arrears', 'total_due'];
        $slip = ['receipt_no', 'txn_no', 'date', 'maturity_date', 'capital', 'interest', 'amount_paid', 'amount_given'];

        return array_merge($common, match ($this) {
            self::Birthday, self::Custom => [],
            self::DueReminder => [...$owed, 'days_left'],
            self::ArrearsReminder, self::ForfeitWarning => [...$owed, 'days_overdue'],
            self::PromiseReminder => [...$owed, 'promise_date'],
            default => $slip,
        });
    }

    public static function forTransaction(string $transactionType): ?self
    {
        return match ($transactionType) {
            PawnTransaction::PAWN => self::SlipPawn,
            PawnTransaction::PART_PAYMENT => self::SlipPartPayment,
            PawnTransaction::RENEWAL => self::SlipRenewal,
            PawnTransaction::REDEMPTION => self::SlipRedemption,
            default => null,
        };
    }
}
