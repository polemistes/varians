<?php

use Illuminate\Support\Facades\Log;

/**
 * A request over the threshold is logged with its timing and query count;
 * one under it, or with the log disabled, is not. See LogSlowRequests.
 */
test('a request slower than the threshold is logged with its queries', function () {
    config(['app.slow_request_ms' => 1]);
    Log::spy();

    $this->get(route('home'))->assertOk();

    Log::shouldHaveReceived('warning')
        ->withArgs(fn (string $message, array $context) => $message === 'Slow request'
            && $context['route'] === 'home'
            && $context['ms'] >= 1
            && $context['queries'] > 0
            && $context['status'] === 200)
        ->once();
});

test('nothing is logged under the threshold, or when the log is off', function () {
    config(['app.slow_request_ms' => 600000]);
    Log::spy();

    $this->get(route('home'))->assertOk();

    Log::shouldNotHaveReceived('warning');

    config(['app.slow_request_ms' => 0]);

    $this->get(route('home'))->assertOk();

    Log::shouldNotHaveReceived('warning');
});
