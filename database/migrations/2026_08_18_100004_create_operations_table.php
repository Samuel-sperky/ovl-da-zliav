<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Jedna dávka (manuálna alebo zo schedulera): set / clear / compensate; dry-run alebo reálne.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operations', function (Blueprint $table) {
            $table->id();
            $table->string('source')->default('manual');   // manual | scheduler
            $table->foreignId('campaign_id')->nullable()->constrained('campaigns')->nullOnDelete();
            $table->string('type')->default('set');         // set | clear | compensate
            $table->string('mode')->default('dry_run');     // dry_run | real
            $table->json('summary')->nullable();            // počty: total/ok/failed/skipped…
            $table->string('actor')->nullable();
            $table->timestamps();

            $table->index(['source', 'type', 'mode']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('operations');
    }
};
