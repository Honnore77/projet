/* ===================================================================
   MISSION — ordres de mission, cumuls par conducteur et paiement.
   =================================================================== */

import { DB, insert, update, remove, knownImmats, knownDrivers } from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO, daysBetween, sum, groupBy } from '../../core/utils.js';
import {
  card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast,
  statTile, dataTable, COLORS
} from '../components.js';
import { state, rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsMissions, dsMissionsParConducteur } from '../../export/datasets.js';

function missionFields(m = {}) {
  return [
    { key: 'ref', label: 'Référence (ex : M-002)', required: true, value: m.ref || suggestRef() },
    { key: 'conducteur', label: 'Conducteur', required: true, value: m.conducteur, list: knownDrivers() },
    { key: 'vehicule', label: 'Véhicule (immatriculation)', value: m.vehicule, list: knownImmats() },
    { key: 'destination', label: 'Destination', value: m.destination },
    { key: 'objet', label: 'Objet de la mission', full: true, value: m.objet },
    { key: 'dateDepart', label: 'Date départ', type: 'date', value: m.dateDepart || todayISO() },
    { key: 'dateRetour', label: 'Date retour', type: 'date', value: m.dateRetour },
    { key: 'jours', label: 'Nombre de jours', type: 'static', value: m.jours },
    { key: 'montant', label: 'Montant des frais (F)', type: 'number', value: m.montant },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: m.observations }
  ];
}

