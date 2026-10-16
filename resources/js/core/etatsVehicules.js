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

/** « RAS », « néant », un tiret… : rien a signaler. */
export function rienASignaler(texte) {
  const t = norm(String(texte || '')).replace(/[\s.\-–—]+/g, ' ').trim();
  return !t || ['ras', 'r a s', 'rien a signaler', 'neant', 'aucun', 'aucun probleme', 'bon etat', 'nr'].includes(t);
}

/**
 * Rapport de mission → ÉTAT DES VÉHICULES. Le champ « État du véhicule »
 * du rapport tient un signalement relie a la mission (`missionId`) :
 *   - un probleme decrit cree le signalement (vehicule de la mission,
 *     signale par le chauffeur, a la date du retour), non resolu ;
 *   - un texte modifie met le signalement a jour ;
 *   - un champ vide ou « RAS » retire le signalement s'il n'est pas
 *     encore resolu (resolu, il reste : c'est l'historique du vehicule).
 * Modifie `db.etatsVehicules` sur place ; rend ce qui a ete fait.
 *
 * @returns {'cree'|'modifie'|'retire'|null}
 */
export function relierRapportMission(m, texte, db = DB, aujourdhui = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(db.etatsVehicules)) db.etatsVehicules = [];
  const liste = db.etatsVehicules;
  const i = liste.findIndex((s) => s.missionId === m.id);
  const lie = i >= 0 ? liste[i] : null;
  const probleme = String(texte || '').trim();

  if (rienASignaler(probleme)) {
    if (lie && !estResolu(lie)) { liste.splice(i, 1); return 'retire'; }
    return null;
  }
  if (lie) {
    const patch = { probleme, immat: lie.immat || m.vehicule || '' };
    if (lie.probleme === patch.probleme && lie.immat === patch.immat) return null;
    Object.assign(lie, patch);
    return 'modifie';
  }
  liste.push({
    id: `ev_${m.id}_${Date.now().toString(36)}`,
    missionId: m.id,
    missionRef: m.ref || '',
    immat: String(m.vehicule || '').trim().toUpperCase(),
    probleme,
    dateSignalement: m.dateRetour || m.dateDepart || aujourdhui,
    signalePar: m.conducteur || '',
    signaleA: '',
    resolu: 'Non',
    dateResolution: ''
  });
  return 'cree';
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
