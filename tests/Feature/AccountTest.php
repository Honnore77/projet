<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AccountTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $login = 'admin'): User
    {
        return User::create([
            'login' => $login, 'nom' => 'Admin', 'role' => 'admin',
            'password' => 'Admin2026', 'actif' => true, 'must_change' => false,
        ]);
    }

    public function test_an_administrator_creates_an_account(): void
    {
        $this->actingAs($this->admin())
            ->postJson('/api/accounts', [
                'login' => 'gestion', 'nom' => 'Logistique',
                'role' => 'gestionnaire', 'password' => 'Logi2026',
            ])
            ->assertCreated()
            ->assertJsonPath('account.role', 'gestionnaire')
            // le titulaire doit choisir son propre mot de passe
            ->assertJsonPath('account.mustChange', true);
    }

    public function test_duplicate_identifiers_are_refused(): void
    {
        $this->admin();

        $this->actingAs($this->admin('autre'))
            ->postJson('/api/accounts', ['login' => 'admin', 'nom' => 'X', 'role' => 'visiteur', 'password' => 'Test2026'])
            ->assertStatus(422);
    }

    public function test_non_administrators_are_locked_out(): void
    {
        $visitor = User::create([
            'login' => 'lecteur', 'nom' => 'Lecteur', 'role' => 'visiteur',
            'password' => 'Lect2026', 'actif' => true, 'must_change' => false,
        ]);

        $this->actingAs($visitor)->getJson('/api/accounts')->assertStatus(403);
        $this->actingAs($visitor)->postJson('/api/accounts', [
            'login' => 'x', 'nom' => 'x', 'role' => 'admin', 'password' => 'Test2026',
        ])->assertStatus(403);
    }

    public function test_the_last_active_administrator_cannot_be_demoted(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson("/api/accounts/{$admin->id}", ['role' => 'visiteur'])
            ->assertStatus(422);

        $this->assertSame('admin', $admin->fresh()->role);
    }

    public function test_the_last_active_administrator_cannot_be_disabled(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson("/api/accounts/{$admin->id}", ['actif' => false])
            ->assertStatus(422);

        $this->assertTrue($admin->fresh()->actif);
    }

    public function test_a_second_administrator_makes_demotion_possible(): void
    {
        $first = $this->admin();
        $second = $this->admin('admin2');

        $this->actingAs($first)
            ->putJson("/api/accounts/{$second->id}", ['role' => 'gestionnaire'])
            ->assertOk();

        $this->assertSame('gestionnaire', $second->fresh()->role);
    }

    public function test_you_cannot_delete_your_own_account(): void
    {
        $admin = $this->admin();
        $this->admin('admin2'); // il en reste un autre : ce n'est pas le garde-fou teste ici

        $this->actingAs($admin)
            ->deleteJson("/api/accounts/{$admin->id}")
            ->assertStatus(422);

        $this->assertNotNull(User::find($admin->id));
    }

    public function test_resetting_a_password_revokes_open_sessions(): void
    {
        $admin = $this->admin();
        $target = User::create([
            'login' => 'gestion', 'nom' => 'Logistique', 'role' => 'gestionnaire',
            'password' => 'Logi2026', 'actif' => true, 'must_change' => false,
        ]);
        $target->createToken('poste')->plainTextToken;
        $this->assertSame(1, $target->tokens()->count());

        $this->actingAs($admin)
            ->postJson("/api/accounts/{$target->id}/password", ['password' => 'Neuf2026'])
            ->assertOk()
            ->assertJsonPath('account.mustChange', true);

        // Un mot de passe reinitialise doit fermer les sessions ouvertes avec
        // l'ancien, sinon la reinitialisation ne protege de rien.
        $this->assertSame(0, $target->fresh()->tokens()->count());
    }

    public function test_weak_passwords_are_refused_on_creation(): void
    {
        $this->actingAs($this->admin())
            ->postJson('/api/accounts', ['login' => 'x', 'nom' => 'X', 'role' => 'visiteur', 'password' => 'court'])
            ->assertStatus(422);
    }
}
