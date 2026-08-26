<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /**
     * Connexion : rend un jeton porteur, utilise ensuite par le site comme par
     * l'application de bureau.
     */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'login' => ['required', 'string', 'max:120'],
            'password' => ['required', 'string'],
            'device' => ['nullable', 'string', 'max:120'],
        ]);

        // Un identifiant donne ne peut etre teste que 10 fois par minute.
        $throttleKey = mb_strtolower($data['login']).'|'.$request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, 10)) {
            throw ValidationException::withMessages([
                'login' => 'Trop de tentatives. Réessayez dans '.RateLimiter::availableIn($throttleKey).' secondes.',
            ])->status(429);
        }

        $user = User::query()->whereRaw('LOWER(login) = ?', [mb_strtolower(trim($data['login']))])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            RateLimiter::hit($throttleKey, 60);

            return response()->json(['message' => 'Identifiant ou mot de passe incorrect.'], 401);
        }

        if (! $user->actif) {
            return response()->json(['message' => 'Ce compte est désactivé. Contactez un administrateur.'], 403);
        }

        RateLimiter::clear($throttleKey);

        $user->forceFill(['last_login_at' => now()])->save();
        $user->tokens()->where('name', $data['device'] ?? 'app')->delete();
        $token = $user->createToken($data['device'] ?? 'app')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $user->toClientArray(),
            'serverTime' => now()->toIso8601String(),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'user' => $request->user()->toClientArray(),
            'serverTime' => now()->toIso8601String(),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Déconnecté.']);
    }

    /** Changement de mot de passe par le titulaire du compte. */
    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current' => ['required', 'string'],
            'password' => ['required', 'string', 'min:6', 'regex:/[A-Za-z]/', 'regex:/[0-9]/'],
        ], [
            'password.min' => 'Le mot de passe doit contenir au moins 6 caractères.',
            'password.regex' => 'Le mot de passe doit contenir au moins une lettre et un chiffre.',
        ]);

        $user = $request->user();
        if (! Hash::check($data['current'], $user->password)) {
            return response()->json(['message' => 'Ancien mot de passe incorrect.'], 422);
        }

        $user->forceFill(['password' => $data['password'], 'must_change' => false])->save();

        return response()->json(['user' => $user->toClientArray()]);
    }
}
