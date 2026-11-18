<?php

/* Shared helpers for pawning feature tests (expects $this->cashier and $this->customer). */

use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\Karat;
use Illuminate\Support\Facades\DB;

function item(array $o = []): array
{
    return $o + [
        'category_id' => ArticleCategory::where('name', 'Chain')->value('id'),
        'karat_id' => Karat::where('code', 'B4')->value('id'),
        'gross_weight' => '8.500',
        'net_weight' => '8.000',
        'quantity' => 1,
    ];
}

function api_(string $method, string $url, array $body = [], $user = null)
{
    return test()->actingAs($user ?? test()->cashier)->withHeaders(spaHeaders())->json($method, "/api/v1{$url}", $body);
}

function pawn(int $amount = 40000, int $months = 3, array $items = []): array
{
    return api_('POST', '/pawn-tickets', [
        'customer_id' => test()->customer->id, 'items' => $items ?: [item()], 'amount' => $amount, 'months' => $months,
    ])->assertCreated()->json('data');
}

/** Every journal balances, and the ledger as a whole balances. */
function assertLedgerBalanced(): void
{
    $bad = DB::table('journal_lines')->selectRaw('journal_entry_id, SUM(debit) d, SUM(credit) c')
        ->groupBy('journal_entry_id')->havingRaw('SUM(debit) <> SUM(credit)')->count();
    expect($bad)->toBe(0);
}

/** Balance of a system account for one ticket (debit − credit). */
function ticketBalance(int $ticketId, string $systemKey): string
{
    return (string) DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')
        ->where('a.system_key', $systemKey)->where('l.pawn_ticket_id', $ticketId)
        ->selectRaw('COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS b')->value('b');
}
