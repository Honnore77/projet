<?php

namespace App\Models;

class Maintenance extends SyncRecord
{
    protected $table = 'maintenances';

    protected function casts(): array
    {
        return ['interventions' => 'array'];
    }

    public static function clientFields(): array
    {
        return [
            'immat' => 'immat',
            'marque' => 'marque',
            'modele' => 'modele',
            'dateEntree' => 'date_entree',
            'kmEntree' => 'km_entree',
            'conducteurEntree' => 'conducteur_entree',
            'motif' => 'motif',
            'signalePar' => 'signale_par',
            'interventions' => 'interventions',
            'kmRetour' => 'km_retour',
            'dateRetour' => 'date_retour',
            'conducteurRetour' => 'conducteur_retour',
            'observationRetour' => 'observation_retour',
        ];
    }

    public static function jsonFields(): array
    {
        return ['interventions'];
    }

    public static function dateFields(): array
    {
        return ['date_entree', 'date_retour'];
    }

    public static function numberFields(): array
    {
        return ['km_entree', 'km_retour'];
    }
}
