<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Redigované odpovede API (bez auth hlavičiek a bez zákazníckych polí). TTL ~90 dní.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_responses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('operation_item_id')->nullable()->constrained('operation_items')->nullOnDelete();
            $table->string('endpoint');
            $table->unsignedSmallInteger('http_status')->nullable();
            $table->json('normalized')->nullable();   // kanonický {success,data,errorCodes} bez PII/kľúča
            $table->timestamp('created_at')->nullable();
            $table->timestamp('expires_at')->nullable();

            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('api_responses');
    }
};
