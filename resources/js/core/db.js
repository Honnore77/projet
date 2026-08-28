/* ===================================================================
   Modele de donnees + magasin central.

   L'application est autonome : ce fichier est la source de verite. Les
   donnees vivent sur le poste (fichier JSON pour l'application de bureau,
   stockage local pour le navigateur) et n'en sortent que par les exports
   et les sauvegardes.
   =================================================================== */

import { readDB, writeDB, readLegacy } from './storage.js';
import { uid, num, norm, sum, daysBetween } from './utils.js';
import { hashPassword } from './crypto.js';

export const SCHEMA_VERSION = 4;

/**
 * Statuts proposes a la saisie. « En mission » a ete retire : le passage en
 * mission se lit dans la rubrique MISSION, le dupliquer ici faisait deux
 * verites pour un meme fait. Les vehicules encore marques ainsi gardent leur
 * valeur (voir vehicleFields), ils ne sont simplement plus proposes.
 */
export const STATUTS_VEHICULE = ['Disponible', 'En entretien', 'Immobilisé'];

/**
 * Prefixes d'immatriculation du PDU. Ils sont pre-inscrits dans le formulaire
 * pour n'avoir a saisir que la fin de la plaque.
 */
export const PREFIXE_IMMAT_NOUVELLE = 'D45 50 ';
export const PREFIXE_IMMAT_ANCIENNE = 'D45 ';

/**
 * Listes de reference proposees a la saisie. Elles ne sont pas fermees : le
 * formulaire y ajoute ce qui est deja enregistre dans le parc, et toute valeur
 * saisie a la main est acceptee puis reproposee ensuite.
 */
export const MODELES = [
  'TERRA', 'NAVARA', 'KICKS', 'QASHQAI', 'XTRAIL',
  'TERRITORY', 'CROSS', 'PRADO', 'LAND CRUISER'
];

export const COULEURS = ['BLANCHE', 'NOIRE', 'GRISE', 'ROUGE', 'BLEU'];

/** Agents du pool pre-enregistres au premier lancement. */
export const AGENTS_PDU = [
  { nom: 'DELON', prenoms: 'CALIXE' },
  { nom: 'DIARRASSOUBA', prenoms: 'BRAHIMA' },
  { nom: 'DOSSO', prenoms: 'YAYA' },
  { nom: 'CHEICKNA', prenoms: 'KEBE' },
  { nom: 'KARABOUE', prenoms: 'FALIKOU' }
];
export const ENERGIES = ['Essence', 'Diesel', 'Hybride', 'Électrique'];
export const STATUTS_USER = ['Actif', 'Suspendu', 'Inactif'];
export const ETATS_VIDANGE = ['À jour', 'À prévoir', 'En retard'];
export const CATEGORIES = [
  { key: 'pool', label: 'POOL' },
  { key: 'mission', label: 'MISSION' },
  { key: 'service', label: 'SERVICE' }
];

/**
 * Sections du PDU. Liste unique, partagee par la fiche vehicule et la fiche
 * agent : deux listes separees finiraient par diverger, et les filtres par
 * section ne retrouveraient plus leurs petits.
 */
export const SECTIONS = [
  'COORDINATION',
  'AFFAIRE ADMINISTRATIVE ET FINANCIERE',
  'OPERATION',
  'MARCHE ET AFFAIRES JURIDIQUES',
  'AGENCE COMPTABLE',
  'COMMUNICATION'
];

export function emptyDB() {
  return {
    version: SCHEMA_VERSION,
    accounts: [],
    vehicles: { pool: [], mission: [], service: [] },
    users: [],
    dotationPool: [],
    // Le carburant des missions n'a pas de collection propre : il est saisi
    // dans le rapport de mission, donc porte par la mission elle-meme.
    missions: [],
    maintenance: [],
    settings: {
      organisation: 'PDU',
      devise: 'F',
      // Intervalle courant entre deux vidanges : sert a proposer le
      // kilometrage de la prochaine quand on saisit un vehicule.
      seuilVidangeKm: 5000,
      // Marge d'alerte : on previent des qu'il reste moins que cela a
      // parcourir avant la vidange due.
      seuilAlerteVidangeKm: 500,
      seuilImmobilisationJours: 7,
      seuilMissionImpayeeJours: 30
    },
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  };
}

