<?php

namespace App\Models;

class Mission extends SyncRecord
{
    protected $table = 'missions';

    protected function casts(): array
    {
        return ['paye' => 'boolean'];
    }

    public static function clientFields(): array
    {
        return [
            'ref' => 'ref',
            'conducteur' => 'conducteur',
            'vehicule' => 'vehicule',
            'destination' => 'destination',
            'objet' => 'objet',
            'dateDepart' => 'date_depart',
            'dateRetour' => 'date_retour',
            'jours' => 'jours',
            'montant' => 'montant',
            'paye' => 'paye',
            'datePaiement' => 'date_paiement',
            'datePaiementISO' => 'date_paiement_iso',
            'referencePaiement' => 'reference_paiement',
            'observations' => 'observations',
        ];
    }

    public static function boolFields(): array
    {
        return ['paye'];
    }

    public static function dateFields(): array
    {
        return ['date_depart', 'date_retour', 'date_paiement_iso'];
    }

    public static function numberFields(): array
    {
        return ['jours', 'montant'];
    }
}
