/* ===================================================================
   FICHE VÉHICULE — tout ce que l application sait d une immatriculation.
   =================================================================== */

import { DB, vehicleByImmat } from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { el, fmt, num, dateFR, sum, daysBetween } from '../../core/utils.js';
import { card, toolbar, statTile, sectionLabel, emptyState, toast, COLORS } from '../components.js';
import { state, navigate } from '../shell.js';
import { statutColor, openVehicleForm } from './vehicles.js';
import { renderMaintenanceEntries, openFicheForm } from './maintenance.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsDotationPool, dsMissions, dsMaintenance, dsVehicles } from '../../export/datasets.js';

export function renderVehicleSheet(page) {
  const immat = state.vehicleSheetImmat;
  const vehicle = vehicleByImmat(immat);
  const cat = vehicle ? vehicle._cat : null;

  const dots = DB.dotationPool.filter((d) => same(d.immat, immat));
  // Le carburant des missions est porte par la mission elle-meme (rapport).
  const missionsCarburant = DB.missions.filter((m) => same(m.vehicule, immat) && (m.ravitaillements || []).length);
  const missions = DB.missions.filter((m) => same(m.vehicule, immat));
  const maint = DB.maintenance.filter((m) => same(m.immat, immat));

  page.appendChild(
    toolbar([
      { label: '← Retour aux véhicules', color: COLORS.blue, onClick: () => navigate('VEHICULES') },
      canWrite() && vehicle && { label: '✎ Modifier le véhicule', color: COLORS.green, write: true, onClick: () => openVehicleForm(stripCat(vehicle), cat) },
      canWrite() && { label: '+ Fiche d’entretien', color: COLORS.orange, write: true, onClick: () => openFicheForm(null, immat) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', immat, vehicle, dots, missions, maint) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', immat, vehicle, dots, missions, maint) }
    ])
  );

  if (vehicle) {
    page.appendChild(
      card(
        `${vehicle.marque || ''} ${vehicle.modele || ''}`.trim() || immat,
        `Immatriculation : ${vehicle.immatNouvelle || '—'}${vehicle.immatAncienne ? ` (anc. ${vehicle.immatAncienne})` : ''}\n` +
          `Statut : ${vehicle.statut} · Catégorie : ${String(cat).toUpperCase()} · Km : ${fmt(vehicle.km)}\n` +
          `Énergie : ${vehicle.energie || '—'} · Couleur : ${vehicle.couleur || '—'}${vehicle.groupe ? ` · Groupe : ${vehicle.groupe}` : ''}` +
          (vehicle.section ? `\nSection : ${vehicle.section}` : '') +
          (vehicle.utilisateur ? ` · Utilisateur : ${vehicle.utilisateur}` : '') +
          (vehicle.observations ? `\nObservations : ${vehicle.observations}` : ''),
        statutColor(vehicle.statut)
      )
    );
  } else {
    page.appendChild(
      card(
        immat || 'Véhicule inconnu',
        "Aucune fiche véhicule n'est enregistrée pour cette immatriculation dans la rubrique VÉHICULES. Les informations ci-dessous proviennent des autres rubriques.",
        COLORS.orange
      )
    );
  }

  // La fiche ne chiffre plus le carburant ni l'entretien : elle compte les
  // litres, les passages au garage et les missions. Les montants se lisent
  // dans le rapport « Coûts par véhicule », qui n'existe que pour cela.
  const litresMission = sum(missionsCarburant, (m) => sum(m.ravitaillements || [], (r) => r.quantite));
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Carburant', `${fmt(sum(dots, (d) => d.quantite) + litresMission)} L`, `${dots.length + missionsCarburant.length} prise(s)`, COLORS.orange));
  grid.appendChild(statTile('Entretien', fmt(maint.length), 'passage(s) au garage', COLORS.red));
  grid.appendChild(statTile('Missions', fmt(missions.length), `${fmt(sum(missions, (m) => m.jours))} jour(s) cumulés`, COLORS.purple));
  page.appendChild(grid);

  /* ---------------------------- Dotations ---------------------------- */
  if (dots.length) {
    page.appendChild(sectionLabel(`DOTATIONS POOL (${dots.length})`, COLORS.orange));
    dots
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .forEach((d) => {
        page.appendChild(
          card(
            `${dateFR(d.date)} — ${fmt(d.montant)} F`,
            `${fmt(d.quantite)} L à ${fmt(d.prixL)} F/L · ${d.station || 'station non précisée'}\nKm : ${fmt(d.km)} · Vidange : ${d.vidange || '—'}`,
            COLORS.orange
          )
        );
      });
  }

  if (missionsCarburant.length) {
    page.appendChild(sectionLabel(`CARBURANT DES MISSIONS (${missionsCarburant.length})`, COLORS.orange));
    missionsCarburant.forEach((m) => {
      const rav = m.ravitaillements || [];
      const litres = sum(rav, (r) => r.quantite);
      const montant = sum(rav, (r) => num(r.quantite) * num(r.prixL));
      page.appendChild(
        card(
          `${m.ref ? `${m.ref} — ` : ''}${m.conducteur} — ${fmt(montant)} F`,
          `${m.destination || '—'} · ${dateFR(m.dateDepart)} → ${dateFR(m.dateRetour) || '…'}\n` +
            `${fmt(litres)} L · ${rav.length} ravitaillement(s) · ` +
            `${rav.map((r) => r.station).filter(Boolean).join(', ') || 'stations non précisées'}`,
          COLORS.orange
        )
      );
    });
  }

  /* ----------------------------- Missions ---------------------------- */
  if (missions.length) {
    page.appendChild(sectionLabel(`MISSIONS (${missions.length})`, COLORS.purple));
    missions
      .slice()
      .sort((a, b) => String(b.dateDepart).localeCompare(String(a.dateDepart)))
      .forEach((m) => {
        page.appendChild(
          card(
            `${m.ref} — ${m.conducteur}`,
            `${m.destination || '—'} · ${dateFR(m.dateDepart)} → ${dateFR(m.dateRetour) || '…'} (${m.jours || 0} j)\n` +
              `${m.paye ? `🟢 Payée${m.datePaiement ? ` le ${m.datePaiement}` : ''}` : '🔴 En attente de paiement'}`,
            COLORS.purple
          )
        );
      });
  }

  /* ---------------------------- Entretien ---------------------------- */
  if (maint.length) {
    page.appendChild(sectionLabel(`HISTORIQUE ENTRETIEN (${maint.length})`, COLORS.green));
    const enCours = maint.filter((m) => !m.dateRetour);
    if (enCours.length) {
      const d = daysBetween(enCours[0].dateEntree, new Date().toISOString().slice(0, 10));
      page.appendChild(
        card('VÉHICULE ACTUELLEMENT AU GARAGE', `Entré le ${dateFR(enCours[0].dateEntree)}${d !== null ? ` — immobilisé depuis ${d} jour(s)` : ''}\nMotif : ${enCours[0].motif || '—'}`, COLORS.orange)
      );
    }
    renderMaintenanceEntries(page, maint);
  }

  if (!vehicle && !dots.length && !missionsCarburant.length && !missions.length && !maint.length) {
    page.appendChild(emptyState('Aucune donnée trouvée pour cette immatriculation.'));
  }
}

function same(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

function stripCat(v) {
  const copy = Object.assign({}, v);
  delete copy._cat;
  return copy;
}

async function doExport(kind, immat, vehicle, dots, missions, maint) {
  try {
    const datasets = [];
    if (vehicle) {
      const ds = dsVehicles([vehicle]);
      ds.title = `Fiche ${immat}`;
      datasets.push(ds);
    }
    if (dots.length) datasets.push(dsDotationPool(dots));
    if (missions.length) datasets.push(dsMissions(missions));
    if (maint.length) datasets.push(dsMaintenance(maint));
    if (!datasets.length) {
      toast('Rien à exporter pour ce véhicule.', 'info');
      return;
    }
    const safe = String(immat || 'vehicule').replace(/[^A-Za-z0-9_-]+/g, '_');
    const res = kind === 'excel'
      ? await exportExcel(datasets, `PDU_fiche_${safe}`)
      : await exportPdf(datasets, `PDU_fiche_${safe}`, { title: `Fiche véhicule ${immat}` });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

