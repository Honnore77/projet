<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Compte d'acces a l'application.
 *
 * Trois roles :
 *   admin        — tout, y compris la gestion des comptes et des reglages
 *   gestionnaire — saisie et modification des donnees du parc
 *   visiteur     — consultation et exports uniquement
 */
#[Fillable(['login', 'nom', 'email', 'password', 'role', 'actif', 'must_change'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    public const ROLES = ['admin', 'gestionnaire', 'visiteur'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'actif' => 'boolean',
            'must_change' => 'boolean',
        ];
    }

    public function canWrite(): bool
    {
        return in_array($this->role, ['admin', 'gestionnaire'], true);
    }

    public function isAdmin(): bool
    {
        return $this->role === 'admin';
    }

    /** Representation envoyee a l'interface. */
    public function toClientArray(): array
    {
        return [
            'id' => (string) $this->id,
            'login' => $this->login,
            'nom' => $this->nom,
            'role' => $this->role,
            'actif' => (bool) $this->actif,
            'mustChange' => (bool) $this->must_change,
            'lastLogin' => optional($this->last_login_at)->toIso8601String() ?? '',
            'createdAt' => optional($this->created_at)->toIso8601String() ?? '',
        ];
    }

    /** Nombre d'administrateurs encore actifs — sert de garde-fou. */
    public static function activeAdminCount(): int
    {
        return static::query()->where('role', 'admin')->where('actif', true)->count();
    }
}
