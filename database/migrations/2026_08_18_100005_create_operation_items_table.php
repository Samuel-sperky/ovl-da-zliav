<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Položka dávky so stavovým automatom (idempotencia, kompenzácia, priebeh v UI).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operation_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('operation_id')->constrained('operations')->cascadeOnDelete();
            $table->unsignedBigInteger('product_id');
            $table->date('from')->nullable();
            $table->date('to')->nullable();
            $table->decimal('reduction', 5, 2)->nullable();          // 0 = clear
            $table->decimal('override_reduction', 5, 2)->nullable(); // per-riadok override %
            $table->string('override_reason')->nullable();           // dôvod pri min-margin override
            // pending|dry_run_ok|awaiting_confirm|queued|sent|verified|failed|compensated|
            // skipped_flash_sale|skipped_low_margin|uncertain
            $table->string('state')->default('pending');
            $table->string('dedup_key')->nullable();                 // id|from|to|reduction
            $table->string('error_code')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamps();

            $table->index(['operation_id', 'state']);
            $table->index('product_id');
            $table->index('dedup_key');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('operation_items');
    }
};
