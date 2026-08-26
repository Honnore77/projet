/* ===================================================================
   RAPPORTS ET EXPORTS — synthèses et production de documents.
   =================================================================== */

import { DB, allVehicles, openMaintenance, unpaidMissions } from '../../core/db.js';
import { el, fmt, esc, sum } from '../../core/utils.js';
import { card, statTile, dataTable, emptyState, toast, COLORS, sectionLabel } from '../components.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import {
  dsAll, dsVehicles, dsUsers, dsIncidents, dsDotationPool, dsDotationMission,
  dsRavitaillements, dsMissions, dsMissionsParConducteur, dsMaintenance,
  dsInterventions, dsCoutParVehicule
} from '../../export/datasets.js';

const RAPPORTS = [
  { key: 'parc', label: 'État du parc', desc: 'Tous les véhicules avec coûts carburant et entretien', build: () => [dsVehicles()], file: 'PDU_etat_du_parc' },
  { key: 'couts', label: 'Coûts par véhicule', desc: 'Classement des véhicules par coût total de possession', build: () => [dsCoutParVehicule()], file: 'PDU_couts_par_vehicule' },
  { key: 'carburant', label: 'Carburant', desc: 'Dotations pool, dotations mission et ravitaillements', build: () => [dsDotationPool(), dsDotationMission(), dsRavitaillements()], file: 'PDU_carburant' },
  { key: 'missions', label: 'Missions', desc: 'Missions détaillées et récapitulatif par conducteur', build: () => [dsMissions(), dsMissionsParConducteur()], file: 'PDU_missions' },
  { key: 'entretien', label: 'Entretien', desc: 'Passages au garage et interventions détaillées', build: () => [dsMaintenance(), dsInterventions()], file: 'PDU_entretien' },
  { key: 'personnel', label: 'Personnel', desc: 'Utilisateurs et historique des incidents', build: () => [dsUsers(), dsIncidents()], file: 'PDU_personnel' },
  { key: 'complet', label: 'Rapport complet', desc: 'Toutes les rubriques dans un seul document', build: () => dsAll(), file: 'PDU_rapport_complet' }
];

export function renderReports(page) {
  page.appendChild(
    card('RAPPORTS ET EXPORTS', 'Produisez un classeur Excel ou un document PDF prêt à imprimer pour chaque volet de la gestion du parc. Les filtres appliqués dans les rubriques ne sont pas repris ici : les rapports portent sur l’ensemble des données.', COLORS.blue)
  );

  const vehicles = allVehicles();
  const totalCarburant = sum(DB.dotationPool, (d) => d.montant) + sum(DB.dotationMission, (d) => d.totalMontant);
  const totalEntretien = DB.maintenance.reduce((s, m) => s + sum(m.interventions || [], (iv) => iv.cout), 0);

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Véhicules', fmt(vehicles.length), 'toutes catégories', COLORS.green));
  grid.appendChild(statTile('Coût carburant', `${fmt(totalCarburant)} F`, 'depuis le début du suivi', COLORS.orange));
  grid.appendChild(statTile('Coût entretien', `${fmt(totalEntretien)} F`, `${DB.maintenance.length} passage(s)`, COLORS.red));
  grid.appendChild(statTile('Coût global', `${fmt(totalCarburant + totalEntretien)} F`, 'carburant + entretien', COLORS.blue));
  page.appendChild(grid);

  page.appendChild(sectionLabel('DOCUMENTS DISPONIBLES', COLORS.blue));

  RAPPORTS.forEach((r) => {
    const e = el('<div class="entry"></div>');
    e.style.borderLeftColor = COLORS.blue;
    e.dataset.search = `${r.label} ${r.desc}`.toLowerCase();
    e.innerHTML =
      `<div class="row1"><h4>${esc(r.label)}</h4></div><div class="meta">${esc(r.desc)}</div>` +
      '<div class="actions">' +
      `<button class="miniBtn" style="background:${COLORS.green}" data-x>⬇ Excel (.xlsx)</button>` +
      `<button class="miniBtn" style="background:${COLORS.red}" data-p>⬇ PDF</button>` +
      `<button class="miniBtn" style="background:${COLORS.blue}" data-print>🖨 Imprimer</button>` +
      '</div>';
    e.querySelector('[data-x]').onclick = () => run(r, 'excel');
    e.querySelector('[data-p]').onclick = () => run(r, 'pdf');
    e.querySelector('[data-print]').onclick = () => printReport(r);
    page.appendChild(e);
  });

  /* ------------------------ Synthèse à l écran ------------------------ */
  page.appendChild(sectionLabel('SYNTHÈSE — COÛT PAR VÉHICULE', COLORS.green));
  const ds = dsCoutParVehicule();
  if (!ds.rows.length) {
    page.appendChild(emptyState('Aucun coût enregistré pour le moment.'));
  } else {
    page.appendChild(
      dataTable(
        ['Immatriculation', 'Véhicule', 'Catégorie', 'Km', 'Carburant', 'Entretien', 'Total', 'Passages garage'],
        ds.rows.map((r) => [
          `<b>${esc(r.immat)}</b>`,
          esc(`${r.marque} ${r.modele}`.trim()),
          esc(r.categorie),
          fmt(r.km),
          `${fmt(r.carburant)} F`,
          `${fmt(r.entretien)} F`,
          `<b>${fmt(r.total)} F</b>`,
          `<span style="display:block;text-align:center">${r.passagesGarage}</span>`
        ]),
        (tr, i) => { tr.dataset.search = String(ds.rows[i].immat).toLowerCase(); }
      )
    );
  }

  page.appendChild(sectionLabel('POINTS D’ATTENTION', COLORS.orange));
  const attention = [];
  openMaintenance().forEach((m) => attention.push(['Immobilisation', m.immat, m.motif || '—', `entré le ${m.dateEntree || '—'}`]));
  unpaidMissions().forEach((m) => attention.push(['Paiement', m.ref, m.conducteur, `${m.jours || 0} jour(s)`]));
  if (!attention.length) {
    page.appendChild(emptyState('Aucun point d’attention : le parc est à jour.'));
  } else {
    page.appendChild(
      dataTable(
        ['Type', 'Référence', 'Concerne', 'Détail'],
        attention.map((a) => a.map((c) => esc(c)))
      )
    );
  }
}

