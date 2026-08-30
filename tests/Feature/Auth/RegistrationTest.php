<?php

use App\Enums\Role;
use App\Models\User;

test('anyone can register, and new accounts start as a guest', function () {
    // An existing user means this registrant is not the first ever — see
    // the dedicated "first user becomes administrator" test below for that case.
    User::factory()->administrator()->create();

    $response = $this->post(route('register'), [
        'name' => 'New Scholar',
        'email' => 'new-scholar@example.com',
        'password' => 'password',
        'password_confirmation' => 'password',
    ]);

    $response->assertRedirect(route('home'));
    $this->assertAuthenticated();

    $user = User::where('email', 'new-scholar@example.com')->sole();
    expect($user->name)->toBe('New Scholar')
        ->and($user->role)->toBe(Role::Guest);
});

test('role cannot be set through the registration form', function () {
    User::factory()->administrator()->create();

    $this->post(route('register'), [
        'name' => 'Aspiring Admin',
        'email' => 'aspiring@example.com',
        'password' => 'password',
        'password_confirmation' => 'password',
        'role' => 'administrator',
    ]);

    expect(User::where('email', 'aspiring@example.com')->sole()->role)->toBe(Role::Guest);
});

test('the first user ever registered becomes an administrator', function () {
    $response = $this->post(route('register'), [
        'name' => 'First Scholar',
        'email' => 'first@example.com',
        'password' => 'password',
        'password_confirmation' => 'password',
    ]);

    $response->assertRedirect(route('home'));
    expect(User::sole()->role)->toBe(Role::Administrator);
});

test('the second user ever registered stays a guest, even without anyone promoting them', function () {
    $this->post(route('register'), [
        'name' => 'First Scholar',
        'email' => 'first@example.com',
        'password' => 'password',
        'password_confirmation' => 'password',
    ]);
    $this->post(route('logout'));

    $this->post(route('register'), [
        'name' => 'Second Scholar',
        'email' => 'second@example.com',
        'password' => 'password',
        'password_confirmation' => 'password',
    ]);

    expect(User::where('email', 'first@example.com')->sole()->role)->toBe(Role::Administrator)
        ->and(User::where('email', 'second@example.com')->sole()->role)->toBe(Role::Guest);
});

test('registration requires a unique email', function () {
    User::factory()->create(['email' => 'taken@example.com']);

    $response = $this->post(route('register'), [
        'name' => 'Someone',
        'email' => 'taken@example.com',
        'password' => 'password',
        'password_confirmation' => 'password',
    ]);

    $response->assertInvalid(['email']);
});

test('registration requires a matching password confirmation', function () {
    $response = $this->post(route('register'), [
        'name' => 'Someone',
        'email' => 'someone@example.com',
        'password' => 'password',
        'password_confirmation' => 'different',
    ]);

    $response->assertInvalid(['password']);
    expect(User::count())->toBe(0);
});
