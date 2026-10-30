/* ===================================================================
   NIVEAUX D'ACCES — qui voit quoi, qui fait quoi.

   Cinq roles. Pour chaque role et chaque rubrique, un niveau :

     masque    la rubrique n'apparait pas ;
     siennes   seulement les fiches qui concernent l'agent lie au compte
               (ses missions, son vehicule, ses absences…) ;
     lecture   tout voir et tout exporter, sans rien modifier ;
     saisie    ajouter et modifier, sans supprimer ;
     complet   tout, suppression comprise.

   Les niveaux par defaut sont ceux de la proposition retenue ;
   l'administrateur les ajuste dans REGLAGES → Niveaux d'accès. Ses
   reglages vivent dans la base (settings.acces) et suivent donc la
   synchronisation : le PC et le telephone appliquent les memes regles.

   L'administrateur a toujours tout : on ne peut pas s'enfermer dehors.

   Ces droits reglent ce que l'application montre et permet. Ils ne
   chiffrent pas les donnees.
   =================================================================== */

import { DB, nomComplet, vehiculesDeLAgent, immatOf } from './db.js';
import { norm } from './utils.js';

export const ROLES_ACCES = [
  { key: 'admin', label: 'Administrateur', desc: 'Tout, y compris les comptes, les réglages, les sauvegardes et les niveaux d’accès' },
  { key: 'chef', label: 'Chef du parc', desc: 'Tout le parc, suppressions et validation des demandes comprises' },
  { key: 'saisie', label: 'Agent de saisie', desc: 'Ajoute et corrige, sans supprimer ni valider' },
  { key: 'conducteur', label: 'Conducteur', desc: 'Son espace : ses missions et leur rapport, son véhicule, ses demandes' },
  { key: 'direction', label: 'Direction / Consultation', desc: 'Voit et exporte tout, sans rien modifier' }
];

export const NIVEAUX = [
  { key: 'masque', label: 'Masqué', signe: '⛔' },
  { key: 'siennes', label: 'Ses fiches', signe: '👤' },
  { key: 'lecture', label: 'Consultation', signe: '👁' },
  { key: 'saisie', label: 'Saisie', signe: '✏️' },
  { key: 'complet', label: 'Complet', signe: '✅' }
];

const TOUS = ['masque', 'siennes', 'lecture', 'saisie', 'complet'];
const SANS_SIENNES = ['masque', 'lecture', 'saisie', 'complet'];

/**
 * Les rubriques soumises a des droits. CONGES est la sous-rubrique
 * CONGÉS ET ABSENCES AU POOL de UTILISATEURS, reglee a part : un conducteur
 * y depose ses demandes sans voir la liste des agents.
 */
export const RUBRIQUES_ACCES = [
  { key: 'TABLEAU DE BORD', label: 'Tableau de bord', niveaux: ['masque', 'lecture'] },
  { key: 'VEHICULES', label: 'Véhicules', niveaux: TOUS, siennes: 'son véhicule, en consultation' },
  { key: 'UTILISATEURS', label: 'Utilisateurs (liste des agents)', niveaux: TOUS, siennes: 'sa propre fiche, en consultation' },
  { key: 'CONGES', label: 'Congés et absences au pool', niveaux: TOUS, siennes: 'ses absences ; il dépose et corrige ses demandes' },
  { key: 'DOTATION', label: 'Dotation', niveaux: TOUS, siennes: 'les dotations de son véhicule, en consultation' },
  { key: 'MISSION', label: 'Mission', niveaux: TOUS, siennes: 'ses missions ; il remplit leur rapport' },
  { key: 'ENTRETIEN', label: 'Entretien', niveaux: SANS_SIENNES },
  { key: 'DECHARGE', label: 'Sorties', niveaux: TOUS, siennes: 'les courses qu’il a déposées, en consultation' },
  { key: 'SIMULATION', label: 'Simulation', niveaux: SANS_SIENNES },
  { key: 'RAPPORTS', label: 'Rapports', niveaux: ['masque', 'lecture'] }
];

const DEFAUTS = {
  chef: {
    niveaux: {
      'TABLEAU DE BORD': 'lecture', VEHICULES: 'complet', UTILISATEURS: 'complet', CONGES: 'complet', DOTATION: 'complet',
      MISSION: 'complet', ENTRETIEN: 'complet', DECHARGE: 'complet', SIMULATION: 'complet', RAPPORTS: 'lecture'
    },
    valider: true
  },
  saisie: {
    niveaux: {
      'TABLEAU DE BORD': 'lecture', VEHICULES: 'saisie', UTILISATEURS: 'saisie', CONGES: 'saisie', DOTATION: 'saisie',
      MISSION: 'saisie', ENTRETIEN: 'saisie', DECHARGE: 'saisie', SIMULATION: 'saisie', RAPPORTS: 'lecture'
    },
    valider: false
  },
  conducteur: {
    niveaux: {
      'TABLEAU DE BORD': 'masque', VEHICULES: 'siennes', UTILISATEURS: 'siennes', CONGES: 'siennes', DOTATION: 'siennes',
      MISSION: 'siennes', ENTRETIEN: 'masque', DECHARGE: 'siennes', SIMULATION: 'masque', RAPPORTS: 'masque'
    },
    valider: false
  },
  direction: {
    niveaux: {
      'TABLEAU DE BORD': 'lecture', VEHICULES: 'lecture', UTILISATEURS: 'lecture', CONGES: 'lecture', DOTATION: 'lecture',
      MISSION: 'lecture', ENTRETIEN: 'lecture', DECHARGE: 'lecture', SIMULATION: 'lecture', RAPPORTS: 'lecture'
    },
    valider: false
  }
};

