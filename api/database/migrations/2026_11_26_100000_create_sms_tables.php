<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Single row: the master switch and the fallback language.
        Schema::create('sms_settings', function (Blueprint $table) {
            $table->id();
            $table->boolean('enabled')->default(false);
            $table->string('default_language', 2)->default('en');
            $table->userRef('updated_by');
            $table->timestamps();
        });

        // When each message type is sent.
        Schema::create('sms_rules', function (Blueprint $table) {
            $table->id();
            $table->string('type', 30)->unique();
            $table->status('mode', 'off');             // off | auto | manual
            $table->json('offsets')->nullable();       // days before / after the date that matters
            $table->string('send_time', 5)->nullable(); // HH:MM, automatic reminders only
            $table->date('last_run_on')->nullable();
            $table->userRef('updated_by');
            $table->timestamps();
        });

        Schema::create('sms_templates', function (Blueprint $table) {
            $table->id();
            $table->string('type', 30);
            $table->string('language', 2);             // en | si | ta
            $table->text('body');
            $table->userRef('updated_by');
            $table->timestamps();

            $table->unique(['type', 'language']);
        });

        // Outbox and history.
        Schema::create('sms_messages', function (Blueprint $table) {
            $table->id();
            $table->branchRef();
            $table->foreignId('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('pawn_ticket_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('type', 30);
            $table->string('language', 2);
            $table->string('phone', 20);
            $table->text('body');
            $table->unsignedSmallInteger('segments')->default(1);
            $table->status('status', 'queued');        // queued | sending | sent | failed | cancelled
            $table->string('dedupe_key', 100)->nullable()->unique(); // stops the same reminder going twice
            $table->char('batch_ref', 36)->nullable();
            $table->string('error', 500)->nullable();
            $table->dateTime('queued_at');
            $table->dateTime('sent_at')->nullable();
            $table->userRef('created_by');
            $table->timestamps();

            $table->index(['branch_id', 'status']);
            $table->index(['branch_id', 'created_at']);
            $table->index(['status', 'queued_at']);
            $table->index(['type', 'created_at']);
            $table->index('batch_ref');
        });

        Schema::table('customers', function (Blueprint $table) {
            $table->string('sms_language', 2)->nullable()->after('email'); // null = company default
        });
    }

    public function down(): void
    {
        Schema::table('customers', fn (Blueprint $table) => $table->dropColumn('sms_language'));
        Schema::dropIfExists('sms_messages');
        Schema::dropIfExists('sms_templates');
        Schema::dropIfExists('sms_rules');
        Schema::dropIfExists('sms_settings');
    }
};
