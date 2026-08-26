/* ===================================================================
   Client HTTP de l'API Laravel.

   Le site web parle a sa propre origine ; l'application de bureau parle a
   l'adresse que l'administrateur a saisie au premier lancement. Le reste du
   code ne connait que les fonctions ci-dessous.
   =================================================================== */

import { isDesktop } from './storage.js';

/** Erreur portant le code HTTP, pour distinguer panne reseau et refus serveur. */
export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }

  /** Vrai quand le serveur n'a pas pu etre joint (et non quand il a refuse). */
  get isOffline() {
    return this.status === 0;
  }
}

let serverUrl = '';
let token = '';

/** Adresse du serveur pour l'application de bureau. */
export function setServerUrl(url) {
  serverUrl = normalizeBase(url);
}

export function getServerUrl() {
  return serverUrl;
}

export function setToken(t) {
  token = t || '';
}

export function getToken() {
  return token;
}

export function hasToken() {
  return !!token;
}

/**
 * Racine de l'API.
 * - bureau : adresse configuree
 * - developpement web : serveur Laravel local, le front tournant sur un autre port
 * - production web : meme origine que la page
 */
export function apiBase() {
  if (isDesktop) return serverUrl ? `${serverUrl}/api` : '';
  if (import.meta.env.VITE_API_URL) return normalizeBase(import.meta.env.VITE_API_URL);
  if (import.meta.env.DEV) return 'http://localhost:8000/api';
  return `${window.location.origin}/api`;
}

/** Une adresse de serveur est-elle necessaire et manquante ? */
export function needsServerUrl() {
  return isDesktop && !serverUrl;
}

function normalizeBase(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '').replace(/\/api$/i, '');
}

/**
 * Appel JSON.
 * @throws {ApiError} status 0 si le serveur est injoignable
 */
export async function request(path, { method = 'GET', body, auth = true, timeout = 20000 } = {}) {
  const base = apiBase();
  if (!base) throw new ApiError("Aucune adresse de serveur n'est configurée.", 0);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(base + path, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new ApiError('Serveur injoignable.', 0, e);
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch (e) {
    payload = null;
  }

  if (!res.ok) {
    throw new ApiError(readMessage(payload, res.status), res.status, payload);
  }
  return payload;
}

function readMessage(payload, status) {
  if (payload && payload.message) return payload.message;
  if (payload && payload.errors) {
    const first = Object.values(payload.errors)[0];
    if (Array.isArray(first) && first[0]) return first[0];
  }
  if (status === 401) return 'Session expirée, reconnectez-vous.';
  if (status === 403) return 'Action non autorisée.';
  return `Erreur du serveur (${status}).`;
}

/* --------------------------- Points d'entree ----------------------- */

export const api = {
  health: () => request('/health', { auth: false, timeout: 8000 }),

  login: (login, password, device) =>
    request('/login', { method: 'POST', auth: false, body: { login, password, device } }),

  me: () => request('/me'),

  logout: () => request('/logout', { method: 'POST' }),

  changePassword: (current, password) =>
    request('/password', { method: 'POST', body: { current, password } }),

  pull: (since) => request(`/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, { timeout: 45000 }),

  push: (operations) => request('/push', { method: 'POST', body: { operations }, timeout: 45000 }),

  accounts: () => request('/accounts'),

  createAccount: (body) => request('/accounts', { method: 'POST', body }),

  updateAccount: (id, body) => request(`/accounts/${id}`, { method: 'PUT', body }),

  resetAccountPassword: (id, password) =>
    request(`/accounts/${id}/password`, { method: 'POST', body: { password } }),

  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' })
};
