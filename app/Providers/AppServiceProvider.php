<?php

namespace App\Providers;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        // Length, and nothing else. Requiring mixed case, digits and symbols
        // does not produce hard passwords: it produces "P@ssw0rd1" — highly
        // predictable to an attacker and unpleasant for the person typing it.
        // Fifteen characters admits the passphrase the registration form
        // advises, four or five unrelated words, which is far stronger than
        // anything a composition rule elicits. This follows NIST SP 800-63B,
        // which recommends against composition requirements outright.
        //
        // `uncompromised()` is kept because it is not a composition rule: it
        // checks the password against known breach corpora, which NIST does
        // recommend. It never fires for a genuine passphrase and it fails open
        // when the API cannot be reached.
        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(15)->uncompromised()
            : null,
        );
    }
}
