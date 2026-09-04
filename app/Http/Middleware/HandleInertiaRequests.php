<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'name' => config('app.name'),
            // For the editor's last-ditch pagehide save (sendBeacon cannot
            // set headers, so the token travels as a form field).
            'csrf' => fn () => csrf_token(),
            'auth' => [
                'user' => $request->user(),
            ],
            // A general one-shot channel for telling the editor what an
            // action did beyond what she asked for — not an error, and not
            // something to confirm. First used to report that a text edit
            // also changed an edition's printed wording, see
            // TranscriptionTextController.
            'flash' => [
                'message' => fn () => $request->session()->get('message'),
                // Which transcription layer the message concerns, when it
                // concerns one — the witness page shows a scoped message
                // only over that layer's pane, never over its neighbour.
                'layer' => fn () => $request->session()->get('message_layer_id'),
            ],
        ];
    }
}
