<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Kampaň = pomenovaná sada zliav so stavom; pri armovaní sa množina zmrazí + uloží dry-run snapshot.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('set_type')->default('static');       // static | filter
            $table->json('product_ids')->nullable();             // pri static
            $table->json('filter')->nullable();                  // pri filter
            $table->decimal('reduction', 5, 2);                  // 0 < x <= 30
            $table->date('from');
            $table->date('to');
            $table->string('status')->default('koncept');        // koncept|armovana|bezi|hotova|zrusena
            $table->json('frozen_product_ids')->nullable();      // zmrazené pri armovaní
            $table->json('dry_run_snapshot')->nullable();        // potvrdený dry-run
            $table->string('created_by')->nullable();
            $table->timestamp('armed_at')->nullable();
            $table->timestamps();

            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaigns');
    }
};
