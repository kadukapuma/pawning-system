<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bank_reconciliations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bank_account_id')->constrained()->restrictOnDelete();
            $table->date('statement_date');
            $table->money('statement_balance');
            $table->money('book_balance');
            $table->status('status', 'draft');         // draft | completed
            $table->userRef('reconciled_by');
            $table->dateTime('completed_at')->nullable();
            $table->timestamps();

            $table->unique(['bank_account_id', 'statement_date']);
        });

        Schema::create('bank_reconciliation_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('reconciliation_id')->constrained('bank_reconciliations')->cascadeOnDelete();
            $table->foreignId('journal_line_id')->unique()->constrained()->restrictOnDelete(); // cleared once
            $table->date('cleared_date');
            $table->timestamps();

            $table->index('reconciliation_id');
        });

        // Generated PDFs, stored on the private disk and served only via authenticated routes.
        Schema::create('printed_documents', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('document_type', 40);       // pawn_receipt, pawn_ticket, redemption, arrears_letter, ...
            $table->string('documentable_type', 60);
            $table->unsignedBigInteger('documentable_id');
            $table->string('file_path');
            $table->unsignedInteger('print_count')->default(1);
            $table->userRef('printed_by');
            $table->dateTime('last_printed_at');
            $table->timestamps();

            $table->index(['documentable_type', 'documentable_id']);
            $table->index(['branch_id', 'document_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('printed_documents');
        Schema::dropIfExists('bank_reconciliation_lines');
        Schema::dropIfExists('bank_reconciliations');
    }
};
