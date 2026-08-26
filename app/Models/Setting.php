<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Reglages de l'application (organisation, devise, seuils d'alerte),
 * partages par tous les postes.
 */
class Setting extends Model
{
    protected $table = 'settings';

    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['value' => 'array'];
    }

    /** Valeurs appliquees tant que rien n'a ete enregistre. */
    public const DEFAULTS = [
        'organisation' => 'PDU',
        'devise' => 'F',
        'seuilVidangeKm' => 5000,
        'seuilImmobilisationJours' => 7,
        'seuilMissionImpayeeJours' => 30,
    ];

    /** Reglages complets, defauts compris. */
    public static function payload(): array
    {
        $out = static::DEFAULTS;
        foreach (static::query()->get() as $row) {
            $v = $row->value;
            $out[$row->key] = is_array($v) && array_key_exists('v', $v) ? $v['v'] : $v;
        }

        return $out;
    }

    public static function put(string $key, mixed $value): void
    {
        static::updateOrCreate(['key' => $key], ['value' => ['v' => $value]]);
    }
}