/** Etat vivant de l'application. Ne jamais reassigner : muter puis appeler persist(). */
export let DB = emptyDB();

let saveTimer = null;
const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(DB); } catch (e) { console.error(e); }
  });
}

/** Persiste la base (ecriture groupee pour ne pas saturer le disque). */
export function persist({ silent = false } = {}) {
  DB.meta.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { writeDB(DB); }, 120);
  if (!silent) emit();
}

/** Force une ecriture immediate (fermeture de l'application, sauvegarde manuelle). */
export async function persistNow() {
  clearTimeout(saveTimer);
  DB.meta.updatedAt = new Date().toISOString();
  return writeDB(DB);
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Charge la base, reprend les donnees des versions precedentes si besoin,
 * cree le compte administrateur au tout premier lancement.
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

  DB = normalize(loaded);

  // Les agents du pool sont pre-enregistres sur une base vierge : ils
  // alimentent le champ « Utilisateur » des fiches vehicule et le tour de role
  // des missions, qui n'ont donc rien a proposer tant que UTILISATEURS est vide.
  if (firstRun && DB.users.length === 0) {
    AGENTS_PDU.forEach((a) => {
      DB.users.push({
        id: uid(),
        nom: a.nom,
        prenoms: a.prenoms,
        fonction: 'Conducteur',
        section: '',
        statut: 'Actif',
        poolConducteur: true,
        telephone: '',
        permis: '',
        observations: '',
        historique: [],
        createdAt: new Date().toISOString()
      });
    });
  }

  if (DB.accounts.length === 0) {
    firstRun = true;
    const pass = await hashPassword('admin');
    DB.accounts.push({
      id: uid(),
      login: 'admin',
      nom: 'Administrateur',
      role: 'admin',
      pass,
      actif: true,
      mustChange: true,
      createdAt: new Date().toISOString(),
      lastLogin: ''
    });
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
  ['accounts', 'users', 'dotationPool', 'missions', 'maintenance'].forEach((k) => {
    if (!Array.isArray(db[k])) db[k] = [];
  });
  db.settings = Object.assign(base.settings, raw && raw.settings);
  db.meta = Object.assign(base.meta, raw && raw.meta);

  db.users.forEach((u) => { if (!Array.isArray(u.historique)) u.historique = []; });
  db.maintenance.forEach((m) => { if (!Array.isArray(m.interventions)) m.interventions = []; });
  db.missions.forEach((m) => {
    if (!Array.isArray(m.ravitaillements)) m.ravitaillements = [];
    if (!Array.isArray(m.participants)) m.participants = [];
  });
  allVehicles(db).forEach((v) => { if (!v.id) v.id = uid(); });

  migrerDotationsMission(db);

  // Traces d'une version connectee a un serveur : sans objet ici, et il
  // serait malvenu de laisser trainer un jeton d'acces sur le disque.
  delete db.sync;
  delete db.credentials;

  return db;
}

/**
 * Le carburant des missions se saisit desormais dans le rapport de mission :
 * il n'y a plus de collection « dotation mission » separee.
 *
 * Les enregistrements des versions precedentes sont donc reverses sur la
 * mission correspondante — meme conducteur, meme date de depart. Faute de
 * correspondance, la dotation devient elle-meme une mission : une depense
 * deja engagee ne doit pas disparaitre d'une mise a jour a l'autre.
 *
 * La cle est supprimee ensuite, ce qui rend l'operation sans effet aux
 * chargements suivants.
 */
function migrerDotationsMission(db) {
  const anciennes = Array.isArray(db.dotationMission) ? db.dotationMission : [];
  delete db.dotationMission;
  if (!anciennes.length) return 0;

  anciennes.forEach((d) => {
    const rav = (d.ravitaillements || []).map((r) => ({
      date: r.date || d.dateDepart || '',
      station: r.station || '',
      quantite: num(r.quantite),
      prixL: num(r.prix !== undefined ? r.prix : r.prixL)
    }));

    const cible = db.missions.find(
      (m) =>
        norm(m.conducteur) === norm(d.conducteur) &&
        (!d.dateDepart || !m.dateDepart || m.dateDepart === d.dateDepart)
    );

    if (cible) {
      cible.ravitaillements = (cible.ravitaillements || []).concat(rav);
      if (!cible.kmDepart) cible.kmDepart = d.kmDepart;
      if (!cible.kmArrivee) cible.kmArrivee = d.kmRetour;
      if (!cible.vehicule) cible.vehicule = d.vehicule || '';
      return;
    }

    db.missions.push({
      id: uid(),
      ref: `M-REP-${String(db.missions.length + 1).padStart(3, '0')}`,
      conducteur: d.conducteur || '',
      vehicule: d.vehicule || '',
      destination: d.destination || '',
      objet: 'Reprise d’une dotation carburant de mission',
      dateDepart: d.dateDepart || '',
      dateRetour: d.dateRetour || '',
      jours: daysBetween(d.dateDepart, d.dateRetour) ?? '',
      montant: 0,
      paye: false,
      datePaiement: '',
      participants: [],
      ravitaillements: rav,
      kmDepart: d.kmDepart,
      kmArrivee: d.kmRetour,
      observations: ''
    });
  });

  return anciennes.length;
}

/** Reprend les donnees des versions precedentes de l'application. */
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
  if ((src.dotationMission || []).length) {
    // reversees sur les missions par migrerDotationsMission()
    target.dotationMission = src.dotationMission.map((d) => Object.assign({ ravitaillements: [] }, d));
  }
  (src.missions || []).forEach((m) => target.missions.push(Object.assign({ id: uid() }, m)));
  (src.maintenance || []).forEach((m) =>
    target.maintenance.push(Object.assign({ id: uid(), interventions: [] }, m)));
  (src.accounts || []).forEach((a) => target.accounts.push(Object.assign({ id: uid() }, a)));
  if (src.settings) Object.assign(target.settings, src.settings);
}

