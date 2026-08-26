<?php

namespace App\Models;

class Vehicle extends SyncRecord
{
    protected $table = 'vehicles';

    public static function clientFields(): array
    {
        return [
            'categorie' => 'categorie',
            'marque' => 'marque',
            'modele' => 'modele',
            'immatNouvelle' => 'immat_nouvelle',
            'immatAncienne' => 'immat_ancienne',
            'couleur' => 'couleur',
            'energie' => 'energie',
            'groupe' => 'groupe',
            'section' => 'section',
            'utilisateur' => 'utilisateur',
            'statut' => 'statut',
            'km' => 'km',
            'observations' => 'observations',
        ];
    }

    public static function numberFields(): array
    {
        return ['km'];
    }
}
