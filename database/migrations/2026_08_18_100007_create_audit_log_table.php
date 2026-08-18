<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Append-only audit s hash-reťazou (tamper-evidencia). Bez PII, bez API kľúča. Natrvalo.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_log', function (Blueprint $table) {
            $table->id();
            $table->string('actor')->nullable();
            $table->string('source')->default('manual');       // manual | scheduler | system
            $table->string('action');                          // set|clear|compensate|arm|kill_switch|settings…
            $table->unsignedBigInteger('product_id')->nullable();
            $table->unsignedBigInteger('operation_id')->nullable();
            $table->string('mode')->default('real');           // dry_run | real
            $table->json('params')->nullable();                // zaslané parametre (bez kľúča)
            $table->json('response_summary')->nullable();      // redigovaná odpoveď
            $table->string('result')->nullable();              // ok | failed | skipped…
            $table->string('margin_override_reason')->nullable();
            $table->unsignedBigInteger('snapshot_before_id')->nullable();
            $table->unsignedBigInteger('snapshot_after_id')->nullable();
            $table->string('hash_prev', 64)->nullable();
            $table->string('hash_self', 64);
            $table->unsignedInteger('schema_version')->default(1);
            // len created_at (append-only), bez updated_at
            $table->timestamp('created_at')->nullable();

            $table->index('created_at');
            $table->index(['action', 'result']);
            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_log');
    }
};
