<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Rate grades, e.g. "B4 - 22KT". Rates themselves are versioned in karat_rates.
        Schema::create('karats', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();      // B4, A0, SILVER
            $table->string('name', 60);                // "B4 - 22KT"
            $table->string('metal', 10)->default('gold'); // gold | silver
            $table->decimal('purity_karat', 5, 2)->nullable(); // 22.00
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['is_active', 'sort_order']);
        });

        // All rates are per 8 g (one sovereign), as in the old system.
        Schema::create('karat_rates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('karat_id')->constrained()->restrictOnDelete();
            $table->dateTime('effective_from');
            $table->decimal('pawn_rate_per_8g', 12, 2);
            $table->decimal('assess_rate_per_8g', 12, 2)->default(0);
            $table->decimal('market_rate_per_8g', 12, 2)->default(0);
            $table->decimal('sale_rate_per_8g', 12, 2)->default(0);
            $table->userRef('created_by');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['karat_id', 'effective_from']);   // "latest rate <= now"
        });

        Schema::create('article_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 60)->unique();      // Earing, Chain, Bangle, SILVER ...
            $table->string('metal', 10)->default('gold');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('article_types', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained('article_categories')->restrictOnDelete();
            $table->string('code', 20)->unique();      // ITM-0001
            $table->string('name', 100);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['category_id', 'name']);
        });

        Schema::create('article_conditions', function (Blueprint $table) {
            $table->id();
            $table->string('name', 60)->unique();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Receipt types: A / B / C (by loan amount band) and SILVER.
        Schema::create('pawn_schemes', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->string('name', 60);
            $table->string('metal', 10)->default('gold');
            $table->status('interest_method', 'tiered'); // tiered | monthly_penalty | silver
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Immutable: editing a scheme closes the current row and inserts a new one.
        // Tickets reference the version they were issued/renewed under.
        Schema::create('pawn_scheme_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scheme_id')->constrained('pawn_schemes')->restrictOnDelete();
            $table->date('effective_from');
            $table->date('effective_to')->nullable();

            // Amount band used to pick A/B/C for a loan amount.
            $table->decimal('min_amount', 15, 2)->default(0);
            $table->decimal('max_amount', 15, 2)->nullable();

            // Term.
            $table->unsignedSmallInteger('valid_days')->default(0);   // old validPeriod (To_Date)
            $table->unsignedTinyInteger('max_term_months')->default(12);

            // Interest tiers: up to periodN days -> rateN % (flat); after period3 -> rate3 per month.
            $table->unsignedSmallInteger('period1_days')->default(10);
            $table->rate('rate1');
            $table->unsignedSmallInteger('period2_days')->default(15);
            $table->rate('rate2');
            $table->unsignedSmallInteger('period3_days')->default(30);
            $table->rate('rate3');
            $table->rate('penalty_rate_monthly');      // old hard-coded 0.5% for type D

            // Charges.
            $table->money('service_charge');
            $table->money('service_charge_below_threshold'); // old s_charge_less
            $table->rate('service_charge_above_percent');    // old s_charge_greater
            $table->decimal('service_charge_threshold', 15, 2)->default(25000);
            $table->money('document_charge');
            $table->money('stamp_duty');
            $table->money('postage_charge');           // per arrears letter

            // Arrears schedule (days).
            $table->unsignedSmallInteger('letter_1_days')->default(0);
            $table->unsignedSmallInteger('letter_2_days')->default(21);
            $table->unsignedSmallInteger('letter_3_days')->default(21);
            $table->unsignedSmallInteger('forfeit_reminder_days')->default(21);

            // Part-payment rule.
            $table->decimal('min_capital_after_part_payment', 15, 2)->default(1000);

            $table->userRef('created_by');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['scheme_id', 'effective_from', 'effective_to'], 'psv_scheme_effective_idx');
            $table->index(['effective_from', 'min_amount'], 'psv_effective_amount_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pawn_scheme_versions');
        Schema::dropIfExists('pawn_schemes');
        Schema::dropIfExists('article_conditions');
        Schema::dropIfExists('article_types');
        Schema::dropIfExists('article_categories');
        Schema::dropIfExists('karat_rates');
        Schema::dropIfExists('karats');
    }
};
