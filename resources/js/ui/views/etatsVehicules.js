/* ===================================================================
   VÉHICULES → ÉTAT DES VÉHICULES : les problemes constates sur les
   vehicules, du signalement a la resolution.

   Tableau : immatriculation, probleme constate, date du signalement,
   signale par, signale a, probleme resolu, date de resolution.

   Un probleme non resolu s'affiche aussi dans la colonne « État du
   véhicule » des tableaux POOL, MISSION et SERVICE.
   =================================================================== */

import { DB, insert, update, remove, allVehicles, immatOf, nomsUtilisateurs, vehiculesDeLAgent } from '../../core/db.js';
import { canWrite, currentUser } from '../../core/auth.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO } from '../../core/utils.js';
import { card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast, statTile, dataTable, COLORS } from '../components.js';
import { state, rerender } from '../shell.js';
import { estResolu, refusSignalement } from '../../core/etatsVehicules.js';
import { voitTout, seulementSiennes, agentConnecte } from '../../core/acces.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';

export const COULEUR_ETAT = '#E65100';

const filtres = { etat: '', immat: '' };

const cle = (immat) => norm(immat || '').replace(/\s+/g, '');

/** Le vehicule du parc qui porte cette immatriculation, s'il existe. */
function vehiculeDe(immat) {
  const c = cle(immat);
  return c ? allVehicles().find((v) => [v.immatNouvelle, v.immatAncienne].some((p) => cle(p) === c)) || null : null;
}

/** D'ou vient un signalement : « Rapport de mission M-004 », « Dotation pool du 03/08/2026 »… ('' : saisi ici). */
function origine(s) {
  if (s.origineLibelle) return s.origineLibelle;
  return s.missionId ? `Rapport de mission ${s.missionRef || ''}`.trim() : '';
}

/** Ce que le compte peut voir : tout, ou les problemes de ses vehicules. */
function visibles() {
  const tous = (DB.etatsVehicules || []).slice();
  if (voitTout('VEHICULES')) return tous;
  if (!seulementSiennes('VEHICULES')) return [];
  const siens = vehiculesDeLAgent(agentConnecte()).flatMap((v) => [v.immatNouvelle, v.immatAncienne]).map(cle).filter(Boolean);
  return tous.filter((s) => siens.includes(cle(s.immat)));
}