function suggestRef() {
  const nums = DB.missions
    .map((m) => /(\d+)\s*$/.exec(String(m.ref || '')))
    .filter(Boolean)
    .map((x) => Number(x[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `M-${String(next).padStart(3, '0')}`;
}

export function renderMissions(page) {
  const f = state.filters.missions;

  page.appendChild(
    card('MISSION', 'Référence · Conducteur · Véhicule · Destination · Période · Nombre de jours · Cumuls par conducteur · Paiement.', COLORS.purple)
  );

  page.appendChild(
    filterBar([
      { type: 'text', placeholder: 'Conducteur', value: f.conducteur, onChange: (v) => { f.conducteur = v; rerender(); } },
      { type: 'date', title: 'Départ à partir du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
      { type: 'date', title: 'Départ jusqu’au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
      {
        type: 'select',
        value: f.paiement,
        options: [
          { value: '', label: 'Tous les paiements' },
          { value: 'non', label: 'Non payées' },
          { value: 'oui', label: 'Payées' }
        ],
        onChange: (v) => { f.paiement = v; rerender(); }
      }
    ])
  );

  let list = DB.missions.slice();
  if (f.conducteur) list = list.filter((m) => norm(m.conducteur || '').includes(norm(f.conducteur)));
  if (f.dateFrom) list = list.filter((m) => !m.dateDepart || m.dateDepart >= f.dateFrom);
  if (f.dateTo) list = list.filter((m) => !m.dateDepart || m.dateDepart <= f.dateTo);
  if (f.paiement === 'oui') list = list.filter((m) => m.paye);
  if (f.paiement === 'non') list = list.filter((m) => !m.paye);
  list.sort((a, b) => String(b.dateDepart).localeCompare(String(a.dateDepart)));

  const nbCond = groupBy(DB.missions, (m) => m.conducteur || '—');
  const joursCond = {};
  Object.keys(nbCond).forEach((k) => { joursCond[k] = sum(nbCond[k], (m) => m.jours); });

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Missions', fmt(list.length), 'sur la période filtrée', COLORS.purple));
  grid.appendChild(statTile('Jours cumulés', fmt(sum(list, (m) => m.jours)), 'toutes missions filtrées', COLORS.blue));
  grid.appendChild(statTile('Non payées', fmt(list.filter((m) => !m.paye).length), 'à régler', COLORS.red));
  grid.appendChild(statTile('Conducteurs', fmt(Object.keys(nbCond).length), 'ayant effectué une mission', COLORS.green));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Ajouter une mission', cls: 'addBtn', color: COLORS.purple, write: true, onClick: () => openMissionForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.missions.length ? 'Aucune mission ne correspond aux filtres.' : 'Aucune mission enregistrée.'));
    return;
  }

  const headers = [
    'Réf', 'Conducteur', 'Nb missions<br>conducteur', 'Véhicule', 'Destination',
    'Période', 'Jours', 'Total jours<br>conducteur', 'Frais', 'Paiement', ''
  ];

  const rows = list.map((m) => {
    const key = m.conducteur || '—';
    const paiement = m.paye
      ? `🟢 Payée${m.datePaiement ? `<br><small>${esc(m.datePaiement)}</small>` : ''}`
      : canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green}" data-pay data-write>🔴 Marquer payée</button>`
        : '🔴 Non payée';
    return [
      `<b>${esc(m.ref)}</b>`,
      esc(m.conducteur),
      `<span style="display:block;text-align:center">${(nbCond[key] || []).length}</span>`,
      m.vehicule ? `<a href="#" data-veh style="color:${COLORS.blue}">${esc(m.vehicule)}</a>` : '',
      esc(m.destination || '') + (m.objet ? `<br><small>${esc(m.objet)}</small>` : ''),
      `${esc(dateFR(m.dateDepart))}<br>→ ${esc(dateFR(m.dateRetour) || '…')}`,
      `<span style="display:block;text-align:center">${esc(m.jours === '' || m.jours === undefined ? '—' : m.jours)}</span>`,
      `<span style="display:block;text-align:center">${fmt(joursCond[key] || 0)}</span>`,
      m.montant ? `${fmt(m.montant)} F` : '',
      paiement,
      canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const m = list[i];
      tr.dataset.search = norm(`${m.ref} ${m.conducteur} ${m.destination} ${m.vehicule} ${m.objet || ''}`);

      const vehLink = tr.querySelector('[data-veh]');
      if (vehLink) vehLink.onclick = (ev) => { ev.preventDefault(); openVehicleSheet(m.vehicule); };

      const pay = tr.querySelector('[data-pay]');
      if (pay) pay.onclick = () => openPaymentForm(m);

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openMissionForm(m);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({ title: 'Supprimer la mission', message: `Supprimer la mission ${m.ref} (${m.conducteur}) ?`, okLabel: 'Supprimer', danger: true }))) return;
          remove('missions', m.id);
          toast('Mission supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

export function openMissionForm(m) {
  const isEdit = !!m;
  openForm({
    title: isEdit ? `Modifier la mission ${m.ref}` : 'Nouvelle mission',
    fields: missionFields(m || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la mission',
    onInput: (values, scope) => {
      const j = daysBetween(values.dateDepart, values.dateRetour);
      const node = scope.querySelector('[data-key="jours"]');
      if (node) node.value = j === null ? '—' : `${j} j`;
    },
    onSubmit: (values) => {
      const jours = daysBetween(values.dateDepart, values.dateRetour);
      if (jours !== null && jours < 0) return 'La date de retour est antérieure à la date de départ.';
      const doublon = DB.missions.find(
        (x) => x.id !== (m && m.id) && norm(x.ref) === norm(values.ref)
      );
      if (doublon) return `La référence ${values.ref} existe déjà.`;

      const payload = {
        ref: values.ref,
        conducteur: values.conducteur,
        vehicule: String(values.vehicule || '').trim().toUpperCase(),
        destination: values.destination,
        objet: values.objet,
        dateDepart: values.dateDepart,
        dateRetour: values.dateRetour,
        jours: jours === null ? '' : jours,
        montant: num(values.montant),
        observations: values.observations
      };
      if (isEdit) update('missions', m.id, payload);
      else insert('missions', Object.assign({ paye: false, datePaiement: '' }, payload));
      toast(isEdit ? 'Mission mise à jour.' : 'Mission enregistrée.', 'ok');
      rerender();
      return null;
    }
  });
}

function openPaymentForm(m) {
  openForm({
    title: `Paiement — mission ${m.ref}`,
    intro: `Conducteur : ${m.conducteur} · ${m.jours || 0} jour(s)`,
    fields: [
      { key: 'datePaiement', label: 'Date de paiement', type: 'date', required: true, value: todayISO() },
      { key: 'montant', label: 'Montant versé (F)', type: 'number', value: m.montant },
      { key: 'referencePaiement', label: 'Référence du paiement', value: m.referencePaiement }
    ],
    okLabel: 'Confirmer le paiement',
    onSubmit: (values) => {
      update('missions', m.id, {
        paye: true,
        datePaiement: dateFR(values.datePaiement),
        datePaiementISO: values.datePaiement,
        montant: num(values.montant),
        referencePaiement: values.referencePaiement
      });
      toast('Mission marquée comme payée.', 'ok');
      rerender();
      return null;
    }
  });
}

async function doExport(kind, list) {
  try {
    const datasets = [dsMissions(list), dsMissionsParConducteur(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_missions')
      : await exportPdf(datasets, 'PDU_missions', { title: 'Missions et paiements' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
