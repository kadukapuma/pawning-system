<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Chart of accounts and journal headers. journal_lines is created after the
 * pawning tables because each line can reference a pawn ticket.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_groups', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->string('name', 100);
            $table->string('type', 10);                // asset | liability | equity | income | expense
            $table->foreignId('parent_id')->nullable()->constrained('account_groups')->restrictOnDelete();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index('type');
        });

        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->string('name', 120);
            $table->foreignId('account_group_id')->constrained()->restrictOnDelete();
            $table->string('type', 10);                // denormalised from group for fast reports
            $table->string('normal_balance', 6);       // debit | credit
            $table->foreignId('branch_id')->nullable()->constrained()->restrictOnDelete(); // null = all branches
            $table->boolean('is_cash')->default(false);
            $table->boolean('is_bank')->default(false);
            $table->boolean('is_system')->default(false);
            $table->string('system_key', 40)->nullable()->unique(); // cash, pawn_loans_receivable, ...
            $table->decimal('opening_balance', 15, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['type', 'is_active']);
            $table->index('account_group_id');
        });

        Schema::create('journal_entries', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('entry_no', 30);
            $table->date('entry_date');
            $table->string('source_type', 60)->nullable(); // morph: pawn_transaction, voucher, sales_invoice, ...
            $table->unsignedBigInteger('source_id')->nullable();
            $table->string('narration', 255)->nullable();
            $table->status('status', 'posted');        // posted | reversed
            $table->foreignId('reversal_of_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->userRef('posted_by');
            $table->dateTime('posted_at')->nullable();
            $table->userRef('created_by');
            $table->timestamps();

            $table->unique(['branch_id', 'entry_no']);
            $table->index(['branch_id', 'entry_date']);
            $table->index(['source_type', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('journal_entries');
        Schema::dropIfExists('accounts');
        Schema::dropIfExists('account_groups');
    }
};
