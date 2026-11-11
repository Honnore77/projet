/* ===================================================================
   ENTRETIEN → PROGRAMME D'ENTRETIEN (voir core/programmesEntretien.js)

   Les passages au garage prevus : date, vehicule, type, travaux, garage.
   Le jour venu, « Entrer au garage » ouvre la fiche d'entretien deja
   remplie. L'entretien reste au tableau « en cours » tant que le vehicule
   est au garage, puis le quitte a sa sortie ; « Voir les entretiens
   réalisés » les retrouve. Un entretien dont la date est passee sans
   entree au garage reste au tableau, « en retard ».

   Les entretiens programmes figurent aussi au TABLEAU DE BORD → PROGRAMMES.
   =================================================================== */

import { DB, insert, update, remove, knownDrivers, nomsGarages, garageParNom, assurerGarage, vehicleByImmat } from '../../core/db.js';
import {
  TYPES_ENTRETIEN, etatProgrammeEntretien, programmesEntretienActifs, programmesEntretienRealises,
  prochaineRefEntretien, conflitsEntretien, ficheDuProgrammeEntretien
} from '../../core/programmesEntretien.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, num, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  champVehicule, autreImmat, card, toolbar, emptyState, openForm, confirmDialog, toast, statTile, dataTable, COLORS
} from '../components.js';
import { state, rerender, moduleColor, openVehicleSheet } from '../shell.js';
import { openFicheForm } from './maintenance.js';
import { miniBtn, echeance, celluleConflits } from './programmes.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsProgrammesEntretien } from '../../export/datasets.js';

const COULEUR = () => moduleColor('ENTRETIEN');

