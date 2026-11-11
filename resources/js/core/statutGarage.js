/* ===================================================================
   STATUT « En entretien » POSE PAR LE GARAGE.

   Un vehicule entre au garage (ENTRETIEN → fiche sans date de sortie) et
   qui n'en est pas sorti le jour meme passe de lui-meme au statut
   « En entretien » des le lendemain de son entree. Son statut d'avant est
   retenu (`statutAvantGarage`) et lui est rendu a la sortie du garage.
   Un statut change a la main pendant le sejour au garage l'emporte : il
   n'est plus touche. Un vehicule reforme ne change pas.

   Lance avant chaque enregistrement et a l'ouverture de l'application
   (le passage au lendemain se constate au demarrage).
   =================================================================== */

import { DB, CATEGORIES, STATUT_REFORME, immatOf, memeVehicule, avantEnregistrement } from './db.js';
import { todayISO } from './utils.js';

export const STATUT_ENTRETIEN = 'En entretien';

/** La fiche du garage ouverte depuis avant aujourd'hui (entree, pas de sortie), s'il y en a une. */
export function sejourAuGarage(immat, jour = todayISO(), db = DB) {
  if (!immat) return null;
  return (db.maintenance || []).find((m) => m.immat && !m.dateRetour && m.dateEntree && m.dateEntree < jour &&
    memeVehicule(m.immat, immat)) || null;
}

/**
 * Accorde le statut des vehicules avec leurs passages au garage.
 * Modifie les vehicules sur place. Le vehicule retient la fiche qui l'a
 * mis « En entretien » (`statutGarageFiche`) : pendant ce sejour, un statut
 * change a la main n'est plus touche.
 * @returns {number} le nombre de vehicules changes
 */
export function synchroniserStatutsGarage(db = DB, jour = todayISO()) {
  let n = 0;
  CATEGORIES.forEach((c) => {
    ((db.vehicles && db.vehicles[c.key]) || []).forEach((v) => {
      if (v.statut === STATUT_REFORME) return;
      const fiche = sejourAuGarage(immatOf(v), jour, db);
      if (fiche && v.statutGarageFiche !== fiche.id) {
        // Nouveau sejour au garage.
        v.statutAvantGarage = v.statut && v.statut !== STATUT_ENTRETIEN ? v.statut : 'Disponible';
        v.statut = STATUT_ENTRETIEN;
        v.statutGarageFiche = fiche.id;
        n += 1;
      } else if (!fiche && v.statutGarageFiche) {
        // Sorti du garage : il retrouve son statut, sauf s'il a ete change
        // a la main entre-temps.
        if (v.statut === STATUT_ENTRETIEN && v.statutAvantGarage) v.statut = v.statutAvantGarage;
        v.statutAvantGarage = '';
        v.statutGarageFiche = '';
        n += 1;
      }
    });
  });
  return n;
}

avantEnregistrement((db) => synchroniserStatutsGarage(db));
