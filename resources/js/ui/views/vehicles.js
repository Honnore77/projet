/* ===================================================================
   VÉHICULES — pool / mission / service, avec creation, modification,
   changement de categorie et suppression.
   =================================================================== */

import {
  DB, CATEGORIES, STATUTS_VEHICULE, ENERGIES,
  insert, update, remove, moveVehicle, immatOf, maintenanceCost, fuelCost
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, norm } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast, COLORS
} from '../components.js';
import { state, rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsVehicles } from '../../export/datasets.js';

const CAT_COLORS = { pool: COLORS.green, mission: COLORS.blue, service: COLORS.purple };

export function statutColor(s) {
  if (s === 'Disponible') return COLORS.green;
  if (s === 'En mission') return COLORS.blue;
  if (s === 'En entretien') return COLORS.orange;
  return COLORS.red;
}

/** Champs du formulaire vehicule (partages creation / modification). */
function vehicleFields(v = {}, cat = 'pool') {
  const withSection = cat !== 'mission';
  const sections = [...new Set(DB.users.map((u) => u.section).filter(Boolean))];
  const agents = DB.users.map((u) => `${u.nom} ${u.prenoms}`.trim()).filter(Boolean);
  return [
    { key: 'marque', label: 'Marque', required: true, value: v.marque, list: [...new Set(DB.vehicles.pool.concat(DB.vehicles.mission, DB.vehicles.service).map((x) => x.marque).filter(Boolean))] },
    { key: 'modele', label: 'Modèle', value: v.modele },
    { key: 'immatNouvelle', label: 'Nouvelle immatriculation', required: true, value: v.immatNouvelle },
    { key: 'immatAncienne', label: 'Ancienne immatriculation', value: v.immatAncienne },
    { key: 'couleur', label: 'Couleur', value: v.couleur },
    { key: 'energie', label: 'Énergie', type: 'select', options: ENERGIES, value: v.energie || 'Essence' },
    { key: 'groupe', label: 'Groupe', value: v.groupe },
    { key: 'statut', label: 'Statut', type: 'select', options: STATUTS_VEHICULE, value: v.statut || 'Disponible' },
    ...(withSection
      ? [
          { key: 'section', label: 'Section', value: v.section, list: sections },
          { key: 'utilisateur', label: 'Utilisateur', value: v.utilisateur, list: agents }
        ]
      : []),
    { key: 'km', label: 'Kilométrage', type: 'number', value: v.km },
    { key: 'categorie', label: 'Catégorie', type: 'select', options: CATEGORIES.map((c) => ({ value: c.key, label: c.label })), value: cat },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: v.observations }
  ];
}

export function renderVehicles(page) {
  const cat = state.sub.VEHICULES || 'pool';
  const f = state.filters.vehicules;

  page.appendChild(
    card('VÉHICULES', 'Véhicules de pool, de mission et de service. Cliquez sur « Fiche complète » pour voir tout l’historique d’un véhicule.', COLORS.green)
  );

  page.appendChild(
    subtabs(
      CATEGORIES.map((c) => ({ key: c.key, label: `${c.label} (${DB.vehicles[c.key].length})` })),
      cat,
      (k) => { state.sub.VEHICULES = k; rerender(); },
      CAT_COLORS
    )
  );

  page.appendChild(
    filterBar([
      {
        type: 'select',
        value: f.statut,
        options: [{ value: '', label: 'Tous les statuts' }, ...STATUTS_VEHICULE],
        onChange: (v) => { f.statut = v; rerender(); }
      },
      {
        type: 'text',
        placeholder: 'Filtrer par section / utilisateur',
        value: f.section,
        onChange: (v) => { f.section = v; rerender(); }
      }
    ])
  );

  let list = DB.vehicles[cat].slice().reverse();
  if (f.statut) list = list.filter((v) => v.statut === f.statut);
  if (f.section) {
    const q = norm(f.section);
    list = list.filter((v) => norm(`${v.section || ''} ${v.utilisateur || ''}`).includes(q));
  }

  page.appendChild(
    toolbar([
      canWrite() && {
        label: `+ Ajouter un véhicule (${CATEGORIES.find((c) => c.key === cat).label})`,
        cls: 'addBtn',
        color: COLORS.green,
        write: true,
        onClick: () => openVehicleForm(null, cat)
      },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', list, cat) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', list, cat) }
    ])
  );

  if (!list.length) {
    page.appendChild(
      emptyState(
        DB.vehicles[cat].length
          ? 'Aucun véhicule ne correspond aux filtres choisis.'
          : `Aucun véhicule enregistré dans ${CATEGORIES.find((c) => c.key === cat).label} pour le moment.`
      )
    );
    return;
  }

  list.forEach((v) => page.appendChild(vehicleEntry(v, cat)));
}

