/* ===================================================================
   VÉHICULES RÉFORMÉS — sous-rubrique de VÉHICULES.

   Un vehicule reforme sort du parc. Il quitte POOL, MISSION ou SERVICE
   pour cette liste, qui garde ce qu'on savait de lui (le tableau des
   vehicules) et ce qu'on sait de sa reforme : annee de mise en service,
   date de la reforme, beneficiaire, kilometrage et etat a la reforme.
   =================================================================== */

import {
  DB, CATEGORIES, CAT_REFORME, ETATS_REFORME, ENERGIES, SECTIONS, MARQUES, MODELES, COULEURS,
  insert, update, remove, reformerVehicule, remettreEnService, anneesDeService, immatOf, kmCourant, valeursVehicules
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, fmt, num, norm, dateFR, todayISO } from '../../core/utils.js';
import { toolbar, emptyState, openForm, confirmDialog, toast, dataTable, COLORS } from '../components.js';
import { state, rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { filtrer } from '../../core/acces.js';

const libelleCat = (k) => (CATEGORIES.find((c) => c.key === k) || { label: '' }).label;
const vide = (x) => x === '' || x === undefined || x === null;

/** Informations propres a la reforme, communes a tous les formulaires. */
function champsReforme(v) {
  return [
    { key: 'anneeMiseService', label: 'Année de mise en service', type: 'number', step: '1', value: v.anneeMiseService,
      placeholder: 'Ex. 2015' },
    { key: 'dateReforme', label: 'Date de la réforme', type: 'date', required: true, value: v.dateReforme || todayISO() },
    { key: 'beneficiaire', label: 'Bénéficiaire', value: v.beneficiaire,
      placeholder: 'Personne ou structure à qui le véhicule est cédé' },
    { key: 'kmReforme', label: 'Kilométrage à la réforme', type: 'number', value: vide(v.kmReforme) ? kmCourant(v) || '' : v.kmReforme },
    { key: 'etatReforme', label: 'État du véhicule à la réforme', type: 'selectAdd', value: v.etatReforme,
      options: ETATS_REFORME, emptyLabel: '— choisir —', addLabel: 'Autre état' }
  ];
}

/** Ce qu'on sait du vehicule lui-meme, pour une saisie directe ou une correction. */
function champsVehicule(v) {
  return [
    { key: 'marque', label: 'Marque', type: 'selectAdd', required: true, value: v.marque,
      options: valeursVehicules('marque', MARQUES), emptyLabel: '— choisir —', addLabel: 'Autre marque' },
    { key: 'modele', label: 'Modèle', type: 'selectAdd', value: v.modele,
      options: valeursVehicules('modele', MODELES), emptyLabel: '— choisir —', addLabel: 'Autre modèle' },
    { key: 'immatNouvelle', label: 'Nouvelle immatriculation', value: v.immatNouvelle },
    { key: 'immatAncienne', label: 'Ancienne immatriculation', value: v.immatAncienne },
    { key: 'numeroChassis', label: 'N° de châssis', value: v.numeroChassis },
    { key: 'couleur', label: 'Couleur', type: 'selectAdd', value: v.couleur,
      options: valeursVehicules('couleur', COULEURS), emptyLabel: '— choisir —', addLabel: 'Autre couleur' },
    { key: 'energie', label: 'Énergie', type: 'select', options: ENERGIES, value: v.energie || 'Essence' },
    { key: 'consommation', label: 'Consommation (litres pour 100 km)', type: 'number', step: '0.1', value: v.consommation },
    { key: 'origine', label: 'Catégorie avant la réforme', type: 'select',
      options: CATEGORIES.map((c) => ({ value: c.key, label: c.label })), value: v.origine || 'pool' },
    { key: 'section', label: 'Section', type: 'select', options: SECTIONS, allowEmpty: true, emptyLabel: '— aucune —', value: v.section },
    { key: 'utilisateur', label: 'Dernier utilisateur', value: v.utilisateur }
  ];
}

/**
 * Formulaire de reforme.
 *
 * - depuis POOL, MISSION ou SERVICE (`fromCat`) : seules les informations
 *   de la reforme sont demandees, puis le vehicule change de sous-rubrique ;
 * - dans VEHICULES REFORMES : la fiche complete, pour une saisie directe
 *   (vehicule reforme avant l'application) ou une correction.
 */
export function openReformeForm(vehicle, fromCat) {
  const v = vehicle || {};
  const dansLeParc = fromCat !== CAT_REFORME && !!vehicle;
  const nom = `${v.marque || ''} ${v.modele || ''}`.trim();
  const fields = [
    ...(dansLeParc ? [] : champsVehicule(v)),
    ...champsReforme(v),
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: v.observations },
    ...(dansLeParc ? [] : [{ key: 'images', label: 'Photos et documents', type: 'images', full: true, value: v.images }])
  ];

  openForm({
    title: dansLeParc
      ? `Réformer — ${nom}${immatOf(v) ? ` (${immatOf(v)})` : ''}`
      : vehicle ? `Modifier — ${nom} (réformé)` : 'Nouveau véhicule réformé',
    fields,
    okLabel: dansLeParc ? 'Sortir le véhicule du parc' : 'Enregistrer',
    onSubmit: (values) => {
      const annee = values.anneeMiseService;
      if (!vide(annee) && (annee < 1950 || annee > new Date().getFullYear())) {
        return 'L’année de mise en service ne paraît pas juste.';
      }
      if (!vide(annee) && values.dateReforme && Number(values.dateReforme.slice(0, 4)) < annee) {
        return 'La réforme ne peut pas précéder la mise en service.';
      }
      const reforme = {
        anneeMiseService: vide(annee) ? '' : Math.round(annee),
        dateReforme: values.dateReforme,
        beneficiaire: String(values.beneficiaire || '').trim(),
        kmReforme: vide(values.kmReforme) ? '' : Math.max(0, num(values.kmReforme)),
        etatReforme: values.etatReforme || '',
        observations: values.observations
      };

      if (dansLeParc) {
        reformerVehicule(v.id, fromCat, reforme);
        toast(`${nom || 'Le véhicule'} est sorti du parc : voir VÉHICULES RÉFORMÉS.`, 'ok');
      } else {
        const fiche = Object.assign(reforme, {
          marque: values.marque,
          modele: values.modele,
          immatNouvelle: String(values.immatNouvelle || '').trim().toUpperCase(),
          immatAncienne: String(values.immatAncienne || '').trim(),
          numeroChassis: String(values.numeroChassis || '').replace(/\s+/g, '').toUpperCase(),
          couleur: values.couleur,
          energie: values.energie,
          consommation: vide(values.consommation) ? '' : Math.max(0, Number(values.consommation)),
          origine: values.origine,
          section: values.section || '',
          utilisateur: String(values.utilisateur || '').trim(),
          statut: 'Réformé',
          images: values.images
        });
        if (vehicle) update(`vehicles.${CAT_REFORME}`, v.id, fiche);
        else insert(`vehicles.${CAT_REFORME}`, fiche);
        toast(vehicle ? 'Véhicule réformé mis à jour.' : 'Véhicule réformé enregistré.', 'ok');
      }
      state.sub.VEHICULES = CAT_REFORME;
      rerender();
      return null;
    }
  });
}

