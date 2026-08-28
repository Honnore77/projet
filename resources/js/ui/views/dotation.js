/* ===================================================================
   DOTATION EN CARBURANT — deux sous-rubriques :

     POOL     dotations des vehicules du pool, saisies ici
     MISSION  carburant des missions, saisi dans le rapport de mission
              et presente ici en tableau

   La saisie du carburant de mission reste dans le rapport : un seul
   endroit de saisie par deplacement, donc pas de double comptage.
   =================================================================== */

import {
  DB, ETATS_VIDANGE, insert, update, remove, knownImmats, vehicleByImmat,
  carburantMissions, missionsAvecCarburant, ravMontant
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO, sum } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast,
  statTile, dataTable, COLORS
} from '../components.js';
import { state, navigate, rerender } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsDotationPool, dsCarburantMissions, dsRavitaillementsMissions } from '../../export/datasets.js';

const SUBS = [
  { key: 'pool', label: 'DOTATION EN CARBURANT POOL' },
  { key: 'mission', label: 'DOTATION EN CARBURANT MISSION' }
];

export function renderDotation(page) {
  const sub = state.sub.DOTATION || 'pool';
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.DOTATION = k; rerender(); }, { pool: COLORS.orange, mission: COLORS.purple })
  );
  if (sub === 'mission') renderMission(page);
  else renderPool(page);
}

/* ===================== DOTATION CARBURANT POOL ===================== */

/** Numeros de carte deja utilises, pour ne pas les retaper. */
function cartesConnues() {
  return [...new Set(DB.dotationPool.map((x) => String(x.carte || '').trim()).filter(Boolean))];
}

/**
 * Derniere dotation enregistree pour une immatriculation. Elle porte le
 * numero de carte du vehicule et le solde laisse par la prise precedente :
 * de quoi enchainer une nouvelle prise sans rien retaper.
 */
function dernierePrise(immat) {
  const cle = String(immat || '').trim().toUpperCase();
  if (!cle) return null;
  return DB.dotationPool
    .filter((x) => String(x.immat || '').trim().toUpperCase() === cle)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .pop() || null;
}

function poolFields(d = {}) {
  return [
    { key: 'date', label: 'Date', type: 'date', required: true, value: d.date || todayISO() },
    { key: 'immat', label: 'Immatriculation', required: true, value: d.immat, list: knownImmats() },
    { key: 'marqueModele', label: 'Marque / Modèle', value: d.marqueModele, hint: 'Rempli automatiquement si le véhicule est connu' },
    { key: 'carte', label: 'Numéro de la carte carburant', value: d.carte, list: cartesConnues(),
      hint: 'Repris de la dernière prise du véhicule' },
    { key: 'energie', label: 'Énergie', type: 'select', options: ['Essence', 'Diesel'], value: d.energie || 'Essence' },
    { key: 'km', label: 'Kilométrage', type: 'number', value: d.km },
    { key: 'quantite', label: 'Quantité (L)', type: 'number', required: true, value: d.quantite },
    { key: 'prixL', label: 'Prix / L', type: 'number', required: true, value: d.prixL },
    { key: 'montant', label: 'Montant calculé', type: 'static', value: d.montant ? fmt(d.montant) : '0' },
    { key: 'soldeAvant', label: 'Solde avant prise', type: 'number', value: d.soldeAvant,
      hint: 'Repris du solde après prise de la dernière dotation' },
    { key: 'soldeApres', label: 'Solde après prise', type: 'number', value: d.soldeApres },
    { key: 'ecartSolde', label: 'Contrôle du solde', type: 'static', value: '' },
    { key: 'station', label: 'Station-service', value: d.station, list: [...new Set(DB.dotationPool.map((x) => x.station).filter(Boolean))] },
    { key: 'vidange', label: 'État vidange', type: 'select', options: ETATS_VIDANGE, value: d.vidange || 'À jour' },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: d.observations }
  ];
}

/** Un solde non renseigne se lit mieux « — » que « 0 ». */
function soldeCell(v) {
  return v === '' || v === undefined || v === null ? '—' : `${fmt(v)} F`;
}

