<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Free-text sub category for an item type (e.g. "Ladies", "Gents", "Kids"). */
    public function up(): void
    {
        Schema::table('article_types', function (Blueprint $table) {
            $table->string('sub_category', 100)->nullable()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('article_types', function (Blueprint $table) {
            $table->dropColumn('sub_category');
        });
    }
};
