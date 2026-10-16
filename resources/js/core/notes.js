/* ===================================================================
   NOTES — messagerie interne entre les comptes de l'application.

   Une note est :
     publique  lue par tous les comptes ;
     privee    lue par son auteur et les comptes qu'il a choisis.

   Les notes suivent la synchronisation comme le reste de la base. Ce que
   chacun a deja lu n'est pas range sur la note : deux comptes qui lisent
   la meme note sur deux appareils se disputeraient la meme fiche. Ni sur
   le compte : la fiche du compte porte le mot de passe, et une fiche
   modifiee sans cesse l'emporterait a la synchronisation sur un mot de
   passe change entre-temps sur l'autre appareil.

   Chaque compte a donc sa fiche de suivi (`suiviComptes`, meme
   identifiant que le compte) :
     notesLues  identifiant de la note -> date de lecture ;
     activite   date du dernier signe de vie de la session ouverte.

   Les dates de lecture font l'accuse de reception : l'expediteur voit qui
   a lu sa note, et quand (✓ envoyee, ✓✓ lue).

   Comme les niveaux d'acces, la confidentialite d'une note privee tient a
   ce que l'application montre : la note n'est pas chiffree dans la base.
   =================================================================== */

import { DB, persist } from './db.js';

export const PUBLIQUE = 'publique';
export const PRIVEE = 'privee';

const compteDe = (id, db) => (db.accounts || []).find((a) => a.id === id) || null;

/** Le compte peut-il lire cette note ? */
export function peutLire(note, compteId) {
  if (!note || !compteId) return false;
  if (note.visibilite === PUBLIQUE) return true;
  return note.auteurId === compteId || (note.destinataires || []).includes(compteId);
}

