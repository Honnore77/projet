/* ===================================================================
   PROGRAMMES (voir core/programmes.js)

     MISSIONS → PROGRAMMES DES MISSIONS   les missions a venir : formulaire
        leger (dates, destinations, objet, conducteur, vehicule,
        participants), bouton « Créer la mission » le jour venu. Un
        programme realise ou dont la date de retour est passee quitte le
        tableau ; « Voir les programmes passés » les retrouve.

     TABLEAU DE BORD → PROGRAMMES   missions programmees, conges et
        absences a venir ou en cours, en un seul tableau trie par date,
        relie aux deux sous-rubriques d'origine, avec les conflits.
   =================================================================== */

import {
  DB, insert, update, remove, knownDrivers, joursMission, nomsDestinationsMission,
  destinationsDe, texteDestinations
} from '../../core/db.js';
import {
  etatProgramme, programmesActifs, programmesPasses, prochaineRefProgramme, conflitsProgramme,
  missionDuProgramme, agendaProgrammes
} from '../../core/programmes.js';
import { canWrite } from '../../core/auth.js';
import { filtrer, voit, peutSaisir } from '../../core/acces.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO, daysBetween } from '../../core/utils.js';
import {
  champVehicule, champParticipant, autreImmat, card, toolbar, emptyState, openForm, confirmDialog, toast,
  statTile, dataTable, COLORS
} from '../components.js';
import { state, rerender, moduleColor, navigate } from '../shell.js';
import { cablerParcours, enregistrerParcours, ajouterEtape, openMissionForm } from './missions.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsProgrammes, dsAgendaProgrammes } from '../../export/datasets.js';

const COULEUR = () => moduleColor('MISSION');

function miniBtn(couleur, attr, libelle, titre = '') {
  return `<button class="miniBtn" style="background:${couleur};padding:5px 8px" ${attr}` +
    `${titre ? ` title="${esc(titre)}"` : ''}>${libelle}</button>`;
}

/** « dans 3 jours », « demain », « en cours »... */
function echeance(etat, du) {
  if (etat === 'en cours') return '<b style="color:#F47B20">en cours</b>';
  if (etat !== 'à venir') return esc(etat);
  const n = daysBetween(todayISO(), du);
  if (n === null) return 'à venir';
  if (n === 0) return '<b>aujourd’hui</b>';
  if (n === 1) return '<b>demain</b>';
  return `dans ${fmt(n)} jours`;
}

function celluleConflits(conflits) {
  if (!conflits.length) return '<span style="color:#008A3B">✔</span>';
  return `<span style="color:#D32F2F" title="${esc(conflits.join('\n'))}">⚠ ${escLignes(conflits.join('\n'))}</span>`;
}

/* ============== MISSIONS → PROGRAMMES DES MISSIONS =============== */

