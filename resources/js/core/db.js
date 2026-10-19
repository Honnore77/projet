/* ===================================================================
   Modele de donnees + magasin central.

   L'application est autonome : ce fichier est la source de verite. Les
   donnees vivent sur le poste (fichier JSON pour l'application de bureau,
   stockage local pour le navigateur) et n'en sortent que par les exports
   et les sauvegardes.
   =================================================================== */

import { readDB, writeDB, readLegacy, platformName } from './storage.js';
import { empreintesDe, estampiller } from './synchro.js';
import { uid, num, norm, sum, daysBetween, francSup, todayISO } from './utils.js';
import { hashPassword } from './crypto.js';
import { validationAbsence } from './demandes.js';
import { idsDesPieces } from './pieces.js';

export const SCHEMA_VERSION = 4;

/**
 * Statuts proposes a la saisie. « En mission » a ete retire : le passage en
 * mission se lit dans la rubrique MISSION, le dupliquer ici faisait deux
 * verites pour un meme fait. Les vehicules encore marques ainsi gardent leur
 * valeur (voir vehicleFields), ils ne sont simplement plus proposes.
 */
export const STATUTS_VEHICULE = ['Disponible', 'En entretien', 'Immobilisé'];

/**
 * Statut propre aux vehicules POOL et SERVICE : un vehicule qui n'est confie
 * a personne. Un vehicule de MISSION ne s'attribue pas, il ne le propose pas.
 */
export const STATUT_NON_ATTRIBUE = 'Non attribué';

/**
 * Vehicule retire du parc pour de bon. Il reste dans la liste pour garder son
 * historique, mais ne declenche plus de voyant de vidange.
 */
export const STATUT_REFORME = 'Réformé';

/**
 * Sous-rubrique VEHICULES REFORMES. Un vehicule reforme sort du parc : il
 * quitte POOL, MISSION ou SERVICE pour cette liste a part, que allVehicles
 * ne parcourt pas. Il n'apparait donc plus dans les voyants, les missions,
 * la dotation ni les statistiques du parc, mais garde son historique.
 */
export const CAT_REFORME = 'reforme';

/** Etat du vehicule au moment de la reforme (liste ouverte a la saisie). */
export const ETATS_REFORME = ['Bon état', 'État moyen', 'Mauvais état', 'Hors d’usage (épave)'];

/** Statuts proposes dans le formulaire d'une sous-rubrique de VEHICULES. */
export function statutsVehicule(cat) {
  return cat === 'mission'
    ? STATUTS_VEHICULE.concat([STATUT_REFORME])
    : STATUTS_VEHICULE.concat([STATUT_NON_ATTRIBUE, STATUT_REFORME]);
}

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
/**
 * Marques de base. La liste s'ouvre a l'usage : toute marque saisie par
 * « + Autre marque » y figure ensuite. Ces trois-la sont celles des modeles
 * de reference ci-dessous, pour que le menu ne soit pas vide au depart.
 */
export const MARQUES = ['NISSAN', 'TOYOTA', 'FORD'];

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
  'OPERATION ET SUIVI-EVALUATION',
  'MARCHE ET AFFAIRES JURIDIQUES',
  'AGENCE COMPTABLE',
  'COMMUNICATION'
];

/**
 * Sections renommees : ancien libelle -> libelle courant. Une fiche qui porte
 * l'ancien nom serait muette dans la liste deroulante (un <select> ignore en
 * silence une valeur absente de ses options) et invisible au filtre par
 * section : on la reporte donc au chargement.
 */
const SECTIONS_RENOMMEES = {
  OPERATION: 'OPERATION ET SUIVI-EVALUATION'
};

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
    // Courriers deposes contre decharge, et les structures qui les recoivent.
    // Une decharge ne retient que le nom du destinataire, comme une fiche
    // vehicule retient celui de son utilisateur : c'est ce qui s'imprime.
    decharges: [],
    destinataires: [],
    // NOTES : messagerie interne entre les comptes (voir core/notes.js).
    notes: [],
    // Une fiche par compte : notes lues et signe de vie de la session.
    suiviComptes: [],
    // ÉTAT DES VÉHICULES : problemes signales sur les vehicules.
    etatsVehicules: [],
    settings: {
      organisation: 'PDU',
      // Ville portee par la mention « Fait à … le … » des documents exportes.
      ville: 'Abidjan',
      devise: 'F',
      // Intervalle courant entre deux vidanges : sert a proposer le
      // kilometrage de la prochaine quand on saisit un vehicule.
      seuilVidangeKm: 5000,
      // Marge d'alerte : on previent des qu'il reste moins que cela a
      // parcourir avant la vidange due.
      seuilAlerteVidangeKm: 500,
      seuilImmobilisationJours: 7,
      seuilMissionImpayeeJours: 30,
      // Prix du litre a la pompe, par energie. Ils alimentent la liste
      // deroulante « Prix / L » des formulaires : le prix est le meme pour
      // tout le monde a une date donnee, il n'a pas a se retaper a chaque
      // prise. Zero vaut « pas encore renseigne » : la liste ne le propose pas.
      prixLitreEssence: 0,
      prixLitreDiesel: 0,
      // Frais d'ordre de mission par participant, pour les simulations.
      fraisOmParParticipant: 1000,
      // Kilometres parcourus chaque jour a l'interieur d'une destination,
      // pour les simulations. Zero vaut « pas encore regle » : rien n'est
      // alors propose, on saisit les km a la main.
      parcoursInterneKmParJour: 0,
      // Dossier des copies datees, hors du poste de preference : cle USB,
      // disque reseau, dossier synchronise. Vide, la sauvegarde automatique
      // ne se fait pas — c'est un choix explicite, pas un defaut silencieux.
      dossierSauvegarde: '',
      // Nombre de copies gardees. Trente jours couvrent une erreur remarquee
      // tard sans encombrer le support : le fichier pese quelques dizaines
      // de kilo-octets.
      sauvegardesConservees: 30
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

/* ------------------------- Datation des fiches ----------------------- */

/**
 * Empreintes des fiches au dernier enregistrement. Chaque enregistrement
 * compare la base a ces empreintes : une fiche qui a change recoit sa date
 * de modification, une fiche disparue laisse une trace de suppression. C'est
 * ce qui permet a la synchronisation de savoir quelle version est la plus
 * recente (voir synchro.js) — sans qu'aucune rubrique ait a s'en occuper.
 *
 * Nulles tant que la base n'est pas chargee : rien n'est date avant.
 */
let empreintes = null;

function dater() {
  if (!empreintes || !DB.synchro) return;
  empreintes = estampiller(DB, empreintes, new Date().toISOString(), DB.synchro.appareil);
}

/** Repart des fiches telles qu'elles sont, sans rien dater (chargement, restauration). */
function reprendreEmpreintes() {
  empreintes = empreintesDe(DB);
}

/** Persiste la base (ecriture groupee pour ne pas saturer le disque). */
export function persist({ silent = false } = {}) {
  dater();
  DB.meta.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { writeDB(DB); }, 120);
  if (!silent) emit();
}

/** Force une ecriture immediate (fermeture de l'application, sauvegarde manuelle). */
export async function persistNow() {
  clearTimeout(saveTimer);
  dater();
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
        poolConducteur: 'Oui',
        telephone: lignesTelephone(''),
        email: '',
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
  reprendreEmpreintes();
  return { firstRun, migrated };
}

