<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Writes a line to the log for every request that took longer than
 * `app.slow_request_ms`: the route, how long it took, and how many queries
 * it ran and how long they took — so that a production server that is
 * slow "sometimes" can be read rather than guessed at (the framework's
 * own boot is the difference between the two timings, the queries say
 * whether the database or the code is waiting).
 *
 * Counted from LARAVEL_START, the very first thing the front controller
 * does, so the framework's boot is included; logged from terminate(), after
 * the response has gone out, so the logging itself costs the user nothing.
 */
class LogSlowRequests
{
    /**
     * The query tally rides on the request, not on this object: the kernel
     * resolves a fresh instance for terminate(), so a property set in
     * handle() would never be seen there.
     */
    private const TALLY = 'slow_request_queries';

    public function handle(Request $request, Closure $next): Response
    {
        if ($this->threshold() > 0) {
            $tally = new \ArrayObject(['queries' => 0, 'ms' => 0.0]);
            $request->attributes->set(self::TALLY, $tally);

            DB::listen(function (QueryExecuted $query) use ($tally): void {
                $tally['queries']++;
                $tally['ms'] += $query->time;
            });
        }

        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        $threshold = $this->threshold();

        if ($threshold <= 0) {
            return;
        }

        // The front controller's own clock, else the request's — a server
        // variable, so a string until read as a number.
        $requestTime = $request->server('REQUEST_TIME_FLOAT');
        $started = defined('LARAVEL_START')
            ? LARAVEL_START
            : (is_numeric($requestTime) ? (float) $requestTime : microtime(true));
        $ms = (int) round((microtime(true) - $started) * 1000);

        if ($ms < $threshold) {
            return;
        }

        /** @var \ArrayObject<string, int|float>|null $tally */
        $tally = $request->attributes->get(self::TALLY);

        Log::warning('Slow request', [
            'method' => $request->method(),
            'path' => '/'.ltrim($request->path(), '/'),
            'route' => $request->route()?->getName(),
            'status' => $response->getStatusCode(),
            'ms' => $ms,
            'queries' => (int) ($tally['queries'] ?? 0),
            'query_ms' => (int) round((float) ($tally['ms'] ?? 0)),
            'user' => $request->user()?->id,
        ]);
    }

    private function threshold(): int
    {
        return (int) config('app.slow_request_ms', 0);
    }
}
