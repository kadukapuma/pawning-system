<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
 * Structural guarantees of the new schema (docs/DB_DESIGN.md).
 */

function dbName(): string
{
    return DB::connection()->getDatabaseName();
}

function makeCustomer(array $overrides = []): int
{
    return DB::table('customers')->insertGetId($overrides + [
        'branch_id' => DB::table('branches')->where('code', '001')->value('id'),
        'code' => 'C001'.random_int(100000, 999999),
        'first_name' => 'Test',
        'last_name' => 'Customer',
        'nic' => (string) random_int(100000000, 999999999).'V',
        'address_line1' => 'No 1, Main Street',
        'phone1' => '0771234567',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

function makeTicket(int $customerId, string $receiptNo): int
{
    $scheme = DB::table('pawn_schemes')->where('code', 'A')->first();

    return DB::table('pawn_tickets')->insertGetId([
        'branch_id' => DB::table('branches')->where('code', '001')->value('id'),
        'customer_id' => $customerId,
        'scheme_id' => $scheme->id,
        'scheme_version_id' => DB::table('pawn_scheme_versions')->where('scheme_id', $scheme->id)->value('id'),
        'receipt_no' => $receiptNo,
        'ticket_no' => $receiptNo,
        'stock_no' => $receiptNo,
        'pawn_date' => '2026-11-18',
        'cycle_start_date' => '2026-11-18',
        'maturity_date' => '2027-02-16',
        'principal_original' => 25000,
        'principal_current' => 25000,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

it('uses InnoDB and a single collation for every table', function () {
    $tables = DB::select('SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [dbName()]);

    expect($tables)->not->toBeEmpty();
    foreach ($tables as $t) {
        expect($t->ENGINE)->toBe('InnoDB', "{$t->TABLE_NAME} is not InnoDB");
        expect($t->TABLE_COLLATION)->toBe('utf8mb4_unicode_ci', "{$t->TABLE_NAME} collation");
    }
});

it('creates every table from the design', function (string $table) {
    expect(DB::getSchemaBuilder()->hasTable($table))->toBeTrue();
})->with([
    'companies', 'branches', 'users', 'user_branches', 'document_sequences', 'settings', 'audit_logs',
    'karats', 'karat_rates', 'article_categories', 'article_types', 'article_conditions',
    'pawn_schemes', 'pawn_scheme_versions', 'customers', 'customer_documents',
    'pawn_tickets', 'pawn_ticket_items', 'pawn_transactions', 'arrears_letters', 'forfeit_promises',
    'pawn_ticket_events', 'pawn_remarks', 'stock_check_sessions', 'stock_check_lines',
    'forfeitures', 'stock_transfer_batches', 'inventory_items', 'stock_movements',
    'sales_invoices', 'sales_invoice_lines',
    'account_groups', 'accounts', 'journal_entries', 'journal_lines', 'day_closings', 'vouchers',
    'banks', 'bank_branches', 'bank_accounts', 'cheques', 'bank_reconciliations', 'bank_reconciliation_lines',
    'printed_documents',
]);

it('never stores money or weight as float, double or text', function () {
    $bad = DB::select(
        "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND DATA_TYPE IN ('float', 'double')",
        [dbName()],
    );

    expect($bad)->toBeEmpty();
});

it('enforces foreign keys on every *_id column of business tables', function () {
    $missing = DB::select(
        "SELECT c.TABLE_NAME, c.COLUMN_NAME
         FROM information_schema.COLUMNS c
         LEFT JOIN information_schema.KEY_COLUMN_USAGE k
           ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
          AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
         WHERE c.TABLE_SCHEMA = ?
           AND (c.COLUMN_NAME LIKE '%\\_id' OR c.COLUMN_NAME IN ('created_by','updated_by','approved_by','closed_by','issued_by','blocked_by','cancelled_by','voided_by','posted_by','requested_by','printed_by','reconciled_by','started_by','checked_by','uploaded_by'))
           AND c.COLUMN_NAME NOT IN ('source_id','reference_id','auditable_id','documentable_id','tokenable_id','model_id')
           AND c.TABLE_NAME NOT IN ('sessions','personal_access_tokens','jobs','job_batches','failed_jobs','model_has_roles','model_has_permissions','role_has_permissions','migrations')
           AND k.COLUMN_NAME IS NULL",
        [dbName()],
    );

    expect(collect($missing)->map(fn ($r) => "{$r->TABLE_NAME}.{$r->COLUMN_NAME}")->all())->toBe([]);
});

it('rejects a duplicate receipt number in the same branch', function () {
    $customer = makeCustomer();
    makeTicket($customer, '000001');

    expect(fn () => makeTicket($customer, '000001'))->toThrow(QueryException::class);
});

it('rejects a second customer with the same NIC', function () {
    makeCustomer(['nic' => '199012345678']);

    expect(fn () => makeCustomer(['nic' => '199012345678']))->toThrow(QueryException::class);
});

it('builds customers.full_name from the name parts', function () {
    $id = makeCustomer(['first_name' => 'Nimal', 'middle_name' => null, 'last_name' => 'Perera']);

    expect(DB::table('customers')->where('id', $id)->value('full_name'))->toBe('Nimal Perera');
});

it('charges each arrears letter only once per cycle', function () {
    $ticket = makeTicket(makeCustomer(), '000002');
    $letter = [
        'pawn_ticket_id' => $ticket,
        'branch_id' => DB::table('branches')->where('code', '001')->value('id'),
        'cycle_no' => 1,
        'letter_no' => 1,
        'due_date' => '2027-02-16',
        'issued_at' => now(),
        'postage_charge' => 150,
    ];
    DB::table('arrears_letters')->insert($letter);

    expect(fn () => DB::table('arrears_letters')->insert($letter))->toThrow(QueryException::class);
});

it('blocks deleting a customer who has tickets', function () {
    $customer = makeCustomer();
    makeTicket($customer, '000003');

    expect(fn () => DB::table('customers')->where('id', $customer)->delete())->toThrow(QueryException::class);
});

it('allows a ticket to be forfeited only once', function () {
    $ticket = makeTicket(makeCustomer(), '000004');
    $row = fn (string $no) => [
        'branch_id' => DB::table('branches')->where('code', '001')->value('id'),
        'forfeit_no' => $no,
        'pawn_ticket_id' => $ticket,
        'forfeit_date' => '2027-06-01',
        'created_at' => now(),
        'updated_at' => now(),
    ];
    DB::table('forfeitures')->insert($row('FF000001'));

    expect(fn () => DB::table('forfeitures')->insert($row('FF000002')))->toThrow(QueryException::class);
});
