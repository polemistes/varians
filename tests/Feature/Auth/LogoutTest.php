<?php

use App\Models\User;

test('an authenticated user can log out', function () {
    $this->actingAs(User::factory()->create());

    $response = $this->post(route('logout'));

    $response->assertRedirect(route('home'));
    $this->assertGuest();
});

test('an anonymous visitor cannot log out', function () {
    $response = $this->post(route('logout'));

    $response->assertRedirect(route('login'));
});
