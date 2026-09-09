<?php

use App\Enums\Role;
use App\Models\User;

test('an administrator can promote a guest to editor', function () {
    $this->actingAs(User::factory()->administrator()->create());
    $guest = User::factory()->create();

    $response = $this->patch(route('admin.users.role.update', $guest), [
        'role' => 'editor',
    ]);

    $response->assertRedirect();
    expect($guest->fresh()->role)->toBe(Role::Editor);
});

test('an administrator can promote a user directly to administrator', function () {
    $this->actingAs(User::factory()->administrator()->create());
    $guest = User::factory()->create();

    $this->patch(route('admin.users.role.update', $guest), [
        'role' => 'administrator',
    ]);

    expect($guest->fresh()->role)->toBe(Role::Administrator);
});

test('an administrator can demote a user back to member', function () {
    $this->actingAs(User::factory()->administrator()->create());
    $editor = User::factory()->editor()->create();

    $this->patch(route('admin.users.role.update', $editor), [
        'role' => 'member',
    ]);

    expect($editor->fresh()->role)->toBe(Role::Member);
});

test('an editor cannot promote anyone — role management is administrator-only', function () {
    $this->actingAs(User::factory()->editor()->create());
    $guest = User::factory()->create();

    $response = $this->patch(route('admin.users.role.update', $guest), [
        'role' => 'editor',
    ]);

    $response->assertForbidden();
    expect($guest->fresh()->role)->toBe(Role::Member);
});

test('a guest cannot promote anyone', function () {
    $this->actingAs(User::factory()->create());
    $other = User::factory()->create();

    $response = $this->patch(route('admin.users.role.update', $other), [
        'role' => 'editor',
    ]);

    $response->assertForbidden();
});

test('an anonymous visitor is redirected to log in when trying to reach the admin panel', function () {
    $response = $this->get(route('admin.users.index'));

    $response->assertRedirect(route('login'));
});

test('the users index lists every user with their role', function () {
    $this->actingAs(User::factory()->administrator()->create());
    User::factory()->count(2)->create();

    $response = $this->get(route('admin.users.index'));

    $response->assertOk();
});

test('the only administrator cannot be demoted — appoint another first', function () {
    $admin = User::factory()->administrator()->create();
    $this->actingAs($admin);

    $this->patch(route('admin.users.role.update', $admin), ['role' => 'member'])
        ->assertSessionHasErrors('role');
    expect($admin->fresh()->role)->toBe(Role::Administrator);

    $second = User::factory()->create();
    $this->patch(route('admin.users.role.update', $second), ['role' => 'administrator']);
    $this->patch(route('admin.users.role.update', $admin), ['role' => 'member'])
        ->assertSessionHasNoErrors();
    expect($admin->fresh()->role)->toBe(Role::Member);
});
