<?php

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

/**
 * Length, and nothing else. Composition rules do not produce hard passwords;
 * they produce "P@ssw0rd1". See AppServiceProvider::configureDefaults.
 */

/** The policy only applies in production, so tests may register with 'password'. */
beforeEach(function () {
    $this->app['env'] = 'production';
});

/**
 * uncompromised() asks api.pwnedpasswords.com for the hashes sharing this
 * password's prefix. Set per test rather than in beforeEach: Http::fake merges
 * its stubs, so an earlier catch-all would answer before a later one.
 */
function breachApiReturns(string $body): void
{
    Http::fake(['api.pwnedpasswords.com/*' => Http::response($body, 200)]);
}

function passwordFails(string $password): bool
{
    return Validator::make(
        ['password' => $password],
        ['password' => ['required', Password::defaults()]],
    )->fails();
}

test('a passphrase of unrelated words is accepted, with no capitals, digits or symbols', function () {
    breachApiReturns('');

    // Four words, 25 characters, nothing but lowercase letters and spaces —
    // and refused outright by the rules this replaced.
    expect(passwordFails('rowan thimble gravel dusk'))->toBeFalse();
});

test('fifteen characters is the whole requirement', function () {
    breachApiReturns('');

    expect(passwordFails(str_repeat('a', 15)))->toBeFalse()
        ->and(passwordFails(str_repeat('a', 14)))->toBeTrue();
});

test('nothing is required of the characters themselves', function () {
    breachApiReturns('');

    // The second would have failed letters(), the third mixedCase() and
    // numbers(), under the rules this replaced.
    foreach ([
        'kirsebær plomme rogn eik',
        '................',
        'aaaaaaaaaaaaaaaaaaaa',
    ] as $password) {
        expect(passwordFails($password))->toBeFalse();
    }
});

test('a password known to be breached is still refused', function () {
    // The one check kept, because it is not a composition rule: NIST
    // recommends screening against breach corpora.
    $hash = strtoupper(sha1('rowan thimble gravel dusk'));
    breachApiReturns(substr($hash, 5).":42\r\n");

    expect(passwordFails('rowan thimble gravel dusk'))->toBeTrue();
});

test('the policy does not apply outside production, so tests can use short passwords', function () {
    $this->app['env'] = 'local';

    expect(passwordFails('password'))->toBeFalse();
});
