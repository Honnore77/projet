/* ===================================================================
   MISSION — deux sous-rubriques :

     TABLEAU DE SUIVI     toutes les missions en tableau, avec les
                          informations du formulaire et les cumuls par
                          conducteur (les missions se font a tour de role)
     RAPPORT DE MISSION   la liste des rapports en tableau, chacun
                          consultable par le bouton « Voir »
   =================================================================== */

import { DB, insert, update, remove, knownImmats, knownDrivers, rotationConducteurs, ravMontant } from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO, daysBetween, sum, groupBy } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, openModal, confirmDialog, toast,
  statTile, dataTable, groupHeader, subEmpty, COLORS
} from '../components.js';
import { state, rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsSuiviMissions, dsMissions, dsMissionsParConducteur } from '../../export/datasets.js';
import { exportMissionReport, printMissionReport, reportData } from '../../export/missionReport.js';

const SUBS = [
  { key: 'suivi', label: 'TABLEAU DE SUIVI' },
  { key: 'rapport', label: 'RAPPORT DE MISSION' }
];

export function renderMissions(page) {
  const sub = state.sub.MISSION || 'suivi';
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.MISSION = k; rerender(); }, { suivi: COLORS.purple, rapport: COLORS.purple })
  );
  if (sub === 'rapport') renderRapport(page);
  else renderSuivi(page);
}

/* ==================== TABLEAU DE SUIVI DES MISSIONS ================= */

