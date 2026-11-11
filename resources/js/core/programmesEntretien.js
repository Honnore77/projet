/* ===================================================================
   PROGRAMME D'ENTRETIEN — les passages au garage prevus.

   ENTRETIEN → PROGRAMME D'ENTRETIEN (collection `programmesEntretien`) :
   une ligne par entretien prevu (date, vehicule, type, travaux, garage).
   Le jour venu, « Entrer au garage » ouvre la fiche d'entretien deja
   remplie ; le programme retient la fiche (ficheId). Il est alors :
     - « en cours » tant que le vehicule est au garage (fiche sans sortie) ;
     - « réalisé » une fois le vehicule sorti : il quitte le tableau.
   Sans fiche, il est « à venir », puis « en retard » des le lendemain de
   la date prevue : un entretien oublie reste en vue jusqu'a ce qu'on le
   fasse ou le supprime.

   Les programmes actifs figurent aussi au TABLEAU DE BORD → PROGRAMMES.
   =================================================================== */

import { DB, memeVehicule } from './db.js';
import { todayISO } from './utils.js';

/** Types proposes a la saisie ; la liste reste ouverte. */
export const TYPES_ENTRETIEN = ['Vidange', 'Révision', 'Visite technique', 'Réparation', 'Pneumatiques', 'Freinage', 'Climatisation'];

/** La fiche d'entretien ouverte depuis le programme, si elle existe encore. */
export function ficheDuProgrammeEntretien(e, db = DB) {
  return (e && e.ficheId && (db.maintenance || []).find((m) => m.id === e.ficheId)) || null;
}

/**
 * Ou en est un entretien programme.
 * @returns {'à venir'|'en retard'|'en cours'|'réalisé'}
 */
export function etatProgrammeEntretien(e, jour = todayISO(), db = DB) {
  const fiche = ficheDuProgrammeEntretien(e, db);
  if (fiche) return fiche.dateRetour ? 'réalisé' : 'en cours';
  if (e && e.datePrevue && e.datePrevue < jour) return 'en retard';
  return 'à venir';
}

/** Encore au tableau : a venir, en retard ou en cours. */
export function programmeEntretienActif(e, jour = todayISO(), db = DB) {
  return etatProgrammeEntretien(e, jour, db) !== 'réalisé';
}

const parDate = (a, b) =>
  String(a.datePrevue || '').localeCompare(String(b.datePrevue || '')) ||
  String(a.ref || '').localeCompare(String(b.ref || ''), 'fr', { numeric: true });

/** Les entretiens au tableau : en cours et en retard d'abord, puis par date. */
export function programmesEntretienActifs(jour = todayISO(), db = DB) {
  const rang = (e) => ({ 'en cours': 0, 'en retard': 1 }[etatProgrammeEntretien(e, jour, db)] ?? 2);
  return (db.programmesEntretien || []).filter((e) => programmeEntretienActif(e, jour, db))
    .sort((a, b) => rang(a) - rang(b) || parDate(a, b));
}

/** Les entretiens realises, le plus recent en tete. */
export function programmesEntretienRealises(jour = todayISO(), db = DB) {
  return (db.programmesEntretien || []).filter((e) => !programmeEntretienActif(e, jour, db)).sort((a, b) => parDate(b, a));
}

/** Prochaine reference : PE-001, PE-002... a la suite de la plus haute. */
export function prochaineRefEntretien(db = DB) {
  const max = (db.programmesEntretien || []).reduce((m, e) => {
    const r = /(\d+)\s*$/.exec(String(e.ref || ''));
    return r ? Math.max(m, Number(r[1])) : m;
  }, 0);
  return `PE-${String(max + 1).padStart(3, '0')}`;
}

function fr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

/** Le jour `d` tombe-t-il dans la periode [du, au] (jours compris) ? */
const dans = (d, du, au) => !!d && !!du && du <= d && d <= (au || du);

/**
 * Ce qui gene un entretien programme, en phrases : le vehicule en mission
 * (ou programme en mission) ce jour-la, ou deja au garage.
 * @returns {string[]}
 */
export function conflitsEntretien(e, db = DB, jour = todayISO()) {
  if (!e || !e.immat || !e.datePrevue || ficheDuProgrammeEntretien(e, db)) return [];
  const out = [];
  const d = e.datePrevue;
  (db.missions || []).filter((m) => m.vehicule && memeVehicule(m.vehicule, e.immat) && dans(d, m.dateDepart, m.dateRetour))
    .forEach((m) => out.push(`Le véhicule ${e.immat} est en mission ce jour-là (${m.ref || 'mission'}, du ${fr(m.dateDepart)}` +
      `${m.dateRetour ? ` au ${fr(m.dateRetour)}` : ''}).`));
  (db.programmes || []).filter((p) => !p.annule && !p.missionId && p.vehicule && memeVehicule(p.vehicule, e.immat) &&
    (p.dateRetour || p.dateDepart || '') >= jour && dans(d, p.dateDepart, p.dateRetour))
    .forEach((p) => out.push(`Le véhicule ${e.immat} est programmé en mission ce jour-là (${p.ref || 'programme'}).`));
  const garage = (db.maintenance || []).find((m) => m.immat && memeVehicule(m.immat, e.immat) && !m.dateRetour &&
    m.dateEntree && m.dateEntree <= d);
  if (garage) out.push(`Le véhicule ${e.immat} est déjà au garage depuis le ${fr(garage.dateEntree)}${garage.garage ? ` (${garage.garage})` : ''}.`);
  return [...new Set(out)];
}