export function renderProgrammes(page) {
  const f = state.filters.programmes;
  page.appendChild(card(
    'PROGRAMMES DES MISSIONS',
    'Les missions à venir, inscrites avant le départ. Un programme ne compte ni dans le tour de rôle, ni dans les jours, ' +
      'ni dans le cumul des missions. Le jour venu, « Créer la mission » ouvre le formulaire de mission déjà rempli ; ' +
      'le programme quitte alors ce tableau, comme celui dont la date de retour est passée.',
    COULEUR()
  ));

  // Un conducteur n'y voit que ses propres programmes.
  const actifs = filtrer('MISSION', programmesActifs());
  const passes = filtrer('MISSION', programmesPasses());
  const list = f.passes ? passes : actifs;
  const conflits = new Map(actifs.map((p) => [p.id, conflitsProgramme(p)]));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Programmées', fmt(actifs.length), 'missions à venir ou en cours', COULEUR()));
  const sept = actifs.filter((p) => { const n = daysBetween(todayISO(), p.dateDepart); return n !== null && n <= 7; }).length;
  grid.appendChild(statTile('Cette semaine', fmt(sept), 'départs dans les 7 jours', COLORS.orange));
  const nbConflits = [...conflits.values()].filter((c) => c.length).length;
  grid.appendChild(statTile('Conflits', fmt(nbConflits), nbConflits ? 'programme(s) à revoir' : 'aucun', nbConflits ? COLORS.red : COLORS.green));
  page.appendChild(grid);

  page.appendChild(toolbar([
    canWrite() && { label: '+ Nouvelle mission programmée', cls: 'addBtn', color: COULEUR(), write: true, onClick: () => openProgrammeForm(null) },
    { label: f.passes ? '← Programmes à venir' : `Voir les programmes passés (${passes.length})`, color: COLORS.grey,
      onClick: () => { f.passes = !f.passes; rerender(); } },
    { label: '⬇ Excel', color: '#1D6F42', onClick: () => doExport('excel', list, f.passes) },
    { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', list, f.passes) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', list, f.passes) }
  ]));

  if (!list.length) {
    page.appendChild(emptyState(f.passes ? 'Aucun programme passé.' : 'Aucune mission programmée.'));
    return;
  }

  const headers = ['Réf.', 'Départ', 'Retour', 'Jours', 'Destination(s)', 'Objet', 'Conducteur', 'Véhicule',
    'Participants', 'Échéance', 'Conflits', ''];
  const rows = list.map((p) => {
    const etat = etatProgramme(p);
    const m = missionDuProgramme(p);
    const j = joursMission(p.dateDepart, p.dateRetour);
    const actions = [];
    if (m) actions.push(miniBtn('#C2185B', 'data-voir-mission', `→ ${esc(m.ref || 'mission')}`, 'Ouvrir le suivi des missions'));
    else if (canWrite() && etat !== 'passé') actions.push(miniBtn('#C2185B', 'data-creer data-write', 'Créer la mission'));
    if (canWrite()) actions.push(miniBtn('#008A3B', 'data-edit data-write', '✎'), miniBtn('#D32F2F', 'data-del data-write', '✕'));
    return [
      `<b style="white-space:nowrap">${esc(p.ref || '')}</b>`,
      esc(dateFR(p.dateDepart)),
      esc(dateFR(p.dateRetour)),
      `<span style="display:block;text-align:center">${j === null || j < 1 ? '—' : j}</span>`,
      esc(texteDestinations(p.destinations || [])),
      escLignes(p.objet || ''),
      esc(p.conducteur || ''),
      p.vehicule ? esc(p.vehicule) + autreImmat(p.vehicule) : '',
      escLignes((p.participants || []).filter(Boolean).join('\n')),
      echeance(etat, p.dateDepart),
      f.passes ? '' : celluleConflits(conflits.get(p.id) || []),
      actions.join(' ')
    ];
  });

  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const p = list[i];
    tr.dataset.search = norm(`${p.ref} ${p.dateDepart} ${p.conducteur} ${p.vehicule} ${(p.destinations || []).join(' ')} ${p.objet} ${(p.participants || []).join(' ')}`);
    const c = tr.querySelector('[data-creer]');
    if (c) c.onclick = () => creerMission(p);
    const v = tr.querySelector('[data-voir-mission]');
    if (v) v.onclick = () => { state.sub.MISSION = 'suivi'; rerender(); };
    const ed = tr.querySelector('[data-edit]');
    if (ed) ed.onclick = () => openProgrammeForm(p);
    const del = tr.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (!(await confirmDialog({
          title: 'Supprimer le programme',
          message: `Supprimer le programme ${p.ref || ''} (${texteDestinations(p.destinations || []) || '—'}, départ le ${dateFR(p.dateDepart) || '…'}) ?` +
            (missionDuProgramme(p) ? '\n\nLa mission déjà créée reste dans le suivi des missions.' : ''),
          okLabel: 'Supprimer', danger: true
        }))) return;
        remove('programmes', p.id);
        toast('Programme supprimé.', 'ok');
        rerender();
      };
    }
  }));
}

/**
 * Le formulaire de mission, prerempli avec le programme. A l'enregistrement,
 * les participants passent a la mission et le programme est « réalisé ».
 */
function creerMission(p) {
  openMissionForm(null, {
    titre: `Nouvelle mission — depuis le programme ${p.ref || ''}`.trim(),
    preset: {
      conducteur: p.conducteur,
      vehicule: p.vehicule,
      destinations: (p.destinations || []).slice(),
      dateDepart: p.dateDepart,
      dateRetour: p.dateRetour
    },
    apresCreation: (m) => {
      if ((p.participants || []).length) update('missions', m.id, { participants: p.participants.slice() });
      update('programmes', p.id, { missionId: m.id });
      rerender();
    }
  });
}

