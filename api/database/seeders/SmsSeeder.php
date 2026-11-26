<?php

namespace Database\Seeders;

use App\Domain\Sms\Enums\SmsType;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * SMS settings, rules and English starter templates. Only adds what is missing,
 * so it is safe to run on a live database. Everything starts switched off.
 */
class SmsSeeder extends Seeder
{
    private const RULES = [
        'birthday' => [null, '09:00'],
        'due_reminder' => [[7, 1], '09:00'],
        'arrears_reminder' => [[1, 14, 28], '09:30'],
        'forfeit_warning' => [null, '10:00'],
        'promise_reminder' => [[1], '09:30'],
    ];

    private const ENGLISH = [
        'birthday' => 'Happy Birthday {first_name}! Best wishes from {company}.',
        'due_reminder' => 'Dear {customer_name}, pawn ticket {receipt_no} is due on {maturity_date}. Please visit our {branch} branch. {branch_phone} - {company}',
        'arrears_reminder' => 'Dear {customer_name}, pawn ticket {receipt_no} expired on {maturity_date}. Amount to redeem today: Rs. {total_due}. {branch} {branch_phone}',
        'forfeit_warning' => 'FINAL NOTICE: {customer_name}, settle pawn ticket {receipt_no} (Rs. {total_due}) now to avoid forfeiture. {branch} {branch_phone}',
        'promise_reminder' => 'Dear {customer_name}, you promised to settle pawn ticket {receipt_no} by {promise_date}. Amount today: Rs. {total_due}. {branch_phone}',
        'slip_pawn' => '{company}: Pawn {receipt_no} on {date}. Amount given Rs. {amount_given}. Due date {maturity_date}. {branch} {branch_phone}',
        'slip_part_payment' => '{company}: Received Rs. {amount_paid} for {receipt_no} on {date}. Balance capital Rs. {capital}. Next due {maturity_date}. Ref {txn_no}',
        'slip_renewal' => '{company}: {receipt_no} renewed on {date}. Capital Rs. {capital}, cash given Rs. {amount_given}. Next due {maturity_date}. Ref {txn_no}',
        'slip_redemption' => '{company}: Received Rs. {amount_paid}. Pawn {receipt_no} redeemed on {date}. Thank you. Ref {txn_no}',
    ];

    public function run(): void
    {
        $now = now();
        $stamps = ['created_at' => $now, 'updated_at' => $now];

        if (! DB::table('sms_settings')->exists()) {
            DB::table('sms_settings')->insert(['enabled' => false, 'default_language' => 'en'] + $stamps);
        }

        foreach (SmsType::configurable() as $type) {
            [$offsets, $time] = self::RULES[$type->value] ?? [null, null];

            DB::table('sms_rules')->insertOrIgnore([
                'type' => $type->value, 'mode' => SmsType::MODE_OFF,
                'offsets' => $offsets === null ? null : json_encode($offsets), 'send_time' => $time,
            ] + $stamps);

            DB::table('sms_templates')->insertOrIgnore([
                'type' => $type->value, 'language' => 'en', 'body' => self::ENGLISH[$type->value],
            ] + $stamps);
        }
    }
}