/** Remplace integralement la base (restauration de sauvegarde). */
export async function replaceDB(raw) {
  const next = normalize(raw);
  if (next.accounts.length === 0) {
    // ne jamais se retrouver sans aucun moyen de se connecter
    next.accounts = DB.accounts;
  }
  DB = next;
  await persistNow();
  emit();
  return DB;
}

/* ------------------------------------------------------------------ */
/* Acces / CRUD                                                        */
/* ------------------------------------------------------------------ */

/** Collections adressables par nom ('missions', 'vehicles.pool'...). */
export function collection(name) {
  if (name.startsWith('vehicles.')) return DB.vehicles[name.split('.')[1]];
  return DB[name];
}

export function insert(name, record) {
  const item = Object.assign({ id: uid() }, record);
  collection(name).push(item);
  persist();
  return item;
}

export function update(name, id, patch) {
  const list = collection(name);
  const item = list.find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  persist();
  return item;
}

export function remove(name, id) {
  const list = collection(name);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  persist();
  return true;
}

/**
 * Signale qu'un enregistrement a ete modifie sur place — typiquement une
 * liste imbriquee (incidents d'un agent, interventions d'un garage,
 * ravitaillements d'une dotation), qui appartient a son parent.
 */
export function touch(name, record) {
  persist();
  return record;
}

/** Enregistre les reglages. */
export function saveSettings(patch) {
  Object.assign(DB.settings, patch);
  persist();
  return DB.settings;
}

export function find(name, id) {
  return collection(name).find((x) => x.id === id) || null;
}

/** Deplace un vehicule d'une categorie a une autre. */
export function moveVehicle(id, fromCat, toCat) {
  if (fromCat === toCat) return;
  const list = DB.vehicles[fromCat];
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) return;
  const [v] = list.splice(i, 1);
  DB.vehicles[toCat].push(v);
  persist();
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

/* =================================================================
   Lien UTILISATEURS <-> vehicules de pool et de service.

   Une fiche vehicule ne retient qu'un nom, pas un identifiant : c'est ce
   qui s'imprime et ce qu'on lit dans un tableau. Le nom doit donc suivre
   l'agent — renomme ici, il se met a jour la-bas, et un nom saisi la-bas
   cree l'agent ici. Sans quoi les deux rubriques divergent au premier
   changement, et plus personne ne sait laquelle dit vrai.
   ================================================================= */