function programmeFields(p = {}) {
  const parts = p.participants || [];
  return [
    { key: 'ref', label: 'Référence', required: true, value: p.ref || prochaineRefProgramme(),
      hint: 'Proposée à la suite de la dernière ; modifiable' },
    { key: 'dateDepart', label: 'Date de départ prévue', type: 'date', required: true, value: p.dateDepart },
    { key: 'dateRetour', label: 'Date de retour prévue', type: 'date', value: p.dateRetour },
    { key: 'jours', label: 'Nombre de jours', type: 'static', value: '', hint: 'Jour de départ inclus' },
    { key: 'destination', label: 'Destinations', type: 'selectAdd', full: true, value: '',
      options: nomsDestinationsMission(), emptyLabel: '— ajouter une destination —', addLabel: 'Nouvelle destination',
      hint: 'Dans l’ordre du parcours ; les mêmes que pour les missions' },
    { key: 'objet', label: 'Objet de la mission', type: 'textarea', full: true, rows: 2, value: p.objet },
    { key: 'conducteur', label: 'Conducteur', value: p.conducteur, list: knownDrivers(),
      hint: 'Peut rester vide : le tour de rôle le désignera à la création de la mission' },
    champVehicule('vehicule', 'Véhicule', p.vehicule),
    champParticipant('participant1', 'Participant 1', parts[0]),
    champParticipant('participant2', 'Participant 2', parts[1]),
    champParticipant('participant3', 'Participant 3', parts[2]),
    champParticipant('participant4', 'Participant 4', parts[3]),
    { key: 'observations', label: 'Observation', type: 'textarea', full: true, rows: 2, value: p.observations }
  ];
}

