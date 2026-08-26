<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\SyncController;
use Illuminate\Support\Facades\Route;

/*
 * API de l'application de parc automobile.
 *
 * Le site web et l'application de bureau consomment exactement les memes
 * routes, avec un jeton porteur (Sanctum) dans l'en-tete Authorization.
 */

// Sans authentification : permet a l'application de bureau de verifier
// l'adresse du serveur saisie par l'utilisateur avant meme la connexion.
Route::get('/health', function () {
    return response()->json([
        'app' => config('app.name'),
        'status' => 'ok',
        'serverTime' => now()->toIso8601String(),
    ]);
});

Route::post('/login', [AuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/password', [AuthController::class, 'changePassword']);

    Route::get('/pull', [SyncController::class, 'pull']);
    Route::post('/push', [SyncController::class, 'push']);

    Route::middleware('admin')->group(function () {
        Route::get('/accounts', [AccountController::class, 'index']);
        Route::post('/accounts', [AccountController::class, 'store']);
        Route::put('/accounts/{account}', [AccountController::class, 'update']);
        Route::post('/accounts/{account}/password', [AccountController::class, 'resetPassword']);
        Route::delete('/accounts/{account}', [AccountController::class, 'destroy']);
    });
});
