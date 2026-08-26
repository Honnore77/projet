<?php

namespace Tests\Feature;

use App\Models\Personnel;
use App\Models\Setting;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class SyncTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::create([
            'login' => 'admin', 'nom' => 'Admin', 'role' => 'admin',
            'password' => 'Admin2026', 'actif' => true, 'must_change' => false,
        ]);
    }

    private function visitor(): User
    {
        return User::create([
            'login' => 'lecteur', 'nom' => 'Lecteur', 'role' => 'visiteur',
            'password' => 'Lect2026', 'actif' => true, 'must_change' => false,
        ]);
    }

    private function upsert(string $collection, string $id, array $data, ?string $at = null): array
    {
        return [
            'seq' => 1,
            'op' => 'upsert',
            'collection' => $collection,
            'id' => $id,
            'at' => $at ?? now()->toIso8601String(),
            'data' => $data,
        ];
    }

    public function test_push_then_pull_round_trips_a_record(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', [
                'categorie' => 'pool',
                'marque' => 'Toyota',
                'modele' => 'Hilux',
                'immatNouvelle' => 'AA-123-BC',
                'km' => 84210,
            ])],
        ])->assertOk()->assertJsonPath('applied', [1]);

        $this->actingAs($admin)->getJson('/api/pull')
            ->assertOk()
            ->assertJsonPath('collections.vehicles.0.immatNouvelle', 'AA-123-BC')
            ->assertJsonPath('collections.vehicles.0.km', 84210)
            ->assertJsonPath('collections.vehicles.0.categorie', 'pool');
    }

    public function test_absent_values_come_back_as_empty_strings(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', ['categorie' => 'pool', 'marque' => 'Toyota'])],
        ])->assertOk();

        // L'interface concatene ces champs sans les tester : une valeur nulle
        // y afficherait le mot « null ».
        $this->actingAs($admin)->getJson('/api/pull')
            ->assertJsonPath('collections.vehicles.0.couleur', '')
            ->assertJsonPath('collections.vehicles.0.observations', '');
    }

    public function test_nested_lists_survive_the_round_trip(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('users', 'p1', [
                'nom' => 'KOFFI',
                'prenoms' => 'Jean',
                'historique' => [
                    ['nature' => 'Retard', 'date' => '2026-05-12', 'vehicule' => 'AA-123-BC'],
                ],
            ])],
        ])->assertOk();

        $this->actingAs($admin)->getJson('/api/pull')
            ->assertJsonPath('collections.users.0.historique.0.nature', 'Retard')
            ->assertJsonCount(1, 'collections.users.0.historique');
    }

    public function test_unknown_fields_are_ignored(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', [
                'categorie' => 'pool',
                'marque' => 'Toyota',
                'colonne_inventee' => 'ne doit pas etre ecrite',
            ])],
        ])->assertOk();

        $this->assertSame('Toyota', Vehicle::find('v1')->marque);
        $this->assertArrayNotHasKey('colonne_inventee', Vehicle::find('v1')->getAttributes());
    }

    public function test_a_stale_operation_is_rejected_and_reported(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', ['categorie' => 'pool', 'marque' => 'Récent'])],
        ])->assertOk();

        // Une modification faite hors ligne il y a une heure arrive apres coup.
        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert(
                'vehicles',
                'v1',
                ['categorie' => 'pool', 'marque' => 'Ancien'],
                Carbon::now()->subHour()->toIso8601String()
            )],
        ])->assertOk()->assertJsonPath('skipped.0.reason', 'obsolete');

        $this->assertSame('Récent', Vehicle::find('v1')->marque);
    }

    public function test_deletions_are_propagated_as_tombstones(): void
    {
        $admin = $this->admin();
        $since = now()->subMinute()->toIso8601String();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('users', 'p1', ['nom' => 'KOFFI'])],
        ])->assertOk();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [[
                'seq' => 2, 'op' => 'delete', 'collection' => 'users',
                'id' => 'p1', 'at' => now()->toIso8601String(),
            ]],
        ])->assertOk()->assertJsonPath('applied', [2]);

        // Sans pierre tombale, les autres postes ne sauraient jamais que la
        // fiche a disparu et la feraient reapparaitre a la synchronisation.
        $this->actingAs($admin)->getJson('/api/pull?since='.urlencode($since))
            ->assertJsonCount(0, 'collections.users')
            ->assertJsonPath('deleted.users.0', 'p1');

        $this->assertSoftDeleted(Personnel::withTrashed()->find('p1'));
    }

    public function test_deleting_an_unknown_record_is_not_an_error(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [[
                'seq' => 1, 'op' => 'delete', 'collection' => 'missions',
                'id' => 'jamais-vu', 'at' => now()->toIso8601String(),
            ]],
        ])->assertOk()->assertJsonPath('applied', [1]);
    }

    public function test_recreating_a_deleted_record_restores_it(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', ['categorie' => 'pool', 'marque' => 'Toyota'])],
        ]);
        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [['seq' => 2, 'op' => 'delete', 'collection' => 'vehicles', 'id' => 'v1', 'at' => now()->toIso8601String()]],
        ]);
        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', ['categorie' => 'pool', 'marque' => 'Toyota'])],
        ])->assertOk();

        $this->assertNotNull(Vehicle::find('v1'));
    }

    public function test_incremental_pull_only_returns_what_changed(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', ['categorie' => 'pool', 'marque' => 'Ancien'])],
        ]);

        $cutoff = now()->addMinute()->toIso8601String();

        $this->actingAs($admin)->getJson('/api/pull?since='.urlencode($cutoff))
            ->assertOk()
            ->assertJsonPath('full', false)
            ->assertJsonCount(0, 'collections.vehicles');
    }

    public function test_settings_are_shared_and_filtered(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [[
                'seq' => 1, 'op' => 'settings', 'at' => now()->toIso8601String(),
                'data' => ['organisation' => 'PDU Abidjan', 'cle_inventee' => 'ignoree'],
            ]],
        ])->assertOk();

        $this->actingAs($admin)->getJson('/api/pull')
            ->assertJsonPath('settings.organisation', 'PDU Abidjan')
            ->assertJsonMissingPath('settings.cle_inventee');

        $this->assertSame(Setting::DEFAULTS['devise'], Setting::payload()['devise']);
    }

    public function test_a_visitor_can_read_but_not_write(): void
    {
        $admin = $this->admin();
        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v1', ['categorie' => 'pool', 'marque' => 'Toyota'])],
        ]);

        $visitor = $this->visitor();

        $this->actingAs($visitor)->getJson('/api/pull')
            ->assertOk()
            ->assertJsonCount(1, 'collections.vehicles');

        $this->actingAs($visitor)->postJson('/api/push', [
            'operations' => [$this->upsert('vehicles', 'v2', ['categorie' => 'pool', 'marque' => 'Interdit'])],
        ])->assertStatus(403);

        $this->assertNull(Vehicle::find('v2'));
    }

    public function test_only_administrators_receive_the_account_list(): void
    {
        $this->actingAs($this->admin())->getJson('/api/pull')->assertJsonStructure(['accounts']);
        $this->actingAs($this->visitor())->getJson('/api/pull')->assertJsonMissingPath('accounts');
    }

    public function test_an_unknown_collection_is_reported_not_fatal(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/push', [
            'operations' => [
                $this->upsert('collection_inexistante', 'x1', ['a' => 1]),
                array_merge($this->upsert('vehicles', 'v1', ['categorie' => 'pool', 'marque' => 'Toyota']), ['seq' => 2]),
            ],
        ])->assertOk()
            ->assertJsonPath('skipped.0.reason', 'collection-inconnue')
            ->assertJsonPath('applied', [2]);

        $this->assertNotNull(Vehicle::find('v1'));
    }
}
