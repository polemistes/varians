<?php

use App\Models\User;

test('a user can log in with valid credentials', function () {
    $user = User::factory()->create(['email' => 'scholar@example.com']);

    $response = $this->post(route('login'), [
        'email' => 'scholar@example.com',
        'password' => 'password',
    ]);

    $response->assertRedirect(route('home'));
    $this->assertAuthenticatedAs($user);
});

test('login fails with an invalid password', function () {
    User::factory()->create(['email' => 'scholar@example.com']);

    $response = $this->post(route('login'), [
        'email' => 'scholar@example.com',
        'password' => 'wrong-password',
    ]);

    $response->assertInvalid(['email']);
    $this->assertGuest();
});

test('login fails for an email that does not exist', function () {
    $response = $this->post(route('login'), [
        'email' => 'nobody@example.com',
        'password' => 'password',
    ]);

    $response->assertInvalid(['email']);
    $this->assertGuest();
});

test('an already-authenticated user is redirected away from the login page', function () {
    $this->actingAs(User::factory()->create());

    $response = $this->get(route('login'));

    $response->assertRedirect();
});