/** Les notes que le compte peut lire, les plus recentes d'abord. */
export function notesVisibles(compteId, db = DB) {
  return (db.notes || [])
    .filter((n) => peutLire(n, compteId))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** Les notes ecrites par d'autres, que le compte peut lire. */
export function notesRecues(compteId, db = DB) {
  return notesVisibles(compteId, db).filter((n) => n.auteurId !== compteId);
}

/** Les notes ecrites par le compte. */
export function notesEnvoyees(compteId, db = DB) {
  return notesVisibles(compteId, db).filter((n) => n.auteurId === compteId);
}

/** La fiche de suivi d'un compte, creee au besoin si `creer`. */
export function suiviDe(compteId, db = DB, creer = false) {
  if (!Array.isArray(db.suiviComptes)) db.suiviComptes = [];
  let s = db.suiviComptes.find((x) => x.id === compteId) || null;
  if (!s && creer && compteId) {
    s = { id: compteId, notesLues: {}, activite: '' };
    db.suiviComptes.push(s);
  }
  return s;
}

/** Les lectures d'un compte : { idNote: date }. */
function lecturesDe(compteId, db) {
  const l = (suiviDe(compteId, db) || {}).notesLues;
  return l && typeof l === 'object' ? l : {};
}

/** Date a laquelle le compte a lu la note, ou null s'il ne l'a pas lue. */
export function luLe(note, compteId, db = DB) {
  const lectures = lecturesDe(compteId, db);
  return Object.prototype.hasOwnProperty.call(lectures, note.id) ? lectures[note.id] : null;
}

export function estLue(note, compteId, db = DB) {
  if (note.auteurId === compteId) return true;
  return luLe(note, compteId, db) !== null;
}

/** Les notes recues que le compte n'a pas encore lues. */
export function notesNonLues(compteId, db = DB) {
  return notesRecues(compteId, db).filter((n) => !estLue(n, compteId, db));
}

/**
 * Marque des notes comme lues. Les marques des notes disparues sont
 * oubliees au passage, pour que la liste ne grossisse pas sans fin.
 */
export function marquerLues(ids, compteId, db = DB, quand = new Date().toISOString()) {
  if (!compteDe(compteId, db) || !ids.length) return false;
  const existantes = new Set((db.notes || []).map((n) => n.id));
  const avant = lecturesDe(compteId, db);
  const apres = {};
  Object.keys(avant).forEach((id) => { if (existantes.has(id)) apres[id] = avant[id]; });
  ids.forEach((id) => { if (!(id in apres)) apres[id] = quand; });
  const inchange = Object.keys(apres).length === Object.keys(avant).length
    && Object.keys(apres).every((id) => avant[id] === apres[id]);
  if (inchange) return false;
  suiviDe(compteId, db, true).notesLues = apres;
  if (db === DB) persist({ silent: true });
  return true;
}

/* ------------------------- Comptes en ligne ------------------------- */

/**
 * Une session ouverte donne signe de vie chaque minute. Passe ce delai
 * sans nouvelle, le compte n'est plus tenu pour en utilisation : une
 * application fermee sans se deconnecter (telephone eteint, panne de
 * courant) eteint ainsi son voyant d'elle-meme.
 */
export const DELAI_ACTIVITE_MS = 3 * 60 * 1000;

/** Note le signe de vie (ou la deconnexion, avec `enLigne` faux) d'un compte. */
export function signalerActivite(compteId, enLigne = true, db = DB, quand = new Date().toISOString()) {
  if (!compteDe(compteId, db)) return;
  suiviDe(compteId, db, true).activite = enLigne ? quand : '';
  if (db === DB) persist({ silent: true });
}

/** Le compte a-t-il une session ouverte en ce moment ? */
export function estEnUtilisation(compteId, db = DB, maintenant = Date.now()) {
  const a = (suiviDe(compteId, db) || {}).activite;
  if (!a) return false;
  const t = new Date(a).getTime();
  return !Number.isNaN(t) && maintenant - t < DELAI_ACTIVITE_MS && t - maintenant < DELAI_ACTIVITE_MS;
}

/**
 * Le point des notes de chaque compte, pour la sous-rubrique COMPTES :
 * envoyees, recues, lues, non lues, et le voyant d'utilisation.
 */
export function pointDesComptes(db = DB, maintenant = Date.now()) {
  return (db.accounts || []).map((a) => {
    const recues = notesRecues(a.id, db);
    const nonLues = recues.filter((n) => !estLue(n, a.id, db)).length;
    return {
      compte: a,
      enUtilisation: estEnUtilisation(a.id, db, maintenant),
      envoyees: notesEnvoyees(a.id, db).length,
      recues: recues.length,
      lues: recues.length - nonLues,
      nonLues
    };
  }).sort((x, y) => (y.enUtilisation - x.enUtilisation)
    || String(x.compte.nom || x.compte.login).localeCompare(String(y.compte.nom || y.compte.login), 'fr'));
}

/**
 * Accuse de reception d'une note : pour chaque lecteur attendu, la date
 * de lecture (ou null). Une note privee attend ses destinataires ; une
 * note publique, tous les comptes actifs sauf son auteur.
 */
export function accusesDe(note, db = DB) {
  const attendus = note.visibilite === PUBLIQUE
    ? (db.accounts || []).filter((a) => a.actif && !a.enAttente && a.id !== note.auteurId).map((a) => a.id)
    : (note.destinataires || []);
  return attendus.map((id) => ({ id, nom: nomDuCompte(id, db), luLe: luLe(note, id, db) }));
}

/** ✓ envoyee (personne n'a lu), ✓✓ lue par une partie, ✓✓ bleu lue par tous. */
export function etatAccuse(note, db = DB) {
  const a = accusesDe(note, db);
  const lus = a.filter((x) => x.luLe !== null).length;
  if (!a.length || !lus) return 'envoyee';
  return lus === a.length ? 'lue' : 'partielle';
}

/**
 * Les lectures de ses notes envoyees, a plat : { cle, noteId, sujet,
 * lecteurId, nom, luLe }. La fenetre flottante y repere les nouvelles.
 */
export function lecturesDeMesNotes(compteId, db = DB) {
  return notesEnvoyees(compteId, db).flatMap((n) => accusesDe(n, db)
    .filter((x) => x.luLe !== null)
    .map((x) => ({ cle: `${n.id}|${x.id}`, noteId: n.id, sujet: n.sujet, lecteurId: x.id, nom: x.nom, luLe: x.luLe })));
}

/** Les comptes a qui l'on peut ecrire : actifs, inscription validee, sauf soi. */
export function comptesDestinataires(compteId, db = DB) {
  return (db.accounts || [])
    .filter((a) => a.actif && !a.enAttente && a.id !== compteId)
    .sort((a, b) => String(a.nom || a.login).localeCompare(String(b.nom || b.login), 'fr'));
}

/** Nom affiche d'un compte, meme supprime depuis (la note garde le nom). */
export function nomDuCompte(id, db = DB, defaut = 'Compte supprimé') {
  const c = compteDe(id, db);
  return c ? (c.nom || c.login) : defaut;
}

/** Modifier : l'auteur seul. Supprimer : l'auteur ou un administrateur. */
export function peutModifierNote(note, compte) {
  return !!note && !!compte && note.auteurId === compte.id;
}

export function peutSupprimerNote(note, compte) {
  return !!note && !!compte && (note.auteurId === compte.id || compte.role === 'admin');
}

/**
 * Destinataires proposes pour repondre : l'auteur, et pour une note
 * privee les autres destinataires (« repondre a tous »).
 */
export function destinatairesReponse(note, compteId) {
  const ids = [note.auteurId].concat(note.visibilite === PRIVEE ? note.destinataires || [] : []);
  return [...new Set(ids)].filter((id) => id && id !== compteId);
}

/** Les reponses a une note, de la plus ancienne a la plus recente. */
export function reponsesA(noteId, compteId, db = DB) {
  return notesVisibles(compteId, db).filter((n) => n.reponseA === noteId).reverse();
}
