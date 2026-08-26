<?php

namespace App\Models;

use App\Models\Concerns\SyncsWithClient;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Base commune aux enregistrements synchronises.
 *
 * La cle primaire est une chaine fournie par le client : un poste hors ligne
 * cree ses enregistrements sans rien demander au serveur. La suppression est
 * douce, sinon les autres postes n'apprendraient jamais qu'une ligne a disparu.
 */
abstract class SyncRecord extends Model
{
    use SoftDeletes, SyncsWithClient;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];
}
