/* ===================================================================
   DOTATION — carburant du pool et dotations de mission
   (avec ravitaillements multiples).
   =================================================================== */

import { DB, ETATS_VIDANGE, insert, update, remove, knownImmats, knownDrivers, vehicleByImmat } from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO, sum } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast,
  statTile, subEmpty, COLORS
} from '../components.js';
import { state, rerender } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsDotationPool, dsDotationMission, dsRavitaillements } from '../../export/datasets.js';

const SUBS = [
  { key: 'pool', label: 'POOL' },
  { key: 'mission', label: 'MISSION' }
];

export function renderDotation(page) {
  const sub = state.sub.DOTATION || 'pool';
  page.appendChild(
    subtabs(
      SUBS.map((s) => ({ key: s.key, label: `${s.label} (${s.key === 'pool' ? DB.dotationPool.length : DB.dotationMission.length})` })),
      sub,
      (k) => { state.sub.DOTATION = k; rerender(); },
      { pool: COLORS.orange, mission: COLORS.orange }
    )
  );
  if (sub === 'pool') renderPool(page);
  else renderMission(page);
}

/* ============================== POOL ============================== */

function poolFields(d = {}) {
  return [
    { key: 'date', label: 'Date', type: 'date', required: true, value: d.date || todayISO() },
    { key: 'immat', label: 'Immatriculation', required: true, value: d.immat, list: knownImmats() },
    { key: 'marqueModele', label: 'Marque / Modèle', value: d.marqueModele, hint: 'Rempli automatiquement si le véhicule est connu' },
    { key: 'energie', label: 'Énergie', type: 'select', options: ['Essence', 'Diesel'], value: d.energie || 'Essence' },
    { key: 'km', label: 'Kilométrage', type: 'number', value: d.km },
    { key: 'quantite', label: 'Quantité (L)', type: 'number', required: true, value: d.quantite },
    { key: 'prixL', label: 'Prix / L', type: 'number', required: true, value: d.prixL },
    { key: 'montant', label: 'Montant calculé', type: 'static', value: d.montant ? fmt(d.montant) : '0' },
    { key: 'station', label: 'Station-service', value: d.station, list: [...new Set(DB.dotationPool.map((x) => x.station).filter(Boolean))] },
    { key: 'vidange', label: 'État vidange', type: 'select', options: ETATS_VIDANGE, value: d.vidange || 'A jour' },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: d.observations }
  ];
}

function renderPool(page) {
  const f = state.filters.dotationPool;
  page.appendChild(
    card('DOTATION POOL', 'Date · Immatriculation · Marque/Modèle · Énergie · Kilométrage · Quantité · Prix/L · Montant · Station-service · État vidange.', COLORS.orange)
  );

  page.appendChild(
    filterBar([
      { type: 'date', title: 'Du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
      { type: 'date', title: 'Au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
      { type: 'text', placeholder: 'Immatriculation', value: f.immat, onChange: (v) => { f.immat = v; rerender(); } }
    ])
  );

  let list = DB.dotationPool.slice();
  if (f.dateFrom) list = list.filter((d) => !d.date || d.date >= f.dateFrom);
  if (f.dateTo) list = list.filter((d) => !d.date || d.date <= f.dateTo);
  if (f.immat) list = list.filter((d) => norm(d.immat || '').includes(norm(f.immat)));
  list.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Dotations', fmt(list.length), 'sur la période filtrée', COLORS.orange));
  grid.appendChild(statTile('Litres', fmt(sum(list, (d) => d.quantite)), 'volume total', COLORS.blue));
  grid.appendChild(statTile('Montant', `${fmt(sum(list, (d) => d.montant))} F`, 'dépense carburant', COLORS.green));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Ajouter une dotation pool', cls: 'addBtn', color: COLORS.orange, write: true, onClick: () => openPoolForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', 'pool', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', 'pool', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.dotationPool.length ? 'Aucune dotation ne correspond aux filtres.' : 'Aucune dotation pool enregistrée.'));
    return;
  }

  list.forEach((d) => {
    const e = el('<div class="entry"></div>');
    e.style.borderLeftColor = d.vidange === 'En retard' ? COLORS.red : COLORS.orange;
    e.dataset.search = norm(`${d.immat} ${d.marqueModele} ${d.station} ${d.date}`);
    e.innerHTML =
      `<div class="row1"><h4>${esc(d.immat)}</h4><span class="badge" style="background:${COLORS.orange}">${fmt(d.montant)} F</span></div>` +
      `<div class="meta">${esc(dateFR(d.date))} · ${esc(d.marqueModele || '—')} · ${esc(d.energie || '—')}</div>` +
      `<div class="fields"><b>Quantité :</b> ${fmt(d.quantite)} L · <b>Prix/L :</b> ${fmt(d.prixL)} F<br>` +
      `<b>Station :</b> ${esc(d.station || '—')} · <b>Vidange :</b> ${esc(d.vidange || '—')} · <b>Km :</b> ${fmt(d.km)}` +
      (d.observations ? `<br><b>Observations :</b> ${esc(d.observations)}` : '') +
      '</div>' +
      '<div class="actions">' +
      (canWrite() ? `<button class="miniBtn" style="background:${COLORS.green}" data-edit data-write>✎ Modifier</button>` : '') +
      (canWrite() ? `<button class="miniBtn" style="background:${COLORS.red}" data-del data-write>Supprimer</button>` : '') +
      '</div>';
    const ed = e.querySelector('[data-edit]');
    if (ed) ed.onclick = () => openPoolForm(d);
    const del = e.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (!(await confirmDialog({ title: 'Supprimer la dotation', message: `Supprimer la dotation du ${dateFR(d.date)} pour ${d.immat} ?`, okLabel: 'Supprimer', danger: true }))) return;
        remove('dotationPool', d.id);
        toast('Dotation supprimée.', 'ok');
        rerender();
      };
    }
    page.appendChild(e);
  });
}

