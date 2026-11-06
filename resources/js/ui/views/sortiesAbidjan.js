/* ===================================================================
   MISSIONS → SORTIES D'ABIDJAN (collection `sortiesAbidjan`).

   Deplacements hors d'Abidjan qui ne sont pas des missions : ils ne
   comptent ni dans le tour de role, ni dans les jours, ni dans le nombre
   de missions des conducteurs. Ils reprennent du rapport de mission les
   points de ravitaillement et le total des depenses.
   =================================================================== */

import {
  DB, insert, update, remove, knownImmats, knownDrivers,
  prochaineRefSortieAbidjan, refSortieAbidjanEnDouble, nomsDestinationsMission, destinationMissionParNom,
  assurerDestinationMission, parcoursMission, libelleParcours, totauxSortieAbidjan, ravMontant
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO, sum, francSup } from '../../core/utils.js';
import { champVehicule, champParticipant,
  autreImmat, card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast, statTile, dataTable
} from '../components.js';
import { state, rerender, moduleColor } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsSortiesAbidjan } from '../../export/datasets.js';
import { filtrer } from '../../core/acces.js';
import { monterRavitaillements } from './missions.js';

/** La couleur de MISSIONS. */
const COULEUR = () => moduleColor('MISSION');

/** Bouton d'action d'une ligne de tableau. */
function miniBtn(couleur, attr, libelle, titre = '') {
  return `<button class="miniBtn" style="background:${couleur};padding:5px 8px" ${attr}` +
    `${titre ? ` title="${esc(titre)}"` : ''}>${libelle}</button>`;
}

