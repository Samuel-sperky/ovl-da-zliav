<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// getFull snapshot pred/po zápisom — dôkaz skutočného stavu v shope. TTL ~90 dní.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('snapshots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('operation_item_id')->nullable()->constrained('operation_items')->nullOnDelete();
            $table->unsignedBigInteger('product_id');
            $table->string('phase');                 // before | after
            $table->json('payload');                 // reduction_*, margin*, sell_price_with_vat, active, qty…
            $table->json('diff')->nullable();        // vypočítaný diff kľúčových polí
            $table->unsignedInteger('schema_version')->default(1);
            $table->timestamp('created_at')->nullable();
            $table->timestamp('expires_at')->nullable();

            $table->index(['product_id', 'phase']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('snapshots');
    }
};
