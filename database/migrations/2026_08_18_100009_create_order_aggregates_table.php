<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Agregáty predajnosti na produkt pre odporúčania. ŽIADNE PII. TTL ~90 dní.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_aggregates', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('product_id')->unique();
            $table->unsignedInteger('units_sold')->default(0);
            $table->unsignedInteger('qty_in_orders')->default(0);
            $table->date('last_time_in_order')->nullable();
            $table->decimal('sales_velocity', 10, 4)->nullable(); // ks/deň
            $table->timestamp('computed_at')->nullable();
            $table->timestamp('expires_at')->nullable();

            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_aggregates');
    }
};
