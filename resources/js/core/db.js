/* ===================================================================
   Modele de donnees + copie locale.

   Depuis la mise en service du serveur, ce module n'est plus la source de
   verite : c'est un miroir local de la base centrale, plus une file d'attente
   des modifications qui n'ont pas encore ete remontees.

   Toute ecriture suit le meme chemin, en ligne comme hors ligne :
     1. on applique la modification au miroir (l'interface repond aussitot)
     2. on empile l'operation correspondante dans la file d'attente
     3. le module de synchronisation vide la file des qu'il y a du reseau

   Il n'y a donc qu'un seul code d'ecriture, et le comportement de
   l'application ne change pas selon l'etat de la connexion.
   =================================================================== */

import { readDB, writeDB, readLegacy } from './storage.js';
import { uid, num, daysBetween } from './utils.js';

export const SCHEMA_VERSION = 3;

export const STATUTS_VEHICULE = ['Disponible', 'En mission', 'En entretien', 'Immobilisé'];
export const ENERGIES = ['Essence', 'Diesel', 'Hybride', 'Électrique'];
export const STATUTS_USER = ['Actif', 'Suspendu', 'Inactif'];
export const ETATS_VIDANGE = ['À jour', 'À prévoir', 'En retard'];
export const CATEGORIES = [
  { key: 'pool', label: 'POOL' },
  { key: 'mission', label: 'MISSION' },
  { key: 'service', label: 'SERVICE' }
];

/** Collections locales et leur nom cote serveur. */
const WIRE = {
  'vehicles.pool': 'vehicles',
  'vehicles.mission': 'vehicles',
  'vehicles.service': 'vehicles',
  users: 'users',
  dotationPool: 'dotationPool',
  dotationMission: 'dotationMission',
  missions: 'missions',
  maintenance: 'maintenance'
};

export function emptyDB() {
  return {
    version: SCHEMA_VERSION,
    vehicles: { pool: [], mission: [], service: [] },
    users: [],
    dotationPool: [],
    dotationMission: [],
    missions: [],
    maintenance: [],
    settings: {
      organisation: 'PDU',
      devise: 'F',
      seuilVidangeKm: 5000,
      seuilImmobilisationJours: 7,
      seuilMissionImpayeeJours: 30
    },
    sync: {
      serverUrl: '',
      token: '',
      lastPull: '',
      outbox: [],
      seq: 0,
      clockOffset: 0
    },
    credentials: null,
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  };
}

/** Miroir local. Ne jamais reassigner : muter puis appeler persist(). */
export let DB = emptyDB();

let saveTimer = null;
const listeners = new Set();
let outboxListener = null;

/** Abonne un callback aux changements de donnees. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Le module de synchronisation s'inscrit ici pour etre reveille a chaque ecriture. */
export function onOutboxChange(fn) {
  outboxListener = fn;
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(DB); } catch (e) { console.error(e); }
  });
}

export function persist({ silent = false } = {}) {
  DB.meta.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { writeDB(DB); }, 120);
  if (!silent) emit();
}

export async function persistNow() {
  clearTimeout(saveTimer);
  DB.meta.updatedAt = new Date().toISOString();
  return writeDB(DB);
}

/* ------------------------------------------------------------------ */
/* File d'attente                                                      */
/* ------------------------------------------------------------------ */

/** Horodatage corrige de l'ecart entre l'horloge du poste et celle du serveur. */
export function syncedNow() {
  return new Date(Date.now() + (DB.sync.clockOffset || 0)).toISOString();
}

function enqueue(op) {
  DB.sync.seq = (DB.sync.seq || 0) + 1;
  DB.sync.outbox.push(Object.assign({ seq: DB.sync.seq, at: syncedNow() }, op));
  if (outboxListener) {
    try { outboxListener(); } catch (e) { console.error(e); }
  }
}

export function outboxSize() {
  return DB.sync.outbox.length;
}

/** Identifiants dont une modification locale n'est pas encore remontee. */
export function pendingIds() {
  const set = new Set();
  DB.sync.outbox.forEach((o) => { if (o.id) set.add(`${o.collection}:${o.id}`); });
  return set;
}

/** Retire de la file les operations traitees par le serveur. */
export function dropOperations(seqs) {
  const drop = new Set(seqs);
  DB.sync.outbox = DB.sync.outbox.filter((o) => !drop.has(o.seq));
  persist({ silent: true });
}