/** Complete les champs absents pour tolerer d'anciennes sauvegardes. */
export function normalize(raw) {
  const base = emptyDB();
  const db = Object.assign(base, raw || {});
  db.version = SCHEMA_VERSION;
  db.vehicles = Object.assign({ pool: [], mission: [], service: [], reforme: [] }, raw && raw.vehicles);
  ['pool', 'mission', 'service', 'reforme'].forEach((k) => {
    if (!Array.isArray(db.vehicles[k])) db.vehicles[k] = [];
  });
  ['accounts', 'users', 'dotationPool', 'missions', 'maintenance', 'decharges', 'destinataires', 'trajets', 'simulations', 'indisponibilites', 'demandes', 'notes', 'suiviComptes', 'etatsVehicules'].forEach((k) => {
    if (!Array.isArray(db[k])) db[k] = [];
  });
  db.settings = Object.assign(base.settings, raw && raw.settings);
  db.meta = Object.assign(base.meta, raw && raw.meta);

  // Roles d'avant les niveaux d'acces : le gestionnaire devient chef du
  // parc, le visiteur direction / consultation (voir core/acces.js).
  db.accounts.forEach((a) => {
    if (a.role === 'gestionnaire') a.role = 'chef';
    else if (a.role === 'visiteur') a.role = 'direction';
  });

  db.users.forEach((u) => {
    if (!Array.isArray(u.historique)) u.historique = [];
    // « Conducteur du pool » a d'abord ete un booleen, il est compare a « Oui »
    // partout ailleurs : sans cette reprise, les agents de la premiere version
    // sortaient du tour de role sans que rien ne l'explique.
    if (typeof u.poolConducteur === 'boolean') u.poolConducteur = u.poolConducteur ? 'Oui' : 'Non';
    u.telephone = lignesTelephone(u.telephone);
    if (u.email === undefined) u.email = '';
  });
  db.maintenance.forEach((m) => { if (!Array.isArray(m.interventions)) m.interventions = []; });
  db.missions.forEach((m) => {
    if (!Array.isArray(m.ravitaillements)) m.ravitaillements = [];
    if (!Array.isArray(m.participants)) m.participants = [];
    // Le nombre de jours se deduit des dates : le recalculer au chargement
    // remet d'aplomb les missions comptees avant que le jour de depart ne
    // soit inclus, sans risque de compter deux fois.
    const j = joursMission(m.dateDepart, m.dateRetour);
    if (j !== null && j >= 0) m.jours = j;
  });
  allVehicles(db).forEach((v) => { if (!v.id) v.id = uid(); });

  // Toute fiche peut porter des images. Le tableau est cree ici une fois
  // pour toutes : les formulaires et les vues n'ont alors jamais a se
  // demander s'il existe, et une base d'avant les images se lit sans rien
  // de particulier.
  fichesAImages(db).forEach((f) => {
    if (!Array.isArray(f.images)) f.images = [];
  });

  migrerDotationsMission(db);
  db.missions.forEach(normaliserDestinations);
  initialiserDestinationsMission(db);
  migrerSectionsRenommees(db);
  renumeroterMissions(db);
  arrondirMontants(db);

  // Traces d'une version connectee a un serveur : sans objet ici, et il
  // serait malvenu de laisser trainer un jeton d'acces sur le disque.
  delete db.sync;
  delete db.credentials;

  // Synchronisation : identite de cet appareil, traces de suppression, et
  // date de la derniere synchronisation avec chaque autre appareil.
  db.synchro = Object.assign({ appareil: '', nom: '', suppressions: [], appareils: {} }, raw && raw.synchro);
  if (!db.synchro.appareil) db.synchro.appareil = uid();
  if (!db.synchro.nom) db.synchro.nom = platformName;
  if (!Array.isArray(db.synchro.suppressions)) db.synchro.suppressions = [];
  if (!db.synchro.appareils || typeof db.synchro.appareils !== 'object') db.synchro.appareils = {};

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
      jours: joursMission(d.dateDepart, d.dateRetour) ?? '',
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

/**
 * Toutes les fiches susceptibles de porter des images, a plat.
 *
 * Une seule liste, pour que l'ajout d'images a une rubrique ne s'oublie ni
 * au chargement, ni au menage des orphelines, ni a l'export en archive.
 */
export function fichesAImages(db = DB) {
  return [
    ...(db.vehicles.pool || []),
    ...(db.vehicles.mission || []),
    ...(db.vehicles.service || []),
    ...(db.vehicles.reforme || []),
    ...db.users,
    ...db.maintenance,
    ...db.missions,
    ...db.dotationPool,
    // La decharge signee, photographiee ou scannee.
    ...(db.decharges || []),
    // Le justificatif d'une indisponibilite : titre de conge, certificat.
    ...(db.indisponibilites || []),
    // Les pieces jointes d'une demande de conge ou d'absence.
    ...(db.demandes || []),
    // Les sous-fiches comptent autant que les autres : une image citee par
    // une intervention ou un incident, mais absente d'ici, serait tenue pour
    // orpheline et effacee au demarrage suivant — et elle manquerait a
    // l'archive de sauvegarde.
    ...db.maintenance.flatMap((m) => m.interventions || []),
    ...db.users.flatMap((u) => u.historique || [])
  ];
}

/**
 * Identifiants d'images citees par au moins une fiche.
 *
 * Sert au menage : une image ecrite puis abandonnee (formulaire annule,
 * fiche supprimee) n'est plus citee par personne et peut partir.
 */
export function imagesCitees(db = DB) {
  const vues = new Set();
  fichesAImages(db).forEach((f) => (f.images || []).forEach((i) => i && i.id && vues.add(i.id)));
  // Les pieces jointes des notes (PDF, Excel, Word) vivent dans le meme
  // magasin : citees ici, elles suivent la synchronisation et l'archive,
  // et echappent au menage. Leurs versions precedentes aussi.
  idsDesPieces((db.notes || []).flatMap((n) => n.pieces || [])).forEach((id) => vues.add(id));
  // Les images ajoutees aux fonds de la page de connexion.
  ((db.settings && db.settings.fondsPerso) || []).forEach((f) => f && f.imageId && vues.add(f.imageId));
  return vues;
}

/** Reporte les fiches qui portent encore l'ancien libelle d'une section. */
function migrerSectionsRenommees(db) {
  const reporter = (o) => {
    const cible = SECTIONS_RENOMMEES[String(o.section || '').trim().toUpperCase()];
    if (cible) o.section = cible;
  };
  db.users.forEach(reporter);
  ['pool', 'mission', 'service', 'reforme'].forEach((cat) => (db.vehicles[cat] || []).forEach(reporter));
}

/**
 * Remonte au franc superieur tous les montants deja enregistres.
 *
 * Les formulaires arrondissent desormais a la saisie, mais les fiches d'avant
 * portent encore leurs centimes : sans cette reprise, un meme tableau
 * melangerait des lignes rondes et des lignes a virgule, et le total ne
 * tomberait juste sur aucune des deux.
 *
 * Un champ laisse vide le reste : `francSup('')` vaudrait zero, et un solde
 * jamais renseigne se lirait alors comme un solde nul.
 *
 * @returns {number} nombre de valeurs effectivement modifiees
 */
function arrondirMontants(db) {
  let changees = 0;
  const arrondir = (o, cle) => {
    if (!o || o[cle] === '' || o[cle] === undefined || o[cle] === null) return;
    const v = francSup(o[cle]);
    if (v !== o[cle]) { o[cle] = v; changees += 1; }
  };

  db.dotationPool.forEach((d) => {
    ['prixL', 'montant', 'soldeAvant', 'soldeApres'].forEach((k) => arrondir(d, k));
  });
  db.missions.forEach((m) => {
    ['montant', 'dotationCarburant'].forEach((k) => arrondir(m, k));
    (m.ravitaillements || []).forEach((r) => arrondir(r, 'prixL'));
  });
  db.maintenance.forEach((m) => {
    (m.interventions || []).forEach((iv) => arrondir(iv, 'cout'));
  });
  ['prixLitreEssence', 'prixLitreDiesel'].forEach((k) => arrondir(db.settings, k));

  return changees;
}

/**
 * Renumerote les missions dans l'ordre des departs : la plus ancienne porte
 * M-001, la suivante M-002, et ainsi de suite.
 *
 * La reference dit donc le rang chronologique de la mission, et non l'ordre
 * dans lequel elle a ete saisie. Une mission ajoutee apres coup, pour un
 * depart anterieur, prend sa place dans la suite et decale celles d'apres —
 * c'est le prix a payer pour que la colonne se lise dans l'ordre.
 *
 * Les missions sans date de depart passent en fin, dans leur ordre de saisie.
 *
 * @returns {number} nombre de references effectivement changees
 */
export function renumeroterMissions(db = DB) {
  let changees = 0;
  db.missions
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const da = a.m.dateDepart || '';
      const dbb = b.m.dateDepart || '';
      if (!da !== !dbb) return da ? -1 : 1;
      if (da !== dbb) return String(da).localeCompare(String(dbb));
      return a.i - b.i;
    })
    .forEach((x, rang) => {
      const ref = `M-${String(rang + 1).padStart(3, '0')}`;
      if (x.m.ref !== ref) { x.m.ref = ref; changees += 1; }
    });
  return changees;
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
  // Une sauvegarde venue d'un autre appareil ne lui prend pas son identite.
  if (DB.synchro && DB.synchro.appareil) {
    next.synchro.appareil = DB.synchro.appareil;
    next.synchro.nom = DB.synchro.nom;
    next.synchro.appareils = Object.assign({}, next.synchro.appareils, DB.synchro.appareils);
  }
  DB = next;
  // Une restauration n'est pas une modification : rien n'est date, aucune
  // trace de suppression. A la synchronisation suivante, les fiches que
  // l'autre appareil a en plus reviennent donc plutot que de disparaitre.
  reprendreEmpreintes();
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

/**
 * Sort un vehicule du parc : il passe de sa categorie a VEHICULES REFORMES,
 * avec les informations de la reforme. La categorie d'origine est gardee
 * pour pouvoir l'y remettre.
 */
export function reformerVehicule(id, fromCat, infos) {
  const list = DB.vehicles[fromCat];
  const i = list ? list.findIndex((v) => v.id === id) : -1;
  if (i < 0) return null;
  const [v] = list.splice(i, 1);
  Object.assign(v, infos, { statut: STATUT_REFORME, origine: fromCat });
  DB.vehicles[CAT_REFORME].push(v);
  persist();
  return v;
}

/**
 * Annees de service d'un vehicule reforme : annee de la reforme moins annee
 * de mise en service. null si l'une des deux manque.
 */
export function anneesDeService(v) {
  const debut = Number(v && v.anneeMiseService);
  const fin = Number(String((v && v.dateReforme) || '').slice(0, 4));
  if (!debut || !fin) return null;
  return Math.max(0, fin - debut);
}

/** Annule une reforme : le vehicule retourne dans sa categorie d'origine. */
export function remettreEnService(id) {
  const list = DB.vehicles[CAT_REFORME];
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) return null;
  const [v] = list.splice(i, 1);
  const cat = CATEGORIES.some((c) => c.key === v.origine) ? v.origine : 'pool';
  v.statut = 'Disponible';
  DB.vehicles[cat].push(v);
  persist();
  return cat;
}