/** Anciens roles (avant les niveaux d'acces) et leur equivalent. */
export const ROLES_ANCIENS = { gestionnaire: 'chef', visiteur: 'direction' };

/** Le role tel qu'il s'entend aujourd'hui. */
export function roleActuel(role) {
  if (ROLES_ACCES.some((r) => r.key === role)) return role;
  return ROLES_ANCIENS[role] || 'direction';
}

/**
 * Les regles d'un role : celles de l'administrateur par-dessus les valeurs
 * par defaut, ramenees aux niveaux que chaque rubrique admet.
 */
export function reglesDuRole(role, db = DB) {
  const r = roleActuel(role);
  if (r === 'admin') {
    const niveaux = {};
    RUBRIQUES_ACCES.forEach((x) => { niveaux[x.key] = x.niveaux[x.niveaux.length - 1]; });
    return { niveaux, valider: true };
  }
  const base = DEFAUTS[r];
  const perso = (db && db.settings && db.settings.acces && db.settings.acces[r]) || {};
  const niveaux = {};
  RUBRIQUES_ACCES.forEach((x) => {
    const voulu = perso.niveaux && perso.niveaux[x.key];
    niveaux[x.key] = x.niveaux.includes(voulu) ? voulu : base.niveaux[x.key];
  });
  return { niveaux, valider: typeof perso.valider === 'boolean' ? perso.valider : base.valider };
}

/** Les valeurs par defaut d'un role, pour « Rétablir ». */
export function reglesParDefaut(role) {
  const b = DEFAUTS[roleActuel(role)];
  return b ? { niveaux: Object.assign({}, b.niveaux), valider: b.valider } : reglesDuRole('admin');
}

/* ---------------------------- Le compte ---------------------------- */

let compte = null;
let courante = 'TABLEAU DE BORD';

/** Le compte connecte : son role et l'agent qui lui est lie. */
export function definirCompte(c) {
  compte = c ? { role: roleActuel(c.role), agent: String(c.agent || '').trim() } : null;
}

/** La rubrique affichee, dont dependent les boutons de la page. */
export function definirRubrique(r) {
  courante = r || 'TABLEAU DE BORD';
}

export function rubriqueCourante() {
  return courante;
}

/** L'agent (UTILISATEURS) lie au compte connecte. */
export function agentConnecte() {
  return compte ? compte.agent : '';
}

export function niveau(rub = courante) {
  if (!compte) return 'masque';
  if (rub === 'REGLAGES') return compte.role === 'admin' ? 'complet' : 'masque';
  return reglesDuRole(compte.role).niveaux[rub] || 'masque';
}

/** La rubrique s'affiche-t-elle ? */
export function voit(rub = courante) {
  return niveau(rub) !== 'masque';
}

/** Voit-il toutes les fiches de la rubrique (et pas seulement les siennes) ? */
export function voitTout(rub = courante) {
  return ['lecture', 'saisie', 'complet'].includes(niveau(rub));
}

/** Ses fiches seulement. */
export function seulementSiennes(rub = courante) {
  return niveau(rub) === 'siennes';
}

/** Ajouter et modifier toutes les fiches. */
export function peutSaisir(rub = courante) {
  return ['saisie', 'complet'].includes(niveau(rub));
}

/** Supprimer. */
export function peutSupprimer(rub = courante) {
  return niveau(rub) === 'complet';
}

/** Decider d'une demande de conge ou d'absence. */
export function peutValider() {
  if (!compte) return false;
  return reglesDuRole(compte.role).valider === true;
}

/** Une decision sur la demande de cet agent : jamais sur la sienne. */
export function peutValiderPour(agent) {
  if (!peutValider()) return false;
  const moi = norm(agentConnecte());
  return !moi || norm(agent || '') !== moi;
}

/* ------------------------- Ses propres fiches ----------------------- */

const meme = (a, b) => !!a && !!b && norm(a) === norm(b);

/** La fiche concerne-t-elle l'agent lie au compte ? */
export function estAMoi(rub, fiche) {
  const moi = agentConnecte();
  if (!moi || !fiche) return false;
  switch (rub) {
    case 'MISSION': return meme(fiche.conducteur, moi);
    case 'CONGES': return meme(fiche.conducteur || fiche.agent || fiche.nomPrenoms, moi);
    case 'UTILISATEURS': return meme(nomComplet(fiche), moi);
    case 'VEHICULES': return meme(fiche.utilisateur, moi);
    case 'DOTATION': {
      if (meme(fiche.conducteur, moi)) return true;
      const immats = vehiculesDeLAgent(moi).map((v) => norm(immatOf(v)));
      return !!fiche.immat && immats.includes(norm(fiche.immat));
    }
    case 'DECHARGE': return meme(fiche.conducteur, moi) || meme(fiche.recuperePar, moi);
    default: return false;
  }
}

/** Ce qu'il peut voir d'une liste : tout, ses fiches, ou rien. */
export function filtrer(rub, liste) {
  if (voitTout(rub)) return liste;
  if (seulementSiennes(rub)) return liste.filter((f) => estAMoi(rub, f));
  return [];
}

/** Peut-il modifier cette fiche ? */
export function peutModifier(rub, fiche) {
  if (peutSaisir(rub)) return true;
  return seulementSiennes(rub) && estAMoi(rub, fiche) && ['MISSION', 'CONGES'].includes(rub);
}
