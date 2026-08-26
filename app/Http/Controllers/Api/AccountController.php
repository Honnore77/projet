<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Gestion des comptes d'acces — reserve aux administrateurs.
 *
 * Garde-fou applique a chaque operation : il doit rester au moins un
 * administrateur actif, faute de quoi plus personne ne pourrait administrer
 * l'application.
 */
class AccountController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'accounts' => User::query()->orderBy('login')->get()->map->toClientArray()->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'login' => ['required', 'string', 'max:120', Rule::unique('users', 'login')],
            'nom' => ['nullable', 'string', 'max:160'],
            'role' => ['required', Rule::in(User::ROLES)],
            'password' => ['required', 'string', 'min:6', 'regex:/[A-Za-z]/', 'regex:/[0-9]/'],
        ], $this->messages());

        $user = User::create([
            'login' => trim($data['login']),
            'nom' => trim($data['nom'] ?? '') ?: trim($data['login']),
            'role' => $data['role'],
            'password' => $data['password'],
            'actif' => true,
            'must_change' => true,
        ]);

        return response()->json(['account' => $user->toClientArray()], 201);
    }

    public function update(Request $request, User $account): JsonResponse
    {
        $data = $request->validate([
            'nom' => ['nullable', 'string', 'max:160'],
            'role' => ['nullable', Rule::in(User::ROLES)],
            'actif' => ['nullable', 'boolean'],
        ]);

        $losesAdmin = ($data['role'] ?? $account->role) !== 'admin' || ($data['actif'] ?? $account->actif) === false;
        if ($account->role === 'admin' && $account->actif && $losesAdmin && User::activeAdminCount() <= 1) {
            return response()->json(['message' => 'Impossible : il doit rester au moins un administrateur actif.'], 422);
        }

        $account->fill(array_filter([
            'nom' => $data['nom'] ?? null,
            'role' => $data['role'] ?? null,
        ], fn ($v) => $v !== null));

        if (array_key_exists('actif', $data)) {
            $account->actif = (bool) $data['actif'];
        }
        $account->save();

        return response()->json(['account' => $account->toClientArray()]);
    }

    public function resetPassword(Request $request, User $account): JsonResponse
    {
        $data = $request->validate([
            'password' => ['required', 'string', 'min:6', 'regex:/[A-Za-z]/', 'regex:/[0-9]/'],
        ], $this->messages());

        $account->forceFill(['password' => $data['password'], 'must_change' => true])->save();
        $account->tokens()->delete(); // les sessions ouvertes avec l'ancien mot de passe tombent

        return response()->json(['account' => $account->toClientArray()]);
    }

    public function destroy(Request $request, User $account): JsonResponse
    {
        if ($account->id === $request->user()->id) {
            return response()->json(['message' => 'Vous ne pouvez pas supprimer le compte avec lequel vous êtes connecté.'], 422);
        }
        if ($account->role === 'admin' && $account->actif && User::activeAdminCount() <= 1) {
            return response()->json(['message' => 'Impossible : il doit rester au moins un administrateur actif.'], 422);
        }

        $account->tokens()->delete();
        $account->delete();

        return response()->json(['message' => 'Compte supprimé.']);
    }

    private function messages(): array
    {
        return [
            'password.min' => 'Le mot de passe doit contenir au moins 6 caractères.',
            'password.regex' => 'Le mot de passe doit contenir au moins une lettre et un chiffre.',
            'login.unique' => 'Cet identifiant existe déjà.',
        ];
    }
}
