<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Krátkodobá cache katalógu (~5 min). NIKDY nie autorita o zľave — tá je živo z getFull.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products_cache', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('product_id')->unique();
            $table->string('name')->nullable();
            $table->decimal('price', 12, 4)->nullable();
            $table->boolean('has_attributes')->default(false);
            $table->json('payload')->nullable();
            $table->timestamp('fetched_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('products_cache');
    }
};