function openPoolForm(d) {
  const isEdit = !!d;
  const fields = poolFields(d || {});
  openForm({
    title: isEdit ? `Modifier la dotation — ${d.immat}` : 'Nouvelle dotation — POOL',
    fields,
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la dotation',
    onInput: (values, scope) => {
      const montant = num(values.quantite) * num(values.prixL);
      const mNode = scope.querySelector('[data-key="montant"]');
      if (mNode) mNode.value = `${fmt(montant)} F`;
      // pre-remplissage marque/modele depuis la fiche vehicule
      const mm = scope.querySelector('[data-key="marqueModele"]');
      if (mm && !mm.value && values.immat) {
        const v = vehicleByImmat(values.immat);
        if (v) mm.value = `${v.marque || ''} ${v.modele || ''}`.trim();
      }
    },
    onSubmit: (values) => {
      const payload = {
        date: values.date,
        immat: String(values.immat || '').trim().toUpperCase(),
        marqueModele: values.marqueModele,
        energie: values.energie,
        km: values.km,
        quantite: num(values.quantite),
        prixL: num(values.prixL),
        montant: num(values.quantite) * num(values.prixL),
        station: values.station,
        vidange: values.vidange,
        observations: values.observations
      };
      if (isEdit) update('dotationPool', d.id, payload);
      else insert('dotationPool', payload);
      toast(isEdit ? 'Dotation mise à jour.' : 'Dotation enregistrée.', 'ok');
      rerender();
      return null;
    }
  });
}

/* ============================= MISSION ============================ */

function missionDotFields(d = {}) {
  return [
    { key: 'conducteur', label: 'Conducteur', required: true, value: d.conducteur, list: knownDrivers() },
    { key: 'vehicule', label: 'Véhicule (immatriculation)', value: d.vehicule, list: knownImmats() },
    { key: 'destination', label: 'Destination', value: d.destination },
    { key: 'dateDepart', label: 'Date départ', type: 'date', value: d.dateDepart || todayISO() },
    { key: 'dateRetour', label: 'Date retour', type: 'date', value: d.dateRetour },
    { key: 'kmDepart', label: 'Km départ', type: 'number', value: d.kmDepart },
    { key: 'kmRetour', label: 'Km retour', type: 'number', value: d.kmRetour },
    { key: 'diff', label: 'Distance parcourue', type: 'static', value: d.diff ? fmt(d.diff) : '0' }
  ];
}

