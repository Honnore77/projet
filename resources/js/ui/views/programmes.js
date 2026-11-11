/* ===================================================================
   PROGRAMMES (voir core/programmes.js)

     MISSIONS → PROGRAMMES DES MISSIONS   les missions a venir : formulaire
        leger (dates, destinations, objet, conducteur, vehicule,
        participants), bouton « Créer la mission » le jour venu. Un
        programme realise ou dont la date de retour est passee quitte le
        tableau ; « Voir les programmes passés » les retrouve. Les missions
        en cours y figurent aussi (« en cours ») jusqu'a leur retour. Un
        programme annule passe au tableau « MISSIONS ANNULÉES ».

     TABLEAU DE BORD → PROGRAMMES   missions en cours et programmees,
        entretiens programmes, conges et absences a venir ou en cours, en
        un seul tableau trie par date, relie aux sous-rubriques d'origine,
        avec les conflits.
   =================================================================== */

import {
  DB, insert, update, remove, knownDrivers, joursMission, nomsDestinationsMission,
  destinationsDe, texteDestinations
} from '../../core/db.js';
import {
  etatProgramme, programmesActifs, programmesPasses, programmesAnnules, prochaineRefProgramme, conflitsProgramme,
  missionDuProgramme, agendaProgrammes, missionsEnCours, programmeDeLaMission
} from '../../core/programmes.js';
import { canWrite, currentUser } from '../../core/auth.js';
import { filtrer, voit, peutSaisir } from '../../core/acces.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO, daysBetween } from '../../core/utils.js';
import {
  champVehicule, champParticipant, autreImmat, card, toolbar, emptyState, openForm, confirmDialog, toast,
  statTile, dataTable, sectionLabel, COLORS
} from '../components.js';
import { state, rerender, moduleColor, navigate } from '../shell.js';
import { cablerParcours, enregistrerParcours, ajouterEtape, openMissionForm } from './missions.js';
import { openProgrammeEntretienForm } from './programmeEntretien.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsProgrammes, dsProgrammesAnnules, dsAgendaProgrammes } from '../../export/datasets.js';

const COULEUR = () => moduleColor('MISSION');

export function miniBtn(couleur, attr, libelle, titre = '') {
  return `<button class="miniBtn" style="background:${couleur};padding:5px 8px" ${attr}` +
    `${titre ? ` title="${esc(titre)}"` : ''}>${libelle}</button>`;
}

/** « dans 3 jours », « demain », « en cours »... */
export function echeance(etat, du) {
  if (etat === 'en cours') return '<b style="color:#F47B20">en cours</b>';
  if (etat === 'en retard') {
    const n = daysBetween(du, todayISO());
    return `<b style="color:#D32F2F">en retard${n ? ` de ${fmt(n)} jour${n > 1 ? 's' : ''}` : ''}</b>`;
  }
  if (etat !== 'à venir') return esc(etat);
  const n = daysBetween(todayISO(), du);
  if (n === null) return 'à venir';
  if (n === 0) return '<b>aujourd’hui</b>';
  if (n === 1) return '<b>demain</b>';
  return `dans ${fmt(n)} jours`;
}

export function celluleConflits(conflits) {
  if (!conflits.length) return '<span style="color:#008A3B">✔</span>';
  return `<span style="color:#D32F2F" title="${esc(conflits.join('\n'))}">⚠ ${escLignes(conflits.join('\n'))}</span>`;
}

/* ============== MISSIONS → PROGRAMMES DES MISSIONS =============== */

