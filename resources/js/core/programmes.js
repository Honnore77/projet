/* ===================================================================
   PROGRAMMES — ce qui est prevu.

   MISSIONS → PROGRAMMES DES MISSIONS (collection `programmes`) : les
   missions a venir, inscrites avant le depart. Un programme n'est qu'une
   prevision : il ne compte ni dans le tour de role, ni dans les jours, ni
   dans le cumul des missions. Il quitte le tableau des programmes :
     - quand la mission est creee depuis lui (bouton « Créer la mission ») :
       il est alors « réalisé » et retient la mission (missionId) ;
     - quand sa date de retour est passee sans mission : il est « passé » ;
     - quand il est annule : il passe au tableau « MISSIONS ANNULÉES »,
       qui en garde l'historique (date, motif, auteur de l'annulation).
   Rien ne s'efface : les programmes passes et realises se retrouvent.

   Les missions en cours (SUIVI DES MISSIONS, parties et pas encore
   revenues : depart passe, retour aujourd'hui ou plus tard) figurent aussi
   aux deux tableaux, avec la mention « en cours » ; elles en sortent le
   lendemain de leur date de retour.

   TABLEAU DE BORD → PROGRAMMES : les missions programmees et les conges et
   absences a venir ou en cours (PERSONNEL → CONGÉS ET ABSENCES), dans un
   seul tableau trie par date, avec les conflits : un agent programme en
   mission pendant son absence, un vehicule pris deux fois ou au garage.
   =================================================================== */

import { DB, indisponibiliteSurMission, absenceRefusee, etatIndisponibilite, memeVehicule, texteDestinations, destinationsDe } from './db.js';
import { norm, todayISO } from './utils.js';
import { programmeEntretienActif, etatProgrammeEntretien, conflitsEntretien } from './programmesEntretien.js';

/** Le dernier jour d'un programme (le depart s'il n'a pas de retour). */
const fin = (p) => p.dateRetour || p.dateDepart || '';

/** La mission creee depuis le programme, si elle existe encore. */
export function missionDuProgramme(p, db = DB) {
  return (p && p.missionId && (db.missions || []).find((m) => m.id === p.missionId)) || null;
}

/**
 * Ou en est un programme.
 * @returns {'à venir'|'en cours'|'réalisé'|'passé'}
 */
export function etatProgramme(p, jour = todayISO(), db = DB) {
  if (p && p.annule) return 'annulé';
  if (missionDuProgramme(p, db)) return 'réalisé';
  if (fin(p) && fin(p) < jour) return 'passé';
  if (p.dateDepart && p.dateDepart <= jour) return 'en cours';
  return 'à venir';
}

/** Un programme encore au tableau : a venir ou en cours. */
export function programmeActif(p, jour = todayISO(), db = DB) {
  const e = etatProgramme(p, jour, db);
  return e === 'à venir' || e === 'en cours';
}

const parDate = (a, b) =>
  String(a.dateDepart || '').localeCompare(String(b.dateDepart || '')) ||
  String(a.ref || '').localeCompare(String(b.ref || ''), 'fr', { numeric: true });

/** Les programmes au tableau, du plus proche au plus lointain. */
export function programmesActifs(jour = todayISO(), db = DB) {
  return (db.programmes || []).filter((p) => programmeActif(p, jour, db)).sort(parDate);
}

/** Les programmes sortis du tableau (realises ou passes), du plus recent au plus ancien. */
export function programmesPasses(jour = todayISO(), db = DB) {
  return (db.programmes || []).filter((p) => !p.annule && !programmeActif(p, jour, db)).sort((a, b) => parDate(b, a));
}

/** Les programmes annules, le plus recemment annule en tete. */
export function programmesAnnules(db = DB) {
  return (db.programmes || []).filter((p) => p.annule).sort((a, b) =>
    String(b.dateAnnulation || '').localeCompare(String(a.dateAnnulation || '')) || parDate(b, a));
}

/**
 * Une mission en cours : partie (depart aujourd'hui ou avant) et pas encore
 * revenue (retour aujourd'hui ou plus tard). Sans date de retour, elle n'est
 * en cours que le jour de son depart. Le lendemain du retour, elle est achevee.
 */
export function missionEnCours(m, jour = todayISO()) {
  if (!m || !m.dateDepart || m.dateDepart > jour) return false;
  return (m.dateRetour || m.dateDepart) >= jour;
}

