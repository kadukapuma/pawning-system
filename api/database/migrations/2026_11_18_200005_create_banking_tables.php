<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('banks', function (Blueprint $table) {
            $table->id();
            $table->string('code', 10)->unique();      // CBSL bank code, e.g. 7083
            $table->string('name', 100);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('bank_branches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bank_id')->constrained()->restrictOnDelete();
            $table->string('code', 10);
            $table->string('name', 100);
            $table->timestamps();

            $table->unique(['bank_id', 'code']);
        });

        // Company's own bank accounts; each is linked to one ledger account.
        Schema::create('bank_accounts', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->foreignId('bank_branch_id')->constrained()->restrictOnDelete();
            $table->string('account_no', 30)->unique();
            $table->string('account_name', 120);
            $table->foreignId('account_id')->unique()->constrained('accounts')->restrictOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('cheques', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('direction', 10);           // received | issued
            $table->string('cheque_no', 20);
            $table->foreignId('bank_branch_id')->nullable()->constrained()->restrictOnDelete(); // drawer's bank
            $table->foreignId('bank_account_id')->nullable()->constrained()->restrictOnDelete(); // our account
            $table->string('party_name', 150);
            $table->money('amount');
            $table->date('cheque_date');
            $table->status('status', 'in_hand');       // in_hand|deposited|cleared|returned|issued|presented|cancelled
            $table->dateTime('deposited_at')->nullable();
            $table->dateTime('cleared_at')->nullable();
            $table->dateTime('returned_at')->nullable();
            $table->string('return_reason', 255)->nullable();
            $table->string('source_type', 60)->nullable();
            $table->unsignedBigInteger('source_id')->nullable();
            $table->foreignId('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->userStamps();
            $table->timestamps();

            $table->index(['branch_id', 'status', 'cheque_date']);
            $table->index(['bank_account_id', 'status']);
            $table->index('cheque_no');
            $table->index(['source_type', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cheques');
        Schema::dropIfExists('bank_accounts');
        Schema::dropIfExists('bank_branches');
        Schema::dropIfExists('banks');
    }
};
