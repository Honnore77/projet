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
  carburantMissions, missionsAvecCarburant, ravMontant, prixLitreOptions,
  suiviDotationPool, soldePrecedentCarte, knownDrivers
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO, sum, francSup } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast,
  statTile, dataTable, COLORS
} from '../components.js';
import { state, navigate, rerender } from '../shell.js';
import { renderStatistiques, SOUS_RUBRIQUE_STATS } from './statistiques.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsDotationPool, dsCarburantMissions, dsRavitaillementsMissions } from '../../export/datasets.js';
import { filtrer } from '../../core/acces.js';

const SUBS = [
  { key: 'pool', label: 'DOTATION EN CARBURANT POOL' },
  { key: 'mission', label: 'DOTATION EN CARBURANT MISSION' },
  SOUS_RUBRIQUE_STATS
];

export function renderDotation(page) {
  const sub = state.sub.DOTATION || 'pool';
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.DOTATION = k; rerender(); }, { pool: COLORS.orange, mission: COLORS.purple, stats: COLORS.grey })
  );
  if (sub === 'stats') renderStatistiques(page, 'DOTATION');
  else if (sub === 'mission') renderMission(page);
  else renderPool(page);
}

/* ===================== DOTATION CARBURANT POOL ===================== */

/** Numeros de carte deja utilises, pour ne pas les retaper. */
function cartesConnues() {
  return [...new Set(DB.dotationPool.map((x) => String(x.carte || '').trim()).filter(Boolean))];
}

/**
 * Montant d'une prise : les litres au prix du litre, arrondi au franc
 * superieur.
 *
 * L'apercu et l'enregistrement passent tous deux par ici, pour que le champ
 * « Montant calcule » annonce le chiffre qui sera reellement inscrit.
 */
function montantPrise(values) {
  return francSup(num(values.quantite) * francSup(values.prixL));
}

/**
 * Derniere dotation enregistree pour une immatriculation. Elle porte le
 * numero de carte du vehicule et le solde laisse par la prise precedente :
 * de quoi enchainer une nouvelle prise sans rien retaper.
 *
 * La dotation en cours de modification est ecartee : sans quoi elle se
 * reprendrait a elle-meme, son propre solde apres prise devenant son solde
 * avant prise. Une prise ne se precede pas.
 *
 * @param {string} immat
 * @param {string} [exclureId] identifiant de la dotation en cours d'edition
 */
function dernierePrise(immat, exclureId) {
  const cle = String(immat || '').trim().toUpperCase();
  if (!cle) return null;
  return DB.dotationPool
    .filter((x) => x.id !== exclureId && String(x.immat || '').trim().toUpperCase() === cle)
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
    // Le prix a la pompe se regle une fois dans REGLAGES et se choisit ici :
    // il est le meme pour tout le monde a une date donnee. « + Autre prix »
    // reste ouvert pour une prise ancienne ou un prix qui vient de changer.
    { key: 'prixL', label: 'Prix / L', type: 'selectAdd', required: true, value: d.prixL,
      options: prixLitreOptions(d.energie), emptyLabel: '— choisir —', addLabel: 'Autre prix',
      hint: 'Réglé dans RÉGLAGES → Modifier les réglages' },
    { key: 'montant', label: 'Montant calculé', type: 'static', value: d.montant ? fmt(d.montant) : '0' },
    { key: 'rechargement', label: 'Rechargement de la carte (F)', type: 'number', value: d.rechargement,
      hint: 'Seulement si la carte a été rechargée depuis la prise précédente' },
    { key: 'soldeAvant', label: 'Solde avant prise', type: 'number', value: d.soldeAvant,
      hint: 'Solde après la prise précédente sur la carte, plus le rechargement' },
    { key: 'soldeApres', label: 'Solde après prise', type: 'number', readonly: true, value: d.soldeApres,
      hint: 'Solde avant prise moins le montant calculé' },
    { key: 'soldeReleve', label: 'Solde relevé sur le ticket (F)', type: 'number', value: d.soldeReleve,
      hint: 'Facultatif : le solde imprimé sur le ticket après la prise. L’écart avec le solde calculé s’affiche dans le tableau' },
    { key: 'station', label: 'Station-service', value: d.station, list: [...new Set(DB.dotationPool.map((x) => x.station).filter(Boolean))] },
    { key: 'vidange', label: 'État vidange', type: 'select', options: ETATS_VIDANGE, value: d.vidange || 'À jour' },
    { key: 'conducteur', label: 'Conducteur', value: d.conducteur, list: knownDrivers(),
      hint: 'Le conducteur qui est allé prendre le carburant' },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: d.observations },
    { key: 'images', label: 'Photos et documents', type: 'images', full: true, value: d.images,
      hint: 'Reçu de la station-service, ticket de la carte carburant' }
  ];
}