export function renderProgrammeEntretien(page) {
  const f = state.filters.programmesEntretien;
  page.appendChild(card(
    'PROGRAMME D’ENTRETIEN',
    'Les passages au garage prévus. Le jour venu, « Entrer au garage » ouvre la fiche d’entretien déjà remplie : ' +
      'l’entretien reste ici « en cours » tant que le véhicule est au garage, puis quitte le tableau à sa sortie. ' +
      'Un entretien dont la date est passée sans entrée au garage reste affiché « en retard ». ' +
      'Ce programme figure aussi au TABLEAU DE BORD → PROGRAMMES.',
    COULEUR()
  ));

  const actifs = programmesEntretienActifs();
  const realises = programmesEntretienRealises();
  const list = f.realises ? realises : actifs;
  const conflits = new Map(actifs.map((e) => [e.id, conflitsEntretien(e)]));
  const etats = actifs.map((e) => etatProgrammeEntretien(e));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Programmés', fmt(etats.filter((x) => x === 'à venir').length), 'entretiens à venir', COULEUR()));
  grid.appendChild(statTile('Au garage', fmt(etats.filter((x) => x === 'en cours').length), 'entretiens en cours', COLORS.orange));
  const retard = etats.filter((x) => x === 'en retard').length;
  grid.appendChild(statTile('En retard', fmt(retard), retard ? 'date passée, pas entré au garage' : 'aucun', retard ? COLORS.red : COLORS.green));
  const nb = [...conflits.values()].filter((c) => c.length).length;
  grid.appendChild(statTile('Conflits', fmt(nb), nb ? 'à revoir' : 'aucun', nb ? COLORS.red : COLORS.green));
  page.appendChild(grid);

  page.appendChild(toolbar([
    canWrite() && { label: '+ Nouvel entretien programmé', cls: 'addBtn', color: COULEUR(), write: true, onClick: () => openProgrammeEntretienForm(null) },
    { label: f.realises ? '← Entretiens programmés' : `Voir les entretiens réalisés (${realises.length})`, color: COLORS.grey,
      onClick: () => { f.realises = !f.realises; rerender(); } },
    { label: '⬇ Excel', color: '#1D6F42', onClick: () => doExport('excel', list, f.realises) },
    { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', list, f.realises) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', list, f.realises) }
  ]));

  if (!list.length) {
    page.appendChild(emptyState(f.realises ? 'Aucun entretien programmé n’a encore été réalisé.' : 'Aucun entretien programmé.'));
    return;
  }

  const headers = ['Réf.', 'Date prévue', 'Véhicule', 'Type', 'Travaux prévus', 'Garage', 'Km prévu', 'Responsable',
    'Échéance', 'Conflits', ''];
  const rows = list.map((e) => {
    const etat = etatProgrammeEntretien(e);
    const fiche = ficheDuProgrammeEntretien(e);
    const actions = [];
    if (fiche) actions.push(miniBtn(COLORS.blue, 'data-fiche', '→ Fiche', 'Ouvrir la fiche du véhicule (passage au garage)'));
    else if (canWrite()) actions.push(miniBtn(COLORS.orange, 'data-entrer data-write', 'Entrer au garage', 'Ouvrir la fiche d’entretien déjà remplie'));
    if (canWrite()) {
      actions.push(miniBtn('#008A3B', 'data-edit data-write', '✎', 'Modifier l’entretien programmé'));
      actions.push(miniBtn('#D32F2F', 'data-del data-write', '✕', 'Supprimer l’entretien programmé'));
    }
    return [
      `<b style="white-space:nowrap">${esc(e.ref || '')}</b>`,
      esc(dateFR(e.datePrevue)),
      e.immat ? `<a href="#" data-veh style="color:${COLORS.blue}">${esc(e.immat)}</a>${autreImmat(e.immat)}` : '',
      esc(e.type || ''),
      escLignes(e.travaux || ''),
      esc(e.garage || ''),
      `<span style="display:block;text-align:right">${e.kmPrevu === '' || e.kmPrevu === undefined ? '—' : fmt(e.kmPrevu)}</span>`,
      esc(e.responsable || ''),
      f.realises
        ? `réalisé${fiche && fiche.dateRetour ? ` <small>(sorti le ${esc(dateFR(fiche.dateRetour))})</small>` : ''}`
        : etat === 'en cours' && fiche
          ? `${echeance('en cours', e.datePrevue)}<br><small>au garage depuis le ${esc(dateFR(fiche.dateEntree))}</small>`
          : echeance(etat, e.datePrevue),
      f.realises ? '' : celluleConflits(conflits.get(e.id) || []),
      `<span style="white-space:nowrap">${actions.join(' ')}</span>`
    ];
  });

  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const e = list[i];
    tr.dataset.search = norm(`${e.ref} ${e.datePrevue} ${e.immat} ${e.type} ${e.travaux} ${e.garage} ${e.responsable} ${e.observations || ''}`);
    const veh = tr.querySelector('[data-veh]');
    if (veh) veh.onclick = (ev) => { ev.preventDefault(); openVehicleSheet(e.immat); };
    const fi = tr.querySelector('[data-fiche]');
    if (fi) fi.onclick = () => openVehicleSheet(e.immat);
    const en = tr.querySelector('[data-entrer]');
    if (en) en.onclick = () => entrerAuGarage(e);
    const ed = tr.querySelector('[data-edit]');
    if (ed) ed.onclick = () => openProgrammeEntretienForm(e);
    const del = tr.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (!(await confirmDialog({
          title: 'Supprimer l’entretien programmé',
          message: `Supprimer l’entretien programmé ${e.ref || ''} (${e.immat || '—'}, le ${dateFR(e.datePrevue) || '…'}) ?` +
            (ficheDuProgrammeEntretien(e) ? '\n\nLa fiche d’entretien déjà ouverte reste dans les fiches d’entretien.' : ''),
          okLabel: 'Supprimer', danger: true
        }))) return;
        remove('programmesEntretien', e.id);
        toast('Entretien programmé supprimé.', 'ok');
        rerender();
      };
    }
  }));
}

