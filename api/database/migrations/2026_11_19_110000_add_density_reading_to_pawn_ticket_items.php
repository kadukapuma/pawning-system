<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Density meter reading taken when the item is tested at the counter. Optional, for the record only. */
    public function up(): void
    {
        Schema::table('pawn_ticket_items', function (Blueprint $table) {
            $table->decimal('density_reading', 7, 3)->nullable()->after('net_weight');
        });
    }

    public function down(): void
    {
        Schema::table('pawn_ticket_items', function (Blueprint $table) {
            $table->dropColumn('density_reading');
        });
    }
};
