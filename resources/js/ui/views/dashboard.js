/* ===================================================================
   TABLEAU DE BORD — indicateurs, alertes, graphiques.
   =================================================================== */

import {
  DB, allVehicles, openMaintenance, unpaidMissions, immatOf,
  maintenanceCost, fuelCost, ravMontant, computeAlerts, STATUTS_VEHICULE, STATUT_NON_ATTRIBUE, STATUT_REFORME
} from '../../core/db.js';
import { fmt, fmtF, num, sum, groupBy, monthKey, monthLabel, esc, el } from '../../core/utils.js';
import { statTile, card, COLORS } from '../components.js';
import { chartCard, destroyCharts, colorsFor } from '../charts.js';
import { navigate } from '../shell.js';
import { COULEUR_NON_ATTRIBUE, COULEUR_REFORME } from './vehicles.js';

export function renderDashboard(page) {
  destroyCharts();

  const vehicles = allVehicles();
  const nbVeh = vehicles.length;
  const auGarage = openMaintenance().length;
  const impayees = unpaidMissions();
  const totalEntretien = DB.maintenance.reduce(
    (s, m) => s + sum(m.interventions || [], (iv) => iv.cout), 0
  );

  page.appendChild(
    card(
      'TABLEAU DE BORD',
      `Vue d'ensemble du parc automobile ${DB.settings.organisation}. Dernière mise à jour des données : ${new Date(DB.meta.updatedAt).toLocaleString('fr-FR')}.`,
      COLORS.green
    )
  );

  /* ---------------------------- Indicateurs ---------------------------- */
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Véhicules', fmt(nbVeh), `${DB.vehicles.pool.length} pool · ${DB.vehicles.mission.length} mission · ${DB.vehicles.service.length} service`, COLORS.green));
  grid.appendChild(statTile('Au garage', fmt(auGarage), auGarage ? 'immobilisations en cours' : 'aucune immobilisation', auGarage ? COLORS.orange : COLORS.green));
  grid.appendChild(statTile('Utilisateurs', fmt(DB.users.length), `${DB.users.filter((u) => u.statut === 'Actif').length} actif(s)`, COLORS.blue));
  grid.appendChild(statTile('Missions', fmt(DB.missions.length), `${impayees.length} en attente de paiement`, COLORS.purple));
  grid.appendChild(statTile('Entretien', fmtF(totalEntretien), `${DB.maintenance.length} passage(s) au garage`, COLORS.red));
  page.appendChild(grid);

  /* ------------------------------ Alertes ------------------------------ */
  const alerts = computeAlerts();
  const alertBox = el('<div class="alertList"></div>');
  alertBox.appendChild(el(`<div class="groupHeader"><span>ALERTES</span><span class="badge" style="background:${alerts[0].level === 'ok' ? COLORS.green : COLORS.red}">${alerts[0].level === 'ok' ? 'RAS' : alerts.length}</span></div>`));
  alerts.forEach((a) => {
    const item = el(
      `<div class="alertItem ${a.level}"><span class="ic">${a.icon}</span>` +
        `<div><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></div></div>`
    );
    if (a.go) {
      item.style.cursor = 'pointer';
      item.onclick = () => navigate(a.go);
    }
    alertBox.appendChild(item);
  });
  page.appendChild(alertBox);

  /* ----------------------------- Graphiques ---------------------------- */
  const charts = el('<div class="chartGrid"></div>');

  // Répartition des statuts
  const statuts = STATUTS_VEHICULE.concat([STATUT_NON_ATTRIBUE, STATUT_REFORME]);
  const parStatut = statuts.map((s) => vehicles.filter((v) => v.statut === s).length);
  const sansStatut = vehicles.filter((v) => !statuts.includes(v.statut)).length;
  if (nbVeh) {
    charts.appendChild(
      chartCard('Répartition des véhicules par statut', {
        type: 'doughnut',
        data: {
          labels: statuts.concat(sansStatut ? ['Non renseigné'] : []),
          datasets: [{
            data: parStatut.concat(sansStatut ? [sansStatut] : []),
            backgroundColor: [COLORS.green, COLORS.orange, COLORS.red, COULEUR_NON_ATTRIBUE, COULEUR_REFORME, '#9aa'],
            borderWidth: 0
          }]
        },
        options: { cutout: '58%', plugins: { legend: { position: 'bottom' } } }
      })
    );
  }

  // Consommation carburant par mois
  const parMois = {};
  DB.dotationPool.forEach((d) => {
    const k = monthKey(d.date);
    if (!k) return;
    parMois[k] = parMois[k] || { litres: 0, montant: 0 };
    parMois[k].litres += num(d.quantite);
    parMois[k].montant += num(d.montant);
  });
  DB.missions.forEach((m) => {
    (m.ravitaillements || []).forEach((r) => {
      const k = monthKey(r.date || m.dateDepart);
      if (!k) return;
      parMois[k] = parMois[k] || { litres: 0, montant: 0 };
      parMois[k].litres += num(r.quantite);
      parMois[k].montant += ravMontant(r);
    });
  });
  const moisKeys = Object.keys(parMois).sort().slice(-12);
  if (moisKeys.length) {
    charts.appendChild(
      chartCard('Carburant par mois (litres et montant)', {
        type: 'bar',
        data: {
          labels: moisKeys.map(monthLabel),
          datasets: [
            {
              label: 'Litres',
              data: moisKeys.map((k) => Math.round(parMois[k].litres)),
              backgroundColor: COLORS.orange,
              borderRadius: 5,
              yAxisID: 'y'
            },
            {
              label: 'Montant (F)',
              type: 'line',
              data: moisKeys.map((k) => Math.round(parMois[k].montant)),
              borderColor: COLORS.green,
              backgroundColor: COLORS.green,
              tension: 0.3,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Litres' } },
            y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'F' } }
          },
          plugins: { legend: { position: 'bottom' } }
        }
      })
    );
  }

  // Coût total par véhicule (top 8)
  const couts = vehicles
    .map((v) => {
      const im = immatOf(v);
      return { immat: im || '(sans immat.)', carburant: fuelCost(im), entretien: maintenanceCost(im) };
    })
    .filter((x) => x.carburant + x.entretien > 0)
    .sort((a, b) => b.carburant + b.entretien - (a.carburant + a.entretien))
    .slice(0, 8);
  if (couts.length) {
    charts.appendChild(
      chartCard('Coût par véhicule — carburant et entretien', {
        type: 'bar',
        data: {
          labels: couts.map((c) => c.immat),
          datasets: [
            { label: 'Carburant', data: couts.map((c) => c.carburant), backgroundColor: COLORS.orange, borderRadius: 4 },
            { label: 'Entretien', data: couts.map((c) => c.entretien), backgroundColor: COLORS.blue, borderRadius: 4 }
          ]
        },
        options: {
          indexAxis: 'y',
          scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } },
          plugins: { legend: { position: 'bottom' } }
        }
      })
    );
  }

  // Missions par conducteur (top 8)
  const parCond = groupBy(DB.missions, (m) => m.conducteur || '—');
  const conds = Object.keys(parCond)
    .map((k) => ({ k, n: parCond[k].length, j: sum(parCond[k], (m) => m.jours) }))
    .sort((a, b) => b.j - a.j)
    .slice(0, 8);
  if (conds.length) {
    charts.appendChild(
      chartCard('Jours de mission par conducteur', {
        type: 'bar',
        data: {
          labels: conds.map((c) => c.k),
          datasets: [{ label: 'Jours cumulés', data: conds.map((c) => c.j), backgroundColor: colorsFor(conds.length), borderRadius: 5 }]
        },
        options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
      })
    );
  }

  if (charts.children.length) page.appendChild(charts);
  else page.appendChild(card('GRAPHIQUES', "Les graphiques apparaîtront dès que des véhicules, dotations ou missions seront enregistrés.", COLORS.blue));
}