export function clearOutbox() {
  DB.sync.outbox = [];
  persist({ silent: true });
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Charge le miroir local et reprend, s'il y a lieu, les donnees des versions
 * precedentes de l'application.
 * @returns {Promise<{firstRun:boolean, migrated:boolean}>}
 */
export async function initDB() {
  let loaded = await readDB();
  let migrated = false;
  let firstRun = false;

  if (!loaded) {
    const legacy = readLegacy();
    loaded = emptyDB();
    if (legacy) {
      importLegacyInto(loaded, legacy);
      migrated = true;
    } else {
      firstRun = true;
    }
  }

  // Une base heritee d'une version autonome n'a jamais connu de serveur :
  // tout ce qu'elle contient doit etre remonte a la premiere connexion.
  const fromStandalone = migrated || Number(loaded.version || 0) < SCHEMA_VERSION;

  DB = normalize(loaded);

  if (fromStandalone && !firstRun) {
    migrated = true;
    queueEverything();
  }

  await persistNow();
  return { firstRun, migrated };
}

/** Complete les champs absents pour tolerer d'anciennes sauvegardes. */
export function normalize(raw) {
  const base = emptyDB();
  const db = Object.assign(base, raw || {});
  db.version = SCHEMA_VERSION;
  db.vehicles = Object.assign({ pool: [], mission: [], service: [] }, raw && raw.vehicles);
  ['pool', 'mission', 'service'].forEach((k) => {
    if (!Array.isArray(db.vehicles[k])) db.vehicles[k] = [];
  });
  ['users', 'dotationPool', 'dotationMission', 'missions', 'maintenance'].forEach((k) => {
    if (!Array.isArray(db[k])) db[k] = [];
  });
  db.settings = Object.assign(base.settings, raw && raw.settings);
  db.sync = Object.assign(base.sync, raw && raw.sync);
  if (!Array.isArray(db.sync.outbox)) db.sync.outbox = [];
  db.meta = Object.assign(base.meta, raw && raw.meta);

  db.users.forEach((u) => { if (!Array.isArray(u.historique)) u.historique = []; });
  db.maintenance.forEach((m) => { if (!Array.isArray(m.interventions)) m.interventions = []; });
  db.dotationMission.forEach((d) => { if (!Array.isArray(d.ravitaillements)) d.ravitaillements = []; });
  allVehicles(db).forEach((v) => { if (!v.id) v.id = uid(); });

  // Les comptes d'acces vivent desormais sur le serveur.
  delete db.accounts;

  return db;
}

/** Reprend les donnees des applications mono-fichier et v2. */
function importLegacyInto(target, legacy) {
  const src = legacy || {};
  if (src.vehicles) {
    ['pool', 'mission', 'service'].forEach((k) => {
      (src.vehicles[k] || []).forEach((v) => {
        target.vehicles[k].push(Object.assign({ id: uid(), statut: 'Disponible' }, v));
      });
    });
  }
  (src.users || []).forEach((u) => target.users.push(Object.assign({ id: uid(), historique: [] }, u)));
  (src.dotationPool || []).forEach((d) => target.dotationPool.push(Object.assign({ id: uid() }, d)));
  (src.dotationMission || []).forEach((d) =>
    target.dotationMission.push(Object.assign({ id: uid(), ravitaillements: [] }, d)));
  (src.missions || []).forEach((m) => target.missions.push(Object.assign({ id: uid() }, m)));
  (src.maintenance || []).forEach((m) =>
    target.maintenance.push(Object.assign({ id: uid(), interventions: [] }, m)));
  if (src.settings) Object.assign(target.settings, src.settings);
}

/**
 * Programme la remontee de l'integralite du miroir.
 * Sert a la premiere mise en service et apres restauration d'une sauvegarde.
 */
export function queueEverything() {
  Object.keys(WIRE).forEach((name) => {
    localList(name).forEach((rec) => {
      enqueue({ op: 'upsert', collection: WIRE[name], id: rec.id, data: wireData(name, rec) });
    });
  });
  enqueue({ op: 'settings', data: DB.settings });
  persist({ silent: true });
}

/** Remplace integralement le miroir (restauration de sauvegarde). */
export async function replaceDB(raw, { push = true } = {}) {
  const keepSync = DB.sync;
  const keepCredentials = DB.credentials;
  const next = normalize(raw);
  next.sync = keepSync;
  next.credentials = keepCredentials;
  DB = next;
  if (push) queueEverything();
  await persistNow();
  emit();
  return DB;
}

/* ------------------------------------------------------------------ */
/* Acces / CRUD                                                        */
/* ------------------------------------------------------------------ */

function localList(name) {
  if (name.startsWith('vehicles.')) return DB.vehicles[name.split('.')[1]];
  return DB[name];
}

export function collection(name) {
  return localList(name);
}

/** Charge utile envoyee au serveur pour un enregistrement donne. */
function wireData(name, record) {
  const data = Object.assign({}, record);
  delete data.updatedAt;
  if (name.startsWith('vehicles.')) data.categorie = name.split('.')[1];
  return data;
}

export function insert(name, record) {
  const item = Object.assign({ id: uid() }, record);
  localList(name).push(item);
  enqueue({ op: 'upsert', collection: WIRE[name], id: item.id, data: wireData(name, item) });
  persist();
  return item;
}

export function update(name, id, patch) {
  const list = localList(name);
  const item = list.find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  enqueue({ op: 'upsert', collection: WIRE[name], id: item.id, data: wireData(name, item) });
  persist();
  return item;
}

export function remove(name, id) {
  const list = localList(name);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  enqueue({ op: 'delete', collection: WIRE[name], id });
  persist();
  return true;
}

/**
 * Signale qu'un enregistrement a ete modifie sur place — typiquement une liste
 * imbriquee (incidents d'un agent, interventions d'un garage, ravitaillements).
 * Ces listes appartiennent a leur parent : c'est le parent qui remonte.
 */
export function touch(name, record) {
  enqueue({ op: 'upsert', collection: WIRE[name], id: record.id, data: wireData(name, record) });
  persist();
  return record;
}

/** Enregistre les reglages et programme leur remontee. */
export function saveSettings(patch) {
  Object.assign(DB.settings, patch);
  enqueue({ op: 'settings', data: DB.settings });
  persist();
  return DB.settings;
}

export function find(name, id) {
  return localList(name).find((x) => x.id === id) || null;
}

/** Deplace un vehicule d'une categorie a une autre. */
export function moveVehicle(id, fromCat, toCat) {
  if (fromCat === toCat) return;
  const list = DB.vehicles[fromCat];
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) return;
  const [v] = list.splice(i, 1);
  DB.vehicles[toCat].push(v);
  enqueue({ op: 'upsert', collection: 'vehicles', id: v.id, data: wireData(`vehicles.${toCat}`, v) });
  persist();
}