function renderPool(page) {
  const f = state.filters.dotationPool;

  page.appendChild(
    card(
      'DOTATION EN CARBURANT — POOL',
      'Date · Immatriculation · Marque/Modèle · Carte carburant · Énergie · Kilométrage · Quantité · Prix/L · Montant · Solde avant et après prise · Station-service · État vidange.',
      COLORS.orange
    )
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

  const headers = [
    'Date', 'Immatriculation', 'Marque / Modèle', 'Carte<br>carburant', 'Énergie', 'Kilométrage',
    'Quantité<br>(L)', 'Prix / L', 'Montant', 'Solde<br>avant', 'Solde<br>après',
    'Station-service', 'État<br>vidange', 'Observations', ''
  ];

  const rows = list.map((d) => [
    esc(dateFR(d.date)),
    `<b>${esc(d.immat || '')}</b>`,
    esc(d.marqueModele || ''),
    esc(d.carte || ''),
    esc(d.energie || ''),
    `<span style="display:block;text-align:right">${fmt(d.km)}</span>`,
    `<span style="display:block;text-align:right">${fmt(d.quantite)}</span>`,
    `<span style="display:block;text-align:right">${fmt(d.prixL)}</span>`,
    `<span style="display:block;text-align:right"><b>${fmt(d.montant)} F</b></span>`,
    `<span style="display:block;text-align:right">${soldeCell(d.soldeAvant)}</span>`,
    `<span style="display:block;text-align:right">${soldeCell(d.soldeApres)}</span>`,
    esc(d.station || ''),
    `<span class="badge" style="background:${d.vidange === 'En retard' ? COLORS.red : COLORS.orange}">${esc(d.vidange || '')}</span>`,
    esc(d.observations || ''),
    canWrite()
      ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
        `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
      : ''
  ]);

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const d = list[i];
      tr.dataset.search = norm(`${d.immat} ${d.marqueModele} ${d.carte} ${d.station} ${d.date}`);

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openPoolForm(d);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({ title: 'Supprimer la dotation', message: `Supprimer la dotation du ${dateFR(d.date)} pour ${d.immat} ?`, okLabel: 'Supprimer', danger: true }))) return;
          remove('dotationPool', d.id);
          toast('Dotation supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

function openPoolForm(d) {
  const isEdit = !!d;
  openForm({
    title: isEdit ? `Modifier la dotation — ${d.immat}` : 'Nouvelle dotation — POOL',
    fields: poolFields(d || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la dotation',
    onInput: (values, scope) => {
      const montant = num(values.quantite) * num(values.prixL);
      const mNode = scope.querySelector('[data-key="montant"]');
      if (mNode) mNode.value = `${fmt(montant)} F`;

      const mm = scope.querySelector('[data-key="marqueModele"]');
      if (mm && !mm.value && values.immat) {
        const v = vehicleByImmat(values.immat);
        if (v) mm.value = `${v.marque || ''} ${v.modele || ''}`.trim();
      }

      // Le vehicule choisi apporte sa carte et le solde qu'y a laisse la
      // prise precedente. Les deux restent modifiables : on complete des
      // champs vides, on n'ecrase jamais une saisie.
      const carte = scope.querySelector('[data-key="carte"]');
      const avant = scope.querySelector('[data-key="soldeAvant"]');
      if (values.immat && ((carte && !carte.value) || (avant && !avant.value))) {
        const prec = dernierePrise(values.immat);
        if (prec) {
          if (carte && !carte.value && prec.carte) carte.value = prec.carte;
          if (avant && !avant.value && prec.soldeApres !== '' && prec.soldeApres !== undefined) {
            avant.value = num(prec.soldeApres);
          }
        }
      }

      // Le solde apres prise se deduit du montant, tant qu'on ne l'a pas
      // saisi soi-meme.
      const apres = scope.querySelector('[data-key="soldeApres"]');
      if (apres && !apres.value && values.soldeAvant !== '' && montant > 0) {
        apres.value = num(values.soldeAvant) - montant;
      }

      // Ecart entre le solde declare et la depense : c'est tout l'interet de
      // noter les deux soldes, autant le dire a la saisie.
      const ctrl = scope.querySelector('[data-key="ecartSolde"]');
      if (ctrl) {
        if (values.soldeAvant === '' || values.soldeApres === '') {
          ctrl.value = 'Renseignez les deux soldes';
        } else {
          const ecart = num(values.soldeAvant) - num(values.soldeApres) - montant;
          ctrl.value = Math.abs(ecart) < 0.5
            ? `Cohérent — ${fmt(montant)} F débités`
            : `⚠ Écart de ${fmt(Math.abs(ecart))} F avec le montant`;
        }
      }
    },
    onSubmit: (values) => {
      const payload = {
        date: values.date,
        immat: String(values.immat || '').trim().toUpperCase(),
        marqueModele: values.marqueModele,
        carte: String(values.carte || '').trim(),
        soldeAvant: values.soldeAvant,
        soldeApres: values.soldeApres,
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

/* =================== DOTATION CARBURANT MISSION ==================== */

function renderMission(page) {
  const f = state.filters.dotationMission;

  page.appendChild(
    card(
      'DOTATION EN CARBURANT — MISSION',
      'Le carburant consommé en mission, tel qu’il a été saisi dans le rapport de mission : conducteur, véhicule, période, destination, points de ravitaillement, litres et montant.',
      COLORS.purple
    )
  );

  let list = missionsAvecCarburant();
  if (f.dateFrom) list = list.filter((m) => !m.dateDepart || m.dateDepart >= f.dateFrom);
  if (f.dateTo) list = list.filter((m) => !m.dateDepart || m.dateDepart <= f.dateTo);
  if (f.conducteur) list = list.filter((m) => norm(m.conducteur || '').includes(norm(f.conducteur)));
  list.sort((a, b) => String(b.dateDepart).localeCompare(String(a.dateDepart)));

  page.appendChild(
    filterBar([
      { type: 'date', title: 'Départ à partir du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
      { type: 'date', title: 'Départ jusqu’au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
      { type: 'text', placeholder: 'Conducteur', value: f.conducteur, onChange: (v) => { f.conducteur = v; rerender(); } }
    ])
  );

  const total = carburantMissions(list);
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Missions', fmt(list.length), 'avec du carburant saisi', COLORS.purple));
  grid.appendChild(statTile('Litres', fmt(total.litres), 'tous ravitaillements', COLORS.blue));
  grid.appendChild(statTile('Montant', `${fmt(total.montant)} F`, 'dépense carburant mission', COLORS.green));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && {
        label: '✎ Saisir dans un rapport de mission',
        cls: 'addBtn',
        color: COLORS.purple,
        write: true,
        onClick: () => { state.sub.MISSION = 'rapport'; navigate('MISSION'); }
      },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', 'mission', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', 'mission', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(
      emptyState('Aucun carburant de mission saisi. Renseignez-le dans MISSION → Rapport de mission.')
    );
    return;
  }

  const headers = [
    'Mission', 'Conducteur', 'Véhicule', 'Destination', 'Période',
    'Km départ', 'Km arrivée', 'Distance', 'Points de ravitaillement',
    'Quantité<br>(L)', 'Montant', ''
  ];

  const rows = list.map((m) => {
    const rav = m.ravitaillements || [];
    return [
      `<b>${esc(m.ref || '')}</b>`,
      esc(m.conducteur || ''),
      esc(m.vehicule || ''),
      esc(m.destination || ''),
      `${esc(dateFR(m.dateDepart) || '…')}<br>→ ${esc(dateFR(m.dateRetour) || '…')}`,
      `<span style="display:block;text-align:right">${fmt(m.kmDepart)}</span>`,
      `<span style="display:block;text-align:right">${fmt(m.kmArrivee)}</span>`,
      `<span style="display:block;text-align:right">${fmt(num(m.kmArrivee) - num(m.kmDepart))}</span>`,
      rav.map((r) => `${esc(r.station || '—')} (${fmt(r.quantite)} L × ${fmt(r.prixL)} F)`).join('<br>'),
      `<span style="display:block;text-align:right">${fmt(sum(rav, (r) => r.quantite))}</span>`,
      `<span style="display:block;text-align:right"><b>${fmt(sum(rav, ravMontant))} F</b></span>`,
      `<button class="miniBtn" style="background:${COLORS.purple};padding:5px 8px" data-rapport>Rapport</button>`
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const m = list[i];
      tr.dataset.search = norm(`${m.ref} ${m.conducteur} ${m.vehicule} ${m.destination}`);
      tr.querySelector('[data-rapport]').onclick = () => {
        state.sub.MISSION = 'rapport';
        state.filters.missions.conducteur = m.conducteur || '';
        navigate('MISSION');
      };
    })
  );
}

async function doExport(kind, sub, list) {
  try {
    const datasets = sub === 'pool'
      ? [dsDotationPool(list)]
      : [dsCarburantMissions(list), dsRavitaillementsMissions(list)];
    const name = sub === 'pool' ? 'PDU_dotation_pool' : 'PDU_dotation_mission';
    const titre = sub === 'pool' ? 'Dotation carburant — pool' : 'Dotation carburant — missions';
    const res = kind === 'excel'
      ? await exportExcel(datasets, name)
      : await exportPdf(datasets, name, { title: titre });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
