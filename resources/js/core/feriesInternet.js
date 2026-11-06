/* ===================================================================
   Jours feries du pays, lus sur Internet.

   La source est le calendrier public des jours feries de Google pour le
   pays (fr.ci : Cote d'Ivoire). C'est la seule, sans cle ni compte, qui
   donne aussi les fetes musulmanes (Nuit du Destin, Aïd el-Fitr, Tabaski,
   Maouloud), fixees chaque annee, et les jours « observés » (le 15 novembre
   tombe un dimanche : le lundi est chome). Seuls les evenements marques
   « Jour férié » comptent ; les « Journée d'observance » (debut du
   Ramadan...) ne sont pas chomees.

   La liste telechargee est rangee dans les reglages (settings.feriesInternet)
   : elle suit la synchronisation, un seul poste connecte suffit, et sert
   ensuite sans connexion. Les feries fixes et ceux de Pâques restent
   calcules (core/joursOuvres.js) : sans Internet, le calcul ne change pas
   de nature.

   Le calendrier ne se lit pas depuis la page (Google ne l'autorise pas aux
   pages web) : le PC passe par le programme Electron (pduDesktop), le
   telephone par la requete native de Capacitor (CapacitorHttp).
   =================================================================== */

import { DB, saveSettings } from './db.js';

/** Le pays du calendrier : code a deux lettres (ISO 3166). */
export const PAYS_PAR_DEFAUT = 'ci';

/** Au-dela, la liste se retelecharge au demarrage. */
const AGE_MAX_MS = 7 * 24 * 3600 * 1000;

export function urlCalendrier(pays = PAYS_PAR_DEFAUT) {
  return `https://calendar.google.com/calendar/ical/fr.${pays}%23holiday%40group.v.calendar.google.com/public/basic.ics`;
}

/** Une valeur d'un evenement iCalendar, lignes repliees recollees. */
function champ(bloc, nom) {
  const m = new RegExp(`^${nom}[^:\\n]*:(.*(?:\\n[ \\t].*)*)`, 'm').exec(bloc);
  return m ? m[1].replace(/\n[ \t]/g, '').replace(/\\,/g, ',').replace(/\\n/g, ' ').trim() : '';
}

const iso = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/**
 * Les jours feries d'un calendrier iCalendar : [{ date, nom }], tries.
 * Un evenement de plusieurs jours donne chacun de ses jours.
 */
export function lireCalendrier(texte) {
  const out = new Map();
  String(texte || '').replace(/\r\n/g, '\n').split('BEGIN:VEVENT').slice(1).forEach((bloc) => {
    const description = champ(bloc, 'DESCRIPTION');
    if (!/jour f[ée]ri[ée]|public holiday/i.test(description)) return;
    const debut = /DTSTART[^:\n]*:(\d{8})/.exec(bloc);
    if (!debut) return;
    const fin = /DTEND[^:\n]*:(\d{8})/.exec(bloc);
    const nom = champ(bloc, 'SUMMARY');
    const a = new Date(`${iso(debut[1])}T00:00:00Z`).getTime();
    const b = fin ? new Date(`${iso(fin[1])}T00:00:00Z`).getTime() : a + 86400000;
    for (let t = a; t < Math.max(b, a + 86400000); t += 86400000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (!out.has(d)) out.set(d, nom);
    }
  });
  return [...out.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([date, nom]) => ({ date, nom }));
}

/** La liste rangee dans les reglages, ou null. */
export function feriesTelecharges(db = DB) {
  const f = db && db.settings && db.settings.feriesInternet;
  return f && Array.isArray(f.jours) ? f : null;
}

async function lireTexte(pays) {
  const bureau = typeof window !== 'undefined' && window.pduDesktop;
  if (bureau && bureau.calendrierFeries) return bureau.calendrierFeries(pays);
  const r = await fetch(urlCalendrier(pays));
  if (!r.ok) throw new Error(`calendrier indisponible (${r.status})`);
  return r.text();
}

/**
 * Telecharge le calendrier du pays et le range dans les reglages.
 * @returns {Promise<{date:string,nom:string}[]>}
 */
export async function telechargerFeries(pays = PAYS_PAR_DEFAUT) {
  const jours = lireCalendrier(await lireTexte(pays));
  if (!jours.length) throw new Error('calendrier vide');
  saveSettings({ feriesInternet: { pays, majLe: new Date().toISOString(), jours } });
  return jours;
}

/**
 * Au demarrage : retelecharge si la liste manque, a plus d'une semaine, ou
 * ne couvre pas l'annee en cours. Sans connexion, rien ne change.
 */
export function majFeriesAuDemarrage(maintenant = new Date()) {
  const f = feriesTelecharges();
  const annee = String(maintenant.getFullYear());
  const vieux = !f || !f.majLe || maintenant - new Date(f.majLe) > AGE_MAX_MS ||
    !f.jours.some((j) => j.date.startsWith(annee));
  if (!vieux) return Promise.resolve(null);
  return telechargerFeries((f && f.pays) || PAYS_PAR_DEFAUT).catch(() => null);
}