export function openProgrammeForm(p) {
  const isEdit = !!p;
  const parcours = destinationsDe(p || {}).map((nom) => ({ nom }));
  const saisies = new Map();
  let redessiner = () => {};
  openForm({
    title: isEdit ? `Modifier le programme ${p.ref || ''}` : 'Nouvelle mission programmée',
    fields: programmeFields(p || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer le programme',
    extra: (scope) => { redessiner = cablerParcours(scope, parcours, saisies); },
    onInput: (values, scope) => {
      const liste = scope.querySelector('select[data-key="destination"]');
      if (liste && liste.value && liste.value !== '__ajout__') {
        ajouterEtape(parcours, liste.value);
        liste.value = '';
        redessiner();
      }
      const j = joursMission(values.dateDepart, values.dateRetour);
      const n = scope.querySelector('[data-key="jours"]');
      if (n) n.value = j === null || j < 1 ? '—' : `${j} j`;
    },
    onSubmit: async (v) => {
      const ref = String(v.ref || '').trim().toUpperCase();
      if ((DB.programmes || []).some((x) => x.id !== (p && p.id) && norm(x.ref || '') === norm(ref))) {
        return `La référence ${ref} est déjà attribuée à un autre programme.`;
      }
      const j = joursMission(v.dateDepart, v.dateRetour);
      if (j !== null && j < 1) return 'La date de retour est antérieure à la date de départ.';
      const noms = enregistrerParcours(parcours, saisies, v.destination);
      const payload = {
        ref,
        dateDepart: v.dateDepart,
        dateRetour: v.dateRetour,
        destinations: noms,
        objet: v.objet,
        conducteur: String(v.conducteur || '').trim(),
        vehicule: String(v.vehicule || '').trim().toUpperCase(),
        participants: [v.participant1, v.participant2, v.participant3, v.participant4].filter(Boolean),
        observations: v.observations
      };
      // Les conflits se signalent sans bloquer : un conge peut etre deplace.
      const conflits = conflitsProgramme(Object.assign({ id: p && p.id, missionId: p && p.missionId }, payload));
      if (conflits.length) {
        const ok = await confirmDialog({
          title: 'Conflit dans le programme',
          message: conflits.map((c) => `• ${c}`).join('\n') + '\n\nEnregistrer le programme quand même ?',
          okLabel: 'Enregistrer quand même'
        });
        if (!ok) return false;
      }
      if (isEdit) update('programmes', p.id, payload);
      else insert('programmes', Object.assign({ createdAt: new Date().toISOString(), missionId: '' }, payload));
      toast(isEdit ? 'Programme mis à jour.' : `Mission programmée ${ref} enregistrée.`, 'ok');
      rerender();
      return null;
    }
  });
}

async function doExport(kind, list, passes) {
  try {
    const datasets = [dsProgrammes(list)];
    const name = passes ? 'PDU_programmes_passes' : 'PDU_programmes_missions';
    const titre = passes ? 'Programmes des missions passés' : 'Programmes des missions';
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

/* ================= TABLEAU DE BORD → PROGRAMMES ================== */

/** Les sources que le compte peut voir, ses fiches seulement s'il y a lieu. */
export function sourcesAgenda() {
  return {
    programmes: voit('MISSION') ? filtrer('MISSION', DB.programmes || []) : [],
    indisponibilites: voit('CONGES') ? filtrer('CONGES', DB.indisponibilites || []) : []
  };
}

export function renderAgendaProgrammes(page) {
  page.appendChild(card(
    'PROGRAMMES',
    'Ce qui est prévu : les missions programmées (MISSIONS → PROGRAMMES DES MISSIONS) et les congés et absences à venir ou en cours ' +
      '(PERSONNEL → CONGÉS ET ABSENCES), du plus proche au plus lointain. Le tableau suit ces deux sous-rubriques ; « Ouvrir » y mène.',
    '#008A3B'
  ));
  const lignes = agendaProgrammes(sourcesAgenda());

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Missions programmées', fmt(lignes.filter((l) => l.type === 'Mission').length), 'à venir ou en cours', moduleColor('MISSION')));
  grid.appendChild(statTile('Congés', fmt(lignes.filter((l) => l.type === 'Congé').length), 'à venir ou en cours', COLORS.blue));
  grid.appendChild(statTile('Absences', fmt(lignes.filter((l) => l.type === 'Absence').length), 'à venir ou en cours', COLORS.orange));
  const nb = lignes.filter((l) => l.conflits.length).length;
  grid.appendChild(statTile('Conflits', fmt(nb), nb ? 'à revoir' : 'aucun', nb ? COLORS.red : COLORS.green));
  page.appendChild(grid);

  page.appendChild(toolbar([
    // Le tableau de bord se lit seulement : le formulaire s'ouvre dans MISSIONS.
    // (pas la classe addBtn : la page en lecture seule la masque).
    peutSaisir('MISSION') && { label: '+ Nouvelle mission programmée', color: moduleColor('MISSION'),
      onClick: () => { state.sub.MISSION = 'programmes'; state.filters.programmes.passes = false; navigate('MISSION'); openProgrammeForm(null); } },
    { label: '⬇ Excel', color: '#1D6F42', onClick: () => exportAgenda('excel', lignes) },
    { label: '⬇ PDF', color: '#D32F2F', onClick: () => exportAgenda('pdf', lignes) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => exportAgenda('word', lignes) }
  ]));

  if (!lignes.length) {
    page.appendChild(emptyState('Rien de programmé : aucune mission programmée, aucun congé ni absence à venir.'));
    return;
  }

  const couleurType = { Mission: moduleColor('MISSION'), 'Congé': COLORS.blue, Absence: COLORS.orange };
  const headers = ['Type', 'Agent(s)', 'Du', 'Au', 'Détail', 'Véhicule', 'Échéance', 'Conflits', ''];
  const rows = lignes.map((l) => [
    `<span class="badge" style="background:${couleurType[l.type]}">${esc(l.type)}</span>`,
    esc(l.agents),
    esc(dateFR(l.du)),
    esc(dateFR(l.au)),
    esc(l.detail),
    l.vehicule ? esc(l.vehicule) + autreImmat(l.vehicule) : '',
    echeance(l.etat, l.du),
    l.source === 'programmes' ? celluleConflits(l.conflits) : '',
    miniBtn(COLORS.grey, 'data-ouvrir', 'Ouvrir', l.source === 'programmes' ? 'MISSIONS → PROGRAMMES DES MISSIONS' : 'PERSONNEL → CONGÉS ET ABSENCES')
  ]);
  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const l = lignes[i];
    tr.dataset.search = norm(`${l.type} ${l.agents} ${l.du} ${l.au} ${l.detail} ${l.vehicule}`);
    tr.querySelector('[data-ouvrir]').onclick = () => {
      if (l.source === 'programmes') { state.sub.MISSION = 'programmes'; state.filters.programmes.passes = false; navigate('MISSION'); }
      else { state.sub.UTILISATEURS = 'indisponibilites'; navigate('UTILISATEURS'); }
    };
  }));
}

async function exportAgenda(kind, lignes) {
  try {
    const datasets = [dsAgendaProgrammes(lignes)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_programmes')
      : kind === 'word'
        ? await exportWord(datasets, 'PDU_programmes', { title: 'Programmes' })
        : await exportPdf(datasets, 'PDU_programmes', { title: 'Programmes' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