/** Vehicule reforme portant cette immatriculation (nouvelle ou ancienne). */
export function vehiculeReformeParImmat(immat) {
  if (!immat) return null;
  const key = String(immat).trim().toUpperCase();
  const v = (DB.vehicles[CAT_REFORME] || []).find(
    (x) =>
      String(x.immatNouvelle || '').trim().toUpperCase() === key ||
      String(x.immatAncienne || '').trim().toUpperCase() === key
  );
  return v ? Object.assign({ _cat: CAT_REFORME }, v) : null;
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

/**
 * Derniere lecture du compteur d'un vehicule, toutes rubriques confondues.
 *
 * Le kilometrage d'une fiche vehicule vieillit des qu'on la ferme : ce sont
 * les autres rubriques qui relevent le compteur au fil de l'usage — la prise
 * de carburant, l'entree au garage, le retour du garage. On retient donc la
 * plus recente de ces lectures, plutot que de demander qu'on reporte le
 * chiffre a la main d'une rubrique a l'autre.
 *
 * @returns {{km:number, date:string, source:string}|null} null si aucune
 *          lecture datee n'existe pour cette immatriculation.
 */
export function derniereLectureKm(immat) {
  const cle = String(immat || '').trim().toUpperCase();
  if (!cle) return null;
  const memeImmat = (x) => String(x || '').trim().toUpperCase() === cle;
  const lectures = [];
  const ajouter = (date, km, source) => {
    if (date && km !== '' && km !== undefined && km !== null) {
      lectures.push({ date, km: num(km), source });
    }
  };

  DB.dotationPool.forEach((d) => {
    if (memeImmat(d.immat)) ajouter(d.date, d.km, 'dotation carburant');
  });
  DB.maintenance.forEach((m) => {
    if (!memeImmat(m.immat)) return;
    ajouter(m.dateEntree, m.kmEntree, 'entrée au garage');
    ajouter(m.dateRetour, m.kmRetour, 'retour du garage');
  });
  // Le rapport de mission releve le compteur au depart et au retour. Sans
  // date de retour, le kilometrage d'arrivee compte au jour du depart : il
  // reste plus recent que le kilometrage de depart, grace au tri ci-dessous.
  DB.missions.forEach((m) => {
    if (!memeImmat(m.vehicule)) return;
    ajouter(m.dateDepart, m.kmDepart, 'départ en mission');
    ajouter(m.dateRetour || m.dateDepart, m.kmArrivee, 'retour de mission');
  });

  // A date egale, la lecture la plus elevee : un compteur ne revient pas en
  // arriere, et une sortie de garage se saisit le jour de l'entree.
  return lectures.sort((a, b) => {
    const c = String(a.date).localeCompare(String(b.date));
    return c !== 0 ? c : a.km - b.km;
  }).pop() || null;
}

/**
 * Kilometrage a retenir pour un vehicule : la derniere lecture relevee
 * ailleurs si elle existe, sinon celui saisi sur la fiche.
 */
export function kmCourant(v) {
  const lecture = derniereLectureKm(immatOf(v));
  return lecture ? lecture.km : num(v && v.km);
}

/**
 * Valeurs deja portees par les vehicules pour un champ donne, fusionnees avec
 * une liste de reference.
 *
 * Sert a proposer partout les memes marques et les memes modeles : la fiche
 * vehicule et la fiche d'entretien parlent du meme parc, elles n'ont pas a en
 * offrir deux inventaires differents. Une valeur ajoutee a la main une fois
 * est reproposee ensuite, la liste s'enrichit d'elle-meme.
 */
export function valeursVehicules(champ, base = []) {
  const vues = allVehicles()
    .map((v) => String(v[champ] || '').trim())
    .filter(Boolean);
  return [...new Set(base.concat(vues))];
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

/**
 * Lignes du champ « Telephone » d'un agent. Le PDU en tient trois : le numero
 * de la flotte, le personnel, puis le numero de poste. Elles sont pre-inscrites pour que
 * chacun sache lequel il renseigne, et qu'un tableau se lise pareil d'une
 * fiche a l'autre.
 */
export const LIGNES_TELEPHONE = ['- FLOTTE PDU :', '- Tel Perso 1 :', '- N° de Poste :'];

/**
 * Etiquettes renommees : ancien prefixe -> prefixe courant. Sans cette
 * correspondance, une fiche ecrite avec l'ancienne etiquette ne serait plus
 * reconnue : son numero se retrouverait relegue en quatrieme ligne, sous une
 * ligne « Tel Perso 1 » restee vide.
 */
// « Tel Perso 2 » est devenu « N° de Poste » : le numero saisi suit.
const PREFIXES_TELEPHONE_RENOMMES = { 'tel pers 1': 'tel perso 1', 'tel perso 2': 'n° de poste' };

/** Prefixe d'une ligne (« - FLOTTE PDU : » pour « - FLOTTE PDU : 07 ... »). */
function prefixeLigne(l) {
  // Le tiret d'ouverture et la casse ne font pas partie de l'etiquette : deux
  // lignes qui designent le meme numero doivent se reconnaitre, qu'elles
  // aient ete tapees ici ou collees d'ailleurs.
  const p = String(l).split(':')[0].replace(/^-\s*/, '').trim().toLowerCase();
  return PREFIXES_TELEPHONE_RENOMMES[p] || p;
}

/** Ce qui suit les deux-points d'une ligne : le numero lui-meme. */
function valeurLigne(l) {
  const i = String(l).indexOf(':');
  return i < 0 ? '' : String(l).slice(i + 1).trim();
}

/**
 * Detache une etiquette collee derriere le numero d'une autre.
 *
 * Un numero ne contient pas de deux-points : quand la valeur d'une ligne en
 * porte, c'est qu'une seconde etiquette y a ete recollee. On rend chacune a
 * sa ligne, en coupant au tiret qui les separe.
 */
function detacherEtiquettesCollees(lignes) {
  for (let i = 0; i < lignes.length; i += 1) {
    const v = valeurLigne(lignes[i]);
    if (!v.includes(':')) continue;
    const coupe = v.slice(0, v.indexOf(':')).lastIndexOf('-');
    const debut = coupe < 0 ? 0 : coupe;
    const etiquette = lignes[i].slice(0, lignes[i].indexOf(':') + 1);
    lignes[i] = `${etiquette} ${v.slice(0, debut).trim()}`.trim();
    // La suite est reexaminee au tour suivant : une ligne peut en cacher deux.
    lignes.push(`- ${v.slice(debut).replace(/^-\s*/, '').trim()}`);
  }
  return lignes;
}

/**
 * Met un champ telephone sous la forme des trois lignes attendues, sans rien
 * perdre de ce qui y figurait.
 *
 * Un numero saisi d'un bloc dans l'ancienne version rejoint la ligne de la
 * flotte ; une ligne deja etiquetee garde son numero et sa place ; ce qui ne
 * correspond a aucune etiquette est conserve a la suite plutot qu'efface.
 */
export function lignesTelephone(valeur) {
  const lignes = String(valeur === undefined || valeur === null ? '' : valeur)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  detacherEtiquettesCollees(lignes);

  const restes = [];
  const trouvees = LIGNES_TELEPHONE.map((modele) => {
    const vises = lignes
      .map((l, i) => ({ l, i }))
      .filter((x) => prefixeLigne(x.l) === prefixeLigne(modele));
    if (!vises.length) return modele;

    // Plusieurs lignes peuvent viser la meme etiquette : l'ancienne et la
    // nouvelle, au lendemain d'un renommage. On retient celle qui porte un
    // numero, l'autre n'etant qu'un modele reste vide. Toutes sont retirees,
    // un doublon n'apprend rien.
    const choisi = vises.find((x) => valeurLigne(x.l)) || vises[0];
    const ligne = choisi.l;
    vises.map((x) => x.i).sort((a, b) => b - a).forEach((k) => lignes.splice(k, 1));
    // On reecrit l'etiquette : seule la valeur saisie apres « : » est reprise.
    return `${modele} ${valeurLigne(ligne)}`.trim();
  });

  lignes.forEach((l) => restes.push(l.startsWith('-') ? l : `- ${l}`));
  // Une ligne qui porte deja des deux-points est etiquetee, meme si son
  // etiquette nous est inconnue : la coller derriere la flotte en ferait un
  // numero qui n'en est pas un. On la laisse alors a la suite, telle quelle.
  if (restes.length === 1 && !restes[0].includes(':') && trouvees[0] === LIGNES_TELEPHONE[0]) {
    // Un numero seul, sans etiquette : c'est celui de la flotte.
    trouvees[0] = `${LIGNES_TELEPHONE[0]} ${restes.shift().replace(/^-\s*/, '')}`.trim();
  }
  return trouvees.concat(restes).join('\n');
}

/**
 * Prix du litre proposes dans les listes deroulantes « Prix / L ».
 *
 * Le prix a la pompe est le meme pour tout le monde a une date donnee : il se
 * regle une fois dans REGLAGES et se choisit ensuite, plutot que de se
 * retaper — et de se faire fautiver — a chaque prise. Le prix de l'energie
 * concernee vient en tete ; les prix deja pratiques restent proposes, pour ne
 * pas rendre impossible la saisie d'une prise ancienne.
 *
 * @param {string} [energie] 'Essence' ou 'Diesel'
 * @returns {string[]} prix distincts, en tete celui de l'energie demandee
 */
export function prixLitreOptions(energie) {
  const regle = {
    essence: num(DB.settings.prixLitreEssence),
    diesel: num(DB.settings.prixLitreDiesel)
  };
  const cle = norm(energie || '');
  const ordre = [];
  if (regle[cle]) ordre.push(regle[cle]);
  [regle.essence, regle.diesel].forEach((p) => { if (p) ordre.push(p); });

  DB.dotationPool.forEach((d) => { if (num(d.prixL)) ordre.push(num(d.prixL)); });
  DB.missions.forEach((m) => {
    (m.ravitaillements || []).forEach((r) => { if (num(r.prixL)) ordre.push(num(r.prixL)); });
  });

  return [...new Set(ordre.map((p) => String(p)))];
}

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
 * UTILISATEURS, avec ce que la fiche sait deja de lui : sa section et le
 * vehicule qui lui est attribue. Le premier mot fait le nom, le reste les
 * prenoms — la fiche agent reste modifiable pour corriger un decoupage
 * malheureux.
 *
 * Sur un agent qui existe deja, on ne complete que les cases vides : une
 * fiche vehicule n'a pas a ecraser ce qui a ete saisi dans UTILISATEURS.
 */
export function assurerAgent(nom, infos = {}) {
  const propre = String(nom || '').trim();
  if (!propre) return null;

  const section = String(infos.section || '').trim();
  const immat = String(infos.immat || '').trim();
  const origine = immat
    ? `Créé depuis la fiche véhicule ${immat}`
    : 'Créé depuis une fiche véhicule';

  const existant = DB.users.find((u) => norm(nomComplet(u)) === norm(propre));
  if (existant) {
    if (section && !String(existant.section || '').trim()) {
      existant.section = section;
      persist();
    }
    return existant;
  }

  const mots = propre.split(/\s+/);
  return insert('users', {
    nom: mots[0],
    prenoms: mots.slice(1).join(' '),
    fonction: '',
    section,
    statut: 'Actif',
    poolConducteur: 'Non',
    telephone: lignesTelephone(''),
    email: '',
    permis: '',
    observations: origine,
    historique: [],
    createdAt: new Date().toISOString()
  });
}

/**
 * Duree d'une mission, en jours.
 *
 * Le jour de depart compte : partir et revenir le meme jour fait une mission
 * d'un jour, pas de zero. On ajoute donc un a l'ecart entre les deux dates.
 * L'immobilisation au garage, elle, garde l'ecart brut : ce n'est pas la meme
 * grandeur, on y mesure un temps d'indisponibilite, pas des journees de
 * mission a indemniser.
 *
 * @returns {number|null} null tant que l'une des deux dates manque.
 */
export function joursMission(dateDepart, dateRetour) {
  const ecart = daysBetween(dateDepart, dateRetour);
  return ecart === null ? null : ecart + 1;
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
 * Seuls les agents actifs marques « conducteur du pool » y figurent : ce sont
 * les seuls habilites a conduire les vehicules de mission. Tant qu'aucun ne
 * l'est, la liste est vide et le dit — y verser tous les agents actifs
 * reviendrait a proposer au depart des gens qui n'ont pas le droit de partir.
 *
 * Un conducteur indisponible ce jour-la (conge, permission, repos maladie)
 * passe en fin de liste, avec son indisponibilite : le tour revient au
 * suivant. Il garde son rang parmi les absents, et retrouve sa place des
 * sa reprise — son anciennete de mission n'a pas bouge.
 *
 * @param {string} [jour] date ISO (aujourd'hui par defaut)
 */
export function rotationConducteurs(jour = todayISO()) {
  const pool = DB.users.filter((u) => u.statut === 'Actif' && u.poolConducteur === 'Oui');
  const absents = indisponibilitesEnCours(jour);

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
        indisponible: absents.find((i) => norm(i.conducteur || '') === norm(nom)) || null
      };
    })
    .sort((a, b) => {
      if (!a.indisponible !== !b.indisponible) return a.indisponible ? 1 : -1;
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
  const actuel = kmCourant(v);
  if (!cible) return { statut: 'inconnu', restant: null, cible: 0 };

  const restant = cible - actuel;
  if (restant <= 0) return { statut: 'depassee', restant, cible };
  if (restant <= num(DB.settings.seuilAlerteVidangeKm)) return { statut: 'proche', restant, cible };
  return { statut: 'ok', restant, cible };
}

/**
 * Seuils du voyant de vidange, en kilometres restants avant l'echeance.
 *
 * Ils sont fixes et ne se reglent pas : c'est une regle d'atelier, pas une
 * preference. Le seuil de REGLAGES (« Alerte vidange ») garde son role
 * ailleurs — il decide de la pastille « approche » dans le tableau des
 * vehicules ; le voyant, lui, previent toujours au meme kilometrage, pour
 * qu'un conducteur sache ce que la couleur veut dire sans avoir a demander
 * comment l'application est reglee.
 */
export const SEUILS_VOYANT_VIDANGE = { jaune: 1000, orange: 700, rouge: 500 };

/**
 * Couleur du voyant pour un nombre de kilometres restants.
 *
 * Une valeur pile sur un seuil prend la couleur la plus grave : a 700 km on
 * est deja orange. Se tromper du cote prudent ne coute rien, l'inverse si.
 * En dessous de zero la vidange est depassee : le voyant reste rouge tant
 * qu'elle n'est pas faite, c'est-a-dire tant que le kilometrage cible de la
 * fiche n'a pas ete reporte plus loin.
 *
 * @returns {'jaune'|'orange'|'rouge'|null} null si rien a signaler
 */
export function niveauVoyantVidange(restant) {
  if (restant === null || restant === undefined) return null;
  if (restant > SEUILS_VOYANT_VIDANGE.jaune) return null;
  if (restant > SEUILS_VOYANT_VIDANGE.orange) return 'jaune';
  if (restant > SEUILS_VOYANT_VIDANGE.rouge) return 'orange';
  return 'rouge';
}

/**
 * Vehicules dont la vidange approche assez pour meriter un voyant, du plus
 * urgent au moins urgent. Ceux dont le kilometrage de vidange n'est pas
 * renseigne sont ecartes : sans echeance, il n'y a rien a decompter.
 */
export function voyantsVidange() {
  return allVehicles()
    .filter((v) => v.statut !== STATUT_REFORME)
    .map((v) => {
      const etat = etatVidange(v);
      return { vehicule: v, immat: immatOf(v), etat, niveau: niveauVoyantVidange(etat.restant) };
    })
    .filter((x) => x.etat.statut !== 'inconnu' && x.niveau)
    .sort((a, b) => a.etat.restant - b.etat.restant);
}

/**
 * Vehicules immobilises : ceux qui sont au garage, plus ceux qu'une fiche
 * declare « Immobilisé » sans passage au garage ouvert.
 *
 * Les deux disent la meme chose de deux endroits differents ; les reunir ici
 * evite qu'un vehicule paraisse deux fois dans le bandeau, ou qu'il y manque
 * parce qu'on n'a regarde qu'une des deux sources.
 */
export function vehiculesImmobilises() {
  const today = new Date().toISOString().slice(0, 10);
  const parImmat = new Map();

  openMaintenance().forEach((m) => {
    const immat = String(m.immat || '').trim();
    if (!immat) return;
    parImmat.set(norm(immat), {
      immat,
      depuis: m.dateEntree || '',
      jours: daysBetween(m.dateEntree, today),
      motif: m.motif || '',
      origine: 'garage'
    });
  });

  allVehicles().forEach((v) => {
    const immat = immatOf(v);
    if (!immat || v.statut !== 'Immobilisé' || parImmat.has(norm(immat))) return;
    parImmat.set(norm(immat), { immat, depuis: '', jours: null, motif: '', origine: 'statut' });
  });

  return [...parImmat.values()].sort((a, b) => (b.jours || 0) - (a.jours || 0));
}

/** Montant d'un ravitaillement de rapport de mission, au franc superieur. */
export function ravMontant(r) {
  return francSup(num(r.quantite) * num(r.prixL));
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

/** Les lignes de vidange de la carte ALERTES, une par couleur de voyant. */
const ALERTES_VIDANGE = [
  { niveau: 'rouge', level: 'crit', titre: 'Vidange urgente' },
  { niveau: 'orange', level: 'orange', titre: 'Vidange proche' },
  { niveau: 'jaune', level: 'jaune', titre: 'Vidange à prévoir' }
];

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

  // Inscriptions faites depuis la page de connexion, a valider.
  const inscrits = (DB.accounts || []).filter((a) => a.enAttente);
  if (inscrits.length) {
    out.push({
      level: 'warn',
      icon: '👤',
      title: `${inscrits.length} inscription(s) en attente de validation`,
      detail: `${inscrits.map((a) => a.nom || a.login).join(', ')} — à valider dans RÉGLAGES → Comptes et accès`,
      go: 'REGLAGES'
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

  // Vidanges : les memes trois couleurs que les voyants du bandeau
  // (SEUILS_VOYANT_VIDANGE), une ligne par couleur, de la plus grave a la
  // moins grave.
  const vidanges = voyantsVidange();
  ALERTES_VIDANGE.forEach((g) => {
    const lot = vidanges.filter((x) => x.niveau === g.niveau);
    if (!lot.length) return;
    out.push({
      level: g.level,
      icon: '🛢️',
      title: `${g.titre} : ${lot.length} véhicule${lot.length > 1 ? 's' : ''}`,
      detail: lot
        .map((x) => `${x.immat || '(sans immat.)'} : ${x.etat.restant <= 0
          ? `${fmtKm(-x.etat.restant)} km de retard`
          : `${fmtKm(x.etat.restant)} km restants`}`)
        .join(' · '),
      go: 'VEHICULES'
    });
  });

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

/* =================================================================
   DECHARGE — courriers deposes et structures destinataires.

   Une decharge ne retient que le nom du destinataire : c'est ce qui
   s'imprime et ce qu'on lit dans le tableau. Le nom doit donc suivre la
   structure — renommee dans « Les destinataires », elle se met a jour sur
   ses decharges, et un nom tape dans une decharge rejoint la liste.
   ================================================================= */

/**
 * Reference proposee pour la prochaine decharge : D-001, D-002…
 *
 * On part du plus grand numero deja attribue, pas du nombre de decharges :
 * apres une suppression, compter les lignes redonnerait une reference deja
 * portee par une autre. Les references saisies a la main dans un autre
 * format sont ignorees, elles ne bloquent pas la suite.
 */
export function prochaineRefDecharge(db = DB) {
  const max = (db.decharges || []).reduce((m, d) => {
    const r = /^D-(\d+)$/i.exec(String(d.ref || '').trim());
    return r ? Math.max(m, Number(r[1])) : m;
  }, 0);
  return `D-${String(max + 1).padStart(3, '0')}`;
}

/** Une reference deja portee par une autre decharge que celle qu'on modifie. */
export function refDechargeEnDouble(ref, exclureId, db = DB) {
  const cle = norm(ref || '');
  if (!cle) return false;
  return (db.decharges || []).some((d) => d.id !== exclureId && norm(d.ref || '') === cle);
}

/** Noms des structures destinataires, dans l'ordre alphabetique. */
export function nomsDestinataires(db = DB) {
  return (db.destinataires || [])
    .map((d) => String(d.nom || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

/** La structure qui porte ce nom, casse et accents mis a part. */
export function destinataireParNom(nom, db = DB) {
  const cle = norm(nom || '');
  if (!cle) return null;
  return (db.destinataires || []).find((d) => norm(d.nom || '') === cle) || null;
}

/**
 * Inscrit dans « Les destinataires » une structure tapee directement dans une
 * decharge. Sans cela, on la retaperait a chaque courrier, et elle
 * manquerait a la liste ou l'on cherche son contact.
 *
 * @returns {object|null} la fiche creee, ou null si elle existait deja
 */
export function assurerDestinataire(nom, db = DB) {
  const propre = String(nom || '').trim();
  if (!propre || destinataireParNom(propre, db)) return null;
  const fiche = {
    id: uid(),
    nom: propre,
    contacts: '',
    localisation: '',
    createdAt: new Date().toISOString()
  };
  db.destinataires.push(fiche);
  if (db === DB) persist();
  return fiche;
}

/** Reporte le nouveau nom d'une structure sur toutes ses decharges. */
export function renommerDestinataire(ancien, nouveau, db = DB) {
  const cle = norm(ancien || '');
  const propre = String(nouveau || '').trim();
  // Corriger un accent ou une majuscule est un vrai changement : on ne
  // compare donc pas les noms normalises, seulement l'ecriture exacte.
  if (!cle || !propre) return 0;
  let n = 0;
  (db.decharges || []).forEach((d) => {
    if (norm(d.destinataire || '') === cle && d.destinataire !== propre) { d.destinataire = propre; n += 1; }
  });
  if (n && db === DB) persist();
  return n;
}

/** Decharges adressees a une structure. */
export function dechargesDuDestinataire(nom, db = DB) {
  const cle = norm(nom || '');
  if (!cle) return [];
  return (db.decharges || []).filter((d) => norm(d.destinataire || '') === cle);
}

/**
 * Lien Google Maps d'une localisation.
 *
 * Un lien colle tel quel (partage depuis Google Maps : maps.app.goo.gl,
 * google.com/maps…) est rendu tel quel. Une adresse ou des coordonnees
 * deviennent une recherche : Google Maps ouvre le lieu s'il le trouve, la
 * liste des resultats sinon.
 */
export function lienCarte(localisation) {
  const v = String(localisation || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
}

/* =================================================================
   DESTINATIONS DES MISSIONS — lieux enregistres, localises, et leur
   distance depuis Abidjan.

   Une mission ne retient que le nom de sa destination, comme avant : les
   missions deja saisies se lisent sans reprise, et le rapport de mission,
   qui lit la meme fiche, suit de lui-meme. La distance se lit dans la liste
   des destinations, par le nom.

   L'application fonctionne sans Internet : la distance ne peut pas etre
   demandee a un service d'itineraire. Elle vient donc :
     - d'un releve pour les principales villes du pays (distance routiere
       indicative, a corriger au besoin) ;
     - sinon, des coordonnees du lieu : distance a vol d'oiseau majoree pour
       approcher la route, marquee « estimee » ;
     - ou de ce qu'on saisit, par exemple lu sur l'itineraire Google Maps.
   ================================================================= */

/** Point de depart des distances : Abidjan-Plateau. */
export const ABIDJAN = { lat: 5.3197, lng: -4.0168 };

/**
 * Rapport entre la route et la ligne droite sur le reseau ivoirien : la
 * mediane des villes de reference ci-dessous (de 1,10 pour Yamoussoukro,
 * sur l'autoroute, a 1,45 pour Daoukro). Il ne sert qu'a une estimation,
 * signalee comme telle.
 */
const FACTEUR_ROUTE = 1.25;

/**
 * Principales villes : coordonnees et distance routiere depuis Abidjan, en
 * km. Valeurs indicatives, arrondies ; chacune reste modifiable dans la liste.
 */
export const DESTINATIONS_REFERENCE = [
  ['Bingerville', 5.3550, -3.8853, 18],
  ['Anyama', 5.4947, -4.0517, 25],
  ['Grand-Bassam', 5.2118, -3.7388, 43],
  ['Alépé', 5.5000, -3.6667, 50],
  ['Dabou', 5.3256, -4.3767, 50],
  ['Jacqueville', 5.2050, -4.4150, 55],
  ['Agboville', 5.9280, -4.2130, 80],
  ['Adzopé', 6.1067, -3.8619, 105],
  ['Aboisso', 5.4667, -3.2000, 120],
  ['Tiassalé', 5.8983, -4.8228, 125],
  ['Grand-Lahou', 5.1367, -5.0244, 145],
  ['Divo', 5.8372, -5.3572, 190],
  ['Toumodi', 6.5520, -5.0190, 200],
  ['Bongouanou', 6.6517, -4.2041, 200],
  ['Abengourou', 6.7297, -3.4964, 210],
  ['Yamoussoukro', 6.8276, -5.2893, 240],
  ['Dimbokro', 6.6500, -4.7000, 240],
  ['Lakota', 5.8500, -5.6833, 240],
  ['Sassandra', 4.9500, -6.0833, 260],
  ['Gagnoa', 6.1319, -5.9506, 275],
  ['Daoukro', 7.0591, -3.9631, 280],
  ['Sinfra', 6.6210, -5.9114, 290],
  ['Bouaflé', 6.9903, -5.7442, 300],
  ['San-Pédro', 4.7485, -6.6363, 340],
  ['Bouaké', 7.6939, -5.0303, 350],
  ['Daloa', 6.8774, -6.4502, 385],
  ['Soubré', 5.7856, -6.6083, 390],
  ['Katiola', 8.1372, -5.1006, 400],
  ['Issia', 6.4922, -6.5856, 410],
  ['Bondoukou', 8.0402, -2.8000, 420],
  ['Tabou', 4.4230, -7.3528, 430],
  ['Vavoua', 7.3819, -6.4778, 440],
  ['Duékoué', 6.7419, -7.3492, 500],
  ['Séguéla', 7.9611, -6.6731, 520],
  ['Guiglo', 6.5436, -7.4933, 530],
  ['Mankono', 8.0586, -6.1897, 550],
  ['Ferkessédougou', 9.5928, -5.1944, 580],
  ['Man', 7.4125, -7.5536, 580],
  ['Bouna', 9.2667, -3.0000, 620],
  ['Korhogo', 9.4580, -5.6296, 635],
  ['Danané', 7.2596, -8.1550, 650],
  ['Touba', 8.2833, -7.6833, 700],
  ['Boundiali', 9.5167, -6.4833, 720],
  ['Tengréla', 10.4833, -6.4000, 800],
  ['Odienné', 9.5000, -7.5667, 840]
];

/** Distance a vol d'oiseau entre deux points, en km (formule de haversine). */
export function distanceVolOiseau(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Coordonnees lues dans ce qu'on colle depuis Google Maps : « 7.69, -5.03 »
 * (clic droit sur la carte), un lien « …/@7.69,-5.03,12z », « …?q=7.69,-5.03 »
 * ou « …!3d7.69!4d-5.03 ». Un lien court (maps.app.goo.gl) ne porte pas les
 * coordonnees : il faut l'ouvrir pour les connaitre, ce qui demande Internet.
 *
 * @returns {{lat:number,lng:number}|null}
 */
export function coordonneesDe(texte) {
  const t = String(texte || '').trim();
  if (!t) return null;
  const formes = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/,
    /^(-?\d+(?:,\d+)?)\s*;\s*(-?\d+(?:,\d+)?)$/
  ];
  for (const f of formes) {
    const r = f.exec(t);
    if (!r) continue;
    const lat = Number(String(r[1]).replace(',', '.'));
    const lng = Number(String(r[2]).replace(',', '.'));
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Distance routiere estimee depuis Abidjan, arrondie a 5 km. */
export function distanceEstimee(coord) {
  if (!coord) return null;
  return Math.max(5, Math.round((distanceVolOiseau(ABIDJAN, coord) * FACTEUR_ROUTE) / 5) * 5);
}

/**
 * Premiere ouverture apres la mise a jour : la liste recoit les villes de
 * reference, puis les destinations deja tapees dans les missions — une
 * mission ancienne retrouve ainsi sa distance si sa ville est connue.
 * La cle absente est le signal : on ne le fait qu'une fois, une ville
 * retiree ensuite ne revient pas.
 */
function initialiserDestinationsMission(db) {
  if (Array.isArray(db.destinationsMission)) return;
  db.destinationsMission = DESTINATIONS_REFERENCE.map(([nom, lat, lng, km]) => ({
    id: uid(), nom, localisation: '', lat, lng, distanceKm: km, estimee: false
  }));
  (db.missions || []).forEach((m) => destinationsDe(m).forEach((nom) => assurerDestinationMission(nom, db)));
}

/* ------------------------------------------------------------------ */
/* Plusieurs destinations par mission                                  */
/* ------------------------------------------------------------------ */

/**
 * Une mission peut passer par plusieurs lieux : ils sont ranges dans
 * `destinations`, dans l'ordre du parcours.
 *
 * `destination` est garde a cote, en texte (« Bouaké, Korhogo ») : c'est ce
 * que lisent les exports, la recherche, la fiche vehicule et la rubrique
 * DOTATION. Il est toujours recalcule a partir de la liste, jamais saisi.
 */
export function destinationsDe(m) {
  if (!m) return [];
  if (Array.isArray(m.destinations)) return m.destinations.filter(Boolean);
  return m.destination ? [String(m.destination).trim()].filter(Boolean) : [];
}

/** Libelle d'une liste de destinations, tel qu'il s'affiche partout. */
export function texteDestinations(liste) {
  return (liste || []).filter(Boolean).join(', ');
}

/**
 * Les missions d'avant ne connaissaient qu'une destination : elle devient la
 * premiere de la liste. On ne coupe pas sur les virgules — « Abidjan,
 * Cocody » peut tres bien designer un seul lieu.
 */
function normaliserDestinations(m) {
  const vus = new Set();
  m.destinations = destinationsDe(m)
    .map((d) => String(d).trim())
    .filter((d) => d && !vus.has(norm(d)) && vus.add(norm(d)));
  m.destination = texteDestinations(m.destinations);
}

/* ------------------------------------------------------------------ */
/* Distances d'etape : chaque ville depuis la precedente               */
/* ------------------------------------------------------------------ */

/** Lieu de depart de toutes les missions. */
export const ORIGINE_MISSIONS = 'Abidjan';

/**
 * Une mission a plusieurs destinations se parcourt de proche en proche :
 * Abidjan → Yamoussoukro, puis Yamoussoukro → Bouaké, puis Bouaké →
 * Korhogo… Le kilometrage de la mission est la somme de ces etapes.
 *
 * La distance d'une etape vient, dans l'ordre :
 *   1. d'un trajet enregistre (« Les trajets entre villes ») — tout chiffre
 *      corrige dans un formulaire y est garde, et sert aux missions suivantes ;
 *   2. pour une etape partant d'Abidjan, de la distance de la destination ;
 *   3. pour deux villes sur la meme route depuis Abidjan, de la difference de
 *      leurs distances : Bouaké (350) − Yamoussoukro (240) = 110 km ;
 *   4. sinon, des coordonnees des deux villes : ligne droite majoree,
 *      marquee « estimee ».
 * Faute de tout cela, l'etape reste a renseigner : on n'invente rien.
 */

/** Cle d'un trajet, dans un sens comme dans l'autre. */
export function cleTrajet(a, b) {
  return [norm(a || ''), norm(b || '')].sort().join('|');
}

export function trajetEnregistre(a, b, db = DB) {
  const k = cleTrajet(a, b);
  return (db.trajets || []).find((t) => cleTrajet(t.a, t.b) === k) || null;
}

/** Garde la distance d'un trajet entre deux villes, dans les deux sens. */
export function enregistrerTrajet(a, b, km, db = DB) {
  const de = String(a || '').trim();
  const vers = String(b || '').trim();
  if (!de || !vers || norm(de) === norm(vers) || km === '' || km === null || km === undefined) return null;
  if (!Array.isArray(db.trajets)) db.trajets = [];
  const t = trajetEnregistre(de, vers, db);
  if (t) t.km = num(km);
  else db.trajets.push({ id: uid(), a: de, b: vers, km: num(km) });
  if (db === DB) persist();
  return t || db.trajets[db.trajets.length - 1];
}

function estOrigine(nom) {
  return !nom || norm(nom) === norm(ORIGINE_MISSIONS);
}

function coordDe(nom, db) {
  const d = destinationMissionParNom(nom, db);
  return d && d.lat !== '' && d.lat !== undefined && d.lat !== null && d.lng !== '' && d.lng !== undefined && d.lng !== null
    ? { lat: num(d.lat), lng: num(d.lng) }
    : null;
}

/**
 * Tolerance de l'alignement : B est « sur la route » de A quand passer par
 * A n'allonge pas de plus de 15 % la ligne droite Abidjan → B. Yamoussoukro
 * puis Bouaké (+ 0,6 %) ou Bouaké puis Korhogo (0 %) le sont ; Korhogo puis
 * Odienné (+ 16 %) ne l'est pas — la route d'Odienné ne passe pas par Korhogo.
 */
const TOLERANCE_AXE = 1.15;

/**
 * Distance par la route entre deux etapes. `de` vide ou « Abidjan » : depuis
 * le lieu de depart.
 * @returns {{km:number, estimee:boolean, source:string}|null}
 *   source : 'trajet' | 'abidjan' | 'axe' | 'coordonnees'
 */
export function distanceEntre(de, vers, db = DB) {
  if (!vers) return null;
  // Le retour vers Abidjan est la meme route que l'aller depuis Abidjan.
  if (estOrigine(vers) && !estOrigine(de)) return distanceEntre(ORIGINE_MISSIONS, de, db);
  if (!estOrigine(de) && norm(de) === norm(vers)) return { km: 0, estimee: false, source: 'trajet' };

  const t = trajetEnregistre(estOrigine(de) ? ORIGINE_MISSIONS : de, vers, db);
  if (t && t.km !== '' && t.km !== undefined) return { km: num(t.km), estimee: false, source: 'trajet' };

  if (estOrigine(de)) {
    const d = distanceAbidjan(vers, db);
    return d ? { km: d.km, estimee: d.estimee, source: 'abidjan' } : null;
  }

  const ca = coordDe(de, db);
  const cb = coordDe(vers, db);
  const da = distanceAbidjan(de, db);
  const dv = distanceAbidjan(vers, db);
  if (ca && cb && da && dv) {
    const [proche, loin] = distanceVolOiseau(ABIDJAN, ca) <= distanceVolOiseau(ABIDJAN, cb) ? [ca, cb] : [cb, ca];
    const parProche = distanceVolOiseau(ABIDJAN, proche) + distanceVolOiseau(proche, loin);
    if (parProche <= TOLERANCE_AXE * distanceVolOiseau(ABIDJAN, loin)) {
      return { km: Math.abs(dv.km - da.km), estimee: da.estimee || dv.estimee, source: 'axe' };
    }
  }
  if (ca && cb) {
    return {
      km: Math.max(5, Math.round((distanceVolOiseau(ca, cb) * FACTEUR_ROUTE) / 5) * 5),
      estimee: true,
      source: 'coordonnees'
    };
  }
  return null;
}

/**
 * Le parcours d'une liste de destinations : les etapes de l'aller, depuis
 * Abidjan, puis le retour de la derniere destination a Abidjan.
 * @returns {{etapes:Array<{de:string,vers:string,km:number|null,estimee:boolean}>,
 *            retour:{de:string,vers:string,km:number|null,estimee:boolean}|null,
 *            aller:number, total:number, complet:boolean, estimee:boolean}}
 */
export function parcoursDe(noms, db = DB) {
  const etapes = [];
  let precedent = ORIGINE_MISSIONS;
  (noms || []).filter(Boolean).forEach((vers) => {
    const d = distanceEntre(precedent, vers, db);
    etapes.push({ de: precedent, vers, km: d ? d.km : null, estimee: !!(d && d.estimee) });
    precedent = vers;
  });
  const dr = etapes.length ? distanceEntre(precedent, ORIGINE_MISSIONS, db) : null;
  const retour = etapes.length
    ? { de: precedent, vers: ORIGINE_MISSIONS, km: dr ? dr.km : null, estimee: !!(dr && dr.estimee), retour: true }
    : null;
  return totaliser({ etapes, retour });
}

/** Totaux d'un parcours, apres calcul ou correction de ses etapes. */
export function totaliser(p) {
  const toutes = p.retour ? [...p.etapes, p.retour] : p.etapes;
  p.aller = p.etapes.reduce((t, e) => t + (e.km || 0), 0);
  p.total = toutes.reduce((t, e) => t + (e.km || 0), 0);
  p.complet = toutes.every((e) => e.km !== null);
  p.estimee = toutes.some((e) => e.estimee);
  return p;
}

/**
 * Distance parcourue a l'interieur des destinations : ce que le compteur a
 * enregistre au-dela du parcours aller-retour calcule — les deplacements
 * sur place, d'un site a l'autre d'une meme ville.
 *
 * @returns {{compteur:number, parcours:number, surPlace:number}|null}
 *   null tant que les deux kilometrages ou une distance d'etape manquent
 */
export function distanceSurPlace(m, db = DB) {
  const vide = (v) => v === '' || v === undefined || v === null;
  if (vide(m.kmDepart) || vide(m.kmArrivee)) return null;
  const p = parcoursMission(m, db);
  if (!p.etapes.length || !p.complet) return null;
  const compteur = num(m.kmArrivee) - num(m.kmDepart);
  return { compteur, parcours: p.total, surPlace: compteur - p.total, estimee: p.estimee };
}

/** Le parcours d'une mission. */
export function parcoursMission(m, db = DB) {
  return parcoursDe(destinationsDe(m), db);
}

/** Total aller-retour : « 1 740 km », « ≈ 1 740 km » ou « 640 km + ? » quand une etape manque. */
export function libelleParcours(p) {
  if (!p || !p.etapes.length) return '';
  if (!p.total && !p.complet) return '';
  return `${p.estimee ? '≈ ' : ''}${p.total.toLocaleString('fr-FR')} km${p.complet ? '' : ' + ?'}`;
}

export function nomsDestinationsMission(db = DB) {
  return (db.destinationsMission || [])
    .map((d) => String(d.nom || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

export function destinationMissionParNom(nom, db = DB) {
  const cle = norm(nom || '');
  if (!cle) return null;
  return (db.destinationsMission || []).find((d) => norm(d.nom || '') === cle) || null;
}

/**
 * Inscrit une destination tapee dans une mission. Sans coordonnees, sa
 * distance reste a renseigner : on ne l'invente pas.
 *
 * @returns {object|null} la fiche creee, ou null si elle existait deja
 */
export function assurerDestinationMission(nom, db = DB) {
  const propre = String(nom || '').trim();
  if (!propre || destinationMissionParNom(propre, db)) return null;
  const fiche = {
    id: uid(),
    nom: propre,
    localisation: '',
    lat: '',
    lng: '',
    distanceKm: '',
    estimee: false
  };
  if (!Array.isArray(db.destinationsMission)) db.destinationsMission = [];
  db.destinationsMission.push(fiche);
  if (db === DB) persist();
  return fiche;
}

/** Reporte le nouveau nom d'une destination sur toutes ses missions. */
export function renommerDestinationMission(ancien, nouveau, db = DB) {
  const cle = norm(ancien || '');
  const propre = String(nouveau || '').trim();
  // Comme pour les destinataires : un accent corrige se reporte aussi.
  if (!cle || !propre) return 0;
  let n = 0;
  (db.missions || []).forEach((m) => {
    const liste = destinationsDe(m);
    const i = liste.findIndex((x) => norm(x) === cle && x !== propre);
    if (i < 0) return;
    liste[i] = propre;
    m.destinations = liste;
    m.destination = texteDestinations(liste);
    n += 1;
  });
  (db.trajets || []).forEach((t) => {
    if (norm(t.a || '') === cle) t.a = propre;
    if (norm(t.b || '') === cle) t.b = propre;
  });
  if (n && db === DB) persist();
  return n;
}

export function missionsVersDestination(nom, db = DB) {
  const cle = norm(nom || '');
  if (!cle) return [];
  return (db.missions || []).filter((m) => destinationsDe(m).some((x) => norm(x) === cle));
}

/**
 * Distance depuis Abidjan d'une destination, par son nom.
 * @returns {{km:number, estimee:boolean}|null} null si elle n'est pas connue
 */
export function distanceAbidjan(nom, db = DB) {
  const d = destinationMissionParNom(nom, db);
  if (!d || d.distanceKm === '' || d.distanceKm === undefined || d.distanceKm === null) return null;
  return { km: num(d.distanceKm), estimee: !!d.estimee };
}

/** « 350 km », ou « ≈ 455 km » pour une estimation ; vide si inconnue. */
export function libelleDistance(nom, db = DB) {
  const d = distanceAbidjan(nom, db);
  return d ? `${d.estimee ? '≈ ' : ''}${d.km.toLocaleString('fr-FR')} km` : '';
}

/** Ce que Google Maps doit chercher pour trouver la destination. */
function cibleCarte(d) {
  const loc = String(d.localisation || '').trim();
  if (loc && !/^https?:\/\//i.test(loc) && !coordonneesDe(loc)) return loc;
  if (d.lat !== '' && d.lat !== undefined && d.lng !== '' && d.lng !== undefined) return `${d.lat},${d.lng}`;
  return `${d.nom}, Côte d’Ivoire`;
}

/** Lien Google Maps de la destination : le lien colle s'il y en a un. */
export function lienCarteDestination(d) {
  if (!d) return '';
  const loc = String(d.localisation || '').trim();
  if (/^https?:\/\//i.test(loc)) return loc;
  return lienCarte(cibleCarte(d));
}

/**
 * Itineraire Google Maps du parcours : Abidjan, puis chaque destination dans
 * l'ordre, jusqu'a la derniere. Google Maps y donne la distance de chaque
 * etape et le total, de quoi verifier ou corriger le calcul.
 */
export function lienParcours(noms, db = DB) {
  const etapes = (noms || []).filter(Boolean).map((nom) =>
    cibleCarte(destinationMissionParNom(nom, db) || { nom, localisation: '', lat: '', lng: '' }));
  if (!etapes.length) return '';
  const params = new URLSearchParams({
    api: '1',
    origin: 'Abidjan, Côte d’Ivoire',
    destination: etapes[etapes.length - 1],
    travelmode: 'driving'
  });
  if (etapes.length > 1) params.set('waypoints', etapes.slice(0, -1).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Itineraire Google Maps d'une seule etape, de la ville precedente a la suivante. */
export function lienEtape(de, vers, db = DB) {
  const cible = (nom) => (estOrigine(nom)
    ? 'Abidjan, Côte d’Ivoire'
    : cibleCarte(destinationMissionParNom(nom, db) || { nom, localisation: '', lat: '', lng: '' }));
  const params = new URLSearchParams({ api: '1', origin: cible(de), destination: cible(vers), travelmode: 'driving' });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Itineraire Google Maps depuis Abidjan : la distance routiere exacte s'y lit. */
export function lienItineraire(d) {
  if (!d) return '';
  const params = new URLSearchParams({
    api: '1',
    origin: 'Abidjan, Côte d’Ivoire',
    destination: cibleCarte(d),
    travelmode: 'driving'
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/* =================================================================
   SIMULATION — estimation des frais d'une mission avant le depart.

     estimation = frais OM + frais de peage + carburant
     carburant  = (parcours aller-retour + parcours en interne)
                  x consommation / 100 x prix du litre
     frais OM   = participants x destinations x 1 000 F

   Le parcours se calcule comme celui d'une mission, etape par etape.
   ================================================================= */

/** Frais d'ordre de mission par participant, tant que RÉGLAGES n'en fixe pas d'autre. */
export const FRAIS_OM_PAR_PARTICIPANT = 1000;

/** Frais OM par participant en vigueur : celui de RÉGLAGES, sinon 1 000 F. */
export function fraisOmParParticipant(db = DB) {
  const v = db.settings && db.settings.fraisOmParParticipant;
  return v === '' || v === undefined || v === null ? FRAIS_OM_PAR_PARTICIPANT : num(v);
}

/**
 * Tous les montants d'une simulation, a partir de ce qui a ete saisi.
 *
 * Le montant du carburant est calcule sur les litres exacts, puis arrondi
 * au franc superieur, comme partout ailleurs dans l'application ; les
 * litres affiches sont arrondis au dixieme.
 *
 * @param {object} s
 * @param {number} s.parcoursKm  parcours aller-retour, en km
 * @param {Array<{km:number}>} s.interne  distance parcourue dans chaque destination
 * @param {number} s.consommation  litres aux 100 km
 * @param {number} s.prixL  prix du litre
 * @param {number} s.participants
 * @param {number} s.fraisPeage  montant total des peages, saisi tel quel
 * @param {number} [s.fraisOmUnitaire]  frais OM par participant (RÉGLAGES par defaut)
 * @param {number} [s.nbDestinations]  nombre de destinations ; a defaut, une par
 *        ligne de `interne` (une ligne par destination), et au moins une.
 */
export function calculerSimulation(s) {
  const parcoursKm = num(s.parcoursKm);
  const interneKm = (s.interne || []).reduce((t, x) => t + num(x.km), 0);
  const distanceTotale = parcoursKm + interneKm;
  const litresExacts = (distanceTotale * num(s.consommation)) / 100;
  const montantCarburant = francSup(litresExacts * francSup(s.prixL));
  const participants = Math.max(0, Math.floor(num(s.participants)));
  const fraisOmUnitaire = s.fraisOmUnitaire === undefined || s.fraisOmUnitaire === ''
    ? fraisOmParParticipant()
    : num(s.fraisOmUnitaire);
  // Les frais OM se paient par destination : X destinations, X frais OM.
  const nbDestinations = Math.max(1, Math.floor(num(
    s.nbDestinations === undefined ? (s.interne || []).length : s.nbDestinations
  )));
  const fraisOm = participants * nbDestinations * fraisOmUnitaire;
  const fraisPeage = francSup(s.fraisPeage);
  return {
    parcoursKm,
    interneKm,
    distanceTotale,
    litres: Math.round(litresExacts * 10) / 10,
    montantCarburant,
    participants,
    nbDestinations,
    fraisOmUnitaire,
    fraisOm,
    fraisPeage,
    estimation: fraisOm + fraisPeage + montantCarburant
  };
}

/** Km parcourus par jour a l'interieur d'une destination (RÉGLAGES), 0 si non regle. */
export function kmInterneParJour(db = DB) {
  return num(db.settings && db.settings.parcoursInterneKmParJour);
}

/**
 * Parcours en interne propose pour une destination : jours sur place x km
 * par jour. Vide tant que les jours ou le reglage manquent — on ne propose
 * pas zero, qui se lirait comme « aucun deplacement ».
 */
export function interneEstime(jours, db = DB) {
  const taux = kmInterneParJour(db);
  if (jours === '' || jours === undefined || jours === null || !taux) return '';
  return Math.round(num(jours) * taux);
}

/**
 * Les vehicules de la rubrique VÉHICULES, pour une liste de choix : chaque
 * immatriculation une fois, avec sa marque et son modele. Une fiche qui ne
 * porte que le prefixe pre-inscrit (« D45 50 ») n'a pas d'immatriculation.
 */
export function vehiculesDuParc(db = DB) {
  const prefixes = [PREFIXE_IMMAT_NOUVELLE, PREFIXE_IMMAT_ANCIENNE].map((p) => p.trim().toUpperCase());
  const vus = new Map();
  allVehicles(db).forEach((v) => {
    const immat = String(immatOf(v) || '').trim().toUpperCase();
    if (!immat || prefixes.includes(immat) || vus.has(immat)) return;
    vus.set(immat, {
      immat,
      marqueModele: `${v.marque || ''} ${v.modele || ''}`.trim(),
      energie: v.energie || ''
    });
  });
  return [...vus.values()].sort((a, b) => a.immat.localeCompare(b.immat, 'fr'));
}

/** Consommation retenue lors de la derniere simulation de ce vehicule. */
export function derniereConsommation(immat, db = DB) {
  const cle = norm(immat || '');
  if (!cle) return '';
  const s = (db.simulations || [])
    .filter((x) => norm(x.vehicule || '') === cle && num(x.consommation))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .pop();
  return s ? num(s.consommation) : '';
}

/* =================================================================
   CONGES ET ABSENCES AU POOL — conges, permissions, repos maladie des
   conducteurs du pool, et l'interimaire qui les remplace.

   La date de reprise est le jour du retour au poste : l'indisponibilite
   couvre les jours du depart a la veille de la reprise. Partir le 5 et
   reprendre le 8 fait trois jours d'absence.
   ================================================================= */

export const MOTIFS_INDISPONIBILITE = ['En congé', 'Permissionnaire', 'Repos maladie'];

/** Nombre de jours d'absence, ou null tant qu'une date manque. */
export function dureeIndisponibilite(dateDepart, dateReprise) {
  return daysBetween(dateDepart, dateReprise);
}

/**
 * Une absence refusee n'a pas lieu : elle ne sort pas le conducteur du
 * tour de role et n'occupe pas ses dates.
 */
export function absenceRefusee(i, db = DB) {
  return validationAbsence(i, (db && db.demandes) || []) === 'non';
}

/**
 * Ou en est une indisponibilite a une date donnee. Refusee, elle est
 * terminee d'emblee, quelles que soient ses dates.
 * @returns {'à venir'|'en cours'|'terminée'|''}
 */
export function etatIndisponibilite(i, jour = todayISO(), db = DB) {
  if (!i || !i.dateDepart) return '';
  if (absenceRefusee(i, db)) return 'terminée';
  if (jour < i.dateDepart) return 'à venir';
  if (!i.dateReprise || jour < i.dateReprise) return 'en cours';
  return 'terminée';
}

/** Les conducteurs du pool, tels qu'ils s'ecrivent dans UTILISATEURS. */
export function conducteursDuPool(db = DB) {
  return (db.users || [])
    .filter((u) => u.poolConducteur === 'Oui')
    .map(nomComplet)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Une autre indisponibilite du meme conducteur qui recouvre la periode.
 * Deux periodes se recouvrent si chacune commence avant la reprise de
 * l'autre ; une reprise le jour d'un nouveau depart ne recouvre rien.
 */
export function chevauchementIndisponibilite(conducteur, dateDepart, dateReprise, exclureId, db = DB) {
  const cle = norm(conducteur || '');
  if (!cle || !dateDepart) return null;
  const fin = dateReprise || '9999-12-31';
  return (db.indisponibilites || []).find((i) =>
    i.id !== exclureId &&
    !absenceRefusee(i, db) &&
    norm(i.conducteur || '') === cle &&
    i.dateDepart < fin &&
    dateDepart < (i.dateReprise || '9999-12-31')) || null;
}

/**
 * Une indisponibilite du conducteur pendant une mission. La mission compte
 * ses jours de depart et de retour ; l'indisponibilite s'arrete la veille
 * de la reprise.
 */
export function indisponibiliteSurMission(conducteur, dateDepart, dateRetour, db = DB) {
  const cle = norm(conducteur || '');
  if (!cle || !dateDepart) return null;
  const fin = dateRetour || dateDepart;
  return (db.indisponibilites || []).find((i) =>
    !absenceRefusee(i, db) &&
    norm(i.conducteur || '') === cle &&
    i.dateDepart && i.dateDepart <= fin &&
    dateDepart < (i.dateReprise || '9999-12-31')) || null;
}

/** Les indisponibilites en cours a une date donnee. */
export function indisponibilitesEnCours(jour = todayISO(), db = DB) {
  return (db.indisponibilites || []).filter((i) => etatIndisponibilite(i, jour, db) === 'en cours');
}

/** Reporte le nouveau nom d'un agent sur ses indisponibilites et ses interims. */
export function renommerAgentDansIndisponibilites(ancien, nouveau, db = DB) {
  const cle = norm(ancien || '');
  const propre = String(nouveau || '').trim();
  if (!cle || !propre) return 0;
  let n = 0;
  (db.indisponibilites || []).forEach((i) => {
    if (norm(i.conducteur || '') === cle && i.conducteur !== propre) { i.conducteur = propre; n += 1; }
    if (norm(i.interimaire || '') === cle && i.interimaire !== propre) { i.interimaire = propre; n += 1; }
  });
  // Les demandes de conge et d'absence retiennent l'agent et l'interimaire.
  (db.demandes || []).forEach((d) => {
    if (norm(d.agent || '') === cle && d.agent !== propre) { d.agent = propre; n += 1; }
    if (norm(d.interimaire || '') === cle && d.interimaire !== propre) { d.interimaire = propre; n += 1; }
  });
  if (n && db === DB) persist();
  return n;
}

/* =================================================================
   SYNCHRONISATION — ce que la base offre au module de synchronisation.
   ================================================================= */

/** Identite de cet appareil. */
export function appareilSynchro() {
  return { id: DB.synchro.appareil, nom: DB.synchro.nom || platformName };
}

/** Date de la derniere synchronisation avec un autre appareil ('' : jamais). */
export function derniereSynchroAvec(idAppareil) {
  const a = (DB.synchro.appareils || {})[idAppareil];
  return (a && a.derniere) || '';
}

/** Les appareils deja synchronises, le plus recent d'abord. */
export function appareilsSynchronises() {
  return Object.entries(DB.synchro.appareils || {})
    .map(([id, a]) => Object.assign({ id }, a))
    .sort((a, b) => String(b.derniere || '').localeCompare(String(a.derniere || '')));
}

/**
 * Installe la base fusionnee. Elle est deja a jour des deux cotes : rien
 * n'est date, et la synchronisation avec l'autre appareil est notee.
 */
/**
 * Synchronisation sans rien de nouveau a recevoir : on note seulement sa
 * date (elle sert a reconnaitre les conflits), sans redessiner ni dater les
 * fiches.
 */
export function noterSynchroAvec(autre, quand = new Date().toISOString()) {
  if (!DB.synchro || !autre || !autre.id) return;
  DB.synchro.appareils = Object.assign({}, DB.synchro.appareils, {
    [autre.id]: { nom: autre.nom || 'Autre appareil', derniere: quand }
  });
  persist({ silent: true });
}

export async function appliquerSynchro(fusion, autre, quand = new Date().toISOString()) {
  const moi = DB.synchro;
  const next = normalize(fusion);
  next.synchro.appareil = moi.appareil;
  next.synchro.nom = moi.nom;
  next.synchro.appareils = Object.assign({}, moi.appareils, {
    [autre.id]: { nom: autre.nom || 'Autre appareil', derniere: quand }
  });
  DB = next;
  reprendreEmpreintes();
  await persistNow();
  emit();
  return DB;
}
