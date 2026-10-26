/* ===================================================================
   ENTRETIEN → VIDANGES : la liste de toutes les vidanges, a part des
   passages au garage.

   Une vidange dit quel vehicule, quand, qui s'en est occupe, ou elle a
   ete faite, ce qui a ete change et la quantite d'huile. Son kilometrage
   futur devient la « Prochaine vidange » du vehicule dans VEHICULES ;
   l'observation apres la vidange est signalee dans ÉTAT DES VÉHICULES.
   =================================================================== */

import {
  DB, insert, update, remove, allVehicles, immatOf, vehiculeDeLImmat, kmCourant, knownDrivers, nomsGarages,
  travauxVidangeConnus, reporterVidange, oublierVidange
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, num, norm, dateFR, todayISO, sum } from '../../core/utils.js';
import { card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast, statTile, dataTable, COLORS } from '../components.js';
import { rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsVidanges } from '../../export/datasets.js';

export const COULEUR_VIDANGES = '#00838F';

const filtres = { immat: '' };

const cle = (immat) => norm(immat || '').replace(/\s+/g, '');
const kmOuTiret = (v) => (v === '' || v === undefined || v === null ? '—' : `${fmt(v)} km`);

/** Garages, puis stations-service deja citees dans les dotations et les missions. */
function structuresConnues() {
  const vus = new Map();
  const voir = (n) => { const p = String(n || '').trim(); if (p && !vus.has(norm(p))) vus.set(norm(p), p); };
  nomsGarages().forEach(voir);
  (DB.vidanges || []).forEach((x) => voir(x.structure));
  (DB.dotationPool || []).forEach((d) => voir(d.station));
  (DB.missions || []).forEach((m) => (m.ravitaillements || []).forEach((r) => voir(r.station)));
  return [...vus.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

export function renderVidanges(page) {
  const f = filtres;
  page.appendChild(card(
    'VIDANGES',
    'Toutes les vidanges des véhicules, à part des passages au garage. ' +
      'Le kilométrage de la prochaine vidange devient la « Prochaine vidange » du véhicule dans VÉHICULES ; ' +
      'l’observation après la vidange est signalée dans ÉTAT DES VÉHICULES.',
    COULEUR_VIDANGES
  ));

  const tous = (DB.vidanges || []).slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || num(b.kmActuel) - num(a.kmActuel));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Vidanges', fmt(tous.length), 'enregistrées', COULEUR_VIDANGES));
  grid.appendChild(statTile('Véhicules', fmt(new Set(tous.map((x) => cle(x.immat))).size), 'concernés', COLORS.blue));
  grid.appendChild(statTile('Huile', `${fmt(sum(tous, (x) => x.quantiteHuile))} L`, 'au total', COLORS.orange));
  page.appendChild(grid);

  const immats = [...new Set(tous.map((x) => x.immat).filter(Boolean))].sort();
  page.appendChild(filterBar([
    {
      type: 'select', value: f.immat, onChange: (v) => { f.immat = v; rerender(); },
      options: [{ value: '', label: 'Tous les véhicules' }].concat(immats)
    }
  ]));

  const list = f.immat ? tous.filter((x) => cle(x.immat) === cle(f.immat)) : tous;

  page.appendChild(toolbar([
    canWrite() && { label: '+ Nouvelle vidange', cls: 'addBtn', color: COULEUR_VIDANGES, write: true, onClick: () => ouvrirVidange(null) },
    { label: '⬇ Excel', color: COLORS.blue, onClick: () => exporter('excel', list) },
    { label: '⬇ PDF', color: COLORS.red, onClick: () => exporter('pdf', list) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => exporter('word', list) }
  ]));

  if (!list.length) {
    page.appendChild(emptyState(tous.length ? 'Aucune vidange pour ce véhicule.' : 'Aucune vidange enregistrée.'));
    return;
  }

  const headers = [
    'Date', 'Immatriculation', 'Conducteur', 'Garage<br>ou station', 'Vidange<br>prévue à', 'Km<br>actuel',
    'Prochaine<br>vidange', 'Ce qui a été fait', 'Huile', 'Observation<br>après la vidange', ''
  ];
  const rows = list.map((x) => [
    `<span style="white-space:nowrap">${esc(dateFR(x.date))}</span>`,
    `<a href="#" data-veh title="Ouvrir la fiche du véhicule" style="color:${COLORS.blue};white-space:nowrap;font-weight:bold">${esc(x.immat || '')}</a>`,
    esc(x.conducteur || ''),
    esc(x.structure || ''),
    `<span style="white-space:nowrap">${esc(kmOuTiret(x.kmAncienFutur))}</span>`,
    `<span style="white-space:nowrap">${esc(kmOuTiret(x.kmActuel))}</span>`,
    `<b style="white-space:nowrap">${esc(kmOuTiret(x.kmFutur))}</b>`,
    (x.travaux || []).map(esc).join('<br>') || '<span style="color:#8a9ba0">—</span>',
    x.quantiteHuile === '' || x.quantiteHuile === undefined ? '—' : `${esc(fmt(x.quantiteHuile))} L`,
    escLignes(x.observation || '') || '<span style="color:#8a9ba0">—</span>',
    canWrite()
      ? `<button class="miniBtn" style="background:#008A3B;padding:5px 8px" data-edit data-write>✎</button> ` +
        `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
      : ''
  ]);

  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const x = list[i];
    tr.dataset.search = norm(`${x.immat} ${x.conducteur} ${x.structure} ${(x.travaux || []).join(' ')} ${x.observation} ${dateFR(x.date)}`);
    tr.querySelector('[data-veh]').onclick = (ev) => { ev.preventDefault(); openVehicleSheet(x.immat); };
    const ed = tr.querySelector('[data-edit]');
    if (ed) ed.onclick = () => ouvrirVidange(x);
    const del = tr.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (!(await confirmDialog({
          title: 'Supprimer la vidange',
          message: `Supprimer la vidange du ${dateFR(x.date)} sur ${x.immat || '—'} ?`,
          okLabel: 'Supprimer', danger: true
        }))) return;
        oublierVidange(x);
        remove('vidanges', x.id);
        toast('Vidange supprimée.', 'ok');
        rerender();
      };
    }
  }));
}

/** Cases a cocher « Ce qui a été fait », avec l'ajout d'un travail a la liste. */
function blocTravaux(coches) {
  const choisis = new Set(coches.map(norm));
  const liste = travauxVidangeConnus();
  coches.forEach((t) => { if (!liste.some((l) => norm(l) === norm(t))) liste.push(t); });
  const bloc = el(
    '<div class="fRow full"><label>Ce qui a été fait</label>' +
      '<div data-travaux style="display:flex;flex-wrap:wrap;gap:6px 18px;padding:4px 0"></div>' +
      '<div class="addField" style="margin-top:6px">' +
        '<input data-travail-nouveau placeholder="Autre travail (ex. filtre à particules)">' +
        `<button type="button" class="miniBtn" data-travail-ajout style="background:${COULEUR_VIDANGES};white-space:nowrap">+ Ajouter à la liste</button>` +
      '</div>' +
      '<span class="hint">Un travail ajouté est proposé aux vidanges suivantes</span>' +
    '</div>'
  );
  const zone = bloc.querySelector('[data-travaux]');
  const caseHtml = (t, coche) =>
    `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">` +
    `<input type="checkbox" data-travail value="${esc(t)}"${coche ? ' checked' : ''} style="width:auto"> ${esc(t)}</label>`;
  zone.innerHTML = liste.map((t) => caseHtml(t, choisis.has(norm(t)))).join('');

  const saisie = bloc.querySelector('[data-travail-nouveau]');
  const ajouter = () => {
    const t = saisie.value.trim();
    if (!t) return;
    const deja = [...zone.querySelectorAll('[data-travail]')].find((c) => norm(c.value) === norm(t));
    if (deja) deja.checked = true;
    else zone.appendChild(el(caseHtml(t.charAt(0).toUpperCase() + t.slice(1), true)));
    saisie.value = '';
  };
  bloc.querySelector('[data-travail-ajout]').onclick = ajouter;
  // Entree ajoute le travail au lieu d'enregistrer le formulaire.
  saisie.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ajouter(); } });
  return bloc;
}

