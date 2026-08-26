<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(array $attrs = []): User
    {
        return User::create(array_merge([
            'login' => 'gestion',
            'nom' => 'Service Logistique',
            'role' => 'gestionnaire',
            'password' => 'Logi2026',
            'actif' => true,
            'must_change' => false,
        ], $attrs));
    }

    public function test_health_is_public(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonPath('status', 'ok');
    }

    public function test_login_returns_a_token(): void
    {
        $this->makeUser();

        $this->postJson('/api/login', ['login' => 'gestion', 'password' => 'Logi2026'])
            ->assertOk()
            ->assertJsonStructure(['token', 'user' => ['id', 'login', 'role'], 'serverTime'])
            ->assertJsonPath('user.role', 'gestionnaire');
    }

    public function test_login_is_case_insensitive_on_the_identifier(): void
    {
        $this->makeUser();

        $this->postJson('/api/login', ['login' => 'GESTION', 'password' => 'Logi2026'])->assertOk();
    }

    public function test_wrong_password_is_rejected(): void
    {
        $this->makeUser();

        $this->postJson('/api/login', ['login' => 'gestion', 'password' => 'nimportequoi'])
            ->assertStatus(401);
    }

    public function test_a_disabled_account_cannot_log_in(): void
    {
        $this->makeUser(['actif' => false]);

        $this->postJson('/api/login', ['login' => 'gestion', 'password' => 'Logi2026'])
            ->assertStatus(403);
    }

    public function test_protected_routes_require_a_token(): void
    {
        $this->getJson('/api/pull')->assertStatus(401);
        $this->postJson('/api/push', ['operations' => []])->assertStatus(401);
        $this->getJson('/api/accounts')->assertStatus(401);
    }

    public function test_password_change_requires_the_current_one(): void
    {
        $user = $this->makeUser();

        $this->actingAs($user)
            ->postJson('/api/password', ['current' => 'faux', 'password' => 'Neuf2026'])
            ->assertStatus(422);

        $this->actingAs($user)
            ->postJson('/api/password', ['current' => 'Logi2026', 'password' => 'Neuf2026'])
            ->assertOk()
            ->assertJsonPath('user.mustChange', false);
    }

    public function test_password_rules_are_enforced(): void
    {
        $user = $this->makeUser();

        // trop court
        $this->actingAs($user)
            ->postJson('/api/password', ['current' => 'Logi2026', 'password' => 'ab1'])
            ->assertStatus(422);

        // sans chiffre
        $this->actingAs($user)
            ->postJson('/api/password', ['current' => 'Logi2026', 'password' => 'seulementdeslettres'])
            ->assertStatus(422);
    }

    public function test_brute_force_is_throttled(): void
    {
        $this->makeUser();

        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/login', ['login' => 'gestion', 'password' => "faux{$i}"])->assertStatus(401);
        }

        $this->postJson('/api/login', ['login' => 'gestion', 'password' => 'encorefaux'])
            ->assertStatus(429);
    }
}