/** Tableau de la sous-rubrique. */
export function renderReformes(page) {
  const list = filtrer('VEHICULES', DB.vehicles[CAT_REFORME].slice())
    .sort((a, b) => String(b.dateReforme || '').localeCompare(String(a.dateReforme || '')));

  page.appendChild(
    toolbar([
      canWrite() && {
        label: '+ Ajouter un véhicule réformé',
        cls: 'addBtn',
        color: COLORS.green,
        write: true,
        onClick: () => openReformeForm(null, CAT_REFORME)
      },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => exporter('excel', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => exporter('pdf', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(
      'Aucun véhicule réformé. Pour sortir un véhicule du parc, donnez-lui le statut « Réformé » dans POOL, MISSION ou SERVICE.'
    ));
    return;
  }

  const droite = (x) => `<span style="display:block;text-align:right">${x}</span>`;
  const headers = [
    'Marque', 'Modèle', 'Immat.<br>nouvelle', 'Immat.<br>ancienne', 'N° de<br>châssis', 'Couleur', 'Énergie',
    'Conso.<br>L/100 km', 'Catégorie<br>d’origine', 'Section', 'Dernier<br>utilisateur',
    'Mise en<br>service', 'Date de<br>réforme', 'Années de<br>service', 'Bénéficiaire', 'Km à la<br>réforme', 'État à la<br>réforme', 'Observations', ''
  ];
  const rows = list.map((v) => [
    `<b>${esc(v.marque || '')}</b>`,
    esc(v.modele || ''),
    esc(v.immatNouvelle || '—'),
    esc(v.immatAncienne || ''),
    `<span style="font-family:monospace;white-space:nowrap">${esc(v.numeroChassis || '')}</span>`,
    esc(v.couleur || ''),
    esc(v.energie || ''),
    droite(vide(v.consommation) ? '—' : esc(String(v.consommation).replace('.', ','))),
    esc(libelleCat(v.origine)),
    esc(v.section || ''),
    esc(v.utilisateur || ''),
    droite(esc(v.anneeMiseService ? String(v.anneeMiseService) : '—')),
    `<span style="white-space:nowrap">${esc(dateFR(v.dateReforme) || '—')}</span>`,
    droite(anneesDeService(v) === null ? '—' : `${anneesDeService(v)} an${anneesDeService(v) > 1 ? 's' : ''}`),
    esc(v.beneficiaire || ''),
    droite(vide(v.kmReforme) ? '—' : fmt(v.kmReforme)),
    esc(v.etatReforme || ''),
    esc(v.observations || ''),
    `<span style="white-space:nowrap"><button class="miniBtn" style="background:${COLORS.blue};padding:5px 8px" data-sheet>Fiche</button>` +
      (canWrite()
        ? ` <button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write title="Modifier">✎</button>` +
          ` <button class="miniBtn" style="background:${COLORS.orange};padding:5px 8px" data-retour data-write title="Remettre dans le parc">↩</button>` +
          ` <button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write title="Supprimer">✕</button>`
        : '') +
      '</span>'
  ]);

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const v = list[i];
      const nom = `${v.marque || ''} ${v.modele || ''}`.trim();
      tr.dataset.search = norm(
        `${v.marque} ${v.modele} ${v.immatNouvelle} ${v.immatAncienne} ${v.numeroChassis || ''} ${v.beneficiaire} ${v.etatReforme} ${v.utilisateur}`
      );
      tr.querySelector('[data-sheet]').onclick = () => openVehicleSheet(immatOf(v));
      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openReformeForm(v, CAT_REFORME);

      const retour = tr.querySelector('[data-retour]');
      if (retour) {
        retour.onclick = async () => {
          const ok = await confirmDialog({
            title: 'Remettre dans le parc',
            message: `Annuler la réforme de ${nom} (${immatOf(v) || 'sans immatriculation'}) ?\n\n` +
              `Il retourne dans ${libelleCat(v.origine) || 'POOL'} avec le statut « Disponible ». ` +
              'Les informations de la réforme restent sur sa fiche.',
            okLabel: 'Remettre dans le parc'
          });
          if (!ok) return;
          const cat = remettreEnService(v.id);
          toast(`Véhicule remis dans ${libelleCat(cat)}.`, 'ok');
          rerender();
        };
      }

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          const ok = await confirmDialog({
            title: 'Supprimer le véhicule réformé',
            message: `Supprimer définitivement ${nom} (${immatOf(v) || 'sans immatriculation'}) de la liste des véhicules réformés ?`,
            okLabel: 'Supprimer',
            danger: true
          });
          if (!ok) return;
          remove(`vehicles.${CAT_REFORME}`, v.id);
          toast('Véhicule supprimé.', 'ok');
          rerender();
        };
      }
    })
  );
}

