<?php

use App\Models\User;
use Illuminate\Support\Facades\Hash;

test('a user can update their own name and email', function () {
    $user = User::factory()->create(['name' => 'Old Name', 'email' => 'old@example.com']);
    $this->actingAs($user);

    $response = $this->patch(route('profile.update'), [
        'name' => 'New Name',
        'email' => 'new@example.com',
    ]);

    $response->assertRedirect();

    $user->refresh();
    expect($user->name)->toBe('New Name')
        ->and($user->email)->toBe('new@example.com');
});

test('a user can change their password', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->patch(route('profile.update'), [
        'name' => $user->name,
        'email' => $user->email,
        'password' => 'new-password',
        'password_confirmation' => 'new-password',
    ]);

    expect(Hash::check('new-password', $user->fresh()->password))->toBeTrue();
});

test('leaving the password blank keeps the current one', function () {
    $user = User::factory()->create();
    $originalPassword = $user->password;
    $this->actingAs($user);

    $this->patch(route('profile.update'), [
        'name' => $user->name,
        'email' => $user->email,
    ]);

    expect($user->fresh()->password)->toBe($originalPassword);
});

test('a user cannot claim an email already taken by someone else', function () {
    User::factory()->create(['email' => 'taken@example.com']);
    $user = User::factory()->create(['email' => 'mine@example.com']);
    $this->actingAs($user);

    $response = $this->patch(route('profile.update'), [
        'name' => $user->name,
        'email' => 'taken@example.com',
    ]);

    $response->assertInvalid(['email']);
});

test('an anonymous visitor cannot reach the profile page', function () {
    $response = $this->get(route('profile.edit'));

    $response->assertRedirect(route('login'));
});
