<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tables metier du parc automobile.
 *
 * Deux partis pris, valables pour toutes les tables :
 *
 * 1. La cle primaire est une chaine generee par le client. Un poste hors ligne
 *    doit pouvoir creer un enregistrement sans demander d'identifiant au
 *    serveur ; l'identifiant reste le meme apres synchronisation.
 *
 * 2. Les collections imbriquees (incidents d'un agent, ravitaillements d'une
 *    dotation, interventions d'un passage au garage) sont stockees en JSON.
 *    Elles n'existent jamais sans leur parent, sont toujours lues et ecrites
 *    avec lui, et ne sont jamais interrogees seules : les normaliser
 *    n'apporterait que des jointures.
 *
 * `updated_at` sert d'horloge de synchronisation, `deleted_at` de pierre
 * tombale : une suppression doit se propager aux autres postes, donc la ligne
 * est conservee jusqu'a ce que tout le monde l'ait vue.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicles', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('categorie')->index();          // pool | mission | service
            $table->string('marque')->nullable();
            $table->string('modele')->nullable();
            $table->string('immat_nouvelle')->nullable()->index();
            $table->string('immat_ancienne')->nullable()->index();
            $table->string('couleur')->nullable();
            $table->string('energie')->nullable();
            $table->string('groupe')->nullable();
            $table->string('section')->nullable();
            $table->string('utilisateur')->nullable();
            $table->string('statut')->nullable()->index();
            $table->decimal('km', 12, 2)->nullable();
            $table->text('observations')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index('updated_at');
        });

        Schema::create('personnel', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('nom')->nullable()->index();
            $table->string('prenoms')->nullable();
            $table->string('fonction')->nullable();
            $table->string('section')->nullable()->index();
            $table->string('statut')->nullable();
            $table->string('telephone')->nullable();
            $table->string('permis')->nullable();
            $table->text('observations')->nullable();
            $table->json('historique')->nullable();        // incidents et observations
            $table->timestamps();
            $table->softDeletes();
            $table->index('updated_at');
        });

        Schema::create('fuel_pool_entries', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->date('date')->nullable()->index();
            $table->string('immat')->nullable()->index();
            $table->string('marque_modele')->nullable();
            $table->string('energie')->nullable();
            $table->decimal('km', 12, 2)->nullable();
            $table->decimal('quantite', 12, 2)->nullable();
            $table->decimal('prix_l', 12, 2)->nullable();
            $table->decimal('montant', 14, 2)->nullable();
            $table->string('station')->nullable();
            $table->string('vidange')->nullable();
            $table->text('observations')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index('updated_at');
        });

        Schema::create('fuel_mission_entries', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('conducteur')->nullable()->index();
            $table->string('vehicule')->nullable()->index();
            $table->string('destination')->nullable();
            $table->date('date_depart')->nullable()->index();
            $table->date('date_retour')->nullable();
            $table->decimal('km_depart', 12, 2)->nullable();
            $table->decimal('km_retour', 12, 2)->nullable();
            $table->decimal('diff', 12, 2)->nullable();
            $table->json('ravitaillements')->nullable();
            $table->decimal('total_litres', 12, 2)->nullable();
            $table->decimal('total_montant', 14, 2)->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index('updated_at');
        });

        Schema::create('missions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('ref')->nullable()->index();
            $table->string('conducteur')->nullable()->index();
            $table->string('vehicule')->nullable()->index();
            $table->string('destination')->nullable();
            $table->text('objet')->nullable();
            $table->date('date_depart')->nullable()->index();
            $table->date('date_retour')->nullable();
            $table->integer('jours')->nullable();
            $table->decimal('montant', 14, 2)->nullable();
            $table->boolean('paye')->default(false)->index();
            $table->string('date_paiement')->nullable();       // libelle affiche (jj/mm/aaaa)
            $table->date('date_paiement_iso')->nullable();
            $table->string('reference_paiement')->nullable();
            $table->text('observations')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index('updated_at');
        });

        Schema::create('maintenances', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('immat')->nullable()->index();
            $table->string('marque')->nullable();
            $table->string('modele')->nullable();
            $table->date('date_entree')->nullable()->index();
            $table->decimal('km_entree', 12, 2)->nullable();
            $table->string('conducteur_entree')->nullable();
            $table->text('motif')->nullable();
            $table->string('signale_par')->nullable();
            $table->json('interventions')->nullable();
            $table->decimal('km_retour', 12, 2)->nullable();
            $table->date('date_retour')->nullable()->index();
            $table->string('conducteur_retour')->nullable();
            $table->text('observation_retour')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index('updated_at');
        });

        Schema::create('settings', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->json('value')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['settings', 'maintenances', 'missions', 'fuel_mission_entries', 'fuel_pool_entries', 'personnel', 'vehicles'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
