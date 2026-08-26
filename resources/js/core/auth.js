/* ===================================================================
   Authentification.

   Les comptes vivent sur le serveur. Ce module s'y connecte, conserve le
   jeton d'acces, et garde de quoi rouvrir une session hors ligne : sans cela
   un poste sans reseau ne pourrait meme pas afficher les donnees qu'il
   possede deja.

   Roles :
     admin        — tout, y compris la gestion des comptes et des reglages
     gestionnaire — saisie et modification des donnees du parc
     visiteur     — consultation et exports uniquement
   =================================================================== */

import { DB, persist } from './db.js';
import { api, ApiError, setToken, getToken, setServerUrl } from './api.js';
import { hashPassword, verifyPassword } from './crypto.js';
import { norm } from './utils.js';

export const ROLES = [
  { key: 'admin', label: 'Administrateur', desc: 'Tous les droits, y compris la gestion des comptes' },
  { key: 'gestionnaire', label: 'Gestionnaire', desc: 'Saisie et modification des données du parc' },
  { key: 'visiteur', label: 'Visiteur', desc: 'Consultation et exports uniquement' }
];

const SESSION_KEY = 'pdu_session';

let session = null;

export function currentUser() {
  return session;
}

export function isLogged() {
  return !!session;
}

export function canWrite() {
  return !!session && (session.role === 'admin' || session.role === 'gestionnaire');
}

export function canAdmin() {
  return !!session && session.role === 'admin';
}

/** La session courante a-t-elle ete ouverte sans joindre le serveur ? */
export function isOfflineSession() {
  return !!session && !!session.offline;
}

export function roleLabel(role) {
  const r = ROLES.find((x) => x.key === role);
  return r ? r.label : role;
}

/** Charge l'adresse du serveur et le jeton conserves sur ce poste. */
export function loadStoredCredentials() {
  if (DB.sync.serverUrl) setServerUrl(DB.sync.serverUrl);
  if (DB.sync.token) setToken(DB.sync.token);
}

/**
 * Connexion. Tente d'abord le serveur ; si celui-ci est injoignable et que ce
 * poste connait deja ce compte, ouvre une session hors ligne.
 * @returns {Promise<{ok:boolean, error?:string, offline?:boolean, mustChange?:boolean}>}
 */
export async function login(loginName, password) {
  const trimmed = String(loginName || '').trim();

  try {
    const res = await api.login(trimmed, password, deviceName());
    setToken(res.token);
    DB.sync.token = res.token;
    if (res.serverTime) {
      DB.sync.clockOffset = new Date(res.serverTime).getTime() - Date.now();
    }
    // On retient de quoi rouvrir une session sans reseau la prochaine fois.
    DB.credentials = {
      id: res.user.id,
      login: res.user.login,
      nom: res.user.nom,
      role: res.user.role,
      mustChange: !!res.user.mustChange,
      pass: await hashPassword(password)
    };
    persist({ silent: true });
    setSession(Object.assign({}, res.user, { offline: false }));
    return { ok: true, mustChange: !!res.user.mustChange };
  } catch (e) {
    if (!(e instanceof ApiError) || !e.isOffline) {
      return { ok: false, error: e instanceof ApiError ? e.message : 'Connexion impossible.' };
    }
    return offlineLogin(trimmed, password);
  }
}

async function offlineLogin(loginName, password) {
  const c = DB.credentials;
  if (!c || norm(c.login) !== norm(loginName)) {
    return {
      ok: false,
      error: "Serveur injoignable, et ce compte ne s'est encore jamais connecté sur ce poste."
    };
  }
  if (!(await verifyPassword(password, c.pass))) {
    return { ok: false, error: 'Mot de passe incorrect.' };
  }
  setSession({ id: c.id, login: c.login, nom: c.nom, role: c.role, mustChange: false, offline: true });
  return { ok: true, offline: true, mustChange: false };
}

/**
 * Ferme la session locale sans revoquer le jeton : les modifications faites
 * hors ligne doivent pouvoir remonter a la prochaine ouverture, meme si
 * l'utilisateur a quitte l'application entre-temps.
 */
export function logout() {
  session = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  document.body.classList.remove('readonly');
}

/**
 * Deconnexion complete : revoque le jeton sur le serveur et efface tout ce que
 * ce poste retenait du compte. La copie locale des donnees est conservee.
 */
export async function forgetDevice() {
  try {
    if (getToken()) await api.logout();
  } catch (e) { /* le serveur peut etre injoignable, on efface quand meme */ }
  setToken('');
  DB.sync.token = '';
  DB.credentials = null;
  persist({ silent: true });
  logout();
}

/** Restaure une session ouverte dans le meme onglet (rafraichissement F5). */
export function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!DB.credentials || DB.credentials.login !== saved.login) return null;
    setSession(saved);
    return session;
  } catch (e) {
    return null;
  }
}

/** Appele par la synchronisation quand le serveur refuse le jeton. */
export function invalidateSession() {
  setToken('');
  DB.sync.token = '';
  persist({ silent: true });
  logout();
}

function setSession(user) {
  session = {
    id: String(user.id),
    login: user.login,
    nom: user.nom || user.login,
    role: user.role,
    mustChange: !!user.mustChange,
    offline: !!user.offline
  };
  document.body.classList.toggle('readonly', !canWrite());
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
}

function deviceName() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (typeof window !== 'undefined' && window.pduDesktop) return 'bureau';
  if (/Android|iPhone|iPad/i.test(ua)) return 'mobile';
  return 'web';
}

/* ------------------------------------------------------------------ */
/* Comptes — toutes ces operations exigent le serveur                  */
/* ------------------------------------------------------------------ */

export async function fetchAccounts() {
  const res = await api.accounts();
  return res.accounts || [];
}

export async function createAccount({ login: loginName, nom, role, password }) {
  try {
    await api.createAccount({ login: loginName, nom, role, password });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function updateAccount(id, patch) {
  try {
    await api.updateAccount(id, patch);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function resetPassword(id, newPassword) {
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };
  try {
    await api.resetAccountPassword(id, newPassword);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function deleteAccount(id) {
  try {
    await api.deleteAccount(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/** Changement de mot de passe par le titulaire du compte. */
export async function changeOwnPassword(oldPassword, newPassword) {
  if (!session) return { ok: false, error: 'Aucun compte connecté.' };
  if (session.offline) {
    return { ok: false, error: 'Le changement de mot de passe demande une connexion au serveur.' };
  }
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };

  try {
    const res = await api.changePassword(oldPassword, newPassword);
    DB.credentials = Object.assign({}, DB.credentials, {
      mustChange: false,
      pass: await hashPassword(newPassword)
    });
    persist({ silent: true });
    setSession(Object.assign({}, res.user, { offline: false }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

function describe(e) {
  if (e instanceof ApiError) {
    return e.isOffline ? 'Cette action demande une connexion au serveur.' : e.message;
  }
  return 'Une erreur est survenue.';
}

/** Regles minimales de mot de passe, identiques a celles du serveur. */
export function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 6) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return null;
}