export function renderProgrammes(page) {
  const f = state.filters.programmes;
  page.appendChild(card(
    'PROGRAMMES DES MISSIONS',
    'Les missions à venir, inscrites avant le départ, et les missions en cours. Un programme ne compte ni dans le tour de rôle, ' +
      'ni dans les jours, ni dans le cumul des missions. Le jour venu, « Créer la mission » ouvre le formulaire de mission déjà rempli. ' +
      'Une mission reste ici avec la mention « en cours » jusqu’à sa date de retour, puis quitte le tableau. ' +
      'Un programme annulé passe au tableau « MISSIONS ANNULÉES », qui en garde l’historique.',
    COULEUR()
  ));

  // Un conducteur n'y voit que ses propres programmes et missions.
  const actifs = filtrer('MISSION', programmesActifs());
  const enCours = filtrer('MISSION', missionsEnCours());
  const passes = filtrer('MISSION', programmesPasses());
  const annules = filtrer('MISSION', programmesAnnules());
  const conflits = new Map(actifs.map((p) => [p.id, conflitsProgramme(p)]));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('En cours', fmt(enCours.length + actifs.filter((p) => etatProgramme(p) === 'en cours').length),
    'missions parties, pas encore revenues', COLORS.orange));
  grid.appendChild(statTile('Programmées', fmt(actifs.length), 'missions à venir', COULEUR()));
  const sept = actifs.filter((p) => { const n = daysBetween(todayISO(), p.dateDepart); return n !== null && n >= 0 && n <= 7; }).length;
  grid.appendChild(statTile('Cette semaine', fmt(sept), 'départs dans les 7 jours', COLORS.blue));
  const nbConflits = [...conflits.values()].filter((c) => c.length).length;
  grid.appendChild(statTile('Conflits', fmt(nbConflits), nbConflits ? 'programme(s) à revoir' : 'aucun', nbConflits ? COLORS.red : COLORS.green));
  page.appendChild(grid);

  const exporter = (kind) => (f.passes ? doExport(kind, passes, true) : doExport(kind, actifs, false, enCours, annules));
  page.appendChild(toolbar([
    canWrite() && { label: '+ Nouvelle mission programmée', cls: 'addBtn', color: COULEUR(), write: true, onClick: () => openProgrammeForm(null) },
    { label: f.passes ? '← Programmes à venir' : `Voir les programmes passés (${passes.length})`, color: COLORS.grey,
      onClick: () => { f.passes = !f.passes; rerender(); } },
    { label: '⬇ Excel', color: '#1D6F42', onClick: () => exporter('excel') },
    { label: '⬇ PDF', color: '#D32F2F', onClick: () => exporter('pdf') },
    { label: '⬇ Word', color: '#2B579A', onClick: () => exporter('word') }
  ]));

  if (f.passes) {
    if (!passes.length) page.appendChild(emptyState('Aucun programme passé.'));
    else tableauProgrammes(page, passes, [], conflits, true);
    return;
  }

  if (!actifs.length && !enCours.length) page.appendChild(emptyState('Aucune mission programmée ni en cours.'));
  else tableauProgrammes(page, actifs, enCours, conflits, false);

  tableauAnnules(page, annules);
}

const ENTETES = ['Réf.', 'Départ', 'Retour', 'Jours', 'Destination(s)', 'Objet', 'Conducteur', 'Véhicule',
  'Participants', 'Échéance', 'Conflits', ''];

/**
 * Le tableau des programmes : d'abord les missions en cours (SUIVI DES
 * MISSIONS), puis les programmes, du plus proche au plus lointain.
 */