export function renderEtatsVehicules(page) {
  const f = filtres;
  page.appendChild(card(
    'ÉTAT DES VÉHICULES',
    'Les problèmes constatés sur les véhicules : qui les a signalés, à qui, et quand ils ont été résolus. ' +
      'Les observations notées ailleurs s’y ajoutent d’elles-mêmes : rapport de mission, dotation, entrée et retour du garage, incident, fiche du véhicule. ' +
      'Tant qu’un problème n’est pas résolu, il s’affiche dans la colonne « État actuel du véhicule » des tableaux POOL, MISSION et SERVICE.',
    COULEUR_ETAT
  ));

  const tous = visibles();
  const enCours = tous.filter((s) => !estResolu(s));
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('En cours', fmt(enCours.length), 'problèmes non résolus', COLORS.red));
  grid.appendChild(statTile('Résolus', fmt(tous.length - enCours.length), 'problèmes réglés', COLORS.green));
  grid.appendChild(statTile('Véhicules concernés', fmt(new Set(enCours.map((s) => cle(s.immat))).size), 'avec un problème en cours', COULEUR_ETAT));
  page.appendChild(grid);

  const immats = [...new Set(tous.map((s) => s.immat).filter(Boolean))].sort();
  page.appendChild(filterBar([
    {
      type: 'select', value: f.etat, onChange: (v) => { f.etat = v; rerender(); },
      options: [{ value: '', label: 'Tous les problèmes' }, { value: 'encours', label: 'En cours' }, { value: 'resolus', label: 'Résolus' }]
    },
    {
      type: 'select', value: f.immat, onChange: (v) => { f.immat = v; rerender(); },
      options: [{ value: '', label: 'Tous les véhicules' }].concat(immats)
    }
  ]));

  let list = tous;
  if (f.etat === 'encours') list = list.filter((s) => !estResolu(s));
  if (f.etat === 'resolus') list = list.filter(estResolu);
  if (f.immat) list = list.filter((s) => cle(s.immat) === cle(f.immat));
  // Les problemes en cours d'abord, puis les plus recents.
  list.sort((a, b) => (estResolu(a) - estResolu(b))
    || String(b.dateSignalement || '').localeCompare(String(a.dateSignalement || '')));

  page.appendChild(toolbar([
    canWrite() && { label: '+ Signaler un problème', cls: 'addBtn', color: COULEUR_ETAT, write: true, onClick: () => ouvrirSignalement(null) },
    { label: '⬇ Excel', color: COLORS.blue, onClick: () => exporter('excel', list) },
    { label: '⬇ PDF', color: COLORS.red, onClick: () => exporter('pdf', list) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => exporter('word', list) }
  ]));

  if (!list.length) {
    page.appendChild(emptyState(tous.length ? 'Aucun problème ne correspond aux filtres.' : 'Aucun problème signalé pour l’instant.'));
    return;
  }

  const headers = [
    'Immatriculation', 'Problème constaté', 'Date du<br>signalement', 'Signalé par', 'Signalé à',
    'Problème<br>résolu', 'Date de<br>résolution', ''
  ];
  const rows = list.map((s) => {
    const v = vehiculeDe(s.immat);
    return [
      `<b style="white-space:nowrap">${esc(s.immat || '')}</b>` +
        (v ? `<br><small style="color:#5b7178">${esc(`${v.marque || ''} ${v.modele || ''}`.trim())}</small>` : ''),
      escLignes(s.probleme || '') +
        (origine(s) ? `<br><small style="color:${COULEUR_ETAT}">via ${esc(origine(s))}</small>` : ''),
      esc(dateFR(s.dateSignalement)),
      esc(s.signalePar || ''),
      esc(s.signaleA || ''),
      estResolu(s)
        ? `<span class="badge" style="background:${COLORS.green}">Oui</span>`
        : `<span class="badge" style="background:${COLORS.red}">Non</span>`,
      esc(dateFR(s.dateResolution)),
      canWrite()
        ? (estResolu(s) ? '' : `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-resolu data-write title="Marquer comme résolu aujourd’hui">✓ Résolu</button> `) +
          `<button class="miniBtn" style="background:#008A3B;padding:5px 8px" data-edit data-write>✎</button>` +
          // Un signalement venu d'ailleurs reviendrait au prochain
          // enregistrement : il se retire a sa source, ou se dit resolu.
          (origine(s) ? '' : ` <button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`)
        : ''
    ];
  });

  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const s = list[i];
    tr.dataset.search = norm(`${s.immat} ${s.probleme} ${s.signalePar} ${s.signaleA} ${estResolu(s) ? 'résolu' : 'en cours'}`);
    const ed = tr.querySelector('[data-edit]');
    if (ed) ed.onclick = () => ouvrirSignalement(s);
    const ok = tr.querySelector('[data-resolu]');
    if (ok) {
      ok.onclick = () => {
        update('etatsVehicules', s.id, { resolu: 'Oui', dateResolution: todayISO() });
        toast(`Problème du ${s.immat} marqué comme résolu.`, 'ok');
        rerender();
      };
    }
    const del = tr.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (!(await confirmDialog({
          title: 'Supprimer le signalement',
          message: `Supprimer le problème signalé sur ${s.immat || '—'} le ${dateFR(s.dateSignalement)} ?`,
          okLabel: 'Supprimer', danger: true
        }))) return;
        remove('etatsVehicules', s.id);
        toast('Signalement supprimé.', 'ok');
        rerender();
      };
    }
  }));
}

