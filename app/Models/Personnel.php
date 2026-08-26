<?php

namespace App\Models;

class Personnel extends SyncRecord
{
    protected $table = 'personnel';

    protected function casts(): array
    {
        return ['historique' => 'array'];
    }

    public static function clientFields(): array
    {
        return [
            'nom' => 'nom',
            'prenoms' => 'prenoms',
            'fonction' => 'fonction',
            'section' => 'section',
            'statut' => 'statut',
            'telephone' => 'telephone',
            'permis' => 'permis',
            'observations' => 'observations',
            'historique' => 'historique',
        ];
    }

    public static function jsonFields(): array
    {
        return ['historique'];
    }
}
