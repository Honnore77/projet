<?php

namespace App\Models;

class FuelMissionEntry extends SyncRecord
{
    protected $table = 'fuel_mission_entries';

    protected function casts(): array
    {
        return ['ravitaillements' => 'array'];
    }

    public static function clientFields(): array
    {
        return [
            'conducteur' => 'conducteur',
            'vehicule' => 'vehicule',
            'destination' => 'destination',
            'dateDepart' => 'date_depart',
            'dateRetour' => 'date_retour',
            'kmDepart' => 'km_depart',
            'kmRetour' => 'km_retour',
            'diff' => 'diff',
            'ravitaillements' => 'ravitaillements',
            'totalLitres' => 'total_litres',
            'totalMontant' => 'total_montant',
        ];
    }

    public static function jsonFields(): array
    {
        return ['ravitaillements'];
    }

    public static function dateFields(): array
    {
        return ['date_depart', 'date_retour'];
    }

    public static function numberFields(): array
    {
        return ['km_depart', 'km_retour', 'diff', 'total_litres', 'total_montant'];
    }
}