/** La fiche d'entretien, preremplie avec le programme ; il retient la fiche creee. */
function entrerAuGarage(e) {
  const v = vehicleByImmat(e.immat);
  // Une ligne par probleme, ouverte par un tiret, comme le champ Motif.
  const lignes = [e.type, ...String(e.travaux || '').split('\n')]
    .map((x) => String(x || '').replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  openFicheForm(null, e.immat, {
    titre: `Entrée au garage — depuis le programme ${e.ref || ''}`.trim(),
    preset: {
      marque: v ? v.marque : '',
      modele: v ? v.modele : '',
      dateEntree: todayISO(),
      motif: lignes.map((x) => `- ${x}`).join('\n'),
      conducteurEntree: e.responsable || '',
      garage: e.garage || ''
    },
    apresCreation: (fiche) => {
      update('programmesEntretien', e.id, { ficheId: fiche.id });
      rerender();
    }
  });
}

function champs(e = {}) {
  return [
    { key: 'ref', label: 'Référence', required: true, value: e.ref || prochaineRefEntretien(),
      hint: 'Proposée à la suite de la dernière ; modifiable' },
    { key: 'datePrevue', label: 'Date prévue', type: 'date', required: true, value: e.datePrevue },
    champVehicule('immat', 'Véhicule', e.immat, { required: true }),
    { key: 'type', label: 'Type d’entretien', type: 'selectAdd', value: e.type,
      options: [...new Set(TYPES_ENTRETIEN.concat((DB.programmesEntretien || []).map((x) => x.type).filter(Boolean)))],
      emptyLabel: '— choisir —', addLabel: 'Autre type' },
    { key: 'travaux', label: 'Travaux prévus', type: 'textarea', full: true, lignesTiret: true, value: e.travaux,
      hint: 'Une ligne par travail — Entrée ouvre la suivante avec un tiret' },
    { key: 'garage', label: 'Garage', type: 'selectAdd', value: e.garage,
      options: nomsGarages(), emptyLabel: '— choisir —', addLabel: 'Nouveau garage',
      hint: 'Un nouveau garage est ajouté à la sous-rubrique GARAGES' },
    { key: 'kmPrevu', label: 'Km prévu', type: 'nombre', value: e.kmPrevu,
      hint: 'Facultatif : le kilométrage auquel l’entretien est dû' },
    { key: 'responsable', label: 'Responsable / conducteur', value: e.responsable, list: knownDrivers(),
      hint: 'Celui qui conduira le véhicule au garage' },
    { key: 'observations', label: 'Observation', type: 'textarea', full: true, rows: 2, value: e.observations }
  ];
}

export function openProgrammeEntretienForm(e) {
  const isEdit = !!e;
  openForm({
    title: isEdit ? `Modifier l’entretien programmé ${e.ref || ''}` : 'Nouvel entretien programmé',
    fields: champs(e || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer l’entretien programmé',
    onSubmit: async (v) => {
      const ref = String(v.ref || '').trim().toUpperCase();
      if ((DB.programmesEntretien || []).some((x) => x.id !== (e && e.id) && norm(x.ref || '') === norm(ref))) {
        return `La référence ${ref} est déjà attribuée à un autre entretien programmé.`;
      }
      const connu = garageParNom(v.garage);
      const payload = {
        ref,
        datePrevue: v.datePrevue,
        immat: String(v.immat || '').trim().toUpperCase(),
        type: String(v.type || '').trim(),
        travaux: v.travaux,
        garage: connu ? connu.nom : String(v.garage || '').trim(),
        kmPrevu: v.kmPrevu === '' || v.kmPrevu === undefined ? '' : num(v.kmPrevu),
        responsable: String(v.responsable || '').trim(),
        observations: v.observations
      };
      const conflits = conflitsEntretien(Object.assign({ id: e && e.id, ficheId: e && e.ficheId }, payload));
      if (conflits.length) {
        const ok = await confirmDialog({
          title: 'Conflit dans le programme d’entretien',
          message: conflits.map((c) => `• ${c}`).join('\n') + '\n\nEnregistrer quand même ?',
          okLabel: 'Enregistrer quand même'
        });
        if (!ok) return false;
      }
      assurerGarage(payload.garage);
      if (isEdit) update('programmesEntretien', e.id, payload);
      else insert('programmesEntretien', Object.assign({ createdAt: new Date().toISOString(), ficheId: '' }, payload));
      toast(isEdit ? 'Entretien programmé mis à jour.' : `Entretien programmé ${ref} enregistré.`, 'ok');
      rerender();
      return null;
    }
  });
}

async function doExport(kind, list, realises) {
  try {
    const datasets = [dsProgrammesEntretien(list)];
    const name = realises ? 'PDU_entretiens_realises' : 'PDU_programme_entretien';
    const titre = realises ? 'Entretiens programmés réalisés' : 'Programme d’entretien';
    const res = kind === 'excel'
      ? await exportExcel(datasets, name)
      : kind === 'word'
        ? await exportWord(datasets, name, { title: titre })
        : await exportPdf(datasets, name, { title: titre });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (err) {
    console.error(err);
    toast("L'export a échoué.", 'err');
  }
}