/* ------------------------------------------------------------------ */
/* Application d'une descente du serveur                               */
/* ------------------------------------------------------------------ */

/**
 * Fusionne dans le miroir ce que le serveur vient d'envoyer.
 *
 * Les enregistrements dont une modification locale attend encore d'etre
 * remontee sont laisses intacts : ecraser la saisie de l'utilisateur avec une
 * version que le serveur n'a pas encore recue serait une perte de donnees.
 */
export function applyPull(payload) {
  const pending = pendingIds();
  const collections = payload.collections || {};
  let touched = 0;

  // Vehicules : le serveur les envoie a plat, avec leur categorie.
  (collections.vehicles || []).forEach((rec) => {
    if (pending.has(`vehicles:${rec.id}`)) return;
    const cat = CATEGORIES.some((c) => c.key === rec.categorie) ? rec.categorie : 'pool';
    ['pool', 'mission', 'service'].forEach((k) => {
      DB.vehicles[k] = DB.vehicles[k].filter((v) => v.id !== rec.id);
    });
    const clean = Object.assign({}, rec);
    delete clean.categorie;
    DB.vehicles[cat].push(clean);
    touched++;
  });
  (((payload.deleted || {}).vehicles) || []).forEach((id) => {
    if (pending.has(`vehicles:${id}`)) return;
    ['pool', 'mission', 'service'].forEach((k) => {
      DB.vehicles[k] = DB.vehicles[k].filter((v) => v.id !== id);
    });
    touched++;
  });

  ['users', 'dotationPool', 'dotationMission', 'missions', 'maintenance'].forEach((name) => {
    (collections[name] || []).forEach((rec) => {
      if (pending.has(`${name}:${rec.id}`)) return;
      const list = DB[name];
      const i = list.findIndex((x) => x.id === rec.id);
      if (i >= 0) list[i] = rec;
      else list.push(rec);
      touched++;
    });
    (((payload.deleted || {})[name]) || []).forEach((id) => {
      if (pending.has(`${name}:${id}`)) return;
      const before = DB[name].length;
      DB[name] = DB[name].filter((x) => x.id !== id);
      if (DB[name].length !== before) touched++;
    });
  });

  if (payload.settings && !DB.sync.outbox.some((o) => o.op === 'settings')) {
    Object.assign(DB.settings, payload.settings);
  }

  DB.sync.lastPull = payload.serverTime || DB.sync.lastPull;
  if (payload.serverTime) {
    DB.sync.clockOffset = new Date(payload.serverTime).getTime() - Date.now();
  }

  normalize(DB);
  persist();
  return touched;
}

/* ------------------------------------------------------------------ */
/* Vues derivees                                                       */
/* ------------------------------------------------------------------ */

export function allVehicles(db = DB) {
  const out = [];
  ['pool', 'mission', 'service'].forEach((cat) => {
    (db.vehicles[cat] || []).forEach((v) => out.push(Object.assign({ _cat: cat }, v)));
  });
  return out;
}

