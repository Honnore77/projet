/* ===================================================================
   Authentification et droits — tout se passe sur le poste.

   Roles :
     admin        — tout, y compris la gestion des comptes et des reglages
     gestionnaire — saisie et modification des donnees du parc
     visiteur     — consultation et exports uniquement
   =================================================================== */

import { DB, persist } from './db.js';
import { hashPassword, verifyPassword } from './crypto.js';
import { uid, norm } from './utils.js';
import { ROLES_ACCES, definirCompte, peutSaisir, roleActuel } from './acces.js';
import { signalerActivite } from './notes.js';

// Les roles et ce qu'ils permettent : voir core/acces.js.
export const ROLES = ROLES_ACCES;

const SESSION_KEY = 'pdu_session';

let session = null;

/* ----------------------- Compte en utilisation ---------------------- */

/** Une session ouverte donne signe de vie a ce rythme (voir core/notes.js). */
const BATTEMENT_MS = 60 * 1000;
let battement = null;

function demarrerActivite(id) {
  arreterActivite(false);
  signalerActivite(id, true);
  battement = setInterval(() => { if (session) signalerActivite(session.id, true); }, BATTEMENT_MS);
}

/**
 * Arrete le signe de vie. `horsLigne` eteint aussi le voyant tout de suite
 * (deconnexion, fermeture de l'application).
 */
export function arreterActivite(horsLigne = true) {
  if (battement) clearInterval(battement);
  battement = null;
  if (horsLigne && session) signalerActivite(session.id, false);
}

export function currentUser() {
  return session;
}

export function isLogged() {
  return !!session;
}

/**
 * Droit d'ajouter et de modifier dans la rubrique affichee (niveau
 * « Saisie » ou « Complet »). Les fiches propres d'un conducteur se
 * reglent a part (acces.js : peutModifier).
 */
export function canWrite() {
  return !!session && peutSaisir();
}

/** Droit d'administration (comptes, reglages, restauration). */
export function canAdmin() {
  return !!session && session.role === 'admin';
}

export function roleLabel(role) {
  const r = ROLES.find((x) => x.key === role);
  return r ? r.label : role;
}

/**
 * Tente une connexion.
 * @returns {Promise<{ok:boolean, error?:string, mustChange?:boolean}>}
 */
export async function login(loginName, password) {
  const key = norm(loginName).trim();
  const acc = DB.accounts.find((a) => norm(a.login).trim() === key);
  if (!acc) return { ok: false, error: 'Identifiant inconnu.' };
  if (acc.enAttente) {
    return { ok: false, error: 'Votre inscription n’a pas encore été validée. Un administrateur doit l’accepter et vous attribuer vos accès.' };
  }
  if (!acc.actif) return { ok: false, error: 'Ce compte est désactivé. Contactez un administrateur.' };

  if (!(await verifyPassword(password, acc.pass))) {
    return { ok: false, error: 'Mot de passe incorrect.' };
  }

  acc.lastLogin = new Date().toISOString();
  persist({ silent: true });
  setSession(acc);
  return { ok: true, mustChange: !!acc.mustChange };
}

export function logout() {
  arreterActivite();
  session = null;
  definirCompte(null);
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  if (typeof document !== 'undefined') document.body.classList.remove('readonly');
}

/** Restaure une session ouverte dans le meme onglet (rafraichissement F5). */
export function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // L'ancienne entree « visiteur » sans mot de passe n'existe plus.
    if (saved.guest) return null;
    const acc = DB.accounts.find((a) => a.id === saved.id && a.actif);
    if (!acc) return null;
    setSession(acc);
    return session;
  } catch (e) {
    return null;
  }
}

