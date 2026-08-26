<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FuelMissionEntry;
use App\Models\FuelPoolEntry;
use App\Models\Maintenance;
use App\Models\Mission;
use App\Models\Personnel;
use App\Models\Setting;
use App\Models\SyncRecord;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Synchronisation entre la base centrale et la copie locale de chaque poste.
 *
 * Deux operations seulement :
 *   GET  /api/pull  — ce qui a change sur le serveur depuis une date
 *   POST /api/push  — ce qui a change sur le poste depuis sa derniere remontee
 *
 * Toute ecriture, en ligne comme hors ligne, emprunte le meme chemin : le
 * client applique la modification chez lui, l'ajoute a sa file d'attente, et
 * la file part des qu'une connexion existe. Il n'y a donc qu'un seul code
 * d'ecriture a maintenir, et le comportement est identique dans les deux cas.
 *
 * Arbitrage des conflits : la derniere ecriture gagne. Une operation plus
 * ancienne que l'enregistrement deja en base est refusee et signalee au client,
 * qui recupere alors la version du serveur.
 */
class SyncController extends Controller
{
    /**
     * Nom de collection cote interface => modele.
     *
     * Attention : `users` designe ici les agents du parc (conducteurs,
     * affectataires), pas les comptes d'acces — ces derniers vivent dans
     * `accounts` et sont geres par AccountController.
     */
    public const COLLECTIONS = [
        'vehicles' => Vehicle::class,
        'users' => Personnel::class,
        'dotationPool' => FuelPoolEntry::class,
        'dotationMission' => FuelMissionEntry::class,
        'missions' => Mission::class,
        'maintenance' => Maintenance::class,
    ];

    /** Recouvrement applique a `since`, pour ne rien perdre a la seconde pres. */
    private const OVERLAP_SECONDS = 2;

    public function pull(Request $request): JsonResponse
    {
        $request->validate(['since' => ['nullable', 'date']]);

        $now = now();
        $since = $request->filled('since')
            ? Carbon::parse($request->query('since'))->subSeconds(self::OVERLAP_SECONDS)
            : null;

        $collections = [];
        $deleted = [];

        foreach (self::COLLECTIONS as $name => $model) {
            $query = $model::query()->withTrashed();
            if ($since) {
                $query->where('updated_at', '>=', $since);
            }

            $rows = $query->get();
            $collections[$name] = $rows->whereNull('deleted_at')->map->toClientArray()->values();
            $deleted[$name] = $rows->whereNotNull('deleted_at')->pluck('id')->values();
        }

        $payload = [
            'serverTime' => $now->toIso8601String(),
            'full' => $since === null,
            'collections' => $collections,
            'deleted' => $deleted,
            'settings' => Setting::payload(),
        ];

        // La liste des comptes n'a de sens que pour un administrateur.
        if ($request->user()->isAdmin()) {
            $payload['accounts'] = User::query()->orderBy('login')->get()->map->toClientArray()->values();
        }

        return response()->json($payload);
    }

    public function push(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->canWrite()) {
            return response()->json(['message' => 'Votre compte est en consultation seule.'], 403);
        }

        $data = $request->validate([
            'operations' => ['present', 'array', 'max:500'],
            'operations.*.seq' => ['required', 'integer'],
            'operations.*.op' => ['required', 'string', 'in:upsert,delete,settings'],
            'operations.*.collection' => ['nullable', 'string'],
            'operations.*.id' => ['nullable', 'string', 'max:64'],
            'operations.*.at' => ['required', 'date'],
            'operations.*.data' => ['nullable', 'array'],
        ]);

        $applied = [];
        $skipped = [];

        DB::transaction(function () use ($data, &$applied, &$skipped) {
            foreach ($data['operations'] as $op) {
                $result = $this->applyOperation($op);
                if ($result === true) {
                    $applied[] = $op['seq'];
                } else {
                    $skipped[] = ['seq' => $op['seq'], 'reason' => $result];
                }
            }
        });

        return response()->json([
            'serverTime' => now()->toIso8601String(),
            'applied' => $applied,
            'skipped' => $skipped,
        ]);
    }

    /** @return true|string true si applique, sinon le motif du refus */
    private function applyOperation(array $op): bool|string
    {
        $at = Carbon::parse($op['at']);

        if ($op['op'] === 'settings') {
            foreach (($op['data'] ?? []) as $key => $value) {
                if (array_key_exists($key, Setting::DEFAULTS)) {
                    Setting::put($key, $value);
                }
            }

            return true;
        }

        $model = self::COLLECTIONS[$op['collection'] ?? ''] ?? null;
        if (! $model) {
            return 'collection-inconnue';
        }
        if (empty($op['id'])) {
            return 'identifiant-manquant';
        }

        /** @var SyncRecord|null $record */
        $record = $model::withTrashed()->find($op['id']);

        // La derniere ecriture gagne : une operation plus ancienne que ce qui
        // est deja en base est ignoree, et le client en est informe.
        if ($record && $record->updated_at && $record->updated_at->gt($at)) {
            return 'obsolete';
        }

        if ($op['op'] === 'delete') {
            if (! $record) {
                return true; // deja absent : rien a faire
            }
            if (! $record->trashed()) {
                $record->delete();
            }

            return true;
        }

        if (! $record) {
            $record = new $model;
            $record->setAttribute($record->getKeyName(), $op['id']);
        } elseif ($record->trashed()) {
            $record->restore();
        }

        $record->fillFromClient($op['data'] ?? []);
        $record->save();

        return true;
    }
}
