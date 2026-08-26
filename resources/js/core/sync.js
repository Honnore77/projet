/* ===================================================================
   Synchronisation entre le miroir local et la base centrale.

   - descente (pull) : ce que les autres postes ont modifie
   - remontee (push) : ce que ce poste a modifie, en ligne ou hors ligne

   Rien ne bloque l'interface : une panne de reseau se traduit par une file
   d'attente qui s'allonge, pas par une erreur de saisie.
   =================================================================== */

import { api, ApiError, hasToken } from './api.js';
import { DB, applyPull, dropOperations, outboxSize, onOutboxChange, persist } from './db.js';

const PULL_INTERVAL_MS = 30000;
const FLUSH_DEBOUNCE_MS = 900;
const BATCH_SIZE = 200;

const state = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  busy: false,
  lastPull: '',
  lastError: '',
  pending: 0
};

const listeners = new Set();
let pullTimer = null;
let flushTimer = null;
let started = false;
let onUnauthorized = null;

/** @returns {{online:boolean, busy:boolean, lastPull:string, lastError:string, pending:number}} */
export function syncState() {
  return Object.assign({}, state, { pending: outboxSize() });
}

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  state.pending = outboxSize();
  listeners.forEach((fn) => {
    try { fn(syncState()); } catch (e) { console.error(e); }
  });
}

/** Demarre les echanges periodiques. */
export function startSync({ onSessionLost } = {}) {
  onUnauthorized = onSessionLost || null;
  if (started) return;
  started = true;

  state.lastPull = DB.sync.lastPull || '';

  onOutboxChange(() => scheduleFlush());
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibility);

  pullTimer = setInterval(() => { syncNow({ quiet: true }); }, PULL_INTERVAL_MS);
  syncNow({ quiet: true });
}

export function stopSync() {
  started = false;
  clearInterval(pullTimer);
  clearTimeout(flushTimer);
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  document.removeEventListener('visibilitychange', handleVisibility);
  onOutboxChange(null);
}

function handleOnline() {
  state.online = true;
  emit();
  syncNow({ quiet: true });
}

function handleOffline() {
  state.online = false;
  emit();
}

function handleVisibility() {
  if (document.visibilityState === 'visible') syncNow({ quiet: true });
}

function scheduleFlush() {
  emit();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { syncNow({ quiet: true }); }, FLUSH_DEBOUNCE_MS);
}

/**
 * Remonte la file d'attente puis redescend les nouveautes.
 * @param {{quiet?:boolean, full?:boolean}} opts
 * @returns {Promise<{ok:boolean, error?:string, received?:number, sent?:number}>}
 */
export async function syncNow({ quiet = false, full = false } = {}) {
  if (!hasToken()) {
    return { ok: false, error: 'Aucune session serveur ouverte sur ce poste.' };
  }
  if (state.busy) return { ok: true, skipped: true };

  state.busy = true;
  state.lastError = '';
  emit();

  let sent = 0;
  let received = 0;
  try {
    sent = await flush();
    received = await pull({ full });
    state.online = true;
    state.lastPull = DB.sync.lastPull;
    return { ok: true, sent, received };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(String(e && e.message ? e.message : e), -1);
    if (err.status === 401) {
      state.lastError = 'Session expirée.';
      if (onUnauthorized) onUnauthorized();
    } else if (err.isOffline) {
      state.online = false;
      state.lastError = '';
    } else {
      state.lastError = err.message;
      if (!quiet) console.error(err);
    }
    return { ok: false, error: state.lastError || 'Serveur injoignable.' };
  } finally {
    state.busy = false;
    emit();
  }
}

/** Envoie la file d'attente, par lots. @returns {Promise<number>} operations acceptees */
async function flush() {
  let total = 0;

  while (DB.sync.outbox.length) {
    const batch = DB.sync.outbox.slice(0, BATCH_SIZE);
    let res;
    try {
      res = await api.push(batch);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Compte passe en consultation seule : la file ne partira jamais,
        // on la vide pour ne pas la faire grossir indefiniment.
        dropOperations(batch.map((o) => o.seq));
        state.lastError = e.message;
        emit();
        return total;
      }
      throw e;
    }

    if (res.serverTime) {
      DB.sync.clockOffset = new Date(res.serverTime).getTime() - Date.now();
    }

    // Les operations refusees comme obsoletes le resteront : on les retire
    // aussi, la descente qui suit ramenera la version du serveur.
    const done = [...(res.applied || []), ...(res.skipped || []).map((s) => s.seq)];
    dropOperations(done);
    total += (res.applied || []).length;

    if (!done.length) break; // rien n'avance : on evite la boucle infinie
  }

  return total;
}

/** Redescend les modifications du serveur. @returns {Promise<number>} */
async function pull({ full = false } = {}) {
  const since = full ? null : DB.sync.lastPull || null;
  const payload = await api.pull(since);
  const received = applyPull(payload);
  lastAccounts = payload.accounts || lastAccounts;
  return received;
}

/** Derniere liste de comptes recue (les administrateurs la recoivent avec la descente). */
let lastAccounts = null;
export function cachedAccounts() {
  return lastAccounts;
}

/** Vide le miroir des metadonnees de synchronisation (changement de serveur). */
export function resetSyncState() {
  DB.sync.lastPull = '';
  DB.sync.clockOffset = 0;
  lastAccounts = null;
  persist({ silent: true });
}