function renderSuivi(page) {
  const f = state.filters.missions;

  page.appendChild(
    card(
      'TABLEAU DE SUIVI DES MISSIONS',
      'Toutes les missions enregistrées, avec le nombre de missions et le cumul des jours de chaque conducteur.',
      COLORS.purple
    )
  );

  renderRotation(page);
  page.appendChild(filtres());

  const list = filtered();
  const parConducteur = groupBy(DB.missions, (m) => norm(m.conducteur || '—'));
  const missionsDe = (m) => parConducteur[norm(m.conducteur || '—')] || [];

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Missions', fmt(list.length), 'sur la période filtrée', COLORS.purple));
  grid.appendChild(statTile('Jours cumulés', fmt(sum(list, (m) => m.jours)), 'toutes missions filtrées', COLORS.blue));
  grid.appendChild(statTile('Non payées', fmt(list.filter((m) => !m.paye).length), 'à régler', COLORS.red));
  grid.appendChild(statTile('Conducteurs', fmt(Object.keys(parConducteur).length), 'ayant effectué une mission', COLORS.green));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Ajouter une mission', cls: 'addBtn', color: COLORS.purple, write: true, onClick: () => openMissionForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.missions.length ? 'Aucune mission ne correspond aux filtres.' : 'Aucune mission enregistrée.'));
    return;
  }

  const headers = [
    'Référence', 'Conducteur', 'Nb missions<br>du conducteur', 'Véhicule', 'Destination', 'Objet',
    'Départ', 'Retour', 'Jours', 'Cumul jours<br>du conducteur', 'Frais', 'Paiement', ''
  ];

  const rows = list.map((m) => {
    const g = missionsDe(m);
    const paiement = m.paye
      ? `🟢 Payée${m.datePaiement ? `<br><small>${esc(m.datePaiement)}</small>` : ''}`
      : canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-pay data-write>🔴 Marquer payée</button>`
        : '🔴 Non payée';
    return [
      `<b>${esc(m.ref || '')}</b>`,
      esc(m.conducteur || ''),
      `<span style="display:block;text-align:center">${g.length}</span>`,
      m.vehicule ? `<a href="#" data-veh style="color:${COLORS.blue}">${esc(m.vehicule)}</a>` : '',
      esc(m.destination || ''),
      esc(m.objet || ''),
      esc(dateFR(m.dateDepart) || ''),
      esc(dateFR(m.dateRetour) || ''),
      `<span style="display:block;text-align:center">${esc(m.jours === '' || m.jours === undefined ? '—' : m.jours)}</span>`,
      `<span style="display:block;text-align:center"><b>${fmt(sum(g, (x) => x.jours))}</b></span>`,
      `<span style="display:block;text-align:right">${m.montant ? `${fmt(m.montant)} F` : ''}</span>`,
      paiement,
      canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const m = list[i];
      tr.dataset.search = norm(`${m.ref} ${m.conducteur} ${m.destination} ${m.vehicule} ${m.objet || ''}`);

      const vehLink = tr.querySelector('[data-veh]');
      if (vehLink) vehLink.onclick = (ev) => { ev.preventDefault(); openVehicleSheet(m.vehicule); };

      const pay = tr.querySelector('[data-pay]');
      if (pay) pay.onclick = () => openPaymentForm(m);

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openMissionForm(m);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({ title: 'Supprimer la mission', message: `Supprimer la mission ${m.ref} (${m.conducteur}) ?`, okLabel: 'Supprimer', danger: true }))) return;
          remove('missions', m.id);
          toast('Mission supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

/** Ordre du tour de role : qui doit partir en mission ensuite. */
function renderRotation(page) {
  const rot = rotationConducteurs();
  if (!rot.length) {
    page.appendChild(
      emptyState('Aucun conducteur actif. Renseignez les agents dans UTILISATEURS et indiquez « conducteur du pool ».')
    );
    return;
  }

  page.appendChild(
    groupHeader(`🔁 TOUR DE RÔLE — prochain : ${rot[0].nom || '—'}`, `${rot.length} conducteur(s)`, COLORS.purple)
  );

  const wrap = el('<div class="entry"></div>');
  wrap.style.borderLeftColor = COLORS.purple;
  wrap.innerHTML =
    '<div class="subBlock"><h5>Ordre de passage</h5>' +
    rot
      .map(
        (r, i) =>
          `<div class="subEntryRow"><span>${i === 0 ? '➡ ' : `${i + 1}. `}<b>${esc(r.nom)}</b>` +
          `${r.section ? ` <small>· ${esc(r.section)}</small>` : ''}` +
          `<br><small>${r.derniereMission ? `dernière mission le ${esc(dateFR(r.derniereMission))}` : 'jamais parti en mission'}</small></span>` +
          `<b>${r.nbMissions} mission(s)<br><small style="font-weight:normal">${fmt(r.totalJours)} jour(s)</small></b></div>`
      )
      .join('') +
    '</div>' +
    (rot[0].marque
      ? ''
      : '<div class="fields"><small>Aucun agent n’est marqué « conducteur du pool » : la liste reprend donc tous les agents actifs.</small></div>');
  page.appendChild(wrap);
}

/* ===================== RAPPORT DE MISSION ========================== */

function renderRapport(page) {
  page.appendChild(
    card(
      'RAPPORT DE MISSION',
      'Un rapport par mission. Le bouton « Voir » ouvre le rapport complet : participants, dotation en carburant, ravitaillements, kilométrage et observations.',
      COLORS.purple
    )
  );

  page.appendChild(filtres());

  const list = filtered();

  if (!DB.missions.length) {
    page.appendChild(
      emptyState('Aucune mission enregistrée. Créez-la dans le tableau de suivi, puis remplissez son rapport ici.')
    );
  } else if (!list.length) {
    page.appendChild(emptyState('Aucune mission ne correspond aux filtres.'));
  } else {
    const headers = ['Conducteur', 'Immatriculation', 'Période de la mission', 'Destination', 'Rapport', ''];

    const rows = list.map((m) => {
      const d = reportData(m);
      const rempli = d.participants.length || d.ravitaillements.length || d.kmDepart !== '' || d.observations;
      return [
        `<b>${esc(m.conducteur || '—')}</b>${m.ref ? `<br><small>${esc(m.ref)}</small>` : ''}`,
        esc(m.vehicule || ''),
        `${esc(dateFR(m.dateDepart) || '…')} → ${esc(dateFR(m.dateRetour) || '…')}` +
          (m.jours !== '' && m.jours !== undefined ? `<br><small>${m.jours} jour(s)</small>` : ''),
        esc(m.destination || ''),
        `<span class="badge" style="background:${rempli ? COLORS.purple : COLORS.orange}">${rempli ? 'Rempli' : 'À compléter'}</span>`,
        `<button class="miniBtn" style="background:${COLORS.blue};padding:6px 12px" data-voir>Voir</button>`
      ];
    });

    page.appendChild(
      dataTable(headers, rows, (tr, i) => {
        const m = list[i];
        tr.dataset.search = norm(`${m.ref} ${m.conducteur} ${m.vehicule} ${m.destination}`);
        tr.querySelector('[data-voir]').onclick = () => openRapportVue(m);
      })
    );
  }

  // Toujours visible sous la liste, quelle que soit la ligne selectionnee.
  if (canWrite()) {
    page.appendChild(
      toolbar([
        {
          label: '✎ Remplir le rapport',
          cls: 'addBtn',
          color: COLORS.purple,
          write: true,
          onClick: () => choisirMission((m) => openRapportForm(m))
        }
      ])
    );
  }
}

/** Choix de la mission dont on veut remplir le rapport. */
function choisirMission(onPick) {
  if (!DB.missions.length) {
    toast('Créez d’abord une mission dans le tableau de suivi.', 'info');
    return;
  }
  const options = DB.missions
    .slice()
    .sort((a, b) => String(b.dateDepart).localeCompare(String(a.dateDepart)))
    .map((m) => ({
      value: m.id,
      label: `${m.ref || 'sans réf.'} — ${m.conducteur || '—'} — ${m.destination || '—'} (${dateFR(m.dateDepart) || '…'})`
    }));

  openForm({
    title: 'Remplir un rapport de mission',
    intro: 'Choisissez la mission concernée.',
    fields: [{ key: 'mission', label: 'Mission', type: 'select', options, required: true, full: true, value: options[0].value }],
    okLabel: 'Continuer',
    onSubmit: (v) => {
      const m = DB.missions.find((x) => x.id === v.mission);
      if (!m) return 'Mission introuvable.';
      setTimeout(() => onPick(m), 60);
      return null;
    }
  });
}

/** Fenetre de consultation : tout le contenu du rapport. */
function openRapportVue(m) {
  const d = reportData(m);
  const ligne = (k, v) => `<div class="subEntryRow"><span>${esc(k)}</span><b>${esc(v || '—')}</b></div>`;

  const ravHtml = d.ravitaillements.length
    ? d.ravitaillements
        .map(
          (r) =>
            `<div class="subEntryRow"><span>${esc(r.date || '—')} · ${esc(r.station || '—')} — ` +
            `${fmt(r.quantite)} L × ${fmt(r.prixL)} F</span><b>${fmt(r.montant)} F</b></div>`
        )
        .join('') +
      `<div class="subEntryRow"><span><b>TOTAL</b></span><b>${fmt(d.totalQuantite)} L — ${fmt(d.totalMontant)} F</b></div>`
    : subEmpty('Aucun ravitaillement saisi');

  const corps = el(
    '<div>' +
      '<div class="subBlock"><h5>Mission</h5>' +
      ligne('Période', d.periode) +
      ligne('Destination', d.destination) +
      ligne('Nom du chauffeur', d.chauffeur) +
      ligne('Véhicule utilisé', d.vehicule) +
      '</div>' +
      `<div class="subBlock"><h5>Participants (${d.participants.length})</h5>` +
      (d.participants.length
        ? d.participants.map((p, i) => `<div class="subEntryRow"><span>${i + 1}. ${esc(p)}</span></div>`).join('')
        : subEmpty('Aucun participant saisi')) +
      '</div>' +
      `<div class="subBlock"><h5>Dotation en carburant — ${esc(d.dotation || 'non renseignée')}</h5>${ravHtml}</div>` +
      '<div class="subBlock"><h5>Kilométrage</h5>' +
      ligne('Km départ', d.kmDepart) +
      ligne('Km arrivée', d.kmArrivee) +
      ligne('Distance parcourue', d.distance !== null ? `${fmt(d.distance)} km` : '') +
      '</div>' +
      `<div class="subBlock"><h5>Observations</h5><div class="subEntryRow"><span>${esc(d.observations || '—')}</span></div></div>` +
      '</div>'
  );

  openModal({
    title: `Rapport de mission — ${m.ref || m.conducteur}`,
    bodyNode: corps,
    buttons: [
      { label: 'Fermer', cls: 'cancel', onClick: (close) => close() },
      {
        label: '🖨 Imprimer',
        cls: 'ok',
        onClick: () => {
          if (!printMissionReport(m)) toast("Impression bloquée. Utilisez l'export PDF.", 'err');
        }
      },
      {
        label: '⬇ PDF',
        cls: 'ok',
        onClick: async () => {
          try {
            const res = await exportMissionReport(m);
            toast(res ? 'Rapport enregistré.' : 'Export annulé.', res ? 'ok' : 'info');
          } catch (e) {
            console.error(e);
            toast("L'export a échoué.", 'err');
          }
        }
      },
      ...(canWrite()
        ? [{ label: '✎ Remplir', cls: 'ok', onClick: (close) => { close(); openRapportForm(m); } }]
        : [])
    ]
  });
}

/** Formulaire de saisie du rapport, avec la liste des ravitaillements. */
function openRapportForm(m) {
  const rav = (m.ravitaillements || []).map((r) => Object.assign({}, r));

  openForm({
    title: `Rapport de mission — ${m.ref || m.conducteur}`,
    intro: `${m.conducteur || '—'} · ${m.destination || '—'} · ${dateFR(m.dateDepart) || '…'} → ${dateFR(m.dateRetour) || '…'}`,
    fields: [
      { key: 'participant1', label: 'Participant 1', value: (m.participants || [])[0] },
      { key: 'participant2', label: 'Participant 2', value: (m.participants || [])[1] },
      { key: 'participant3', label: 'Participant 3', value: (m.participants || [])[2] },
      { key: 'participant4', label: 'Participant 4', value: (m.participants || [])[3] },
      { key: 'dotationCarburant', label: 'Dotation en carburant (F)', type: 'number', value: m.dotationCarburant },
      { key: 'kmDepart', label: 'Km départ', type: 'number', value: m.kmDepart },
      { key: 'kmArrivee', label: 'Km arrivée', type: 'number', value: m.kmArrivee },
      { key: 'distance', label: 'Distance parcourue', type: 'static', value: '' },
      { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: m.observations }
    ],
    okLabel: 'Enregistrer le rapport',
    onInput: (values, scope) => {
      const node = scope.querySelector('[data-key="distance"]');
      if (node) node.value = `${fmt(num(values.kmArrivee) - num(values.kmDepart))} km`;
    },
    extra: (scope) => {
      const bloc = el(
        '<div class="subBlock" style="margin-top:14px"><h5>Dotation en carburant — points de ravitaillement</h5>' +
        '<div data-ravlist></div>' +
        '<div class="fGrid" style="margin-top:8px">' +
        '<div class="fRow"><label>Date</label><input type="date" data-rdate></div>' +
        '<div class="fRow"><label>Point de ravitaillement</label><input data-rstation></div>' +
        '<div class="fRow"><label>Prix du litre</label><input type="number" step="any" data-rprix></div>' +
        '<div class="fRow"><label>Quantité (L)</label><input type="number" step="any" data-rqte></div>' +
        '</div><button type="button" class="smallBtn" data-radd>+ Ajouter ce ravitaillement</button>' +
        '<div class="subEntryRow" style="margin-top:8px;border:none"><span><b>TOTAL</b></span><b data-rtotal>0 L — 0 F</b></div></div>'
      );

      const liste = bloc.querySelector('[data-ravlist]');
      const total = bloc.querySelector('[data-rtotal]');

      const dessiner = () => {
        liste.innerHTML = rav.length
          ? rav
              .map(
                (r, i) =>
                  `<div class="subEntryRow"><span>${esc(dateFR(r.date) || '—')} · ${esc(r.station || '—')} — ` +
                  `${fmt(r.quantite)} L × ${fmt(r.prixL)} F = ${fmt(ravMontant(r))} F</span>` +
                  `<button type="button" class="miniBtn" style="background:${COLORS.red};padding:4px 8px" data-rdel="${i}">✕</button></div>`
              )
              .join('')
          : subEmpty('Aucun ravitaillement ajouté');
        total.textContent = `${fmt(sum(rav, (r) => r.quantite))} L — ${fmt(sum(rav, ravMontant))} F`;
        liste.querySelectorAll('[data-rdel]').forEach((b) => {
          b.onclick = () => { rav.splice(Number(b.dataset.rdel), 1); dessiner(); };
        });
      };
      dessiner();

      bloc.querySelector('[data-radd]').onclick = () => {
        const station = bloc.querySelector('[data-rstation]').value.trim();
        const quantite = num(bloc.querySelector('[data-rqte]').value);
        const prixL = num(bloc.querySelector('[data-rprix]').value);
        if (!station || quantite <= 0) {
          toast('Renseignez le point de ravitaillement et une quantité valide.', 'err');
          return;
        }
        rav.push({ date: bloc.querySelector('[data-rdate]').value, station, quantite, prixL });
        bloc.querySelector('[data-rstation]').value = '';
        bloc.querySelector('[data-rqte]').value = '';
        bloc.querySelector('[data-rprix]').value = '';
        dessiner();
      };

      scope.insertBefore(bloc, scope.querySelector('.err'));
    },
    onSubmit: (v) => {
      update('missions', m.id, {
        participants: [v.participant1, v.participant2, v.participant3, v.participant4].filter(Boolean),
        dotationCarburant: num(v.dotationCarburant),
        kmDepart: v.kmDepart,
        kmArrivee: v.kmArrivee,
        ravitaillements: rav,
        observations: v.observations
      });
      toast('Rapport enregistré.', 'ok');
      rerender();
      return null;
    }
  });
}

/* ========================== Commun ================================= */

function filtres() {
  const f = state.filters.missions;
  return filterBar([
    { type: 'text', placeholder: 'Conducteur', value: f.conducteur, onChange: (v) => { f.conducteur = v; rerender(); } },
    { type: 'date', title: 'Départ à partir du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
    { type: 'date', title: 'Départ jusqu’au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
    {
      type: 'select',
      value: f.paiement,
      options: [
        { value: '', label: 'Tous les paiements' },
        { value: 'non', label: 'Non payées' },
        { value: 'oui', label: 'Payées' }
      ],
      onChange: (v) => { f.paiement = v; rerender(); }
    }
  ]);
}

function filtered() {
  const f = state.filters.missions;
  let list = DB.missions.slice();
  if (f.conducteur) list = list.filter((m) => norm(m.conducteur || '').includes(norm(f.conducteur)));
  if (f.dateFrom) list = list.filter((m) => !m.dateDepart || m.dateDepart >= f.dateFrom);
  if (f.dateTo) list = list.filter((m) => !m.dateDepart || m.dateDepart <= f.dateTo);
  if (f.paiement === 'oui') list = list.filter((m) => m.paye);
  if (f.paiement === 'non') list = list.filter((m) => !m.paye);
  list.sort((a, b) => String(b.dateDepart).localeCompare(String(a.dateDepart)));
  return list;
}

function missionFields(m = {}) {
  return [
    { key: 'ref', label: 'Référence (ex : M-002)', required: true, value: m.ref || suggestRef() },
    { key: 'conducteur', label: 'Conducteur', required: true, value: m.conducteur, list: conducteursProposes() },
    { key: 'vehicule', label: 'Véhicule (immatriculation)', value: m.vehicule, list: knownImmats() },
    { key: 'destination', label: 'Destination', value: m.destination },
    { key: 'objet', label: 'Objet de la mission', full: true, value: m.objet },
    { key: 'dateDepart', label: 'Date départ', type: 'date', value: m.dateDepart || todayISO() },
    { key: 'dateRetour', label: 'Date retour', type: 'date', value: m.dateRetour },
    { key: 'jours', label: 'Nombre de jours', type: 'static', value: m.jours },
    { key: 'montant', label: 'Montant des frais (F)', type: 'number', value: m.montant }
  ];
}

/** Le conducteur dont c'est le tour arrive en tete des suggestions. */
function conducteursProposes() {
  const rot = rotationConducteurs().map((r) => r.nom);
  const autres = knownDrivers().filter((n) => !rot.includes(n));
  return [...rot, ...autres];
}

function suggestRef() {
  const nums = DB.missions
    .map((m) => /(\d+)\s*$/.exec(String(m.ref || '')))
    .filter(Boolean)
    .map((x) => Number(x[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `M-${String(next).padStart(3, '0')}`;
}

export function openMissionForm(m) {
  const isEdit = !!m;
  const rot = rotationConducteurs();
  openForm({
    title: isEdit ? `Modifier la mission ${m.ref}` : 'Nouvelle mission',
    intro: !isEdit && rot.length ? `Tour de rôle : c’est au tour de ${rot[0].nom}.` : undefined,
    fields: missionFields(m || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la mission',
    onInput: (values, scope) => {
      const j = daysBetween(values.dateDepart, values.dateRetour);
      const node = scope.querySelector('[data-key="jours"]');
      if (node) node.value = j === null ? '—' : `${j} j`;
    },
    onSubmit: (values) => {
      const jours = daysBetween(values.dateDepart, values.dateRetour);
      if (jours !== null && jours < 0) return 'La date de retour est antérieure à la date de départ.';
      const doublon = DB.missions.find((x) => x.id !== (m && m.id) && norm(x.ref) === norm(values.ref));
      if (doublon) return `La référence ${values.ref} existe déjà.`;

      const payload = {
        ref: values.ref,
        conducteur: values.conducteur,
        vehicule: String(values.vehicule || '').trim().toUpperCase(),
        destination: values.destination,
        objet: values.objet,
        dateDepart: values.dateDepart,
        dateRetour: values.dateRetour,
        jours: jours === null ? '' : jours,
        montant: num(values.montant)
      };
      if (isEdit) update('missions', m.id, payload);
      else {
        insert('missions', Object.assign(
          { paye: false, datePaiement: '', participants: [], ravitaillements: [], kmDepart: '', kmArrivee: '', observations: '' },
          payload
        ));
      }
      toast(isEdit ? 'Mission mise à jour.' : 'Mission enregistrée.', 'ok');
      rerender();
      return null;
    }
  });
}

function openPaymentForm(m) {
  openForm({
    title: `Paiement — mission ${m.ref}`,
    intro: `Conducteur : ${m.conducteur} · ${m.jours || 0} jour(s)`,
    fields: [
      { key: 'datePaiement', label: 'Date de paiement', type: 'date', required: true, value: todayISO() },
      { key: 'montant', label: 'Montant versé (F)', type: 'number', value: m.montant },
      { key: 'referencePaiement', label: 'Référence du paiement', value: m.referencePaiement }
    ],
    okLabel: 'Confirmer le paiement',
    onSubmit: (values) => {
      update('missions', m.id, {
        paye: true,
        datePaiement: dateFR(values.datePaiement),
        datePaiementISO: values.datePaiement,
        montant: num(values.montant),
        referencePaiement: values.referencePaiement
      });
      toast('Mission marquée comme payée.', 'ok');
      rerender();
      return null;
    }
  });
}

async function doExport(kind, list) {
  try {
    const datasets = [dsSuiviMissions(list), dsMissions(list), dsMissionsParConducteur(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_suivi_des_missions')
      : await exportPdf(datasets, 'PDU_suivi_des_missions', { title: 'Tableau de suivi des missions' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
