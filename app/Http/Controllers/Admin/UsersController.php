<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateUserRoleRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class UsersController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Admin/Users', [
            'users' => User::orderBy('name')->get(['id', 'name', 'email', 'role', 'created_at']),
        ]);
    }

    /**
     * `role` isn't mass-assignable (guards against privilege escalation via
     * any other write path), so this is the one deliberate place it's set —
     * via forceFill, after this route's own role:administrator gate.
     */
    public function updateRole(UpdateUserRoleRequest $request, User $user): RedirectResponse
    {
        $role = Role::from($request->validated('role'));

        // A site with no administrator has nobody left to appoint one.
        if ($role !== Role::Administrator
            && $user->role === Role::Administrator
            && ! User::where('role', Role::Administrator)->whereKeyNot($user->id)->exists()) {
            throw ValidationException::withMessages([
                'role' => 'This is the only administrator — appoint another before changing this role.',
            ]);
        }

        $user->forceFill(['role' => $role])->save();

        return back();
    }
}
