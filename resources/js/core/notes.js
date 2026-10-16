/* ===================================================================
   NOTES — messagerie interne entre les comptes de l'application.

   Une note est :
     publique  lue par tous les comptes ;
     privee    lue par son auteur et les comptes qu'il a choisis.

   Les notes suivent la synchronisation comme le reste de la base. Ce que
   chacun a deja lu est range sur son compte (`notesLues`), pas sur la
   note : deux comptes qui lisent la meme note sur deux appareils ne se
   disputent pas la meme fiche.

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

export function estLue(note, compteId, db = DB) {
  if (note.auteurId === compteId) return true;
  const c = compteDe(compteId, db);
  return !!c && (c.notesLues || []).includes(note.id);
}

/** Les notes recues que le compte n'a pas encore lues. */
export function notesNonLues(compteId, db = DB) {
  return notesRecues(compteId, db).filter((n) => !estLue(n, compteId, db));
}

/**
 * Marque des notes comme lues. Les marques des notes disparues sont
 * oubliees au passage, pour que la liste ne grossisse pas sans fin.
 */
export function marquerLues(ids, compteId, db = DB) {
  const c = compteDe(compteId, db);
  if (!c || !ids.length) return false;
  const existantes = new Set((db.notes || []).map((n) => n.id));
  const actuelles = c.notesLues || [];
  const apres = [...new Set(actuelles.filter((id) => existantes.has(id)).concat(ids))];
  if (apres.length === actuelles.length && apres.every((id) => actuelles.includes(id))) return false;
  c.notesLues = apres;
  if (db === DB) persist({ silent: true });
  return true;
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
