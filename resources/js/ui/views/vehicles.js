/* ===================================================================
   VÉHICULES — pool / mission / service.

   Chaque sous-rubrique presente les vehicules en tableau, une ligne par
   vehicule, avec toutes les informations du formulaire. La colonne « État
   du véhicule » reprend les problemes non resolus de la sous-rubrique
   ÉTAT DES VÉHICULES.
   =================================================================== */

import {
  DB, CATEGORIES, CAT_REFORME, STATUT_NON_ATTRIBUE, STATUT_REFORME, statutsVehicule, ENERGIES, SECTIONS, MARQUES, MODELES, COULEURS,
  PREFIXE_IMMAT_NOUVELLE, PREFIXE_IMMAT_ANCIENNE,
  insert, update, remove, moveVehicle, immatOf, etatVidange,
  nomsUtilisateurs, assurerAgent, valeursVehicules, derniereLectureKm, kmCourant
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, fmt, num, norm, dateFR } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast,
  dataTable, COLORS
} from '../components.js';
import { renderStatistiques, SOUS_RUBRIQUE_STATS } from './statistiques.js';
import { state, rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsVehicles } from '../../export/datasets.js';
import { filtrer } from '../../core/acces.js';
import { renderReformes, openReformeForm } from './vehiculesReformes.js';
import { renderEtatsVehicules, COULEUR_ETAT } from './etatsVehicules.js';
import { problemesEnCours } from '../../core/etatsVehicules.js';

const CAT_COLORS = { pool: COLORS.green, mission: COLORS.blue, service: COLORS.purple, reforme: '#3e2723', etat: COULEUR_ETAT, stats: COLORS.grey };

/** Memes teintes que la pastille du bandeau (bleu) et que le graphique. */
export const COULEUR_NON_ATTRIBUE = '#1e6fd9';
export const COULEUR_REFORME = '#3e2723';

