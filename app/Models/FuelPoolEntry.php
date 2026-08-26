<?php

namespace App\Models;

class FuelPoolEntry extends SyncRecord
{
    protected $table = 'fuel_pool_entries';

    public static function clientFields(): array
    {
        return [
            'date' => 'date',
            'immat' => 'immat',
            'marqueModele' => 'marque_modele',
            'energie' => 'energie',
            'km' => 'km',
            'quantite' => 'quantite',
            'prixL' => 'prix_l',
            'montant' => 'montant',
            'station' => 'station',
            'vidange' => 'vidange',
            'observations' => 'observations',
        ];
    }

    public static function dateFields(): array
    {
        return ['date'];
    }

    public static function numberFields(): array
    {
        return ['km', 'quantite', 'prix_l', 'montant'];
    }
}
