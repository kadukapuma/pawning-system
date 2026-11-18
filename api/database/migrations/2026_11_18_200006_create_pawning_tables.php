<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * Pawn ticket header. Replaces t_pawn_sums, t_opening_pawn_sums,
         * t_delete_pawn_sums, receipts and cancel__pawnings.
         */
        Schema::create('pawn_tickets', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->foreignId('customer_id')->constrained()->restrictOnDelete();
            $table->foreignId('scheme_id')->constrained('pawn_schemes')->restrictOnDelete();
            $table->foreignId('scheme_version_id')->constrained('pawn_scheme_versions')->restrictOnDelete();

            // Document numbers (per-branch sequences).
            $table->string('receipt_no', 20);
            $table->string('ticket_no', 20);
            $table->string('stock_no', 20);            // old Invoice_Number ("Stock Number")

            // Dates.
            $table->date('pawn_date');
            $table->date('cycle_start_date');          // interest counts from here (resets on part payment / renewal)
            $table->date('maturity_date');             // old Final_date (Silver: To_Date)
            $table->unsignedTinyInteger('valid_months')->default(1);

            // Valuation.
            $table->weight('gross_weight');
            $table->weight('net_weight');
            $table->money('assessed_value');
            $table->money('market_value');

            // Balances.
            $table->money('principal_original');
            $table->money('principal_current');
            $table->money('interest_carried');         // unpaid interest brought forward (old BalanceInterest)
            $table->money('interest_paid_cycle');      // interest already paid in current cycle
            $table->rate('monthly_interest_rate');     // display snapshot of rate3

            // State.
            $table->status('status', 'active');        // active | redeemed | forfeited | cancelled
            $table->status('arrears_stage', 'none');   // none | letter_1 | letter_2 | letter_3 | reminder | forfeit_queued
            $table->unsignedSmallInteger('letter_cycle')->default(1);

            $table->boolean('is_blocked')->default(false);
            $table->dateTime('blocked_at')->nullable();
            $table->userRef('blocked_by');
            $table->string('block_reason', 500)->nullable();

            $table->dateTime('forfeit_queued_at')->nullable();
            $table->dateTime('redeemed_at')->nullable();
            $table->dateTime('forfeited_at')->nullable();
            $table->dateTime('cancelled_at')->nullable();
            $table->userRef('cancelled_by');
            $table->string('cancel_reason', 500)->nullable();

            // Tickets carried over from the paper / old system.
            $table->boolean('is_opening')->default(false);
            $table->string('legacy_receipt_no', 30)->nullable();

            $table->dateTime('stock_checked_at')->nullable();
            $table->userStamps();
            $table->timestamps();

            $table->unique(['branch_id', 'receipt_no']);
            $table->unique(['branch_id', 'ticket_no']);
            $table->unique(['branch_id', 'stock_no']);
            $table->index(['customer_id', 'status']);
            $table->index(['branch_id', 'status', 'maturity_date']);
            $table->index(['branch_id', 'arrears_stage', 'status']);
            $table->index(['branch_id', 'pawn_date']);
            $table->index(['status', 'forfeit_queued_at']);
            $table->index('legacy_receipt_no');
        });

        /*
         * Articles on a ticket. Replaces t_pawn_details, t_opening_pawn_details,
         * t_delete_pawn_details and t_forfit_details.
         */
        Schema::create('pawn_ticket_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pawn_ticket_id')->constrained()->cascadeOnDelete();
            $table->foreignId('category_id')->constrained('article_categories')->restrictOnDelete();
            $table->foreignId('article_type_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('condition_id')->nullable()->constrained('article_conditions')->restrictOnDelete();
            $table->foreignId('karat_id')->constrained()->restrictOnDelete();
            $table->string('description', 255)->nullable();
            $table->unsignedSmallInteger('quantity')->default(1);
            $table->weight('gross_weight');
            $table->weight('net_weight');
            $table->decimal('karat_rate_per_8g', 12, 2)->default(0); // pawn rate used at valuation
            $table->money('assessed_value');
            $table->money('market_value');
            $table->status('status', 'pledged');       // pledged | redeemed | forfeited | in_stock | sold
            $table->string('photo_path')->nullable();
            $table->timestamps();

            $table->index('status');
            $table->index('karat_id');
        });

        /*
         * Every money event on a ticket. Replaces t_pawn_trans, t_pawn_payments,
         * t_redeem_sums, t_repawning_sums, t_forfeit_sums and t_customer_accounts.
         */
        Schema::create('pawn_transactions', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->foreignId('pawn_ticket_id')->constrained()->restrictOnDelete();
            $table->string('txn_no', 20);
            $table->string('type', 20);                // pawn|part_payment|renewal|redemption|forfeit|letter_charge|rounding|cancellation|reversal
            $table->dateTime('txn_at');
            $table->date('business_date');
            $table->unsignedSmallInteger('interest_days')->default(0);

            $table->money('principal_before');
            $table->money('interest_due');
            $table->money('interest_paid');
            $table->money('interest_capitalised');
            $table->money('service_charge');
            $table->money('postage_charge');
            $table->money('document_charge');
            $table->money('stamp_duty');
            $table->money('discount');
            $table->money('principal_paid');
            $table->money('principal_added');
            $table->money('principal_after');
            $table->money('cash_received');            // from customer
            $table->money('cash_paid');                // to customer

            $table->date('new_maturity_date')->nullable();
            $table->foreignId('new_scheme_version_id')->nullable()->constrained('pawn_scheme_versions')->restrictOnDelete();
            $table->string('payment_method', 10)->default('cash'); // cash | cheque | bank
            $table->foreignId('cheque_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('reversal_of_id')->nullable()->constrained('pawn_transactions')->restrictOnDelete();
            $table->foreignId('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('remarks', 500)->nullable();
            $table->userRef('created_by');
            $table->timestamps();

            $table->unique(['branch_id', 'txn_no']);
            $table->index(['pawn_ticket_id', 'txn_at']);
            $table->index(['branch_id', 'type', 'business_date']);
            $table->index(['created_by', 'business_date']);
        });

        // Arrears letters. Unique key prevents charging postage twice.
        Schema::create('arrears_letters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pawn_ticket_id')->constrained()->restrictOnDelete();
            $table->branchRef();
            $table->unsignedSmallInteger('cycle_no')->default(1);
            $table->unsignedTinyInteger('letter_no');  // 1, 2, 3
            $table->date('due_date');
            $table->dateTime('issued_at');
            $table->money('postage_charge');
            $table->money('service_charge');
            $table->userRef('issued_by');
            $table->unsignedInteger('reprint_count')->default(0);
            $table->dateTime('last_reprinted_at')->nullable();
            $table->timestamps();

            $table->unique(['pawn_ticket_id', 'cycle_no', 'letter_no']);
            $table->index(['branch_id', 'issued_at']);
            $table->index('due_date');
        });

        Schema::create('forfeit_promises', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pawn_ticket_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('cycle_no')->default(1);
            $table->date('promise_date');
            $table->text('remark')->nullable();
            $table->status('status', 'pending');       // pending | extended | kept | broken
            $table->foreignId('previous_promise_id')->nullable()->constrained('forfeit_promises')->restrictOnDelete();
            $table->userStamps();
            $table->timestamps();

            $table->index(['pawn_ticket_id', 'cycle_no', 'status']);
            $table->index(['promise_date', 'status']);
        });

        // Lifecycle timeline (non-money events + snapshots).
        Schema::create('pawn_ticket_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pawn_ticket_id')->constrained()->cascadeOnDelete();
            $table->string('event_type', 40);
            $table->dateTime('event_at');
            $table->decimal('amount', 15, 2)->nullable();
            $table->string('description', 500)->nullable();
            $table->json('payload')->nullable();
            $table->userRef('user_id');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['pawn_ticket_id', 'event_at']);
            $table->index(['event_type', 'event_at']);
        });

        // Cashier remarks / customer feedback (old m_pawnfeedbacks).
        Schema::create('pawn_remarks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pawn_ticket_id')->constrained()->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained()->restrictOnDelete();
            $table->text('remark');
            $table->userRef('user_id');
            $table->timestamp('created_at')->useCurrent();

            $table->index('pawn_ticket_id');
            $table->index('customer_id');
        });

        // Vault audit (old checkbox_stock).
        Schema::create('stock_check_sessions', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->dateTime('started_at');
            $table->dateTime('completed_at')->nullable();
            $table->userRef('started_by');
            $table->status('status', 'open');          // open | completed
            $table->string('notes', 500)->nullable();
            $table->timestamps();

            $table->index(['branch_id', 'started_at']);
        });

        Schema::create('stock_check_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('session_id')->constrained('stock_check_sessions')->cascadeOnDelete();
            $table->foreignId('pawn_ticket_id')->constrained()->restrictOnDelete();
            $table->dateTime('checked_at');
            $table->userRef('checked_by');

            $table->unique(['session_id', 'pawn_ticket_id']);
            $table->index('pawn_ticket_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_check_lines');
        Schema::dropIfExists('stock_check_sessions');
        Schema::dropIfExists('pawn_remarks');
        Schema::dropIfExists('pawn_ticket_events');
        Schema::dropIfExists('forfeit_promises');
        Schema::dropIfExists('arrears_letters');
        Schema::dropIfExists('pawn_transactions');
        Schema::dropIfExists('pawn_ticket_items');
        Schema::dropIfExists('pawn_tickets');
    }
};
