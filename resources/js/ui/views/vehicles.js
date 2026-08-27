/* ===================================================================
   VÉHICULES — pool / mission / service.

   Chaque sous-rubrique presente les vehicules en tableau, une ligne par
   vehicule, avec toutes les informations du formulaire.
   =================================================================== */

import {
  DB, CATEGORIES, STATUTS_VEHICULE, ENERGIES, SECTIONS,
  insert, update, remove, moveVehicle, immatOf, maintenanceCost, fuelCost, etatVidange
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, fmt, num, norm } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast,
  dataTable, COLORS
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

/** Pastille resumant l'etat de la vidange d'un vehicule. */
export function badgeVidange(e) {
  if (e.statut === 'inconnu') {
    return '<span style="color:#8aa0a6">non suivie</span>';
  }
  if (e.statut === 'depassee') {
    return `<span class="badge" style="background:${COLORS.red}">Dépassée de ${fmt(-e.restant)} km</span>`;
  }
  if (e.statut === 'proche') {
    return `<span class="badge" style="background:${COLORS.orange}">⚠ Dans ${fmt(e.restant)} km</span>`;
  }
  return `<span class="badge" style="background:${COLORS.green}">Dans ${fmt(e.restant)} km</span>`;
}

/** Champs du formulaire vehicule (partages creation / modification). */
function vehicleFields(v = {}, cat = 'pool') {
  const withSection = cat !== 'mission';
  const agents = DB.users.map((u) => `${u.nom} ${u.prenoms}`.trim()).filter(Boolean);
  const marques = [...new Set(
    DB.vehicles.pool.concat(DB.vehicles.mission, DB.vehicles.service).map((x) => x.marque).filter(Boolean)
  )];

  return [
    { key: 'marque', label: 'Marque', required: true, value: v.marque, list: marques },
    { key: 'modele', label: 'Modèle', value: v.modele },
    { key: 'immatNouvelle', label: 'Nouvelle immatriculation', required: true, value: v.immatNouvelle },
    { key: 'immatAncienne', label: 'Ancienne immatriculation', value: v.immatAncienne },
    { key: 'couleur', label: 'Couleur', value: v.couleur },
    { key: 'energie', label: 'Énergie', type: 'select', options: ENERGIES, value: v.energie || 'Essence' },
    { key: 'statut', label: 'Statut', type: 'select', options: STATUTS_VEHICULE, value: v.statut || 'Disponible' },
    ...(withSection
      ? [
          {
            key: 'section',
            label: 'Section',
            type: 'select',
            options: SECTIONS,
            allowEmpty: true,
            emptyLabel: '— aucune —',
            value: v.section
          },
          { key: 'utilisateur', label: 'Utilisateur', value: v.utilisateur, list: agents,
            hint: agents.length ? 'Agents enregistrés dans UTILISATEURS' : 'Enregistrez d’abord les agents dans UTILISATEURS' }
        ]
      : []),
    { key: 'km', label: 'Kilométrage', type: 'number', value: v.km },
    { key: 'kmVidange', label: 'Kilométrage de vidange', type: 'number', value: v.kmVidange,
      hint: 'Kilométrage auquel la vidange devra être faite' },
    { key: 'etatVidange', label: 'Suivi de la vidange', type: 'static', value: '' },
    { key: 'categorie', label: 'Catégorie', type: 'select', options: CATEGORIES.map((c) => ({ value: c.key, label: c.label })), value: cat },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: v.observations }
  ];
}

