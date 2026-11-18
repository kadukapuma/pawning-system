<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Chart of accounts. System accounts are found by `system_key` (never by id).
 * Expense accounts are the old system's chart entries, de-duplicated.
 */
class ChartOfAccountsSeeder extends Seeder
{
    private const GROUPS = [
        // code, name, type, parent
        ['1000', 'Assets', 'asset', null],
        ['1100', 'Current Assets', 'asset', '1000'],
        ['2000', 'Liabilities', 'liability', null],
        ['2100', 'Current Liabilities', 'liability', '2000'],
        ['3000', 'Equity', 'equity', null],
        ['4000', 'Income', 'income', null],
        ['4100', 'Pawning Income', 'income', '4000'],
        ['4500', 'Trading Income', 'income', '4000'],
        ['5000', 'Expenses', 'expense', null],
        ['5100', 'Administrative & Establishment', 'expense', '5000'],
        ['5200', 'Finance & Other Expenses', 'expense', '5000'],
        ['5300', 'Selling & Distribution', 'expense', '5000'],
        ['5400', 'Marketing Expenses', 'expense', '5000'],
    ];

    private const ACCOUNTS = [
        // code, name, group, system_key, flags
        ['1110', 'Cash in Hand', '1100', 'cash', ['is_cash' => true]],
        ['1120', 'Cheques in Hand', '1100', 'cheques_in_hand', []],
        ['1130', 'Pawn Loans Receivable', '1100', 'pawn_loans_receivable', []],
        ['1150', 'Forfeited Articles Stock', '1100', 'forfeited_stock', []],
        ['2110', 'Stamp Duty Payable', '2100', 'stamp_duty_payable', []],
        ['2120', 'Customer Surplus Payable', '2100', 'customer_surplus_payable', []],
        ['3100', 'Owner\'s Capital', '3000', 'capital', []],
        ['3200', 'Head Office Current Account', '3000', 'head_office_current', []],
        ['3900', 'Retained Earnings', '3000', 'retained_earnings', []],
        ['4110', 'Interest Income', '4100', 'interest_income', []],
        ['4120', 'Service Charge Income', '4100', 'service_charge_income', []],
        ['4130', 'Postage / Letter Charge Income', '4100', 'postage_income', []],
        ['4140', 'Document Charge Income', '4100', 'document_charge_income', []],
        ['4190', 'Cash Rounding', '4100', 'rounding', []],
        ['4510', 'Sales of Forfeited Articles', '4500', 'sales_income', []],
        ['5110', 'Discount Allowed', '5200', 'discount_allowed', []],
        ['5310', 'Cost of Forfeited Articles Sold', '5300', 'cost_of_sales', []],
        ['5320', 'Loss on Forfeiture', '5300', 'forfeit_loss', []],
        // From the old chart (non-system).
        ['5120', 'Electricity', '5100', null, []],
        ['5121', 'Water', '5100', null, []],
        ['5122', 'Telephone', '5100', null, []],
        ['5123', 'Building Rent', '5100', null, []],
        ['5124', 'Travelling Allowance', '5100', null, []],
        ['5125', 'Food Allowance', '5100', null, []],
        ['5126', 'Stationery & Printing', '5100', null, []],
        ['5127', 'Registered Mail', '5100', null, []],
        ['5128', 'Head Office Expenses', '5100', null, []],
        ['5129', 'Other Expenses', '5100', null, []],
        ['5210', 'Bank Charges', '5200', null, []],
    ];

    private const NORMAL_BALANCE = [
        'asset' => 'debit', 'expense' => 'debit',
        'liability' => 'credit', 'equity' => 'credit', 'income' => 'credit',
    ];

    public function run(): void
    {
        $now = now();
        $groupIds = [];
        $groupTypes = [];

        foreach (self::GROUPS as $i => [$code, $name, $type, $parent]) {
            DB::table('account_groups')->updateOrInsert(['code' => $code], [
                'name' => $name,
                'type' => $type,
                'parent_id' => $parent ? $groupIds[$parent] : null,
                'sort_order' => $i,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $groupIds[$code] = DB::table('account_groups')->where('code', $code)->value('id');
            $groupTypes[$code] = $type;
        }

        foreach (self::ACCOUNTS as [$code, $name, $group, $systemKey, $flags]) {
            $type = $groupTypes[$group];
            DB::table('accounts')->updateOrInsert(['code' => $code], [
                'name' => $name,
                'account_group_id' => $groupIds[$group],
                'type' => $type,
                'normal_balance' => self::NORMAL_BALANCE[$type],
                'is_cash' => $flags['is_cash'] ?? false,
                'is_bank' => false,
                'is_system' => $systemKey !== null,
                'system_key' => $systemKey,
                'opening_balance' => 0,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }
}
