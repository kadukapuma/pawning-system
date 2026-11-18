<?php

use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Core\Support\BranchContext;

it('uses the home branch when no branch header is sent', function () {
    $user = userWithRole('cashier', '002');

    $this->actingAs($user)->withHeaders(spaHeaders())->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.current_branch_id', branch('002')->id);
});

it('forbids switching to a branch the user was not granted', function () {
    $user = userWithRole('cashier', '001');

    $this->actingAs($user)
        ->withHeaders(spaHeaders(['X-Branch-Id' => (string) branch('002')->id]))
        ->getJson('/api/v1/auth/me')
        ->assertForbidden();
});

it('allows switching to a granted branch', function () {
    $user = userWithRole('cashier', '001');
    $user->branches()->attach(branch('002'));

    $this->actingAs($user)
        ->withHeaders(spaHeaders(['X-Branch-Id' => (string) branch('002')->id]))
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.current_branch_id', branch('002')->id)
        ->assertJsonCount(2, 'data.branches');
});

it('lets head office work in every branch', function () {
    $user = userWithRole('head_office', '001');

    $this->actingAs($user)
        ->withHeaders(spaHeaders(['X-Branch-Id' => (string) branch('002')->id]))
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.current_branch_id', branch('002')->id);
});

it('limits branch-owned records to the working branch', function () {
    $poster = app(LedgerPoster::class);
    $lines = [JournalLineData::debit('pawn_loans_receivable', 1000), JournalLineData::credit('cash', 1000)];

    $poster->post($lines, 'Branch 1 loan', branchId: branch('001')->id);
    $poster->post($lines, 'Branch 2 loan', branchId: branch('002')->id);
    $poster->post($lines, 'Branch 2 loan', branchId: branch('002')->id);

    useBranch('001');
    expect(JournalEntry::count())->toBe(1);

    useBranch('002');
    expect(JournalEntry::count())->toBe(2)
        ->and(JournalEntry::withoutBranchScope()->count())->toBe(3);
});

it('fills branch_id from the working branch on create', function () {
    $branch = useBranch('002');

    $entry = JournalEntry::create(['entry_no' => 'X1', 'entry_date' => '2026-11-18', 'status' => 'posted']);

    expect($entry->branch_id)->toBe($branch->id);
});

it('refuses to create a branch-owned record with no working branch', function () {
    app(BranchContext::class)->set(null);

    JournalEntry::create(['entry_no' => 'X2', 'entry_date' => '2026-11-18', 'status' => 'posted']);
})->throws(LogicException::class);