export function renderSortiesAbidjan(page) {
  const f = state.filters.sortiesAbidjan;

  page.appendChild(
    card(
      'SORTIES D’ABIDJAN',
      'Déplacements hors d’Abidjan qui ne sont pas des missions : ils ne comptent ni dans le tour de rôle, ' +
        'ni dans les jours, ni dans le nombre de missions des conducteurs.',
      COULEUR()
    )
  );

  // Un conducteur n'y voit que ses propres sorties.
  const tous = filtrer('MISSION', (DB.sortiesAbidjan || []).slice());
  const conducteurs = [...new Set(tous.map((x) => x.conducteur).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  page.appendChild(
    filterBar([
      { type: 'date', title: 'Du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
      { type: 'date', title: 'Au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
      {
        type: 'select', value: f.conducteur,
        options: [{ value: '', label: 'Tous les conducteurs' }].concat(conducteurs),
        onChange: (v) => { f.conducteur = v; rerender(); }
      }
    ])
  );

  let list = tous;
  if (f.dateFrom) list = list.filter((x) => !x.date || x.date >= f.dateFrom);
  if (f.dateTo) list = list.filter((x) => !x.date || x.date <= f.dateTo);
  if (f.conducteur) list = list.filter((x) => norm(x.conducteur || '') === norm(f.conducteur));
  list.sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.ref || '').localeCompare(String(a.ref || ''), 'fr', { numeric: true }));

  const rav = list.flatMap((x) => x.ravitaillements || []);
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Sorties', fmt(list.length), 'sur la période filtrée', COULEUR()));
  grid.appendChild(statTile('Carburant', `${fmt(sum(rav, (r) => r.quantite))} L`, `${fmt(sum(rav, ravMontant))} F`, '#F47B20'));
  grid.appendChild(statTile('Dépenses', `${fmt(sum(list, (x) => totauxSortieAbidjan(x).total))} F`,
    'carburant, péage, divers', COULEUR()));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouvelle sortie d’Abidjan', cls: 'addBtn', color: COULEUR(), write: true, onClick: () => openSortieAbidjanForm(null) },
      { label: '⬇ Excel', color: '#1D6F42', onClick: () => doExport('excel', list) },
      { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', list) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState((DB.sortiesAbidjan || []).length
      ? 'Aucune sortie d’Abidjan ne correspond aux filtres.' : 'Aucune sortie d’Abidjan enregistrée.'));
    return;
  }

  const headers = [
    'Réf.', 'Date', 'Conducteur', 'Véhicule', 'Destination', 'Km<br>départ', 'Km<br>arrivée',
    'Parcours<br>(A-R)', 'Participants', 'Dotation', 'Carburant', 'Péage', 'Total', 'Observation', ''
  ];
  const droite = (v) => `<span style="display:block;text-align:right;white-space:nowrap">${v}</span>`;
  const vide = (v) => v === '' || v === undefined || v === null;
  const francs = (v) => (vide(v) ? '' : `${fmt(v)} F`);

  const rows = list.map((x) => {
    const t = totauxSortieAbidjan(x);
    return [
      `<b style="white-space:nowrap">${esc(x.ref || '')}</b>`,
      esc(dateFR(x.date)),
      esc(x.conducteur || ''),
      esc(x.vehicule || '') + autreImmat(x.vehicule),
      esc(x.destination || ''),
      droite(vide(x.kmDepart) ? '' : esc(fmt(x.kmDepart))),
      droite(vide(x.kmArrivee) ? '' : esc(fmt(x.kmArrivee))),
      droite(esc(libelleParcours(parcoursMission(x)) || '—')),
      escLignes((x.participants || []).filter(Boolean).join('\n')),
      droite(esc(francs(x.dotationCarburant))),
      droite(esc(francs(t.carburant))),
      droite(esc(francs(t.fraisPeage))),
      droite(`<b>${esc(francs(t.total))}</b>`),
      escLignes(x.observations || ''),
      canWrite()
        ? `${miniBtn('#008A3B', 'data-edit data-write', '✎')} ${miniBtn('#D32F2F', 'data-del data-write', '✕')}`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const x = list[i];
      tr.dataset.search = norm(
        `${x.ref} ${x.date} ${x.conducteur} ${x.vehicule} ${x.destination} ${(x.participants || []).join(' ')}`
      );

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openSortieAbidjanForm(x);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({
            title: 'Supprimer la sortie d’Abidjan',
            message: `Supprimer la sortie ${x.ref || ''} de ${x.conducteur || '—'} vers ${x.destination || '—'} ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('sortiesAbidjan', x.id);
          toast('Sortie d’Abidjan supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

/** « 640 km » aller-retour, ou ce qui manque pour le calculer. */
function texteParcoursSortie(destination) {
  if (!String(destination || '').trim()) return 'choisir une destination';
  return libelleParcours(parcoursMission({ destinations: [destination] })) ||
    'distance inconnue — à renseigner dans MISSIONS → DESTINATIONS';
}

function sortieAbidjanFields(x = {}) {
  const p = x.participants || [];
  return [
    { key: 'ref', label: 'Référence', required: true, value: x.ref || prochaineRefSortieAbidjan(),
      hint: 'Proposée à la suite de la dernière ; modifiable' },
    { key: 'date', label: 'Date de la sortie', type: 'date', required: true, value: x.date || todayISO() },
    { key: 'conducteur', label: 'Conducteur', required: true, value: x.conducteur, list: knownDrivers() },
    champVehicule('vehicule', 'Véhicule', x.vehicule),
    // Les memes destinations que les missions : la distance depuis Abidjan
    // ne se renseigne qu'une fois, dans MISSIONS → DESTINATIONS.
    { key: 'destination', label: 'Destination', type: 'selectAdd', required: true, value: x.destination,
      options: nomsDestinationsMission(), emptyLabel: '— choisir —', addLabel: 'Nouvelle destination',
      hint: 'Une nouvelle destination rejoint MISSIONS → DESTINATIONS' },
    { key: 'kmDepart', label: 'Kilométrage départ', type: 'nombre', value: x.kmDepart },
    { key: 'kmArrivee', label: 'Kilométrage arrivée', type: 'nombre', value: x.kmArrivee },
    { key: 'dotationCarburant', label: 'Dotation (F)', type: 'montant', value: x.dotationCarburant },
    champParticipant('participant1', 'Participant 1', p[0]),
    champParticipant('participant2', 'Participant 2', p[1]),
    champParticipant('participant3', 'Participant 3', p[2]),
    champParticipant('participant4', 'Participant 4', p[3]),
    { key: 'parcours', label: 'Parcours calculé (aller-retour)', type: 'static', value: texteParcoursSortie(x.destination),
      hint: 'Abidjan → destination → Abidjan' },
    { key: 'fraisPeage', label: 'Frais de péage (F)', type: 'montant', value: x.fraisPeage },
    { key: 'depenseDivers', label: 'Dépense divers (F)', type: 'montant', value: x.depenseDivers },
    { key: 'justificationDivers', label: 'Justification de la dépense divers', value: x.justificationDivers },
    // Reliee a VÉHICULES → ÉTAT DES VÉHICULES, comme l'observation du
    // rapport de mission (voir observationsSources).
    { key: 'observations', label: 'Observation', type: 'textarea', full: true, rows: 3, value: x.observations,
      placeholder: 'RAS, ou le problème constaté sur le véhicule pendant la sortie',
      hint: 'Un problème décrit ici est signalé dans VÉHICULES → ÉTAT DES VÉHICULES ; « RAS » si rien à signaler' }
  ];
}

export function openSortieAbidjanForm(x) {
  const isEdit = !!x;
  const rav = ((x && x.ravitaillements) || []).map((r) => Object.assign({}, r));
  let majTotaux = () => {};
  const francsOuVide = (v) => (v === '' ? '' : francSup(v));

  openForm({
    title: isEdit ? `Modifier la sortie d’Abidjan — ${x.ref || ''}` : 'Nouvelle sortie d’Abidjan',
    fields: sortieAbidjanFields(x || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la sortie',
    onInput: (values, scope) => {
      majTotaux();
      const node = scope.querySelector('[data-key="parcours"]');
      if (node) node.value = texteParcoursSortie(values.destination);
    },
    // Les points de ravitaillement et le total des depenses, comme dans le
    // rapport de mission.
    extra: (scope) => { majTotaux = monterRavitaillements(scope, rav, { fraisOm: false, titre: 'Total des dépenses de la sortie' }); },
    onSubmit: (v) => {
      const ref = String(v.ref || '').trim().toUpperCase();
      if (refSortieAbidjanEnDouble(ref, x && x.id)) {
        return `La référence ${ref} est déjà attribuée à une autre sortie d’Abidjan.`;
      }
      // Une destination deja connue garde son ecriture ; une nouvelle
      // rejoint la liste des destinations des missions.
      const connue = destinationMissionParNom(v.destination);
      const destination = connue ? connue.nom : String(v.destination || '').trim();
      const creee = connue ? null : assurerDestinationMission(destination);

      const payload = {
        ref,
        date: v.date,
        conducteur: v.conducteur,
        vehicule: String(v.vehicule || '').trim().toUpperCase(),
        destination,
        destinations: destination ? [destination] : [],
        kmDepart: v.kmDepart,
        kmArrivee: v.kmArrivee,
        dotationCarburant: francsOuVide(v.dotationCarburant),
        participants: [v.participant1, v.participant2, v.participant3, v.participant4].filter(Boolean),
        ravitaillements: rav,
        fraisPeage: francsOuVide(v.fraisPeage),
        // Plus de frais OM pour une sortie : un montant saisi avant s'efface.
        fraisOm: '',
        depenseDivers: francsOuVide(v.depenseDivers),
        justificationDivers: v.justificationDivers,
        observations: v.observations
      };
      if (isEdit) update('sortiesAbidjan', x.id, payload);
      else insert('sortiesAbidjan', Object.assign({ createdAt: new Date().toISOString() }, payload));

      toast(
        (isEdit ? 'Sortie d’Abidjan mise à jour.' : 'Sortie d’Abidjan enregistrée.') +
          (creee ? ` « ${creee.nom} » ajoutée aux destinations, distance à renseigner.` : ''),
        'ok', creee ? 4500 : 2600
      );
      rerender();
      return null;
    }
  });
}

async function doExport(kind, list) {
  try {
    const datasets = [dsSortiesAbidjan(list)];
    const name = 'PDU_sorties_abidjan';
    const titre = 'Sorties d’Abidjan';
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