/** Les missions en cours, du depart le plus ancien au plus recent. */
export function missionsEnCours(jour = todayISO(), db = DB) {
  return (db.missions || []).filter((m) => missionEnCours(m, jour)).sort(parDate);
}

/** Le programme d'ou vient une mission (« Créer la mission »), s'il existe. */
export function programmeDeLaMission(m, db = DB) {
  return (m && (db.programmes || []).find((p) => p.missionId && p.missionId === m.id)) || null;
}

/** La mission en cours d'un agent (conducteur ou participant), s'il y en a une. */
export function missionEnCoursDe(nom, jour = todayISO(), db = DB) {
  const cle = norm(nom || '');
  if (!cle) return null;
  return missionsEnCours(jour, db).find((m) => agentsDuProgramme(m).some((n) => norm(n) === cle)) || null;
}

/** Prochaine reference : PM-001, PM-002... a la suite de la plus haute. */
export function prochaineRefProgramme(db = DB) {
  const max = (db.programmes || []).reduce((m, p) => {
    const r = /(\d+)\s*$/.exec(String(p.ref || ''));
    return r ? Math.max(m, Number(r[1])) : m;
  }, 0);
  return `PM-${String(max + 1).padStart(3, '0')}`;
}

/** Deux periodes [a1, b1] et [a2, b2] (jours compris) se recouvrent-elles ? */
function recouvre(a1, b1, a2, b2) {
  if (!a1 || !a2) return false;
  return a1 <= (b2 || a2) && a2 <= (b1 || a1);
}

/** Les agents d'un programme : le conducteur puis les participants. */
export function agentsDuProgramme(p) {
  return [p.conducteur, ...(p.participants || [])].map((x) => String(x || '').trim()).filter(Boolean);
}

/**
 * Ce qui empeche ou gene un programme, en phrases : un agent indisponible
 * sur ses dates, un agent ou un vehicule deja pris par une autre mission ou
 * un autre programme, un vehicule au garage.
 * @returns {string[]}
 */
export function conflitsProgramme(p, db = DB, jour = todayISO()) {
  if (!p || !p.dateDepart) return [];
  const out = [];
  const du = p.dateDepart, au = fin(p);

  agentsDuProgramme(p).forEach((agent) => {
    // L'indisponibilite court jusqu'a la veille de la reprise.
    const i = indisponibiliteSurMission(agent, du, au, db);
    if (i) {
      out.push(`${agent} est indisponible (${i.motif || 'absent'}) du ${fr(i.dateDepart)}` +
        `${i.dateReprise ? ` à sa reprise le ${fr(i.dateReprise)}` : ''}.`);
    }
  });

  const autres = (db.programmes || [])
    .filter((x) => x.id !== p.id && programmeActif(x, jour, db) && recouvre(du, au, x.dateDepart, fin(x)))
    .map((x) => ({ quoi: `le programme ${x.ref || ''}`.trim(), x }))
    .concat((db.missions || [])
      .filter((m) => m.id !== p.missionId && recouvre(du, au, m.dateDepart, m.dateRetour))
      .map((m) => ({ quoi: `la mission ${m.ref || ''}`.trim(), x: m })));

  agentsDuProgramme(p).forEach((agent) => {
    const pris = autres.find(({ x }) => agentsDuProgramme(x).some((n) => norm(n) === norm(agent)));
    if (pris) out.push(`${agent} est déjà sur ${pris.quoi} (${periode(pris.x)}).`);
  });
  if (p.vehicule) {
    const pris = autres.find(({ x }) => x.vehicule && memeVehicule(x.vehicule, p.vehicule));
    if (pris) out.push(`Le véhicule ${p.vehicule} est déjà pris par ${pris.quoi} (${periode(pris.x)}).`);
    const prevu = (db.programmesEntretien || []).find((e) => e.immat && memeVehicule(e.immat, p.vehicule) &&
      programmeEntretienActif(e, jour, db) && !e.ficheId && e.datePrevue && e.datePrevue >= du && e.datePrevue <= au);
    if (prevu) out.push(`Le véhicule ${p.vehicule} est programmé à l’entretien le ${fr(prevu.datePrevue)} (${prevu.ref || 'programme d’entretien'}).`);
    const garage = (db.maintenance || []).find((m) => m.immat && memeVehicule(m.immat, p.vehicule) &&
      m.dateEntree && m.dateEntree <= au && (!m.dateRetour || m.dateRetour >= du));
    if (garage) {
      out.push(`Le véhicule ${p.vehicule} est au garage${garage.garage ? ` (${garage.garage})` : ''} depuis le ${fr(garage.dateEntree)}` +
        `${garage.dateRetour ? `, retour le ${fr(garage.dateRetour)}` : ', sans date de retour'}.`);
    }
  }
  return [...new Set(out)];
}