function vehicleEntry(v, cat) {
  const im = immatOf(v);
  const e = el('<div class="entry"></div>');
  e.style.borderLeftColor = CAT_COLORS[cat];
  e.dataset.search = norm(
    `${v.marque} ${v.modele} ${v.immatNouvelle} ${v.immatAncienne} ${v.statut} ${v.section} ${v.utilisateur} ${v.groupe}`
  );

  e.innerHTML =
    `<div class="row1"><h4>${esc(v.marque)} ${esc(v.modele)}</h4>` +
    `<span class="badge" style="background:${statutColor(v.statut)}">${esc(v.statut)}</span></div>` +
    `<div class="meta">${esc(v.immatNouvelle || '—')}${v.immatAncienne ? ` <small>(anc. ${esc(v.immatAncienne)})</small>` : ''} · ${esc(v.couleur || '—')} · ${esc(v.energie || '—')}</div>` +
    '<div class="fields">' +
    (v.groupe ? `<b>Groupe :</b> ${esc(v.groupe)}<br>` : '') +
    (v.section ? `<b>Section :</b> ${esc(v.section)}<br>` : '') +
    (v.utilisateur ? `<b>Utilisateur :</b> ${esc(v.utilisateur)}<br>` : '') +
    `<b>Km :</b> ${fmt(v.km)} · <b>Carburant :</b> ${fmt(fuelCost(im))} F · <b>Entretien :</b> ${fmt(maintenanceCost(im))} F` +
    (v.observations ? `<br><b>Observations :</b> ${esc(v.observations)}` : '') +
    '</div>' +
    '<div class="actions">' +
    `<button class="miniBtn" style="background:${COLORS.blue}" data-sheet>Fiche complète</button>` +
    (canWrite() ? `<button class="miniBtn" style="background:${COLORS.green}" data-edit data-write>✎ Modifier</button>` : '') +
    (canWrite() ? `<button class="miniBtn" style="background:${COLORS.red}" data-del data-write>Supprimer</button>` : '') +
    '</div>';

  e.querySelector('[data-sheet]').onclick = () => openVehicleSheet(im);
  const editBtn = e.querySelector('[data-edit]');
  if (editBtn) editBtn.onclick = () => openVehicleForm(v, cat);
  const delBtn = e.querySelector('[data-del]');
  if (delBtn) {
    delBtn.onclick = async () => {
      const ok = await confirmDialog({
        title: 'Supprimer le véhicule',
        message: `Supprimer définitivement ${v.marque} ${v.modele} (${im || 'sans immatriculation'}) ?\n\nLes dotations, missions et fiches d'entretien liées à cette immatriculation seront conservées.`,
        okLabel: 'Supprimer',
        danger: true
      });
      if (!ok) return;
      remove(`vehicles.${cat}`, v.id);
      toast('Véhicule supprimé.', 'ok');
      rerender();
    };
  }
  return e;
}

/** Formulaire de creation / modification. */
export function openVehicleForm(vehicle, cat) {
  const isEdit = !!vehicle;
  const fields = vehicleFields(vehicle || {}, cat);

  openForm({
    title: isEdit ? `Modifier — ${vehicle.marque} ${vehicle.modele}` : `Nouveau véhicule — ${CATEGORIES.find((c) => c.key === cat).label}`,
    fields,
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer le véhicule',
    onSubmit: (values) => {
      const targetCat = values.categorie || cat;
      const immat = String(values.immatNouvelle || '').trim().toUpperCase();
      const doublon = DB.vehicles[targetCat]
        .concat(targetCat !== 'pool' ? DB.vehicles.pool : [], targetCat !== 'mission' ? DB.vehicles.mission : [], targetCat !== 'service' ? DB.vehicles.service : [])
        .find((x) => x.id !== (vehicle && vehicle.id) && String(x.immatNouvelle || '').trim().toUpperCase() === immat);
      if (doublon) return `L'immatriculation ${immat} est déjà utilisée par un autre véhicule.`;

      const payload = {
        marque: values.marque,
        modele: values.modele,
        immatNouvelle: values.immatNouvelle,
        immatAncienne: values.immatAncienne,
        couleur: values.couleur,
        energie: values.energie,
        groupe: values.groupe,
        section: values.section || '',
        utilisateur: values.utilisateur || '',
        statut: values.statut,
        km: values.km,
        observations: values.observations
      };

      if (isEdit) {
        update(`vehicles.${cat}`, vehicle.id, payload);
        if (targetCat !== cat) {
          moveVehicle(vehicle.id, cat, targetCat);
          state.sub.VEHICULES = targetCat;
        }
        toast('Véhicule mis à jour.', 'ok');
      } else {
        insert(`vehicles.${targetCat}`, payload);
        state.sub.VEHICULES = targetCat;
        toast('Véhicule enregistré.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

async function doExport(kind, list, cat) {
  const ds = dsVehicles(list.map((v) => Object.assign({ _cat: cat }, v)));
  ds.title = `Vehicules ${CATEGORIES.find((c) => c.key === cat).label}`;
  try {
    const res = kind === 'excel'
      ? await exportExcel([ds], `PDU_vehicules_${cat}`)
      : await exportPdf([ds], `PDU_vehicules_${cat}`, { title: 'État du parc automobile' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