export function vehicleByImmat(immat) {
  if (!immat) return null;
  const key = String(immat).trim().toUpperCase();
  return allVehicles().find(
    (v) =>
      String(v.immatNouvelle || '').trim().toUpperCase() === key ||
      String(v.immatAncienne || '').trim().toUpperCase() === key
  ) || null;
}

export function immatOf(v) {
  return (v && (v.immatNouvelle || v.immatAncienne)) || '';
}

export function knownImmats() {
  const set = new Set();
  allVehicles().forEach((v) => { const i = immatOf(v); if (i) set.add(i); });
  DB.dotationPool.forEach((d) => d.immat && set.add(d.immat));
  DB.missions.forEach((m) => m.vehicule && set.add(m.vehicule));
  DB.maintenance.forEach((m) => m.immat && set.add(m.immat));
  return [...set].sort();
}

export function knownDrivers() {
  const set = new Set();
  DB.users.forEach((u) => set.add(`${u.nom} ${u.prenoms}`.trim()));
  DB.missions.forEach((m) => m.conducteur && set.add(m.conducteur));
  DB.dotationMission.forEach((d) => d.conducteur && set.add(d.conducteur));
  return [...set].filter(Boolean).sort();
}

export function openMaintenance() {
  return DB.maintenance.filter((m) => !m.dateRetour);
}

export function unpaidMissions() {
  return DB.missions.filter((m) => !m.paye);
}

export function maintenanceCost(immat) {
  return DB.maintenance
    .filter((m) => m.immat === immat)
    .reduce((s, m) => s + (m.interventions || []).reduce((t, iv) => t + num(iv.cout), 0), 0);
}

export function fuelCost(immat) {
  return DB.dotationPool.filter((d) => d.immat === immat).reduce((s, d) => s + num(d.montant), 0);
}

/**
 * Alertes calculees a partir des donnees et des seuils de reglage.
 * @returns {{level:'crit'|'warn'|'ok', icon:string, title:string, detail:string, go?:string}[]}
 */
export function computeAlerts() {
  const out = [];
  const s = DB.settings;
  const today = new Date().toISOString().slice(0, 10);

  const open = openMaintenance();
  if (open.length) {
    const longs = open.filter((m) => {
      const d = daysBetween(m.dateEntree, today);
      return d !== null && d > num(s.seuilImmobilisationJours);
    });
    out.push({
      level: longs.length ? 'crit' : 'warn',
      icon: '🔧',
      title: `${open.length} véhicule(s) actuellement au garage`,
      detail: longs.length
        ? `dont ${longs.length} immobilisé(s) depuis plus de ${s.seuilImmobilisationJours} jours`
        : 'immobilisation dans les délais habituels',
      go: 'ENTRETIEN'
    });
  }

  const unpaid = unpaidMissions();
  if (unpaid.length) {
    const old = unpaid.filter((m) => {
      const d = daysBetween(m.dateRetour, today);
      return d !== null && d > num(s.seuilMissionImpayeeJours);
    });
    out.push({
      level: old.length ? 'crit' : 'warn',
      icon: '💰',
      title: `${unpaid.length} mission(s) en attente de paiement`,
      detail: old.length
        ? `dont ${old.length} de retour depuis plus de ${s.seuilMissionImpayeeJours} jours`
        : 'à régler prochainement',
      go: 'MISSION'
    });
  }

  const vidangeRetard = new Map();
  DB.dotationPool.forEach((d) => {
    if (d.vidange === 'En retard') vidangeRetard.set(d.immat, d);
  });
  if (vidangeRetard.size) {
    out.push({
      level: 'crit',
      icon: '🛢️',
      title: `${vidangeRetard.size} véhicule(s) avec vidange en retard`,
      detail: [...vidangeRetard.keys()].join(', '),
      go: 'DOTATION'
    });
  }

  const immo = allVehicles().filter((v) => v.statut === 'Immobilisé');
  if (immo.length) {
    out.push({
      level: 'warn',
      icon: '🚫',
      title: `${immo.length} véhicule(s) immobilisé(s)`,
      detail: immo.map((v) => immatOf(v)).join(', '),
      go: 'VEHICULES'
    });
  }

  const sansImmat = allVehicles().filter((v) => !immatOf(v));
  if (sansImmat.length) {
    out.push({
      level: 'warn',
      icon: '❓',
      title: `${sansImmat.length} véhicule(s) sans immatriculation`,
      detail: 'à compléter pour permettre le suivi entretien et dotation',
      go: 'VEHICULES'
    });
  }

  if (!out.length) {
    out.push({ level: 'ok', icon: '✅', title: 'Aucune alerte', detail: 'Le parc est à jour.' });
  }
  return out;
}
