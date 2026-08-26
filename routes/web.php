<?php

use Illuminate\Support\Facades\Route;

/*
 * L'interface est une application autonome construite par Vite dans
 * public/app/. Le serveur web sert ses fichiers directement, sans passer par
 * PHP ; ces routes ne couvrent que l'entree du site.
 *
 * Elle est servie a l'adresse /app/index.html, et non a la racine, pour deux
 * raisons liees :
 *
 *   - les ressources sont referencees en chemins relatifs, ce qui permet au
 *     meme dossier de fonctionner servi par le web et charge depuis le disque
 *     par l'application de bureau ;
 *   - le service worker qui rend le site utilisable hors ligne ne controle que
 *     les pages situees sous son propre dossier.
 *
 * Laravel ne distingue pas /app de /app/ (les slash finaux sont supprimes
 * avant le routage) : on renvoie donc explicitement vers le fichier, avec un
 * en-tete Location relatif — aucune supposition sur le nom d'hote ou le
 * protocole, ce qui evite les mauvaises surprises derriere un proxy.
 */

$toApp = fn () => response('', 302, ['Location' => '/app/index.html']);

Route::get('/', $toApp);
Route::get('/app', $toApp);
Route::get('/app/{path}', $toApp)->where('path', '.*');