export function statutColor(s) {
  if (s === 'Disponible') return COLORS.green;
  if (s === 'En mission') return COLORS.blue;
  if (s === 'En entretien') return COLORS.orange;
  if (s === STATUT_NON_ATTRIBUE) return COULEUR_NON_ATTRIBUE;
  if (s === STATUT_REFORME) return COULEUR_REFORME;
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
  const agents = nomsUtilisateurs();
  const marques = valeursVehicules('marque', MARQUES);

  // Un vehicule enregistre avant le retrait d'un statut garde le sien : on le
  // rajoute a la liste plutot que de le remplacer en douce a la modification.
  const proposes = statutsVehicule(cat);
  const statuts = proposes.includes(v.statut) || !v.statut
    ? proposes
    : proposes.concat([v.statut]);

  return [
    { key: 'marque', label: 'Marque', type: 'selectAdd', required: true, value: v.marque,
      options: marques, emptyLabel: '— choisir —', addLabel: 'Autre marque' },
    { key: 'modele', label: 'Modèle', type: 'selectAdd', value: v.modele,
      options: valeursVehicules('modele', MODELES), emptyLabel: '— choisir —', addLabel: 'Autre modèle' },
    { key: 'immatNouvelle', label: 'Nouvelle immatriculation',
      value: v.immatNouvelle === undefined ? PREFIXE_IMMAT_NOUVELLE : v.immatNouvelle,
      hint: 'Facultative — signalée en rouge tant qu’elle manque' },
    { key: 'immatAncienne', label: 'Ancienne immatriculation',
      value: v.immatAncienne === undefined ? PREFIXE_IMMAT_ANCIENNE : v.immatAncienne },
    // Le numero de chassis (VIN) identifie le vehicule pour de bon : il ne
    // change pas avec la plaque, et c'est lui que demandent l'assurance et
    // le garage.
    { key: 'numeroChassis', label: 'N° de châssis', value: v.numeroChassis,
      placeholder: 'Ex. JTMHV05J604123456', hint: 'Inscrit sur la carte grise (rubrique E)' },
    { key: 'couleur', label: 'Couleur', type: 'selectAdd', value: v.couleur,
      options: valeursVehicules('couleur', COULEURS), emptyLabel: '— choisir —', addLabel: 'Autre couleur' },
    { key: 'energie', label: 'Énergie', type: 'select', options: ENERGIES, value: v.energie || 'Essence' },
    { key: 'consommation', label: 'Consommation (litres pour 100 km)', type: 'number', step: '0.1', value: v.consommation,
      placeholder: 'Ex. 9,5', hint: 'Reprise par SIMULATION quand on choisit ce véhicule' },
    { key: 'statut', label: 'Statut', type: 'select', options: statuts, value: v.statut || 'Disponible' },
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
          {
            key: 'utilisateur',
            label: 'Utilisateur',
            type: 'selectAdd',
            // Un vehicule attribue a un agent depuis supprime garde son nom :
            // il vaut mieux une valeur devenue orpheline qu'une attribution
            // effacee sans que personne ne l'ait demande.
            options: agents.includes(v.utilisateur) || !v.utilisateur ? agents : agents.concat([v.utilisateur]),
            emptyLabel: '— aucun —',
            addLabel: 'Autre nom',
            value: v.utilisateur,
            hint: 'Un nom saisi ici est ajouté à la rubrique UTILISATEURS'
          }
        ]
      : []),
    { key: 'km', label: 'Kilométrage', type: 'number', value: v.km,
      hint: 'Repris du dernier relevé du compteur : dotation carburant, entrée ou retour de garage, rapport de mission' },
    { key: 'sourceKm', label: 'Origine du kilométrage', type: 'static', value: '' },
    { key: 'kmVidange', label: 'Kilométrage de vidange', type: 'number', value: v.kmVidange,
      hint: 'Kilométrage auquel la vidange devra être faite' },
    { key: 'etatVidange', label: 'Suivi de la vidange', type: 'static', value: '' },
    { key: 'categorie', label: 'Catégorie', type: 'select', options: CATEGORIES.map((c) => ({ value: c.key, label: c.label })), value: cat },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: v.observations },
    { key: 'images', label: 'Photos et documents', type: 'images', full: true, value: v.images,
      hint: 'Photo du vehicule, carte grise, assurance, visite technique' }
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
      [
        ...CATEGORIES.map((c) => ({ key: c.key, label: `${c.label} (${DB.vehicles[c.key].length})` })),
        { key: CAT_REFORME, label: `VÉHICULES RÉFORMÉS (${DB.vehicles[CAT_REFORME].length})` },
        { key: 'etat', label: `ÉTAT DES VÉHICULES (${(DB.etatsVehicules || []).filter((s) => s.resolu !== 'Oui').length})` },
        SOUS_RUBRIQUE_STATS
      ],
      cat,
      (k) => { state.sub.VEHICULES = k; rerender(); },
      CAT_COLORS
    )
  );
  if (cat === 'stats') return renderStatistiques(page, 'VEHICULES');
  if (cat === CAT_REFORME) return renderReformes(page);
  if (cat === 'etat') return renderEtatsVehicules(page);

  page.appendChild(
    filterBar([
      {
        type: 'select',
        value: f.statut,
        options: [{ value: '', label: 'Tous les statuts' }, ...statutsVehicule(cat)],
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

  // Un conducteur n'y voit que le vehicule qui lui est attribue.
  let list = filtrer('VEHICULES', DB.vehicles[cat].slice().reverse());
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
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', list, cat) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', list, cat) }
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
    'Marque', 'Modèle', 'Immat.<br>nouvelle', 'Immat.<br>ancienne', 'N° de<br>châssis', 'Couleur', 'Énergie',
    'Conso.<br>L/100 km', 'Statut',
    ...(withSection ? ['Section', 'Utilisateur'] : []),
    'Km', 'Prochaine<br>vidange', 'Suivi vidange', 'État du<br>véhicule', ''
  ];

  const rows = list.map((v) => {
    return [
      `<b>${esc(v.marque || '')}</b>`,
      esc(v.modele || ''),
      v.immatNouvelle
        ? esc(v.immatNouvelle)
        : '<span class="celluleManquante">non renseignée</span>',
      esc(v.immatAncienne || ''),
      `<span style="font-family:monospace;white-space:nowrap">${esc(v.numeroChassis || '')}</span>`,
      esc(v.couleur || ''),
      esc(v.energie || ''),
      `<span style="display:block;text-align:right">${v.consommation === '' || v.consommation === undefined ? '—' : esc(String(v.consommation).replace('.', ','))}</span>`,
      `<span class="badge" style="background:${statutColor(v.statut)}">${esc(v.statut || '')}</span>`,
      ...(withSection ? [esc(v.section || ''), esc(v.utilisateur || '')] : []),
      `<span style="display:block;text-align:right">${fmt(kmCourant(v))}</span>`,
      `<span style="display:block;text-align:right">${v.kmVidange === '' || v.kmVidange === undefined ? '—' : fmt(v.kmVidange)}</span>`,
      badgeVidange(etatVidange(v)),
      celluleEtat(v),
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
        `${v.marque} ${v.modele} ${v.immatNouvelle} ${v.immatAncienne} ${v.numeroChassis || ''} ${v.statut} ${v.section} ${v.utilisateur}`
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

/**
 * Colonne « État du véhicule » : les problemes signales et pas encore
 * resolus (sous-rubrique ÉTAT DES VÉHICULES), le plus recent d'abord.
 * Sans probleme en cours, la cellule le dit simplement.
 */
function celluleEtat(v) {
  const pbs = problemesEnCours(v);
  if (!pbs.length) return '<span style="color:#008A3B;white-space:nowrap">✓ RAS</span>';
  return pbs.map((s) =>
    `<div class="etatPb" title="Signalé le ${esc(dateFR(s.dateSignalement))}${s.signalePar ? ` par ${esc(s.signalePar)}` : ''}">` +
    `⚠ ${esc(String(s.probleme || '').split('\n')[0])} <small>(${esc(dateFR(s.dateSignalement))})</small></div>`).join('');
}

/** Les vehicules de mission ne portent pas d'utilisateur attitre. */
function withSectionCat(cat) {
  return cat !== 'mission';
}

/** Formulaire de creation / modification. */
export function openVehicleForm(vehicle, cat) {
  const isEdit = !!vehicle;
  const fields = vehicleFields(vehicle || {}, cat);
  // On ne propose le kilometrage de vidange qu une seule fois par ouverture.
  let propositionFaite = isEdit;
  // Dernier kilometrage que le formulaire a pose de lui-meme. Il dit ce qu'on
  // a le droit d'effacer si l'immatriculation change : le releve d'un autre
  // vehicule ne doit pas rester en place, mais un chiffre saisi a la main si.
  let kmPose = null;

  openForm({
    title: isEdit ? `Modifier — ${vehicle.marque} ${vehicle.modele}` : `Nouveau véhicule — ${CATEGORIES.find((c) => c.key === cat).label}`,
    fields,
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer le véhicule',
    onInput: (values, scope) => {
      const cible = scope.querySelector('[data-key="kmVidange"]');
      const suivi = scope.querySelector('[data-key="etatVidange"]');

      // Le compteur se releve dans les autres rubriques — prise de carburant,
      // entree et retour de garage. La fiche affiche donc le dernier releve
      // plutot que d'attendre qu'on le reporte a la main : le champ passe en
      // lecture seule et dit d'ou vient le chiffre. Sans releve, il se saisit
      // normalement.
      const km = scope.querySelector('[data-key="km"]');
      const origine = scope.querySelector('[data-key="sourceKm"]');
      const lecture = derniereLectureKm(values.immatNouvelle || values.immatAncienne);
      if (km) {
        if (lecture) {
          km.value = lecture.km;
          kmPose = String(lecture.km);
          km.readOnly = true;
        } else {
          // Plus de releve — plaque effacee, corrigee, ou vehicule que les
          // autres rubriques ne connaissent pas encore. Le chiffre du releve
          // precedent n'a plus rien a faire la : il serait enregistre pour un
          // vehicule qui n'a jamais affiche ce compteur.
          if (km.value === kmPose) km.value = '';
          kmPose = null;
          km.readOnly = false;
        }
        km.closest('.fRow').classList.toggle('readonly', !!lecture);
      }
      if (origine) {
        origine.value = lecture
          ? `${lecture.source} du ${dateFR(lecture.date)}`
          : 'Aucun relevé — saisissez le kilométrage';
      }

      // Sur un vehicule neuf, on propose le kilometrage courant augmente de
      // l'intervalle de vidange. La proposition ne se fait qu'une fois : si
      // l'utilisateur efface ou corrige, on ne la lui réimpose pas.
      const kmActuel = num(km ? km.value : values.km);
      if (cible && !cible.value && !propositionFaite && kmActuel > 0) {
        cible.value = kmActuel + num(DB.settings.seuilVidangeKm);
        propositionFaite = true;
      }

      if (suivi) {
        const e = etatVidange({ km: km ? km.value : values.km, kmVidange: cible ? cible.value : '' });
        suivi.value =
          e.statut === 'inconnu' ? 'Renseignez le kilométrage de vidange'
            : e.statut === 'depassee' ? `⚠ Vidange dépassée de ${fmt(-e.restant)} km`
              : e.statut === 'proche' ? `⚠ Vidange dans ${fmt(e.restant)} km`
                : `Vidange dans ${fmt(e.restant)} km`;
      }
    },
    onSubmit: (values) => {
      const targetCat = values.categorie || cat;

      // Le prefixe est pre-inscrit dans le champ. Laisse tel quel, il ne
      // designe aucun vehicule : le champ etant facultatif, cela vaut une
      // immatriculation absente, pas une erreur de saisie.
      const saisie = String(values.immatNouvelle || '').trim();
      const immat = saisie.toUpperCase() === PREFIXE_IMMAT_NOUVELLE.trim().toUpperCase()
        ? ''
        : saisie.toUpperCase();

      // Deux vehicules sans immatriculation ne sont pas des doublons : le
      // controle ne porte que sur une plaque effectivement saisie.
      if (immat) {
        const doublon = DB.vehicles.pool
          .concat(DB.vehicles.mission, DB.vehicles.service, DB.vehicles[CAT_REFORME])
          .find((x) => x.id !== (vehicle && vehicle.id) && String(x.immatNouvelle || '').trim().toUpperCase() === immat);
        if (doublon) return `L'immatriculation ${immat} est déjà utilisée par un autre véhicule.`;
      }

      // Un numero de chassis ne designe qu'un vehicule : saisi deux fois,
      // c'est une erreur de frappe ou un doublon de fiche.
      const chassis = String(values.numeroChassis || '').replace(/\s+/g, '').toUpperCase();
      if (chassis) {
        const meme = DB.vehicles.pool
          .concat(DB.vehicles.mission, DB.vehicles.service, DB.vehicles[CAT_REFORME])
          .find((x) => x.id !== (vehicle && vehicle.id) && String(x.numeroChassis || '').replace(/\s+/g, '').toUpperCase() === chassis);
        if (meme) {
          return `Le n° de châssis ${chassis} est déjà celui de ${`${meme.marque || ''} ${meme.modele || ''}`.trim() || 'un autre véhicule'}` +
            `${meme.immatNouvelle || meme.immatAncienne ? ` (${meme.immatNouvelle || meme.immatAncienne})` : ''}.`;
        }
      }

      const ancienne = String(values.immatAncienne || '').trim();
      // Un nom saisi a la main rejoint UTILISATEURS : les deux rubriques ne
      // doivent pas connaitre des agents differents.
      if (withSectionCat(targetCat) && values.utilisateur) {
        assurerAgent(values.utilisateur, { section: values.section, immat });
      }

      const payload = {
        marque: values.marque,
        modele: values.modele,
        immatNouvelle: immat,
        immatAncienne: ancienne.toUpperCase() === PREFIXE_IMMAT_ANCIENNE.trim().toUpperCase() ? '' : ancienne,
        numeroChassis: chassis,
        couleur: values.couleur,
        energie: values.energie,
        consommation: values.consommation === '' ? '' : Math.max(0, Number(values.consommation)),
        section: values.section || '',
        utilisateur: values.utilisateur || '',
        statut: values.statut,
        km: values.km,
        kmVidange: values.kmVidange,
        observations: values.observations,
        images: values.images
      };

      let enregistre;
      if (isEdit) {
        update(`vehicles.${cat}`, vehicle.id, payload);
        if (targetCat !== cat) {
          moveVehicle(vehicle.id, cat, targetCat);
          state.sub.VEHICULES = targetCat;
        }
        enregistre = Object.assign({}, vehicle, payload);
        toast('Véhicule mis à jour.', 'ok');
      } else {
        enregistre = insert(`vehicles.${targetCat}`, payload);
        state.sub.VEHICULES = targetCat;
        toast('Véhicule enregistré.', 'ok');
      }
      rerender();
      // Un vehicule reforme sort du parc : on demande aussitot les
      // informations de la reforme. Sans elles (Annuler), il reste dans sa
      // sous-rubrique avec le statut « Réformé », sans voyant de vidange.
      if (payload.statut === STATUT_REFORME && cat !== CAT_REFORME) {
        setTimeout(() => openReformeForm(enregistre, targetCat), 0);
      }
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
      : kind === 'word'
        ? await exportWord([ds], `PDU_vehicules_${cat}`, { title: 'État du parc automobile' })
        : await exportPdf([ds], `PDU_vehicules_${cat}`, { title: 'État du parc automobile' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
