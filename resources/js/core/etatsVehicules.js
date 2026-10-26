/* ===================================================================
   ÉTAT DES VÉHICULES — les problemes constates sur les vehicules.

   Un signalement dit quel vehicule (immatriculation), quel probleme, qui
   l'a signale, a qui, et quand ; puis s'il est resolu, et quand.

   Tant qu'il n'est pas resolu, le probleme s'affiche dans la colonne
   « État du véhicule » des tableaux POOL, MISSION et SERVICE.
   =================================================================== */

import { DB, avantEnregistrement } from './db.js';
import { norm, dateFR, uid } from './utils.js';

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

/* ==================================================================
   Observations saisies ailleurs → ÉTAT DES VÉHICULES.

   Tout ce qu'on note sur un vehicule, ou que ce soit dans l'application,
   devient un signalement relie a sa source (`origine`) :
     - rapport de mission, champ « Observation (état du véhicule) » — la
       « Observation divers » du rapport n'y vient pas ;
     - dotation pool, champ « Observations » ;
     - entree au garage, « Motif / problème » — resolu des que le vehicule
       sort du garage, a la date de sortie ;
     - retour du garage, « Observation du conducteur » ;
     - vidange, « Observation après la vidange » ;
     - incident d'un agent sur un vehicule (nature et circonstances) ;
     - fiche du vehicule, champ « Observations ».
   La source fait foi : son texte modifie met le signalement a jour ; vide,
   « RAS » ou supprimee, elle retire le signalement s'il n'est pas resolu
   (resolu, il reste : c'est l'historique du vehicule).
   ================================================================== */

const CATEGORIES_EN_SERVICE = ['pool', 'mission', 'service'];

/** Les observations de toute la base, chacune avec sa source. */
export function observationsSources(db = DB) {
  const out = [];
  const ajouter = (o) => { if (String(o.immat || '').trim()) out.push(o); };

  (db.missions || []).forEach((m) => ajouter({
    origine: `mission:${m.id}`, missionId: m.id, missionRef: m.ref || '',
    libelle: `Rapport de mission ${m.ref || ''}`.trim(),
    immat: m.vehicule, texte: m.observations, date: m.dateRetour || m.dateDepart, par: m.conducteur
  }));
  (db.dotationPool || []).forEach((d) => ajouter({
    origine: `dotation:${d.id}`, libelle: `Dotation pool du ${dateFR(d.date)}`,
    immat: d.immat, texte: d.observations, date: d.date, par: d.conducteur
  }));
  (db.maintenance || []).forEach((m) => {
    ajouter({
      origine: `entretien:${m.id}`, libelle: `Entrée au garage du ${dateFR(m.dateEntree)}`,
      immat: m.immat, texte: m.motif, date: m.dateEntree, par: m.signalePar || m.conducteurEntree,
      resoluLe: m.dateRetour || '', resoluPar: `garage:${m.id}`
    });
    if (m.dateRetour) {
      ajouter({
        origine: `retour:${m.id}`, libelle: `Retour du garage du ${dateFR(m.dateRetour)}`,
        immat: m.immat, texte: m.observationRetour, date: m.dateRetour, par: m.conducteurRetour
      });
    }
  });
  (db.vidanges || []).forEach((x) => ajouter({
    origine: `vidange:${x.id}`, libelle: `Vidange du ${dateFR(x.date)}`,
    immat: x.immat, texte: x.observation, date: x.date, par: x.conducteur
  }));
  (db.users || []).forEach((u) => (u.historique || []).forEach((h) => {
    // Un incident n'avait pas d'identifiant : il en recoit un, pour rester
    // relie a son signalement.
    if (!h.id) h.id = uid();
    ajouter({
      origine: `incident:${h.id}`, libelle: `Incident — ${`${u.nom || ''} ${u.prenoms || ''}`.trim()}`,
      immat: h.vehicule,
      texte: [h.nature, h.circonstances].map((x) => String(x || '').trim()).filter(Boolean).join(' — '),
      date: h.date, par: `${u.nom || ''} ${u.prenoms || ''}`.trim()
    });
  }));
  CATEGORIES_EN_SERVICE.forEach((c) => ((db.vehicles || {})[c] || []).forEach((v) => ajouter({
    origine: `vehicule:${v.id}`, libelle: 'Fiche du véhicule',
    immat: v.immatNouvelle || v.immatAncienne, texte: v.observations, date: '', par: ''
  })));
  return out;
}

/** La source d'un signalement (les anciens signalements de mission n'ont que `missionId`). */
const origineDe = (s) => s.origine || (s.missionId ? `mission:${s.missionId}` : '');

/**
 * Accorde ÉTAT DES VÉHICULES avec les observations de toute la base.
 * Modifie `db.etatsVehicules` sur place.
 * @returns {number} le nombre de signalements crees, modifies ou retires
 */