/** Jeu de donnees exportable : memes colonnes que le tableau. */
export function dsVehiculesReformes(list) {
  const C = (key, label, width) => ({ key, label, width });
  return {
    title: 'Véhicules réformés',
    columns: [
      C('marque', 'Marque', 14), C('modele', 'Modèle', 16), C('immatNouvelle', 'Immat. nouvelle', 16),
      C('immatAncienne', 'Immat. ancienne', 16), C('numeroChassis', 'N° de châssis', 20), C('couleur', 'Couleur', 12),
      C('energie', 'Énergie', 11), C('consommation', 'Consommation (L/100 km)', 14), C('origine', 'Catégorie d’origine', 14),
      C('section', 'Section', 18), C('utilisateur', 'Dernier utilisateur', 20), C('anneeMiseService', 'Mise en service', 12),
      C('dateReforme', 'Date de réforme', 13), C('anneesService', 'Années de service', 12), C('beneficiaire', 'Bénéficiaire', 22), C('kmReforme', 'Km à la réforme', 14),
      C('etatReforme', 'État à la réforme', 18), C('observations', 'Observations', 30)
    ],
    rows: list.map((v) => ({
      marque: v.marque || '',
      modele: v.modele || '',
      immatNouvelle: v.immatNouvelle || '',
      immatAncienne: v.immatAncienne || '',
      numeroChassis: v.numeroChassis || '',
      couleur: v.couleur || '',
      energie: v.energie || '',
      consommation: vide(v.consommation) ? '' : Number(v.consommation),
      origine: libelleCat(v.origine),
      section: v.section || '',
      utilisateur: v.utilisateur || '',
      anneeMiseService: v.anneeMiseService || '',
      dateReforme: dateFR(v.dateReforme) || '',
      anneesService: anneesDeService(v) === null ? '' : anneesDeService(v),
      beneficiaire: v.beneficiaire || '',
      kmReforme: vide(v.kmReforme) ? '' : num(v.kmReforme),
      etatReforme: v.etatReforme || '',
      observations: v.observations || ''
    }))
  };
}

async function exporter(kind, list) {
  const ds = dsVehiculesReformes(list);
  try {
    const res = kind === 'excel'
      ? await exportExcel([ds], 'PDU_vehicules_reformes')
      : await exportPdf([ds], 'PDU_vehicules_reformes', { title: 'Véhicules réformés' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