/** Nom tel qu'il apparait dans une fiche vehicule. */
export function nomComplet(u) {
  return `${(u && u.nom) || ''} ${(u && u.prenoms) || ''}`.trim();
}

/** Noms des agents enregistres, dans l'ordre de la liste. */
export function nomsUtilisateurs() {
  return DB.users.map(nomComplet).filter(Boolean);
}

/** Categories de vehicules qui portent un utilisateur. */
const CATS_UTILISATEUR = ['pool', 'service'];

/** Vehicules attribues a un agent, toutes categories concernees. */
export function vehiculesDeLAgent(nom) {
  const cle = norm(nom || '');
  if (!cle) return [];
  const out = [];
  CATS_UTILISATEUR.forEach((cat) => {
    DB.vehicles[cat].forEach((v) => {
      if (norm(v.utilisateur || '') === cle) out.push(Object.assign({ _cat: cat }, v));
    });
  });
  return out;
}

/** Applique un nouveau nom aux vehicules qui portaient l'ancien. */
export function renommerAgentSurVehicules(ancien, nouveau) {
  const cle = norm(ancien || '');
  if (!cle || norm(nouveau || '') === cle) return 0;
  let n = 0;
  CATS_UTILISATEUR.forEach((cat) => {
    DB.vehicles[cat].forEach((v) => {
      if (norm(v.utilisateur || '') === cle) { v.utilisateur = nouveau; n += 1; }
    });
  });
  if (n) persist();
  return n;
}

/** Retire un agent des vehicules qui lui etaient attribues. */
export function detacherAgentDesVehicules(nom) {
  return renommerAgentSurVehicules(nom, '');
}

/**
 * Garantit qu'un nom saisi dans une fiche vehicule existe aussi dans
 * UTILISATEURS. Le premier mot fait le nom, le reste les prenoms — la fiche
 * agent reste modifiable pour corriger un decoupage malheureux.
 */
export function assurerAgent(nom) {
  const propre = String(nom || '').trim();
  if (!propre) return null;
  const existant = DB.users.find((u) => norm(nomComplet(u)) === norm(propre));
  if (existant) return existant;

  const mots = propre.split(/\s+/);
  return insert('users', {
    nom: mots[0],
    prenoms: mots.slice(1).join(' '),
    fonction: '',
    section: '',
    statut: 'Actif',
    poolConducteur: 'Non',
    telephone: '',
    permis: '',
    observations: 'Créé depuis une fiche véhicule',
    historique: [],
    createdAt: new Date().toISOString()
  });
}

export function knownDrivers() {
  const set = new Set();
  DB.users.forEach((u) => set.add(`${u.nom} ${u.prenoms}`.trim()));
  DB.missions.forEach((m) => m.conducteur && set.add(m.conducteur));
  return [...set].filter(Boolean).sort();
}

/**
 * Conducteurs du pool, classes dans l'ordre du tour de role.
 *
 * Les missions se font a tour de role : passe en tete celui qui n'est jamais
 * parti, puis celui dont la derniere mission est la plus ancienne. A date
 * egale, celui qui a fait le moins de missions.
 *
 * Sont retenus les agents actifs marques « conducteur du pool » ; tant
 * qu'aucun ne l'est, on prend tous les agents actifs, pour que le tableau ne
 * soit pas vide avant que la liste ait ete renseignee.
 */