function renderMission(page) {
  const f = state.filters.dotationMission;
  page.appendChild(
    card('DOTATION MISSION', 'Conducteur · Destination · Dates et kilométrages · Ravitaillements multiples dans différentes stations-service. Totaux litres et montants calculés automatiquement.', COLORS.orange)
  );

  page.appendChild(
    filterBar([
      { type: 'date', title: 'Du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
      { type: 'date', title: 'Au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
      { type: 'text', placeholder: 'Conducteur', value: f.conducteur, onChange: (v) => { f.conducteur = v; rerender(); } }
    ])
  );

  let list = DB.dotationMission.slice();
  if (f.dateFrom) list = list.filter((d) => !d.dateDepart || d.dateDepart >= f.dateFrom);
  if (f.dateTo) list = list.filter((d) => !d.dateDepart || d.dateDepart <= f.dateTo);
  if (f.conducteur) list = list.filter((d) => norm(d.conducteur || '').includes(norm(f.conducteur)));
  list.sort((a, b) => String(b.dateDepart).localeCompare(String(a.dateDepart)));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Dotations', fmt(list.length), 'sur la période filtrée', COLORS.orange));
  grid.appendChild(statTile('Litres', fmt(sum(list, (d) => d.totalLitres)), 'tous ravitaillements', COLORS.blue));
  grid.appendChild(statTile('Montant', `${fmt(sum(list, (d) => d.totalMontant))} F`, 'dépense carburant mission', COLORS.green));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Ajouter une dotation mission', cls: 'addBtn', color: COLORS.orange, write: true, onClick: () => openMissionDotForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', 'mission', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', 'mission', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.dotationMission.length ? 'Aucune dotation ne correspond aux filtres.' : 'Aucune dotation mission enregistrée.'));
    return;
  }

  list.forEach((d) => {
    const rav = d.ravitaillements || [];
    const e = el('<div class="entry"></div>');
    e.style.borderLeftColor = COLORS.orange;
    e.dataset.search = norm(`${d.conducteur} ${d.destination} ${d.vehicule || ''}`);
    const ravHtml = rav.length
      ? rav.map((r) => `<div class="subEntryRow"><span>${esc(r.station || '—')} — ${fmt(r.quantite)} L × ${fmt(r.prix)} F</span><b>${fmt(num(r.quantite) * num(r.prix))} F</b></div>`).join('')
      : subEmpty('Aucun ravitaillement');
    e.innerHTML =
      `<div class="row1"><h4>${esc(d.conducteur)}</h4><span class="badge" style="background:${COLORS.orange}">${fmt(d.totalMontant)} F</span></div>` +
      `<div class="meta">${esc(d.destination || '—')}${d.vehicule ? ` · ${esc(d.vehicule)}` : ''} · ${esc(dateFR(d.dateDepart))} → ${esc(dateFR(d.dateRetour) || '…')}</div>` +
      `<div class="fields"><b>Km :</b> ${fmt(d.kmDepart)} → ${fmt(d.kmRetour)} (Δ ${fmt(d.diff)} km) · <b>Total :</b> ${fmt(d.totalLitres)} L</div>` +
      `<div class="subBlock"><h5>Ravitaillements (${rav.length})</h5>${ravHtml}</div>` +
      '<div class="actions">' +
      (canWrite() ? `<button class="miniBtn" style="background:${COLORS.green}" data-edit data-write>✎ Modifier</button>` : '') +
      (canWrite() ? `<button class="miniBtn" style="background:${COLORS.red}" data-del data-write>Supprimer</button>` : '') +
      '</div>';
    const ed = e.querySelector('[data-edit]');
    if (ed) ed.onclick = () => openMissionDotForm(d);
    const del = e.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (!(await confirmDialog({ title: 'Supprimer la dotation mission', message: `Supprimer la dotation de ${d.conducteur} (${d.destination || 'sans destination'}) ?`, okLabel: 'Supprimer', danger: true }))) return;
        remove('dotationMission', d.id);
        toast('Dotation supprimée.', 'ok');
        rerender();
      };
    }
    page.appendChild(e);
  });
}

