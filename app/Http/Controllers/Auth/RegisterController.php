<?php

namespace App\Http\Controllers\Auth;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

class RegisterController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('Auth/Register');
    }

    /**
     * Role is otherwise never set here — it comes from the `users` table's
     * default ('guest'), since `role` isn't mass-assignable. The one
     * exception: the very first account ever registered becomes an
     * Administrator, so a fresh install always has someone able to promote
     * others — otherwise nobody could ever reach the admin panel.
     */
    public function store(RegisterRequest $request): RedirectResponse
    {
        $isFirstUser = User::doesntExist();

        $user = User::create([
            'name' => $request->validated('name'),
            'email' => $request->validated('email'),
            'password' => $request->validated('password'),
        ]);

        if ($isFirstUser) {
            $user->forceFill(['role' => Role::Administrator])->save();
        }

        Auth::login($user);
        $request->session()->regenerate();

        return redirect()->route('home');
    }
}