export function synchroniserEtats(db = DB, aujourdhui = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(db.etatsVehicules)) db.etatsVehicules = [];
  const liste = db.etatsVehicules;
  const vues = new Set();
  let n = 0;

  observationsSources(db).forEach((src) => {
    vues.add(src.origine);
    const i = liste.findIndex((s) => origineDe(s) === src.origine);
    const lie = i >= 0 ? liste[i] : null;
    const probleme = String(src.texte || '').trim();
    const immat = String(src.immat || '').trim().toUpperCase();

    if (rienASignaler(probleme)) {
      if (lie && !estResolu(lie)) { liste.splice(i, 1); n += 1; }
      return;
    }
    if (lie) {
      const patch = { probleme, immat, origine: src.origine, origineLibelle: src.libelle };
      // Sorti du garage : le motif d'entree est regle a la date de sortie.
      if (src.resoluLe && !estResolu(lie)) Object.assign(patch, { resolu: 'Oui', dateResolution: src.resoluLe, resoluPar: src.resoluPar });
      else if (src.resoluLe && !lie.resoluPar) patch.resoluPar = src.resoluPar;
      if (Object.keys(patch).some((k) => lie[k] !== patch[k])) { Object.assign(lie, patch); n += 1; }
      return;
    }
    liste.push({
      // Identifiant tire de la source : deux postes qui creent le meme
      // signalement creent la meme fiche, que la synchronisation reunit.
      id: `ev_${src.origine.replace(/[^A-Za-z0-9]+/g, '_')}`,
      origine: src.origine,
      origineLibelle: src.libelle,
      ...(src.missionId ? { missionId: src.missionId, missionRef: src.missionRef } : {}),
      immat,
      probleme,
      dateSignalement: src.date || aujourdhui,
      signalePar: src.par || '',
      signaleA: '',
      resolu: src.resoluLe ? 'Oui' : 'Non',
      dateResolution: src.resoluLe || '',
      ...(src.resoluLe ? { resoluPar: src.resoluPar } : {})
    });
    n += 1;
  });

  n += reglerParLeGarage(db);

  // Source disparue (fiche supprimee, vehicule reforme...) : le signalement
  // part s'il n'est pas resolu.
  for (let i = liste.length - 1; i >= 0; i -= 1) {
    const o = origineDe(liste[i]);
    if (o && !vues.has(o) && !estResolu(liste[i])) { liste.splice(i, 1); n += 1; }
  }
  return n;
}

/** Les plaques du vehicule (nouvelle et ancienne), ou la seule donnee. */
function plaquesDu(immat, db) {
  const c = cle(immat);
  const v = Object.values(db.vehicles || {}).flat()
    .find((x) => x && [x.immatNouvelle, x.immatAncienne].some((p) => cle(p) === c));
  return v ? [v.immatNouvelle, v.immatAncienne].map(cle).filter(Boolean) : [c];
}

/** Le signalement a-t-il ete regle par un passage au garage ? */
export const regleAuGarage = (s) => estResolu(s) && String(s.resoluPar || '').startsWith('garage:');

/**
 * Retour du garage : les pannes signalees sur le vehicule jusqu'a son
 * entree au garage sont reglees a la date de sortie. Seule l'observation
 * du retour, s'il y en a une, reste en cours. Une sortie annulee rouvre
 * ce qu'elle avait regle.
 * @returns {number} le nombre de signalements changes
 */
function reglerParLeGarage(db) {
  let n = 0;
  const sorties = new Map((db.maintenance || []).filter((m) => m.dateRetour).map((m) => [`garage:${m.id}`, m]));
  (db.etatsVehicules || []).forEach((s) => {
    if (s.resoluPar && s.resoluPar.startsWith('garage:') && !sorties.has(s.resoluPar) && !String(s.origine || '').startsWith('entretien:')) {
      Object.assign(s, { resolu: 'Non', dateResolution: '' });
      delete s.resoluPar;
      n += 1;
    }
  });
  sorties.forEach((m, par) => {
    const plaques = plaquesDu(m.immat, db);
    (db.etatsVehicules || []).forEach((s) => {
      if (estResolu(s) || s.origine === `retour:${m.id}` || !plaques.includes(cle(s.immat))) return;
      if (String(s.dateSignalement || '') > String(m.dateEntree || m.dateRetour)) return;
      Object.assign(s, { resolu: 'Oui', dateResolution: m.dateRetour, resoluPar: par });
      n += 1;
    });
  });
  return n;
}

// Chaque enregistrement, d'ou qu'il vienne, accorde ÉTAT DES VÉHICULES.
avantEnregistrement((db) => synchroniserEtats(db));

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