/** Noms deja saisis dans un champ, ajoutes aux agents. */
function nomsProposes(champ) {
  const deja = (DB.etatsVehicules || []).map((s) => s[champ]).filter(Boolean);
  return [...new Set(nomsUtilisateurs().concat(deja))].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Formulaire : signaler un probleme, ou modifier un signalement. */
export function ouvrirSignalement(s, depart = {}) {
  const moi = currentUser();
  const vehicules = allVehicles()
    .filter((v) => immatOf(v))
    .map((v) => ({ value: immatOf(v), label: `${immatOf(v)} — ${`${v.marque || ''} ${v.modele || ''}`.trim()}` }))
    .sort((a, b) => a.value.localeCompare(b.value));
  const x = s || {};
  // Venu d'ailleurs, le vehicule et le probleme se corrigent a la source.
  const source = origine(x);
  const fields = [
    source
      ? { key: 'immat', label: 'Immatriculation du véhicule', type: 'static', value: x.immat }
      : { key: 'immat', label: 'Immatriculation du véhicule', type: 'selectAdd', required: true, value: x.immat || depart.immat,
        options: vehicules, emptyLabel: '— choisir —', addLabel: 'Autre immatriculation' },
    { key: 'dateSignalement', label: 'Date du signalement', type: 'date', required: true, value: x.dateSignalement || todayISO() },
    { key: 'probleme', label: 'Problème constaté', type: 'textarea', required: true, full: true, rows: 3, value: x.probleme,
      readonly: !!source,
      hint: source ? `Vient de : ${source}. Pour le changer, modifiez-le là-bas.` : 'Ex. bruit au freinage, pneu avant gauche usé, voyant moteur allumé' },
    { key: 'signalePar', label: 'Signalé par', type: 'selectAdd', required: true,
      value: x.signalePar || (moi && (agentConnecte() || moi.nom)) || '',
      options: nomsProposes('signalePar'), emptyLabel: '— choisir —', addLabel: 'Autre nom' },
    { key: 'signaleA', label: 'Signalé à', type: 'selectAdd', value: x.signaleA,
      options: nomsProposes('signaleA'), emptyLabel: '— choisir —', addLabel: 'Autre destinataire',
      hint: 'La personne informée du problème : chef du parc, responsable, garage…' },
    { key: 'resolu', label: 'Problème résolu', type: 'select', options: ['Non', 'Oui'], value: x.resolu || 'Non' },
    { key: 'dateResolution', label: 'Date de résolution du problème', type: 'date', value: x.dateResolution,
      hint: 'À remplir quand le problème est résolu' }
  ];

  openForm({
    title: s ? `MODIFIER LE SIGNALEMENT — ${s.immat || ''}` : 'SIGNALER UN PROBLÈME',
    okLabel: s ? 'Enregistrer' : 'Signaler',
    fields,
    onInput: (v, scope) => {
      // Un probleme qu'on dit resolu prend la date du jour, si elle manque.
      const date = scope.querySelector('[data-key="dateResolution"]');
      if (v.resolu === 'Oui' && date && !date.value) date.value = todayISO();
    },
    onSubmit: (v) => {
      const fiche = {
        immat: String(v.immat || '').trim().toUpperCase(),
        probleme: v.probleme,
        dateSignalement: v.dateSignalement,
        signalePar: v.signalePar,
        signaleA: v.signaleA,
        resolu: v.resolu === 'Oui' ? 'Oui' : 'Non',
        dateResolution: v.resolu === 'Oui' ? v.dateResolution : ''
      };
      const refus = refusSignalement(fiche);
      if (refus) return refus;
      if (s) {
        update('etatsVehicules', s.id, fiche);
        toast('Signalement modifié.', 'ok');
      } else {
        insert('etatsVehicules', fiche);
        toast(`Problème signalé sur ${fiche.immat}.`, 'ok');
      }
      state.sub.VEHICULES = 'etat';
      rerender();
      return null;
    }
  });
}

/** Le jeu de donnees exporte : les memes colonnes que le tableau. */
export function dsEtatsVehicules(list) {
  const C = (key, label, width) => ({ key, label, width });
  return {
    title: 'État des véhicules',
    columns: [
      C('immat', 'Immatriculation', 16), C('vehicule', 'Véhicule', 18), C('probleme', 'Problème constaté', 40),
      C('dateSignalement', 'Date du signalement', 14), C('signalePar', 'Signalé par', 20), C('signaleA', 'Signalé à', 20),
      C('resolu', 'Problème résolu', 12), C('dateResolution', 'Date de résolution', 14), C('origine', 'Origine', 24)
    ],
    rows: list.map((s) => {
      const v = vehiculeDe(s.immat);
      return {
        immat: s.immat || '',
        vehicule: v ? `${v.marque || ''} ${v.modele || ''}`.trim() : '',
        probleme: s.probleme || '',
        dateSignalement: dateFR(s.dateSignalement),
        signalePar: s.signalePar || '',
        signaleA: s.signaleA || '',
        resolu: estResolu(s) ? 'Oui' : 'Non',
        dateResolution: dateFR(s.dateResolution),
        origine: origine(s) || 'saisi dans ÉTAT DES VÉHICULES'
      };
    })
  };
}

async function exporter(kind, list) {
  const ds = dsEtatsVehicules(list);
  try {
    const res = kind === 'excel'
      ? await exportExcel([ds], 'PDU_etat_des_vehicules')
      : kind === 'word'
        ? await exportWord([ds], 'PDU_etat_des_vehicules', { title: 'État des véhicules' })
        : await exportPdf([ds], 'PDU_etat_des_vehicules', { title: 'État des véhicules' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
