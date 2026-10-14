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

// Les roles et ce qu'ils permettent : voir core/acces.js.
export const ROLES = ROLES_ACCES;

const SESSION_KEY = 'pdu_session';

let session = null;

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
  session = null;
  definirCompte(null);
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  document.body.classList.remove('readonly');
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

/** Modifie un compte (nom, role, activation). */
export function updateAccount(id, patch) {
  const acc = DB.accounts.find((a) => a.id === id);
  if (!acc) return { ok: false, error: 'Compte introuvable.' };

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