function tableauProgrammes(page, programmes, missions, conflits, passes) {
  const lignes = [
    ...missions.map((m) => ({ mission: m })),
    ...programmes.map((p) => ({ programme: p }))
  ];
  const rows = lignes.map(({ mission: m, programme: p }) => {
    if (m) {
      const origine = programmeDeLaMission(m);
      const j = joursMission(m.dateDepart, m.dateRetour);
      return [
        `<b style="white-space:nowrap">${esc(m.ref || '')}</b>` +
          (origine ? `<br><small style="white-space:nowrap">programme ${esc(origine.ref || '')}</small>` : ''),
        esc(dateFR(m.dateDepart)),
        esc(dateFR(m.dateRetour)),
        `<span style="display:block;text-align:center">${j === null || j < 1 ? '—' : j}</span>`,
        esc(texteDestinations(destinationsDe(m))),
        escLignes((origine && origine.objet) || ''),
        esc(m.conducteur || ''),
        m.vehicule ? esc(m.vehicule) + autreImmat(m.vehicule) : '',
        escLignes((m.participants || []).filter(Boolean).join('\n')),
        echeance('en cours', m.dateDepart),
        '',
        miniBtn('#C2185B', 'data-voir-mission', '→ Suivi', 'Ouvrir le suivi des missions')
      ];
    }
    const etat = etatProgramme(p);
    const mi = missionDuProgramme(p);
    const j = joursMission(p.dateDepart, p.dateRetour);
    const actions = [];
    if (mi) actions.push(miniBtn('#C2185B', 'data-voir-mission', `→ ${esc(mi.ref || 'mission')}`, 'Ouvrir le suivi des missions'));
    else if (canWrite() && etat !== 'passé') actions.push(miniBtn('#C2185B', 'data-creer data-write', 'Créer la mission'));
    if (canWrite()) {
      actions.push(miniBtn('#008A3B', 'data-edit data-write', '✎', 'Modifier le programme'));
      if (!mi && etat !== 'passé') {
        actions.push(miniBtn(COLORS.orange, 'data-annuler data-write', 'Annuler', 'Annuler la mission programmée : elle passe aux missions annulées'));
      }
      actions.push(miniBtn('#D32F2F', 'data-del data-write', '✕', 'Supprimer le programme'));
    }
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
      passes ? '' : celluleConflits(conflits.get(p.id) || []),
      actions.join(' ')
    ];
  });

  page.appendChild(dataTable(ENTETES, rows, (tr, i) => {
    const { mission: m, programme: p } = lignes[i];
    const v = tr.querySelector('[data-voir-mission]');
    if (v) v.onclick = () => { state.sub.MISSION = 'suivi'; rerender(); };
    if (m) {
      tr.dataset.search = norm(`${m.ref} ${m.dateDepart} ${m.conducteur} ${m.vehicule} ${destinationsDe(m).join(' ')} ` +
        `${(m.participants || []).join(' ')} en cours`);
      return;
    }
    tr.dataset.search = norm(`${p.ref} ${p.dateDepart} ${p.conducteur} ${p.vehicule} ${(p.destinations || []).join(' ')} ${p.objet} ${(p.participants || []).join(' ')}`);
    const c = tr.querySelector('[data-creer]');
    if (c) c.onclick = () => creerMission(p);
    const ed = tr.querySelector('[data-edit]');
    if (ed) ed.onclick = () => openProgrammeForm(p);
    const an = tr.querySelector('[data-annuler]');
    if (an) an.onclick = () => openAnnulation(p);
    const del = tr.querySelector('[data-del]');
    if (del) del.onclick = () => supprimerProgramme(p);
  }));
}

async function supprimerProgramme(p) {
  if (!(await confirmDialog({
    title: 'Supprimer le programme',
    message: `Supprimer le programme ${p.ref || ''} (${texteDestinations(p.destinations || []) || '—'}, départ le ${dateFR(p.dateDepart) || '…'}) ?` +
      (missionDuProgramme(p) ? '\n\nLa mission déjà créée reste dans le suivi des missions.' : '') +
      (p.annule || missionDuProgramme(p) ? '' : '\n\nPour garder la trace d’une mission qui n’aura pas lieu, utilisez plutôt « Annuler ».'),
    okLabel: 'Supprimer', danger: true
  }))) return;
  remove('programmes', p.id);
  toast('Programme supprimé.', 'ok');
  rerender();
}