function openMissionDotForm(d) {
  const isEdit = !!d;
  const rav = (d && d.ravitaillements ? d.ravitaillements : []).map((r) => Object.assign({}, r));

  openForm({
    title: isEdit ? `Modifier la dotation — ${d.conducteur}` : 'Nouvelle dotation — MISSION',
    fields: missionDotFields(d || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la dotation',
    onInput: (values, scope) => {
      const node = scope.querySelector('[data-key="diff"]');
      if (node) node.value = `${fmt(num(values.kmRetour) - num(values.kmDepart))} km`;
    },
    extra: (scope) => {
      const block = el('<div class="subBlock" style="margin-top:14px"><h5>Ravitaillements</h5><div data-ravlist></div>' +
        '<div class="fGrid" style="margin-top:8px">' +
        '<div class="fRow"><label>Station-service</label><input data-rstation></div>' +
        '<div class="fRow"><label>Quantité (L)</label><input type="number" step="any" data-rqte></div>' +
        '<div class="fRow"><label>Prix / L</label><input type="number" step="any" data-rprix></div>' +
        '</div><button type="button" class="smallBtn" data-radd>+ Ajouter ce ravitaillement</button>' +
        '<div class="subEntryRow" style="margin-top:8px;border:none"><span><b>Total</b></span><b data-rtotal>0 L — 0 F</b></div></div>');

      const listBox = block.querySelector('[data-ravlist]');
      const totalBox = block.querySelector('[data-rtotal]');

      const draw = () => {
        listBox.innerHTML = rav.length
          ? rav
              .map(
                (r, i) =>
                  `<div class="subEntryRow"><span>${esc(r.station || '—')} — ${fmt(r.quantite)} L × ${fmt(r.prix)} F = ${fmt(num(r.quantite) * num(r.prix))} F</span>` +
                  `<button type="button" class="miniBtn" style="background:${COLORS.red};padding:4px 8px" data-rdel="${i}">✕</button></div>`
              )
              .join('')
          : subEmpty('Aucun ravitaillement ajouté');
        totalBox.textContent = `${fmt(sum(rav, (r) => r.quantite))} L — ${fmt(sum(rav, (r) => num(r.quantite) * num(r.prix)))} F`;
        listBox.querySelectorAll('[data-rdel]').forEach((b) => {
          b.onclick = () => { rav.splice(Number(b.dataset.rdel), 1); draw(); };
        });
      };
      draw();

      block.querySelector('[data-radd]').onclick = () => {
        const station = block.querySelector('[data-rstation]').value.trim();
        const quantite = num(block.querySelector('[data-rqte]').value);
        const prix = num(block.querySelector('[data-rprix]').value);
        if (!station || quantite <= 0) {
          toast('Renseignez la station et une quantité valide.', 'err');
          return;
        }
        rav.push({ station, quantite, prix });
        block.querySelector('[data-rstation]').value = '';
        block.querySelector('[data-rqte]').value = '';
        block.querySelector('[data-rprix]').value = '';
        draw();
      };
      scope.insertBefore(block, scope.querySelector('.err'));
    },
    onSubmit: (values) => {
      const payload = {
        conducteur: values.conducteur,
        vehicule: String(values.vehicule || '').trim().toUpperCase(),
        destination: values.destination,
        dateDepart: values.dateDepart,
        dateRetour: values.dateRetour,
        kmDepart: num(values.kmDepart),
        kmRetour: num(values.kmRetour),
        diff: num(values.kmRetour) - num(values.kmDepart),
        ravitaillements: rav,
        totalLitres: sum(rav, (r) => r.quantite),
        totalMontant: sum(rav, (r) => num(r.quantite) * num(r.prix))
      };
      if (isEdit) update('dotationMission', d.id, payload);
      else insert('dotationMission', payload);
      toast(isEdit ? 'Dotation mise à jour.' : 'Dotation enregistrée.', 'ok');
      rerender();
      return null;
    }
  });
}

async function doExport(kind, sub, list) {
  try {
    const datasets = sub === 'pool' ? [dsDotationPool(list)] : [dsDotationMission(list), dsRavitaillements(list)];
    const name = sub === 'pool' ? 'PDU_dotation_pool' : 'PDU_dotation_mission';
    const res = kind === 'excel'
      ? await exportExcel(datasets, name)
      : await exportPdf(datasets, name, { title: 'Dotation carburant' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
