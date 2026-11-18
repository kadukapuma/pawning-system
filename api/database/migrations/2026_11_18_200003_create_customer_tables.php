<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One record per person across all branches (unique NIC).
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->branchRef();                       // registered at
            $table->string('code', 20)->unique();
            $table->string('title', 10)->nullable();   // Mr, Mrs, Miss, Rev ...
            $table->string('first_name', 80);
            $table->string('middle_name', 80)->nullable();
            $table->string('last_name', 80)->nullable();
            $table->string('full_name', 250)
                ->storedAs("CONCAT_WS(' ', first_name, middle_name, last_name)");
            $table->string('gender', 10)->nullable();
            $table->string('nic', 20)->unique();
            $table->string('driving_license', 30)->nullable();
            $table->string('passport', 30)->nullable();
            $table->string('other_identification', 50)->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('address_line1', 150);
            $table->string('address_line2', 150)->nullable();
            $table->string('city', 60)->nullable();
            $table->string('phone1', 20);
            $table->string('phone2', 20)->nullable();
            $table->string('email', 150)->nullable();
            $table->string('photo_path')->nullable();
            $table->status('status', 'active');        // active | inactive | blacklisted
            $table->decimal('pawn_amount_limit', 15, 2)->nullable();
            $table->unsignedSmallInteger('pawn_count_limit')->nullable();
            $table->text('notes')->nullable();
            $table->userStamps();
            $table->timestamps();
            $table->softDeletes();

            $table->index('phone1');
            $table->index('full_name');
            $table->index(['branch_id', 'status']);
            $table->fullText(['full_name', 'address_line1']);
        });

        Schema::create('customer_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->string('type', 30);                // nic_front, nic_back, photo, other
            $table->string('file_path');
            $table->userRef('uploaded_by');
            $table->timestamp('created_at')->useCurrent();

            $table->index('customer_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_documents');
        Schema::dropIfExists('customers');
    }
};