/**
 * Ecart entre le solde releve sur le ticket et le solde calcule, en rouge
 * et avec son signe. Le solde releve s'affiche au survol.
 */
function ecartCell(ecart, releve) {
  if (ecart === '' || ecart === undefined) return '<span style="display:block;text-align:right">—</span>';
  const signe = ecart > 0 ? '+' : ecart < 0 ? '−' : '';
  return `<span style="display:block;text-align:right;color:${COLORS.red};font-weight:700" title="Solde relevé : ${fmt(releve)} F">` +
    `${signe}${fmt(Math.abs(ecart))} F</span>`;
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
      'Date · Nombre de jours depuis la prise précédente du véhicule · Immatriculation · Marque/Modèle · Carte carburant · Énergie · Kilométrage · Quantité · Prix/L · Montant · ' +
      'Solde avant et après prise, enchaînés d’une prise à l’autre sur chaque carte · Écart avec le solde relevé sur le ticket · Station-service · État vidange · Conducteur.',
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

  // Un conducteur n'y voit que les dotations de son vehicule.
  let list = filtrer('DOTATION', DB.dotationPool.slice());
  if (f.dateFrom) list = list.filter((d) => !d.date || d.date >= f.dateFrom);
  if (f.dateTo) list = list.filter((d) => !d.date || d.date <= f.dateTo);
  if (f.immat) list = list.filter((d) => norm(d.immat || '').includes(norm(f.immat)));
  // Dans l'ordre des prises, de la plus ancienne a la plus recente (a date
  // egale, dans l'ordre de saisie) : le solde apres d'une ligne se lit
  // comme le solde avant de la suivante sur la meme carte.
  const suivi = suiviDotationPool();
  const rang = new Map([...suivi.keys()].map((id, i) => [id, i]));
  list.sort((a, b) => rang.get(a.id) - rang.get(b.id));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Dotations', fmt(list.length), 'sur la période filtrée', COLORS.orange));
  grid.appendChild(statTile('Litres', fmt(sum(list, (d) => d.quantite)), 'volume total', COLORS.blue));
  grid.appendChild(statTile('Montant', `${fmt(sum(list, (d) => d.montant))} F`, 'dépense carburant', COLORS.green));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Ajouter une dotation pool', cls: 'addBtn', color: COLORS.orange, write: true, onClick: () => openPoolForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', 'pool', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', 'pool', list) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', 'pool', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.dotationPool.length ? 'Aucune dotation ne correspond aux filtres.' : 'Aucune dotation pool enregistrée.'));
    return;
  }

  const headers = [
    'Date', 'Nombre<br>de jours', 'Immatriculation', 'Marque / Modèle', 'Carte<br>carburant', 'Énergie', 'Kilométrage',
    'Quantité<br>(L)', 'Prix / L', 'Montant', 'Solde<br>avant', 'Solde<br>après', 'Écart',
    'Station-service', 'État<br>vidange', 'Conducteur', ''
  ];

  const rows = list.map((d) => {
    const s = suivi.get(d.id) || {};
    return [
      esc(dateFR(d.date)),
      `<span style="display:block;text-align:center">${s.jours === null || s.jours === undefined ? '—' : fmt(s.jours)}</span>`,
      `<b>${esc(d.immat || '')}</b>`,
      esc(d.marqueModele || ''),
      esc(d.carte || ''),
      esc(d.energie || ''),
      `<span style="display:block;text-align:right">${fmt(d.km)}</span>`,
      `<span style="display:block;text-align:right">${fmt(d.quantite)}</span>`,
      `<span style="display:block;text-align:right">${fmt(d.prixL)}</span>`,
      `<span style="display:block;text-align:right"><b>${fmt(d.montant)} F</b></span>`,
      `<span style="display:block;text-align:right">${soldeCell(s.soldeAvant)}` +
        (num(d.rechargement) ? `<small style="display:block;color:${COLORS.green}">dont +${fmt(d.rechargement)} F rechargés</small>` : '') +
        '</span>',
      `<span style="display:block;text-align:right">${soldeCell(s.soldeApres)}</span>`,
      ecartCell(s.ecart, d.soldeReleve),
      esc(d.station || ''),
      `<span class="badge" style="background:${d.vidange === 'En retard' ? COLORS.red : COLORS.orange}">${esc(d.vidange || '')}</span>`,
      esc(d.conducteur || ''),
      canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const d = list[i];
      tr.dataset.search = norm(`${d.immat} ${d.marqueModele} ${d.carte} ${d.station} ${d.date} ${d.conducteur || ''}`);

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
  // Dernier prix que le formulaire a propose de lui-meme. Il sert a savoir
  // ce qu'on a le droit de remplacer quand l'energie change : une valeur
  // choisie a la main n'est jamais ecrasee, la notre l'est volontiers.
  let prixPropose = null;

  openForm({
    title: isEdit ? `Modifier la dotation — ${d.immat}` : 'Nouvelle dotation — POOL',
    fields: poolFields(d || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la dotation',
    onInput: (values, scope) => {
      // Le montant se lit ici exactement comme il sera enregistre : arrondi
      // au franc superieur. Un apercu non arrondi annoncerait une depense que
      // la ligne enregistree contredirait d'un franc.
      const montant = montantPrise(values);
      const mNode = scope.querySelector('[data-key="montant"]');
      if (mNode) mNode.value = `${fmt(montant)} F`;

      // Le prix suit l'energie : passer au diesel doit proposer le prix du
      // diesel, pas laisser celui de l'essence. On ne remplace que le vide ou
      // notre propre proposition — un prix choisi a la main tient.
      const prix = scope.querySelector('select[data-key="prixL"]');
      if (prix && (!prix.value || prix.value === prixPropose)) {
        const propose = prixLitreOptions(values.energie)[0];
        if (propose && [...prix.options].some((o) => o.value === propose)) {
          prix.value = propose;
          prixPropose = propose;
        }
      }

      const mm = scope.querySelector('[data-key="marqueModele"]');
      if (mm && !mm.value && values.immat) {
        const v = vehicleByImmat(values.immat);
        if (v) mm.value = `${v.marque || ''} ${v.modele || ''}`.trim();
      }

      // Le vehicule choisi apporte sa carte, reprise de sa derniere prise ;
      // elle reste modifiable.
      const carte = scope.querySelector('[data-key="carte"]');
      if (values.immat && carte && !carte.value) {
        const prec = dernierePrise(values.immat, d && d.id);
        if (prec && prec.carte) carte.value = prec.carte;
      }

      // Le solde avant prise suit la carte : solde apres de la prise qui
      // precede sur cette carte, plus le rechargement. Il ne se saisit que
      // pour la toute premiere prise d'une carte (solde de depart).
      const avant = scope.querySelector('[data-key="soldeAvant"]');
      const precedent = soldePrecedentCarte(carte ? carte.value : values.carte, values.date, d && d.id);
      if (avant) {
        const enchaine = precedent !== null && precedent !== '';
        avant.readOnly = enchaine;
        if (enchaine) {
          avant.value = num(precedent) + num(values.rechargement);
          values.soldeAvant = avant.value;
        }
      }

      // Le solde apres prise est le solde avant prise moins le montant : ce
      // n'est pas une valeur a constater mais une soustraction. La saisir a
      // la main ouvrait la porte a un solde qui ne correspond pas a la
      // depense — le champ est donc calcule et en lecture seule.
      const apres = scope.querySelector('[data-key="soldeApres"]');
      if (apres) {
        apres.value = values.soldeAvant === '' ? '' : francSup(values.soldeAvant) - montant;
      }
    },
    onSubmit: (values) => {
      const montant = montantPrise(values);
      const precedent = soldePrecedentCarte(values.carte, values.date, d && d.id);
      if (precedent !== null && precedent !== '') values.soldeAvant = num(precedent) + num(values.rechargement);
      const payload = {
        date: values.date,
        immat: String(values.immat || '').trim().toUpperCase(),
        marqueModele: values.marqueModele,
        carte: String(values.carte || '').trim(),
        rechargement: values.rechargement === '' ? '' : francSup(values.rechargement),
        soldeReleve: values.soldeReleve === '' ? '' : francSup(values.soldeReleve),
        soldeAvant: values.soldeAvant === '' ? '' : francSup(values.soldeAvant),
        soldeApres: values.soldeAvant === ''
          ? ''
          : francSup(values.soldeAvant) - montant,
        energie: values.energie,
        km: values.km,
        quantite: num(values.quantite),
        prixL: francSup(values.prixL),
        montant,
        station: values.station,
        vidange: values.vidange,
        conducteur: String(values.conducteur || '').trim(),
        observations: values.observations,
        images: values.images
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

  let list = filtrer('DOTATION', missionsAvecCarburant());
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
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', 'mission', list) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', 'mission', list) }
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
      : kind === 'word'
        ? await exportWord(datasets, name, { title: titre })
        : await exportPdf(datasets, name, { title: titre });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
