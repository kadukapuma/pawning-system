<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('forfeitures', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('forfeit_no', 20);
            $table->foreignId('pawn_ticket_id')->unique()->constrained()->restrictOnDelete(); // forfeited once
            $table->date('forfeit_date');
            $table->money('principal_at_forfeit');
            $table->money('interest_at_forfeit');
            $table->money('charges_at_forfeit');
            $table->money('total_due');
            $table->userRef('approved_by');
            $table->userRef('created_by');
            $table->foreignId('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->timestamps();

            $table->unique(['branch_id', 'forfeit_no']);
            $table->index(['branch_id', 'forfeit_date']);
        });

        Schema::create('stock_transfer_batches', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('batch_no', 20);
            $table->dateTime('transferred_at');
            $table->userRef('user_id');
            $table->string('notes', 500)->nullable();
            $table->timestamps();

            $table->unique(['branch_id', 'batch_no']);
        });

        Schema::create('inventory_items', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('item_code', 20)->unique();
            $table->string('barcode', 40)->unique();
            $table->string('source', 10)->default('forfeit'); // forfeit | purchase
            $table->foreignId('forfeiture_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('pawn_ticket_item_id')->nullable()->unique()->constrained()->restrictOnDelete();
            $table->foreignId('transfer_batch_id')->nullable()->constrained('stock_transfer_batches')->restrictOnDelete();
            $table->foreignId('category_id')->constrained('article_categories')->restrictOnDelete();
            $table->foreignId('article_type_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('karat_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('description', 255)->nullable();
            $table->unsignedSmallInteger('quantity')->default(1);
            $table->weight('gross_weight');
            $table->weight('net_weight');
            $table->money('cost_price');
            $table->money('sale_price');
            $table->status('status', 'in_stock');      // in_stock | reserved | sold | written_off
            $table->dateTime('received_at');
            $table->dateTime('sold_at')->nullable();
            $table->timestamps();

            $table->index(['branch_id', 'status']);
            $table->index(['category_id', 'status']);
            $table->index('forfeiture_id');
        });

        Schema::create('stock_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('inventory_item_id')->constrained()->restrictOnDelete();
            $table->branchRef();
            $table->string('movement_type', 20);       // forfeit_in | sale | return | adjustment | write_off
            $table->decimal('qty_in', 10, 3)->default(0);
            $table->decimal('qty_out', 10, 3)->default(0);
            $table->string('reference_type', 60)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->dateTime('moved_at');
            $table->userRef('user_id');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['inventory_item_id', 'moved_at']);
            $table->index(['branch_id', 'movement_type', 'moved_at']);
            $table->index(['reference_type', 'reference_id']);
        });

        Schema::create('sales_invoices', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->string('invoice_no', 20);
            $table->dateTime('invoice_date');
            $table->foreignId('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('customer_name', 150)->nullable();
            $table->string('customer_phone', 20)->nullable();
            $table->money('gross_amount');
            $table->money('discount');
            $table->money('net_amount');
            $table->money('paid_cash');
            $table->money('paid_card');
            $table->money('paid_cheque');
            $table->money('credit_amount');
            $table->status('status', 'completed');     // completed | voided
            $table->userRef('voided_by');
            $table->dateTime('voided_at')->nullable();
            $table->string('void_reason', 500)->nullable();
            $table->foreignId('journal_entry_id')->nullable()->constrained()->restrictOnDelete();
            $table->userRef('created_by');
            $table->timestamps();

            $table->unique(['branch_id', 'invoice_no']);
            $table->index(['branch_id', 'invoice_date']);
            $table->index('customer_id');
        });

        Schema::create('sales_invoice_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sales_invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignId('inventory_item_id')->constrained()->restrictOnDelete();
            $table->string('description', 255)->nullable();
            $table->decimal('qty', 10, 3)->default(1);
            $table->money('unit_price');
            $table->money('discount');
            $table->money('line_total');
            $table->timestamps();

            $table->index('inventory_item_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_invoice_lines');
        Schema::dropIfExists('sales_invoices');
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('inventory_items');
        Schema::dropIfExists('stock_transfer_batches');
        Schema::dropIfExists('forfeitures');
    }
};