async function run(rapport, kind) {
  try {
    const datasets = rapport.build().filter((d) => d.rows.length);
    if (!datasets.length) {
      toast('Aucune donnée à exporter pour ce rapport.', 'info');
      return;
    }
    const res = kind === 'excel'
      ? await exportExcel(datasets, rapport.file)
      : await exportPdf(datasets, rapport.file, { title: rapport.label });
    toast(res ? `Rapport « ${rapport.label} » enregistré.` : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

/** Impression directe dans une fenêtre dédiée. */
function printReport(rapport) {
  const datasets = rapport.build().filter((d) => d.rows.length);
  if (!datasets.length) {
    toast('Aucune donnée à imprimer pour ce rapport.', 'info');
    return;
  }
  const org = DB.settings.organisation || 'PDU';
  const html =
    `<html><head><meta charset="utf-8"><title>${esc(org)} — ${esc(rapport.label)}</title><style>
      body{font-family:Segoe UI,Arial,sans-serif;color:#17313B;margin:18px;}
      h1{color:#008A3B;font-size:17px;margin:0 0 4px;}
      h2{font-size:13px;margin:20px 0 6px;color:#17313B;border-bottom:2px solid #008A3B;padding-bottom:3px;}
      .sub{color:#5b7178;font-size:11px;margin-bottom:8px;}
      table{border-collapse:collapse;width:100%;font-size:9px;margin-bottom:12px;}
      th{background:#008A3B;color:#fff;text-align:left;padding:5px;}
      td{border-bottom:1px solid #e6eced;padding:4px 5px;vertical-align:top;}
      tr:nth-child(even) td{background:#f8fbfb;}
      @page{size:A4 landscape;margin:10mm;}
    </style></head><body>` +
    `<h1>${esc(org)} — ${esc(rapport.label)}</h1>` +
    `<div class="sub">Édité le ${new Date().toLocaleString('fr-FR')} — application de gestion du parc automobile</div>` +
    datasets
      .map(
        (ds) =>
          `<h2>${esc(ds.title)}</h2><table><thead><tr>${ds.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>` +
          `<tbody>${ds.rows
            .map((r) => `<tr>${ds.columns.map((c) => `<td>${esc(r[c.key] === undefined || r[c.key] === null ? '' : r[c.key])}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>` +
          (ds.note ? `<div class="sub">${esc(ds.note)}</div>` : '')
      )
      .join('') +
    '</body></html>';

  const w = window.open('', '_blank');
  if (!w) {
    toast("Impression bloquée par le navigateur. Utilisez l'export PDF.", 'err');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

