<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Print Designer layouts. One row per printed document. No row, or active = false:
 * the document prints with its standard layout.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('print_designs', function (Blueprint $table) {
            $table->id();
            $table->string('document_key', 50)->unique();
            $table->json('template');
            $table->boolean('active')->default(false);
            $table->foreignId('updated_by')->nullable()->constrained('users');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('print_designs');
    }
};