export function rotationConducteurs() {
  const actifs = DB.users.filter((u) => u.statut === 'Actif');
  const marques = actifs.filter((u) => u.poolConducteur === 'Oui');
  const pool = marques.length ? marques : actifs;

  return pool
    .map((u) => {
      const nom = `${u.nom} ${u.prenoms}`.trim();
      const missions = DB.missions.filter((m) => norm(m.conducteur) === norm(nom));
      const derniere = missions.map((m) => m.dateDepart).filter(Boolean).sort().pop() || '';
      return {
        id: u.id,
        nom,
        section: u.section || '',
        nbMissions: missions.length,
        totalJours: sum(missions, (m) => m.jours),
        derniereMission: derniere,
        marque: marques.length > 0
      };
    })
    .sort((a, b) => {
      if (!a.derniereMission !== !b.derniereMission) return a.derniereMission ? 1 : -1;
      if (a.derniereMission !== b.derniereMission) {
        return String(a.derniereMission).localeCompare(String(b.derniereMission));
      }
      return a.nbMissions - b.nbMissions;
    });
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

/** Kilometrage lisible dans les messages d alerte. */
function fmtKm(n) {
  return Math.round(num(n)).toLocaleString('fr-FR');
}

/**
 * Etat de la vidange d'un vehicule.
 *
 * `kmVidange` est le kilometrage AUQUEL la vidange doit etre faite, pas
 * celui de la derniere. On le compare donc au kilometrage courant.
 *
 * @returns {{statut:'inconnu'|'ok'|'proche'|'depassee', restant:number|null, cible:number}}
 */
export function etatVidange(v) {
  const cible = num(v && v.kmVidange);
  const actuel = num(v && v.km);
  if (!cible) return { statut: 'inconnu', restant: null, cible: 0 };

  const restant = cible - actuel;
  if (restant <= 0) return { statut: 'depassee', restant, cible };
  if (restant <= num(DB.settings.seuilAlerteVidangeKm)) return { statut: 'proche', restant, cible };
  return { statut: 'ok', restant, cible };
}

/** Vehicules dont la vidange est due ou proche de l'etre. */
export function vidangesASurveiller() {
  return allVehicles()
    .map((v) => ({ vehicule: v, etat: etatVidange(v) }))
    .filter((x) => x.etat.statut === 'depassee' || x.etat.statut === 'proche')
    .sort((a, b) => a.etat.restant - b.etat.restant);
}

/** Montant d'un ravitaillement de rapport de mission. */
export function ravMontant(r) {
  return num(r.quantite) * num(r.prixL);
}

/** Missions dont le rapport porte au moins un ravitaillement. */
export function missionsAvecCarburant() {
  return DB.missions.filter((m) => (m.ravitaillements || []).length);
}

/** Tous les ravitaillements de mission, a plat, avec leur mission. */
export function tousRavitaillementsMission() {
  const out = [];
  DB.missions.forEach((m) => {
    (m.ravitaillements || []).forEach((r) => out.push({ mission: m, rav: r }));
  });
  return out;
}

/** Litres et montant du carburant de mission (rapports de mission). */
export function carburantMissions(list = DB.missions) {
  let litres = 0;
  let montant = 0;
  list.forEach((m) => {
    (m.ravitaillements || []).forEach((r) => {
      litres += num(r.quantite);
      montant += ravMontant(r);
    });
  });
  return { litres, montant };
}

/**
 * Cout carburant d'un vehicule : dotations du pool + ravitaillements des
 * rapports de mission ou ce vehicule a servi.
 */
export function fuelCost(immat) {
  const pool = DB.dotationPool
    .filter((d) => d.immat === immat)
    .reduce((s, d) => s + num(d.montant), 0);

  const mission = DB.missions
    .filter((m) => norm(m.vehicule) === norm(immat) && norm(immat))
    .reduce((s, m) => s + (m.ravitaillements || []).reduce((t, r) => t + ravMontant(r), 0), 0);

  return pool + mission;
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

  // Vidanges : on compare le kilometrage courant au kilometrage auquel la
  // vidange est due. C'est plus fiable que l'etat coche a la pompe, qui
  // n'est mis a jour qu'au moment d'un plein.
  const surveillance = vidangesASurveiller();
  const depassees = surveillance.filter((x) => x.etat.statut === 'depassee');
  const proches = surveillance.filter((x) => x.etat.statut === 'proche');

  if (depassees.length) {
    out.push({
      level: 'crit',
      icon: '🛢️',
      title: `${depassees.length} véhicule(s) à vidanger sans délai`,
      detail: depassees
        .map((x) => `${immatOf(x.vehicule) || '(sans immat.)'} : ${fmtKm(-x.etat.restant)} km au-delà`)
        .join(' · '),
      go: 'VEHICULES'
    });
  }
  if (proches.length) {
    out.push({
      level: 'warn',
      icon: '🛢️',
      title: `${proches.length} véhicule(s) approchent de la vidange`,
      detail: proches
        .map((x) => `${immatOf(x.vehicule) || '(sans immat.)'} : ${fmtKm(x.etat.restant)} km restants`)
        .join(' · '),
      go: 'VEHICULES'
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