/** MISSIONS ANNULÉES : l'historique des programmes annules. */
function tableauAnnules(page, annules) {
  page.appendChild(sectionLabel(`MISSIONS ANNULÉES (${annules.length})`, COLORS.red));
  if (!annules.length) {
    page.appendChild(emptyState('Aucune mission programmée n’a été annulée.'));
    return;
  }
  const headers = ['Réf.', 'Départ prévu', 'Retour prévu', 'Destination(s)', 'Objet', 'Conducteur', 'Véhicule',
    'Participants', 'Annulée le', 'Motif de l’annulation', 'Annulée par', ''];
  const rows = annules.map((p) => [
    `<b style="white-space:nowrap">${esc(p.ref || '')}</b>`,
    esc(dateFR(p.dateDepart)),
    esc(dateFR(p.dateRetour)),
    esc(texteDestinations(p.destinations || [])),
    escLignes(p.objet || ''),
    esc(p.conducteur || ''),
    p.vehicule ? esc(p.vehicule) + autreImmat(p.vehicule) : '',
    escLignes((p.participants || []).filter(Boolean).join('\n')),
    `<b style="color:${COLORS.red};white-space:nowrap">${esc(dateFR(p.dateAnnulation))}</b>`,
    escLignes(p.motifAnnulation || ''),
    esc(p.annulePar || ''),
    canWrite()
      ? `<span style="white-space:nowrap">${miniBtn(COLORS.green, 'data-retablir data-write', '↺ Rétablir', 'Remettre le programme parmi les missions programmées')} ` +
        `${miniBtn('#D32F2F', 'data-del data-write', '✕', 'Supprimer définitivement')}</span>`
      : ''
  ]);
  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const p = annules[i];
    tr.dataset.search = norm(`${p.ref} ${p.dateDepart} ${p.conducteur} ${p.vehicule} ${(p.destinations || []).join(' ')} ` +
      `${p.objet} ${p.motifAnnulation} ${p.annulePar} annulee`);
    const r = tr.querySelector('[data-retablir]');
    if (r) {
      r.onclick = async () => {
        if (!(await confirmDialog({ title: 'Rétablir le programme',
          message: `Remettre le programme ${p.ref || ''} parmi les missions programmées ?`, okLabel: 'Rétablir' }))) return;
        update('programmes', p.id, { annule: false, dateAnnulation: '', motifAnnulation: '', annulePar: '' });
        toast('Programme rétabli.', 'ok');
        rerender();
      };
    }
    const del = tr.querySelector('[data-del]');
    if (del) del.onclick = () => supprimerProgramme(p);
  }));
}