/** Formulaire : nouvelle vidange, ou modification. */
function ouvrirVidange(x) {
  const isEdit = !!x;
  const d = x || {};
  const vehicules = allVehicles()
    .filter((v) => immatOf(v))
    .map((v) => ({ value: immatOf(v), label: `${immatOf(v)} — ${`${v.marque || ''} ${v.modele || ''}`.trim()}` }))
    .sort((a, b) => a.value.localeCompare(b.value));

  // « Prochaine vidange » du vehicule avant celle-ci : relue a chaque
  // changement de vehicule, gardee telle qu'enregistree en modification.
  let ancienFutur = isEdit ? d.kmAncienFutur : '';
  let immatVue = isEdit ? d.immat : null;
  let futurAuto = !isEdit;
  let kmActuelAuto = !isEdit;

  const fields = [
    { key: 'immat', label: 'Véhicule (immatriculation)', type: 'selectAdd', required: true, value: d.immat,
      options: vehicules, emptyLabel: '— choisir —', addLabel: 'Autre immatriculation' },
    { key: 'date', label: 'Date de la vidange', type: 'date', required: true, value: d.date || todayISO() },
    { key: 'conducteur', label: 'Conducteur', value: d.conducteur, list: knownDrivers(),
      hint: 'Celui qui s’est occupé de la vidange' },
    { key: 'structure', label: 'Garage ou station', type: 'selectAdd', value: d.structure,
      options: structuresConnues(), emptyLabel: '— choisir —', addLabel: 'Autre garage ou station',
      hint: 'La structure qui a fait la vidange' },
    { key: 'kmAncienFutur', label: 'Vidange prévue à (km)', type: 'static', value: '',
      hint: 'La « Prochaine vidange » du véhicule dans VÉHICULES, avant celle-ci' },
    { key: 'kmActuel', label: 'Kilométrage actuel', type: 'nombre', required: true, value: d.kmActuel },
    { key: 'kmFutur', label: 'Kilométrage de la prochaine vidange', type: 'nombre', required: true, value: d.kmFutur,
      hint: 'Devient la « Prochaine vidange » du véhicule dans VÉHICULES' },
    { key: 'quantiteHuile', label: 'Quantité d’huile (L)', type: 'nombre', value: d.quantiteHuile },
    { key: 'observation', label: 'Observation après la vidange', type: 'textarea', full: true, lignesTiret: true,
      value: d.observation, placeholder: 'RAS, ou ce qui a été constaté sur le véhicule',
      hint: 'Un problème décrit ici est signalé dans VÉHICULES → ÉTAT DES VÉHICULES' }
  ];

  openForm({
    title: isEdit ? `Modifier la vidange — ${d.immat}` : 'Nouvelle vidange',
    fields,
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la vidange',
    extra: (scope) => {
      const huile = scope.querySelector('[data-key="quantiteHuile"]').closest('.fRow');
      huile.parentNode.insertBefore(blocTravaux(d.travaux || []), huile);
      // Une valeur tapee a la main n'est plus remplacee par la proposition.
      scope.querySelector('[data-key="kmFutur"]').addEventListener('input', () => { futurAuto = false; });
      scope.querySelector('[data-key="kmActuel"]').addEventListener('input', () => { kmActuelAuto = false; });
    },
    onInput: (v, scope) => {
      const champ = (k) => scope.querySelector(`[data-key="${k}"]`);
      const veh = vehiculeDeLImmat(v.immat);
      if (v.immat !== immatVue) {
        immatVue = v.immat;
        ancienFutur = veh ? veh.kmVidange : '';
        if (kmActuelAuto && veh) champ('kmActuel').value = fmt(kmCourant(veh));
      }
      champ('kmAncienFutur').value = !v.immat ? '' : ancienFutur === '' || ancienFutur === undefined ? 'non renseignée' : `${fmt(ancienFutur)} km`;
      // Proposition : kilometrage actuel plus l'intervalle de vidange des REGLAGES.
      const actuel = num(champ('kmActuel').value.replace(/\s/g, ''));
      if (futurAuto && actuel) champ('kmFutur').value = fmt(actuel + num(DB.settings.seuilVidangeKm || 5000));
    },
    onSubmit: (v, { scope }) => {
      if (num(v.kmFutur) <= num(v.kmActuel)) return 'Le kilométrage de la prochaine vidange doit dépasser le kilométrage actuel.';
      const travaux = [...scope.querySelectorAll('[data-travail]:checked')].map((c) => c.value);
      const fiche = {
        immat: String(v.immat || '').trim().toUpperCase(),
        date: v.date,
        conducteur: v.conducteur,
        structure: v.structure,
        kmAncienFutur: ancienFutur === undefined ? '' : ancienFutur,
        kmActuel: v.kmActuel,
        kmFutur: v.kmFutur,
        travaux,
        quantiteHuile: v.quantiteHuile,
        observation: v.observation
      };
      const enregistree = isEdit ? update('vidanges', x.id, fiche) : insert('vidanges', fiche);
      const reportee = reporterVidange(enregistree);
      toast(
        reportee ? `Vidange enregistrée. Prochaine vidange de ${fiche.immat} : ${fmt(fiche.kmFutur)} km.`
          : isEdit ? 'Vidange modifiée.' : 'Vidange enregistrée.',
        'ok', reportee ? 4000 : 2600
      );
      rerender();
      return null;
    }
  });
}

async function exporter(kind, list) {
  try {
    const datasets = [dsVidanges(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_vidanges')
      : kind === 'word'
        ? await exportWord(datasets, 'PDU_vidanges', { title: 'Vidanges' })
        : await exportPdf(datasets, 'PDU_vidanges', { title: 'Vidanges' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