function setSession(acc) {
  session = {
    id: acc.id,
    login: acc.login,
    nom: acc.nom || acc.login,
    role: roleActuel(acc.role),
    agent: acc.agent || '',
    guest: !!acc.guest,
    mustChange: !!acc.mustChange
  };
  definirCompte(session);
  if (!battement) demarrerActivite(acc.id);
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Gestion des comptes                                                 */
/* ------------------------------------------------------------------ */

/** Liste des comptes, telle que la rubrique Reglages l'affiche. */
export function listAccounts() {
  return DB.accounts.slice().sort((a, b) => String(a.login).localeCompare(String(b.login)));
}

export async function createAccount({ login: loginName, nom, role, agent, password }) {
  const key = norm(loginName).trim();
  if (!key) return { ok: false, error: "L'identifiant est obligatoire." };
  if (DB.accounts.some((a) => norm(a.login).trim() === key)) {
    return { ok: false, error: 'Cet identifiant existe déjà.' };
  }
  const pwErr = passwordProblem(password);
  if (pwErr) return { ok: false, error: pwErr };

  DB.accounts.push({
    id: uid(),
    login: String(loginName).trim(),
    nom: String(nom || '').trim() || String(loginName).trim(),
    role: role || 'direction',
    agent: String(agent || '').trim(),
    pass: await hashPassword(password),
    actif: true,
    mustChange: true,
    createdAt: new Date().toISOString(),
    lastLogin: ''
  });
  persist();
  return { ok: true };
}

/**
 * Inscription depuis la page de connexion. Le compte nait inactif et « en
 * attente » : il ne sert qu'une fois qu'un administrateur l'a valide et
 * lui a donne son role. Sans cela, n'importe qui se donnerait un acces
 * aux donnees.
 */
export async function inscrire({ login: loginName, nom, password }) {
  const key = norm(loginName).trim();
  const nomPropre = String(nom || '').trim();
  if (!nomPropre) return { ok: false, error: 'Indiquez vos nom et prénoms.' };
  if (!key) return { ok: false, error: 'Choisissez un identifiant.' };
  if (DB.accounts.some((a) => norm(a.login).trim() === key)) {
    return { ok: false, error: 'Cet identifiant est déjà pris : choisissez-en un autre.' };
  }
  const pwErr = passwordProblem(password);
  if (pwErr) return { ok: false, error: pwErr };

  // L'agent de la liste UTILISATEURS qui porte ce nom, s'il existe :
  // l'administrateur n'aura qu'a confirmer.
  const agent = DB.users.find((u) => norm(`${u.nom || ''} ${u.prenoms || ''}`.trim()) === norm(nomPropre));
  const maintenant = new Date().toISOString();
  DB.accounts.push({
    id: uid(),
    login: String(loginName).trim(),
    nom: nomPropre,
    role: 'direction',
    agent: agent ? `${agent.nom || ''} ${agent.prenoms || ''}`.trim() : '',
    pass: await hashPassword(password),
    actif: false,
    enAttente: true,
    // Il a choisi son mot de passe lui-meme : rien a changer a l'arrivee.
    mustChange: false,
    createdAt: maintenant,
    inscritLe: maintenant,
    lastLogin: ''
  });
  persist();
  return { ok: true };
}

/** Les inscriptions qui attendent un administrateur. */
export function inscriptionsEnAttente() {
  return DB.accounts.filter((a) => a.enAttente);
}

/** Modifie un compte (nom, role, activation). */
export function updateAccount(id, patch) {
  const acc = DB.accounts.find((a) => a.id === id);
  if (!acc) return { ok: false, error: 'Compte introuvable.' };
  // Activer un compte inscrit, c'est valider son inscription.
  if (patch.actif === true) patch = Object.assign({}, patch, { enAttente: false });

  const perdAdmin = (patch.role && patch.role !== 'admin') || patch.actif === false;
  if (acc.role === 'admin' && acc.actif && perdAdmin && countActiveAdmins() <= 1) {
    return { ok: false, error: 'Impossible : il doit rester au moins un administrateur actif.' };
  }

  Object.assign(acc, patch);
  persist();
  if (session && session.id === id) setSession(acc);
  return { ok: true };
}

/** Reinitialise le mot de passe d'un compte (administrateur). */
export async function resetPassword(id, newPassword) {
  const acc = DB.accounts.find((a) => a.id === id);
  if (!acc) return { ok: false, error: 'Compte introuvable.' };
  const pwErr = passwordProblem(newPassword);
  if (pwErr) return { ok: false, error: pwErr };
  acc.pass = await hashPassword(newPassword);
  acc.mustChange = true;
  persist();
  return { ok: true };
}

/** Changement de mot de passe par le titulaire du compte. */
export async function changeOwnPassword(oldPassword, newPassword) {
  if (!session || session.guest) return { ok: false, error: 'Aucun compte connecté.' };
  const acc = DB.accounts.find((a) => a.id === session.id);
  if (!acc) return { ok: false, error: 'Compte introuvable.' };
  if (!(await verifyPassword(oldPassword, acc.pass))) {
    return { ok: false, error: 'Ancien mot de passe incorrect.' };
  }
  const pwErr = passwordProblem(newPassword);
  if (pwErr) return { ok: false, error: pwErr };
  acc.pass = await hashPassword(newPassword);
  acc.mustChange = false;
  persist();
  setSession(acc);
  return { ok: true };
}

export function deleteAccount(id) {
  const acc = DB.accounts.find((a) => a.id === id);
  if (!acc) return { ok: false, error: 'Compte introuvable.' };
  if (session && session.id === id) {
    return { ok: false, error: 'Vous ne pouvez pas supprimer le compte avec lequel vous êtes connecté.' };
  }
  if (acc.role === 'admin' && acc.actif && countActiveAdmins() <= 1) {
    return { ok: false, error: 'Impossible : il doit rester au moins un administrateur actif.' };
  }
  DB.accounts = DB.accounts.filter((a) => a.id !== id);
  persist();
  return { ok: true };
}

function countActiveAdmins() {
  return DB.accounts.filter((a) => a.role === 'admin' && a.actif).length;
}

/** Regles minimales de mot de passe. Renvoie un message ou null. */
export function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 6) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return null;
}
