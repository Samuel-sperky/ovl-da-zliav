<?php

namespace App\Providers;

use App\Services\Api\RateBudget;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // RateBudget s rezervou z konfigurácie (fallback 10).
        $this->app->singleton(RateBudget::class, fn () => new RateBudget(
            (int) config('sperky.guards.rate_reserve_per_min', 10),
        ));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
