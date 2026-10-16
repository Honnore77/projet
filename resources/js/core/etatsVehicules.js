/* ===================================================================
   ÉTAT DES VÉHICULES — les problemes constates sur les vehicules.

   Un signalement dit quel vehicule (immatriculation), quel probleme, qui
   l'a signale, a qui, et quand ; puis s'il est resolu, et quand.

   Tant qu'il n'est pas resolu, le probleme s'affiche dans la colonne
   « État du véhicule » des tableaux POOL, MISSION et SERVICE.
   =================================================================== */

import { DB } from './db.js';
import { norm } from './utils.js';

/** Une immatriculation comparable : sans espaces ni accents, en minuscules. */
const cle = (immat) => norm(immat || '').replace(/\s+/g, '');

/** Le signalement est-il resolu ? */
export const estResolu = (s) => s && s.resolu === 'Oui';

/** Les signalements concernant un vehicule (nouvelle ou ancienne plaque). */
export function signalementsDu(v, db = DB) {
  const plaques = [v && v.immatNouvelle, v && v.immatAncienne].map(cle).filter((p) => p && !['d45', 'd4550'].includes(p));
  if (!plaques.length) return [];
  return (db.etatsVehicules || []).filter((s) => plaques.includes(cle(s.immat)));
}

/** Les problemes encore ouverts d'un vehicule, du plus recent au plus ancien. */
export function problemesEnCours(v, db = DB) {
  return signalementsDu(v, db)
    .filter((s) => !estResolu(s))
    .sort((a, b) => String(b.dateSignalement || '').localeCompare(String(a.dateSignalement || '')));
}

/**
 * Raison de refuser un signalement, ou null. La date de resolution ne
 * precede pas le signalement, et un probleme resolu porte sa date.
 */
export function refusSignalement(s) {
  if (estResolu(s) && !s.dateResolution) return 'Indiquez la date de résolution du problème.';
  if (s.dateResolution && s.dateSignalement && s.dateResolution < s.dateSignalement) {
    return 'La date de résolution ne peut pas précéder la date du signalement.';
  }
  return null;
}
