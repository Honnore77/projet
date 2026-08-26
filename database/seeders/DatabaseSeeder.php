<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Cree le premier compte administrateur si aucun compte n'existe.
 *
 * Sans effet si un compte est deja present : ce seeder peut donc etre appele
 * a chaque deploiement sans risque d'ecraser quoi que ce soit.
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (User::query()->exists()) {
            $this->command?->info('Des comptes existent déjà — aucun compte créé.');

            return;
        }

        User::create([
            'login' => 'admin',
            'nom' => 'Administrateur',
            'role' => 'admin',
            'password' => 'admin',
            'actif' => true,
            'must_change' => true,
        ]);

        $this->command?->warn('Compte administrateur créé : admin / admin — à changer à la première connexion.');
    }
}