export function renderVehicles(page) {
  const cat = state.sub.VEHICULES || 'pool';
  const f = state.filters.vehicules;
  const withSection = cat !== 'mission';

  page.appendChild(
    card('VÉHICULES', 'Véhicules de pool, de mission et de service. Cliquez sur « Fiche » pour voir tout l’historique d’un véhicule.', COLORS.green)
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
        type: 'select',
        value: f.section,
        options: [{ value: '', label: 'Toutes les sections' }, ...SECTIONS],
        onChange: (v) => { f.section = v; rerender(); }
      }
    ])
  );

  let list = DB.vehicles[cat].slice().reverse();
  if (f.statut) list = list.filter((v) => v.statut === f.statut);
  if (f.section) list = list.filter((v) => v.section === f.section);

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

  const headers = [
    'Marque', 'Modèle', 'Immat.<br>nouvelle', 'Immat.<br>ancienne', 'Couleur', 'Énergie', 'Statut',
    ...(withSection ? ['Section', 'Utilisateur'] : []),
    'Km', 'Vidange<br>à', 'Suivi vidange', 'Carburant', 'Entretien', 'Observations', ''
  ];

  const rows = list.map((v) => {
    const im = immatOf(v);
    return [
      `<b>${esc(v.marque || '')}</b>`,
      esc(v.modele || ''),
      esc(v.immatNouvelle || ''),
      esc(v.immatAncienne || ''),
      esc(v.couleur || ''),
      esc(v.energie || ''),
      `<span class="badge" style="background:${statutColor(v.statut)}">${esc(v.statut || '')}</span>`,
      ...(withSection ? [esc(v.section || ''), esc(v.utilisateur || '')] : []),
      `<span style="display:block;text-align:right">${fmt(v.km)}</span>`,
      `<span style="display:block;text-align:right">${v.kmVidange === '' || v.kmVidange === undefined ? '—' : fmt(v.kmVidange)}</span>`,
      badgeVidange(etatVidange(v)),
      `<span style="display:block;text-align:right">${fmt(fuelCost(im))} F</span>`,
      `<span style="display:block;text-align:right">${fmt(maintenanceCost(im))} F</span>`,
      esc(v.observations || ''),
      `<button class="miniBtn" style="background:${COLORS.blue};padding:5px 8px" data-sheet>Fiche</button>` +
        (canWrite()
          ? ` <button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button>` +
            ` <button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
          : '')
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const v = list[i];
      tr.dataset.search = norm(
        `${v.marque} ${v.modele} ${v.immatNouvelle} ${v.immatAncienne} ${v.statut} ${v.section} ${v.utilisateur}`
      );
      tr.querySelector('[data-sheet]').onclick = () => openVehicleSheet(immatOf(v));

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openVehicleForm(v, cat);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          const ok = await confirmDialog({
            title: 'Supprimer le véhicule',
            message: `Supprimer définitivement ${v.marque} ${v.modele} (${immatOf(v) || 'sans immatriculation'}) ?\n\nLes dotations, missions et fiches d'entretien liées à cette immatriculation seront conservées.`,
            okLabel: 'Supprimer',
            danger: true
          });
          if (!ok) return;
          remove(`vehicles.${cat}`, v.id);
          toast('Véhicule supprimé.', 'ok');
          rerender();
        };
      }
    })
  );
}

/** Formulaire de creation / modification. */
export function openVehicleForm(vehicle, cat) {
  const isEdit = !!vehicle;
  const fields = vehicleFields(vehicle || {}, cat);
  // On ne propose le kilometrage de vidange qu une seule fois par ouverture.
  let propositionFaite = isEdit;

  openForm({
    title: isEdit ? `Modifier — ${vehicle.marque} ${vehicle.modele}` : `Nouveau véhicule — ${CATEGORIES.find((c) => c.key === cat).label}`,
    fields,
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer le véhicule',
    onInput: (values, scope) => {
      const cible = scope.querySelector('[data-key="kmVidange"]');
      const suivi = scope.querySelector('[data-key="etatVidange"]');

      // Sur un vehicule neuf, on propose le kilometrage courant augmente de
      // l'intervalle de vidange. La proposition ne se fait qu'une fois : si
      // l'utilisateur efface ou corrige, on ne la lui réimpose pas.
      if (cible && !cible.value && !propositionFaite && num(values.km) > 0) {
        cible.value = num(values.km) + num(DB.settings.seuilVidangeKm);
        propositionFaite = true;
      }

      if (suivi) {
        const e = etatVidange({ km: values.km, kmVidange: cible ? cible.value : '' });
        suivi.value =
          e.statut === 'inconnu' ? 'Renseignez le kilométrage de vidange pour activer le suivi'
            : e.statut === 'depassee' ? `⚠ Vidange dépassée de ${fmt(-e.restant)} km`
              : e.statut === 'proche' ? `⚠ Vidange dans ${fmt(e.restant)} km`
                : `Vidange dans ${fmt(e.restant)} km`;
      }
    },
    onSubmit: (values) => {
      const targetCat = values.categorie || cat;
      const immat = String(values.immatNouvelle || '').trim().toUpperCase();
      const doublon = DB.vehicles.pool
        .concat(DB.vehicles.mission, DB.vehicles.service)
        .find((x) => x.id !== (vehicle && vehicle.id) && String(x.immatNouvelle || '').trim().toUpperCase() === immat);
      if (doublon) return `L'immatriculation ${immat} est déjà utilisée par un autre véhicule.`;

      const payload = {
        marque: values.marque,
        modele: values.modele,
        immatNouvelle: values.immatNouvelle,
        immatAncienne: values.immatAncienne,
        couleur: values.couleur,
        energie: values.energie,
        section: values.section || '',
        utilisateur: values.utilisateur || '',
        statut: values.statut,
        km: values.km,
        kmVidange: values.kmVidange,
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
