<?php

namespace App\Models\Concerns;

/**
 * Traduction entre le vocabulaire de la base (snake_case) et celui de
 * l'interface (camelCase), dans les deux sens.
 *
 * Chaque modele declare une carte `clientFields()` : cle cote client =>
 * colonne cote base. Rien d'autre n'est accepte a l'ecriture, ce qui evite
 * qu'un client bavard n'ecrive dans une colonne qui ne le regarde pas.
 */
trait SyncsWithClient
{
    /** @return array<string,string> cle client => colonne */
    abstract public static function clientFields(): array;

    /** Colonnes stockees en JSON (listes imbriquees). @return array<int,string> */
    public static function jsonFields(): array
    {
        return [];
    }

    /** Colonnes booleennes. @return array<int,string> */
    public static function boolFields(): array
    {
        return [];
    }

    /** Colonnes de type date (renvoyees au format ISO aaaa-mm-jj). @return array<int,string> */
    public static function dateFields(): array
    {
        return [];
    }

    /** Colonnes numeriques (renvoyees comme nombres). @return array<int,string> */
    public static function numberFields(): array
    {
        return [];
    }

    /**
     * Represente l'enregistrement tel que l'interface l'attend.
     *
     * Les valeurs nulles deviennent des chaines vides : l'interface compare et
     * concatene ces champs sans les tester, une valeur nulle y afficherait
     * « null ».
     */
    public function toClientArray(): array
    {
        $out = ['id' => (string) $this->getKey()];

        foreach (static::clientFields() as $clientKey => $column) {
            $value = $this->getAttribute($column);

            if (in_array($column, static::jsonFields(), true)) {
                $out[$clientKey] = is_array($value) ? array_values($value) : [];

                continue;
            }
            if (in_array($column, static::boolFields(), true)) {
                $out[$clientKey] = (bool) $value;

                continue;
            }
            if ($value === null) {
                $out[$clientKey] = '';

                continue;
            }
            if (in_array($column, static::dateFields(), true)) {
                $out[$clientKey] = substr((string) $value, 0, 10);

                continue;
            }
            if (in_array($column, static::numberFields(), true)) {
                $out[$clientKey] = 0 + $value;

                continue;
            }
            $out[$clientKey] = $value;
        }

        $out['updatedAt'] = optional($this->updated_at)->toIso8601String();

        return $out;
    }

    /** Applique les valeurs envoyees par le client, en ignorant tout le reste. */
    public function fillFromClient(array $data): static
    {
        foreach (static::clientFields() as $clientKey => $column) {
            if (! array_key_exists($clientKey, $data)) {
                continue;
            }
            $value = $data[$clientKey];

            if (in_array($column, static::jsonFields(), true)) {
                $this->setAttribute($column, is_array($value) ? array_values($value) : []);

                continue;
            }
            if (in_array($column, static::boolFields(), true)) {
                $this->setAttribute($column, (bool) $value);

                continue;
            }
            if ($value === '' || $value === null) {
                $this->setAttribute($column, null);

                continue;
            }
            if (in_array($column, static::numberFields(), true)) {
                $this->setAttribute($column, is_numeric($value) ? 0 + $value : null);

                continue;
            }
            if (in_array($column, static::dateFields(), true)) {
                $this->setAttribute($column, substr((string) $value, 0, 10));

                continue;
            }
            $this->setAttribute($column, (string) $value);
        }

        return $this;
    }
}
