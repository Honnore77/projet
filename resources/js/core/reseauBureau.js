/* ===================================================================
   RÉSEAU DU BUREAU — plusieurs PC, une seule base, sans Internet.

   Un PC est le SERVEUR du bureau : sa base est la base de reference. Les
   autres PC sont des POSTES : ils gardent une copie de la base, et la
   tiennent a jour avec le serveur, sur le reseau local :

     - au demarrage, avant la page de connexion (les comptes crees ailleurs
       sont la des l'arrivee) ;
     - toutes les quelques secondes, des que le serveur ou le poste a du
       nouveau. Le poste demande au serveur sa « version » (l'heure de son
       dernier enregistrement, une requete minuscule) et ne synchronise
       que si elle a change, ou s'il a lui-meme enregistre quelque chose.

   L'echange est celui de la synchronisation avec le telephone (synchro.js) :
   fiche par fiche, la modification la plus recente l'emporte, et les
   suppressions suivent. Les photos et pieces jointes suivent aussi.

   Le serveur eteint, le poste continue sur sa copie ; il rattrape le
   serveur des qu'il revient. Rien ne se perd.
   =================================================================== */

import { DB, appareilSynchro, appliquerSynchro, noterSynchroAvec } from './db.js';
import { requete, echangerImages } from './synchroClient.js';

/** Frequence des « quoi de neuf ? » au serveur. */
const INTERVALLE_MS = 3000;
/** Au-dela, une synchronisation est faite quoi qu'il arrive. */
const SECURITE_MS = 60 * 1000;

export const PORT_BUREAU = 47800;

const etat = {
  cfg: null,
  base: '',
  connecte: false,
  enCours: false,
  derniere: '',
  erreur: '',
  versionServeur: null,
  envoiLocal: '',
  derniereSynchro: 0,
  minuterie: null,
  surReception: null,
  ecouteurs: new Set()
};

const prevenir = () => etat.ecouteurs.forEach((f) => { try { f(etatPoste()); } catch (e) { /* ecran ferme */ } });

/** L'etat du poste, pour l'ecran RÉGLAGES et le voyant de l'en-tete. */
export function etatPoste() {
  return {
    actif: !!etat.cfg,
    connecte: etat.connecte,
    enCours: etat.enCours,
    derniere: etat.derniere,
    erreur: etat.erreur,
    serveur: etat.cfg ? etat.cfg.serveur : ''
  };
}

export function suivrePoste(f) {
  etat.ecouteurs.add(f);
  return () => etat.ecouteurs.delete(f);
}

/** « 192.168.1.20 », « 192.168.1.20:47800 » ou « PC-ACCUEIL » → adresse http. */
export function adresseServeur(saisie, port = PORT_BUREAU) {
  let a = String(saisie || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!a) return '';
  if (!/:\d+$/.test(a)) a = `${a}:${port}`;
  return `http://${a}`;
}

/**
 * Une synchronisation avec le serveur. Rend true si quelque chose est
 * arrive (la page a alors de quoi se redessiner).
 */
export async function synchroniserPoste({ force = false } = {}) {
  if (!etat.cfg || etat.enCours) return false;
  etat.enCours = true;
  let recu = false;
  try {
    const jeton = etat.cfg.code;
    const local = (DB.meta && DB.meta.updatedAt) || '';
    const { v } = await requete(etat.base, jeton, '/pdu/version', { delai: 4000 });
    const aFaire = force || v !== etat.versionServeur || local !== etat.envoiLocal ||
      Date.now() - etat.derniereSynchro > SECURITE_MS;
    if (aFaire) {
      const r = await requete(etat.base, jeton, '/pdu/synchro', {
        methode: 'POST',
        corps: { appareil: appareilSynchro(), db: DB },
        delai: 60000
      });
      recu = !!(r.rapport && (r.rapport.recues || r.rapport.supprimees));
      if (recu) await appliquerSynchro(r.db, r.pc, r.pc.quand);
      else noterSynchroAvec(r.pc, r.pc.quand);
      // Les photos et pieces jointes, apres les fiches qui les citent.
      const images = await echangerImages(etat.base, jeton);
      if (images.recues) recu = true;
      etat.versionServeur = r.v;
      etat.envoiLocal = (DB.meta && DB.meta.updatedAt) || '';
      etat.derniereSynchro = Date.now();
      etat.derniere = new Date().toISOString();
    }
    etat.connecte = true;
    etat.erreur = '';
  } catch (e) {
    etat.connecte = false;
    etat.erreur = /code du bureau/i.test(String(e && e.message))
      ? e.message
      : 'Serveur injoignable : ce poste travaille sur sa copie et se remettra à jour dès que le serveur répondra.';
  } finally {
    etat.enCours = false;
    prevenir();
  }
  if (recu && etat.surReception) {
    try { etat.surReception(); } catch (e) { /* page en cours de remplacement */ }
  }
  return recu;
}

/**
 * Demarre le poste. `premiere` : la premiere synchronisation est attendue
 * (au demarrage, avant la page de connexion), dans la limite de `delai`.
 */
export async function demarrerPoste(cfg, { delai = 6000 } = {}) {
  arreterPoste();
  etat.cfg = { serveur: cfg.serveur, code: String(cfg.code || '').trim().toUpperCase(), port: cfg.port || PORT_BUREAU };
  etat.base = adresseServeur(cfg.serveur, etat.cfg.port);
  etat.versionServeur = null;
  etat.envoiLocal = '';
  etat.derniereSynchro = 0;
  prevenir();
  const premiere = synchroniserPoste({ force: true });
  await Promise.race([premiere, new Promise((r) => setTimeout(r, delai))]);
  etat.minuterie = setInterval(() => { synchroniserPoste(); }, INTERVALLE_MS);
}

export function arreterPoste() {
  if (etat.minuterie) clearInterval(etat.minuterie);
  etat.minuterie = null;
  etat.cfg = null;
  etat.connecte = false;
  etat.erreur = '';
  prevenir();
}

/** Ce qu'il faut faire quand des donnees arrivent (redessiner la page). */
export function surReceptionPoste(f) {
  etat.surReception = f;
}

/**
 * Teste un serveur avant de l'enregistrer : rend son nom, ou leve
 * l'erreur a afficher.
 */
export async function testerServeur(serveur, code, port = PORT_BUREAU) {
  const base = adresseServeur(serveur, port);
  if (!base) throw new Error('Indiquez l’adresse du PC serveur.');
  try {
    const r = await requete(base, String(code || '').trim().toUpperCase(), '/pdu/ping', { delai: 5000 });
    if (!r.serveur) throw new Error('Ce PC répond, mais il n’est pas réglé comme serveur du bureau.');
    return r.nom || 'PC serveur';
  } catch (e) {
    if (/code du bureau|serveur du bureau/i.test(String(e && e.message))) throw e;
    throw new Error(
      'Le serveur ne répond pas. Vérifiez l’adresse, que l’application est ouverte sur le PC serveur, ' +
      'que les deux PC sont sur le même réseau, et que le pare-feu Windows autorise PDU Parc Auto sur le serveur.'
    );
  }
}