/** Annuler un programme : il garde tout, plus la date, le motif et l'auteur de l'annulation. */
function openAnnulation(p) {
  const moi = currentUser();
  openForm({
    title: `Annuler la mission programmée ${p.ref || ''}`.trim(),
    intro: `${texteDestinations(p.destinations || []) || '—'} · départ prévu le ${dateFR(p.dateDepart) || '…'}` +
      `${p.conducteur ? ` · ${p.conducteur}` : ''}. Elle passera au tableau « MISSIONS ANNULÉES ».`,
    fields: [
      { key: 'dateAnnulation', label: 'Date de l’annulation', type: 'date', required: true, value: todayISO() },
      { key: 'annulePar', label: 'Annulée par', value: (moi && moi.nom) || '', list: knownDrivers() },
      { key: 'motifAnnulation', label: 'Motif de l’annulation', type: 'textarea', full: true, rows: 2, required: true, value: '' }
    ],
    okLabel: 'Annuler la mission',
    onSubmit: (v) => {
      if (!String(v.motifAnnulation || '').trim()) return 'Indiquez le motif de l’annulation.';
      update('programmes', p.id, {
        annule: true,
        dateAnnulation: v.dateAnnulation,
        annulePar: String(v.annulePar || '').trim(),
        motifAnnulation: String(v.motifAnnulation).trim()
      });
      toast(`Mission programmée ${p.ref || ''} annulée.`, 'ok');
      rerender();
      return null;
    }
  });
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

async function doExport(kind, list, passes, enCours = [], annules = []) {
  try {
    const datasets = [dsProgrammes(list, enCours)];
    if (annules.length) datasets.push(dsProgrammesAnnules(annules));
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
    missions: voit('MISSION') ? filtrer('MISSION', DB.missions || []) : [],
    entretiens: voit('ENTRETIEN') ? filtrer('ENTRETIEN', DB.programmesEntretien || []) : [],
    indisponibilites: voit('CONGES') ? filtrer('CONGES', DB.indisponibilites || []) : []
  };
}

export function renderAgendaProgrammes(page) {
  page.appendChild(card(
    'PROGRAMMES',
    'Ce qui est en cours et ce qui est prévu : les missions en cours et programmées (MISSIONS → PROGRAMMES DES MISSIONS), ' +
      'les entretiens programmés (ENTRETIEN → PROGRAMME D’ENTRETIEN) et les congés et absences à venir ou en cours ' +
      '(PERSONNEL → CONGÉS ET ABSENCES), ce qui est en cours d’abord. Une mission quitte le tableau après sa date de retour, ' +
      'un entretien à la sortie du garage. Le tableau suit ces sous-rubriques ; « Ouvrir » y mène.',
    '#008A3B'
  ));
  const lignes = agendaProgrammes(sourcesAgenda());

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Missions', fmt(lignes.filter((l) => l.type === 'Mission').length),
    `dont ${fmt(lignes.filter((l) => l.type === 'Mission' && l.etat === 'en cours').length)} en cours`, moduleColor('MISSION')));
  grid.appendChild(statTile('Entretiens', fmt(lignes.filter((l) => l.type === 'Entretien').length),
    `dont ${fmt(lignes.filter((l) => l.type === 'Entretien' && l.etat === 'en retard').length)} en retard`, moduleColor('ENTRETIEN')));
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
    peutSaisir('ENTRETIEN') && { label: '+ Nouvel entretien programmé', color: moduleColor('ENTRETIEN'),
      onClick: () => { state.sub.ENTRETIEN = 'programme'; navigate('ENTRETIEN'); openProgrammeEntretienForm(null); } },
    { label: '⬇ Excel', color: '#1D6F42', onClick: () => exportAgenda('excel', lignes) },
    { label: '⬇ PDF', color: '#D32F2F', onClick: () => exportAgenda('pdf', lignes) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => exportAgenda('word', lignes) }
  ]));

  if (!lignes.length) {
    page.appendChild(emptyState('Rien de programmé : aucune mission en cours ni programmée, aucun entretien programmé, aucun congé ni absence à venir.'));
    return;
  }

  const couleurType = { Mission: moduleColor('MISSION'), Entretien: moduleColor('ENTRETIEN'), 'Congé': COLORS.blue, Absence: COLORS.orange };
  const destination = {
    programmes: 'MISSIONS → PROGRAMMES DES MISSIONS',
    missions: 'MISSIONS → PROGRAMMES DES MISSIONS',
    programmesEntretien: 'ENTRETIEN → PROGRAMME D’ENTRETIEN',
    indisponibilites: 'PERSONNEL → CONGÉS ET ABSENCES'
  };
  const headers = ['Type', 'Agent(s)', 'Du', 'Au', 'Détail', 'Véhicule', 'Échéance', 'Conflits', ''];
  const rows = lignes.map((l) => [
    `<span class="badge" style="background:${couleurType[l.type]}">${esc(l.type)}</span>`,
    esc(l.agents),
    esc(dateFR(l.du)),
    esc(dateFR(l.au)),
    esc(l.detail),
    l.vehicule ? esc(l.vehicule) + autreImmat(l.vehicule) : '',
    echeance(l.etat, l.du),
    l.source === 'programmes' || l.source === 'programmesEntretien' ? celluleConflits(l.conflits) : '',
    miniBtn(COLORS.grey, 'data-ouvrir', 'Ouvrir', destination[l.source])
  ]);
  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const l = lignes[i];
    tr.dataset.search = norm(`${l.type} ${l.agents} ${l.du} ${l.au} ${l.detail} ${l.vehicule}`);
    tr.querySelector('[data-ouvrir]').onclick = () => {
      if (l.source === 'programmes' || l.source === 'missions') { state.sub.MISSION = 'programmes'; state.filters.programmes.passes = false; navigate('MISSION'); }
      else if (l.source === 'programmesEntretien') { state.sub.ENTRETIEN = 'programme'; state.filters.programmesEntretien.realises = false; navigate('ENTRETIEN'); }
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