function fr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}
function periode(x) {
  return x.dateRetour && x.dateRetour !== x.dateDepart ? `du ${fr(x.dateDepart)} au ${fr(x.dateRetour)}` : `le ${fr(x.dateDepart)}`;
}

/**
 * Le tableau PROGRAMMES du tableau de bord : missions programmees et
 * conges ou absences a venir ou en cours, tries par date de debut.
 * `avec` dit quelles sources le compte peut voir (et lesquelles fiches).
 * @returns {{type:string, etat:string, agents:string, du:string, au:string,
 *   detail:string, source:'programmes'|'indisponibilites', fiche:object, conflits:string[]}[]}
 */
export function agendaProgrammes({ programmes, indisponibilites, missions, entretiens } = {}, jour = todayISO(), db = DB) {
  const lignes = [];
  // Les missions parties et pas encore revenues : « en cours », jusqu'au
  // lendemain de leur retour.
  (missions || []).filter((m) => missionEnCours(m, jour)).forEach((m) => {
    const p = programmeDeLaMission(m, db);
    lignes.push({
      type: 'Mission', etat: 'en cours', agents: agentsDuProgramme(m).join(', '),
      du: m.dateDepart || '', au: m.dateRetour || '',
      detail: [m.ref, texteDestinations(destinationsDe(m)), p && p.objet].filter(Boolean).join(' — '),
      vehicule: m.vehicule || '',
      source: 'missions', fiche: m, conflits: []
    });
  });
  (entretiens || []).filter((e) => programmeEntretienActif(e, jour, db)).forEach((e) => {
    lignes.push({
      type: 'Entretien', etat: etatProgrammeEntretien(e, jour, db), agents: e.responsable || '',
      du: e.datePrevue || '', au: '',
      detail: [e.type, String(e.travaux || '').split('\n').map((x) => x.replace(/^\s*-\s*/, '').trim()).filter(Boolean).join(', '),
        e.garage ? `garage : ${e.garage}` : ''].filter(Boolean).join(' — '),
      vehicule: e.immat || '',
      source: 'programmesEntretien', fiche: e, conflits: conflitsEntretien(e, db, jour)
    });
  });
  (programmes || []).filter((p) => programmeActif(p, jour, db)).forEach((p) => {
    lignes.push({
      type: 'Mission', etat: etatProgramme(p, jour, db), agents: agentsDuProgramme(p).join(', '),
      du: p.dateDepart || '', au: p.dateRetour || '',
      detail: [texteDestinations(p.destinations || []), p.objet].filter(Boolean).join(' — '),
      vehicule: p.vehicule || '',
      source: 'programmes', fiche: p, conflits: conflitsProgramme(p, db, jour)
    });
  });
  (indisponibilites || []).forEach((i) => {
    if (absenceRefusee(i, db)) return;
    const e = etatIndisponibilite(i, jour, db);
    if (e !== 'à venir' && e !== 'en cours') return;
    // La reprise est le jour du retour au poste : l'absence finit la veille.
    lignes.push({
      type: i.motif === 'En congé' ? 'Congé' : 'Absence', etat: e, agents: i.conducteur || '',
      du: i.dateDepart || '', au: veille(i.dateReprise),
      detail: [i.motif, i.interimaire ? `intérim : ${i.interimaire}` : ''].filter(Boolean).join(' — '),
      vehicule: '',
      source: 'indisponibilites', fiche: i, conflits: []
    });
  });
  // Ce qui est en cours d'abord, puis le reste du plus proche au plus lointain.
  const rang = (l) => (l.etat === 'en cours' ? 0 : l.etat === 'en retard' ? 1 : 2);
  return lignes.sort((a, b) => rang(a) - rang(b) || a.du.localeCompare(b.du) || a.type.localeCompare(b.type, 'fr'));
}

function veille(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
