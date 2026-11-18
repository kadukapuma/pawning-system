<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * One counter per branch and document type. SequenceService (phase 3)
 * increments these under a row lock. Final number = prefix + zero-padded value.
 */
class DocumentSequenceSeeder extends Seeder
{
    public const TYPES = [
        // doc_type => [prefix, padding]
        'customer' => ['C', 6],
        'receipt' => ['', 6],
        'ticket' => ['', 6],
        'stock' => ['', 6],
        'pawn_txn' => ['PW', 6],
        'part_payment' => ['PP', 6],
        'renewal' => ['RN', 6],
        'redemption' => ['RD', 6],
        'letter_charge' => ['LC', 6],
        'rounding' => ['RA', 6],
        'cancellation' => ['CN', 6],
        'reversal' => ['RV', 6],
        'forfeit' => ['FF', 6],
        'transfer_batch' => ['TB', 5],
        'inventory_item' => ['IT', 6],
        'sales_invoice' => ['INV', 6],
        'journal' => ['JE', 7],
        'voucher_payment' => ['PV', 6],
        'voucher_receipt' => ['GR', 6],
        'voucher_expense' => ['EX', 6],
        'voucher_petty_cash' => ['PC', 6],
    ];

    public function run(): void
    {
        $now = now();

        foreach (DB::table('branches')->get(['id', 'code']) as $branch) {
            foreach (self::TYPES as $type => [$prefix, $padding]) {
                DB::table('document_sequences')->insertOrIgnore([
                    'branch_id' => $branch->id,
                    'doc_type' => $type,
                    // Customer codes are global but issued per branch, so include the branch code.
                    'prefix' => $type === 'customer' ? $prefix.$branch->code : $prefix,
                    'next_number' => 1,
                    'padding' => $padding,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }
}
