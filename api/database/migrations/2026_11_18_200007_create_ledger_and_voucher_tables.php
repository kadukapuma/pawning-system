<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Balanced lines: per journal_entry, SUM(debit) = SUM(credit) (enforced by LedgerPoster).
        Schema::create('journal_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('journal_entry_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained()->restrictOnDelete();
            $table->branchRef();                       // denormalised for reporting
            $table->date('entry_date');                // denormalised for reporting
            $table->money('debit');
            $table->money('credit');
            $table->string('description', 255)->nullable();
            $table->foreignId('pawn_ticket_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->timestamps();

            $table->index(['account_id', 'entry_date']);
            $table->index(['branch_id', 'account_id', 'entry_date']);
            $table->index('pawn_ticket_id');
        });

        Schema::create('day_closings', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->date('business_date');
            $table->money('opening_cash');
            $table->money('total_in');
            $table->money('total_out');
            $table->money('closing_cash');
            $table->decimal('physical_cash', 15, 2)->nullable();
            $table->money('variance');
            $table->status('status', 'open');          // open | closed
            $table->userRef('closed_by');
            $table->dateTime('closed_at')->nullable();
            $table->timestamps();

            $table->unique(['branch_id', 'business_date']);
            $table->index(['status', 'business_date']);
        });

        // Payment vouchers, general receipts, expenses, petty cash. Maker-checker.
        Schema::create('vouchers', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('voucher_no', 20);
            $table->string('type', 20);                // payment | receipt | expense | petty_cash
            $table->date('voucher_date');
            $table->string('party_name', 150)->nullable();
            $table->foreignId('account_id')->constrained('accounts')->restrictOnDelete();      // expense/income side
            $table->foreignId('cash_account_id')->constrained('accounts')->restrictOnDelete(); // cash / bank side
            $table->money('amount');
            $table->string('description', 500)->nullable();
            $table->status('status', 'draft');         // draft | pending | approved | rejected | posted
            $table->userRef('requested_by');
            $table->userRef('approved_by');
            $table->dateTime('approved_at')->nullable();
            $table->string('rejection_reason', 500)->nullable();
            $table->string('attachment_path')->nullable();
            $table->foreignId('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->timestamps();

            $table->unique(['branch_id', 'voucher_no']);
            $table->index(['branch_id', 'status', 'voucher_date']);
            $table->index(['type', 'voucher_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vouchers');
        Schema::dropIfExists('day_closings');
        Schema::dropIfExists('journal_lines');
    }
};
