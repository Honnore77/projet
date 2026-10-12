/* ===================================================================
   MISSION — deux sous-rubriques :

     TABLEAU DE SUIVI     toutes les missions en tableau, avec les
                          informations du formulaire et les cumuls par
                          conducteur (les missions se font a tour de role)
     RAPPORT DE MISSION   la liste des rapports en tableau, chacun
                          consultable par le bouton « Voir »
   =================================================================== */

import {
  DB, insert, update, remove, knownImmats, knownDrivers, rotationConducteurs,
  ravMontant, joursMission, renumeroterMissions, prixLitreOptions, persist,
  nomsDestinationsMission, destinationMissionParNom, assurerDestinationMission,
  renommerDestinationMission, missionsVersDestination, libelleDistance,
  lienCarteDestination, lienItineraire, coordonneesDe, distanceEstimee,
  destinationsDe, texteDestinations, parcoursDe, parcoursMission, libelleParcours,
  distanceEntre, enregistrerTrajet, cleTrajet, lienParcours, lienEtape, ORIGINE_MISSIONS
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO, sum, groupBy, francSup } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, openModal, confirmDialog, toast,
  statTile, dataTable, groupHeader, subEmpty, COLORS
} from '../components.js';
import { state, rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsSuiviMissions, dsMissions, dsMissionsParConducteur, dsDestinationsMission } from '../../export/datasets.js';
import { exportMissionReport, printMissionReport, reportData } from '../../export/missionReport.js';

const SUBS = [
  { key: 'suivi', label: 'TABLEAU DE SUIVI' },
  { key: 'rapport', label: 'RAPPORT DE MISSION' },
  { key: 'destinations', label: 'DESTINATIONS' }
];

export function renderMissions(page) {
  const sub = state.sub.MISSION || 'suivi';
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.MISSION = k; rerender(); },
      { suivi: COLORS.purple, rapport: COLORS.purple, destinations: COLORS.purple })
  );
  if (sub === 'rapport') renderRapport(page);
  else if (sub === 'destinations') renderDestinations(page);
  else renderSuivi(page);
}

/* ==================== TABLEAU DE SUIVI DES MISSIONS ================= */

function renderSuivi(page) {
  const f = state.filters.missions;

  page.appendChild(
    card(
      'TABLEAU DE SUIVI DES MISSIONS',
      'Toutes les missions enregistrées, avec le nombre de missions et le cumul des jours de chaque conducteur. Les références suivent l’ordre des départs : la mission partie le plus tôt porte M-001.',
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
    'Référence', 'Conducteur', 'Nb missions<br>du conducteur', 'Véhicule', 'Destination',
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
      celluleDestinations(m),
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
      tr.dataset.search = norm(`${m.ref} ${m.conducteur} ${m.destination} ${m.vehicule}`);

      const vehLink = tr.querySelector('[data-veh]');
      if (vehLink) vehLink.onclick = (ev) => { ev.preventDefault(); openVehicleSheet(m.vehicule); };
      cablerCarte(tr, m);

      const pay = tr.querySelector('[data-pay]');
      if (pay) pay.onclick = () => openPaymentForm(m);

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openMissionForm(m);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({ title: 'Supprimer la mission', message: `Supprimer la mission ${m.ref} (${m.conducteur}) ?`, okLabel: 'Supprimer', danger: true }))) return;
          remove('missions', m.id);
          if (renumeroterMissions()) persist();
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
      emptyState(
        'Aucun conducteur du pool. Le tour de rôle ne retient que les agents actifs marqués ' +
        '« conducteur du pool » dans UTILISATEURS : ce sont les seuls autorisés à conduire les ' +
        'véhicules de mission.'
      )
    );
    return;
  }

  page.appendChild(
    groupHeader(`🔁 TOUR DE RÔLE — prochain : ${rot[0].nom || '—'}`, `${rot.length} conducteur(s) du pool`, COLORS.purple)
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
    '<div class="fields"><small>Seuls les conducteurs du pool figurent ici : ils sont les seuls ' +
    'autorisés à conduire les véhicules de mission. Un agent y entre par la mention « conducteur ' +
    'du pool » de sa fiche, dans UTILISATEURS.</small></div>';
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
        celluleDestinations(m),
        `<span class="badge" style="background:${rempli ? COLORS.purple : COLORS.orange}">${rempli ? 'Rempli' : 'À compléter'}</span>`,
        `<button class="miniBtn" style="background:${COLORS.blue};padding:6px 12px" data-voir>Voir</button>`
      ];
    });

    page.appendChild(
      dataTable(headers, rows, (tr, i) => {
        const m = list[i];
        tr.dataset.search = norm(`${m.ref} ${m.conducteur} ${m.vehicule} ${m.destination}`);
        tr.querySelector('[data-voir]').onclick = () => openRapportVue(m);
        cablerCarte(tr, m);
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
      (d.etapes.length > 1
        ? d.etapes.map((e, i) =>
            ligne(`Destination ${i + 1}`, `${e.vers} — ${e.km === null ? '? km' : `${fmt(e.km)} km${e.estimee ? ' (estimé)' : ''}`} depuis ${e.de}`)).join('') +
          ligne('Distance totale du parcours', d.distanceParcours)
        : ligne('Destination', d.destination) +
          (d.distanceParcours ? ligne('Distance depuis Abidjan', d.distanceParcours) : '')) +
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

/**
 * Champ « Prix du litre » du bloc ravitaillement : liste des prix regles dans
 * REGLAGES, avec une derniere entree qui rend la saisie libre.
 *
 * Le bloc est monte a la main dans la modale, il ne passe pas par le
 * formulaire declaratif : ce petit couple de fonctions lui rend le meme
 * service que `selectAdd` rend aux champs ordinaires.
 */
function champPrixHtml() {
  const prix = prixLitreOptions();
  return (
    '<select data-rprix>' +
    '<option value="">— choisir —</option>' +
    prix.map((p) => `<option value="${esc(p)}">${esc(fmt(p))} F</option>`).join('') +
    '<option value="__autre__">+ Autre prix</option>' +
    '</select>'
  );
}

/**
 * Bascule la liste des prix en saisie libre sur « + Autre prix », et revient
 * a la liste par « ↩ ».
 *
 * Le bouton de retour n'est pas un ornement : sans lui, un clic de trop
 * enferme dans la saisie libre pour tout le reste du rapport. C'est le geste
 * qu'offrent deja les autres listes ouvertes de l'application (marque,
 * modele, couleur, prix de la dotation) — celle-ci ne va pas s'en distinguer.
 */
function cablerPrix(bloc) {
  const select = bloc.querySelector('select[data-rprix]');
  if (!select) return;
  select.addEventListener('change', () => {
    if (select.value !== '__autre__') return;

    const zone = el('<div class="addField"></div>');
    const saisie = el('<input type="number" step="any" data-rprix placeholder="Prix du litre">');
    const retour = el('<button type="button" class="miniBtn addBack" title="Revenir à la liste">↩</button>');
    zone.appendChild(saisie);
    zone.appendChild(retour);

    select.replaceWith(zone);
    saisie.focus();

    retour.onclick = () => {
      select.value = '';
      zone.replaceWith(select);
      cablerPrix(bloc);
      select.focus();
    };

    // Le prix saisi rejoint la liste : on le retrouve si l'on repasse par « ↩ ».
    saisie.addEventListener('change', () => {
      const v = saisie.value.trim();
      if (v && ![...select.options].some((o) => o.value === v)) {
        select.insertBefore(el(`<option value="${esc(v)}">${esc(fmt(v))} F</option>`), select.lastElementChild);
      }
    });
  });
}

/** Formulaire de saisie du rapport, avec la liste des ravitaillements. */
function openRapportForm(m) {
  const rav = (m.ravitaillements || []).map((r) => Object.assign({}, r));

  openForm({
    title: `Rapport de mission — ${m.ref || m.conducteur}`,
    intro: `${m.conducteur || '—'} · ${texteDestinations(destinationsDe(m)) || '—'}` +
      `${libelleParcours(parcoursMission(m)) ? ` (parcours : ${libelleParcours(parcoursMission(m))})` : ''}` +
      ` · ${dateFR(m.dateDepart) || '…'} → ${dateFR(m.dateRetour) || '…'}`,
    fields: [
      { key: 'participant1', label: 'Participant 1', value: (m.participants || [])[0] },
      { key: 'participant2', label: 'Participant 2', value: (m.participants || [])[1] },
      { key: 'participant3', label: 'Participant 3', value: (m.participants || [])[2] },
      { key: 'participant4', label: 'Participant 4', value: (m.participants || [])[3] },
      { key: 'dotationCarburant', label: 'Dotation en carburant (F)', type: 'number', value: m.dotationCarburant },
      { key: 'kmDepart', label: 'Km départ', type: 'number', value: m.kmDepart },
      { key: 'kmArrivee', label: 'Km arrivée', type: 'number', value: m.kmArrivee },
      { key: 'distance', label: 'Distance parcourue', type: 'static', value: '' },
      { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: m.observations },
      { key: 'images', label: 'Photos et documents', type: 'images', full: true, value: m.images,
        hint: 'Ordre de mission signé, justificatifs de frais' }
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
        '<div class="fRow"><label>Prix du litre</label>' + champPrixHtml() + '</div>' +
        '<div class="fRow"><label>Quantité (L)</label><input type="number" step="any" data-rqte></div>' +
        '</div><button type="button" class="smallBtn" data-radd>+ Ajouter ce ravitaillement</button>' +
        '<div class="subEntryRow" style="margin-top:8px;border:none"><span><b>TOTAL</b></span><b data-rtotal>0 L — 0 F</b></div></div>'
      );

      const liste = bloc.querySelector('[data-ravlist]');
      const total = bloc.querySelector('[data-rtotal]');
      cablerPrix(bloc);

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
        const prixL = francSup(bloc.querySelector('[data-rprix]').value);
        if (!station || quantite <= 0) {
          toast('Renseignez le point de ravitaillement et une quantité valide.', 'err');
          return;
        }
        rav.push({ date: bloc.querySelector('[data-rdate]').value, station, quantite, prixL });
        bloc.querySelector('[data-rstation]').value = '';
        bloc.querySelector('[data-rqte]').value = '';
        dessiner();
      };

      scope.insertBefore(bloc, scope.querySelector('.err'));
    },
    onSubmit: (v) => {
      update('missions', m.id, {
        participants: [v.participant1, v.participant2, v.participant3, v.participant4].filter(Boolean),
        dotationCarburant: francSup(v.dotationCarburant),
        kmDepart: v.kmDepart,
        kmArrivee: v.kmArrivee,
        ravitaillements: rav,
        observations: v.observations,
        images: v.images
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
  // Depart le plus recent en tete. A date egale, on departage par la
  // reference : elle suit l'ordre des departs, la colonne se lit donc de
  // haut en bas sans rupture.
  list.sort((a, b) => {
    const parDate = String(b.dateDepart).localeCompare(String(a.dateDepart));
    return parDate !== 0 ? parDate : String(b.ref).localeCompare(String(a.ref));
  });
  return list;
}

function missionFields(m = {}) {
  return [
    // La reference dit le rang chronologique de la mission : elle se deduit
    // de la date de depart et se recalcule a chaque enregistrement. La saisir
    // a la main reviendrait a pouvoir la mettre en desaccord avec le tableau.
    { key: 'ref', label: 'Référence', type: 'static', value: m.ref || '',
      hint: 'Attribuée selon la date de départ — la plus ancienne porte M-001' },
    { key: 'conducteur', label: 'Conducteur', required: true, value: m.conducteur, list: conducteursProposes() },
    { key: 'vehicule', label: 'Véhicule (immatriculation)', value: m.vehicule, list: knownImmats() },
    // Liste ou l'on puise les destinations, une a une : chacune rejoint le
    // parcours affiche juste dessous (voir cablerParcours). Le champ lui-meme
    // revient a vide apres chaque ajout, il n'est pas enregistre.
    { key: 'destination', label: 'Destinations', type: 'selectAdd', full: true, value: '',
      options: nomsDestinationsMission(), emptyLabel: '— ajouter une destination —', addLabel: 'Nouvelle destination',
      hint: 'Ajoutez autant de destinations que nécessaire, dans l’ordre du parcours' },
    { key: 'dateDepart', label: 'Date départ', type: 'date', value: m.dateDepart || todayISO() },
    { key: 'dateRetour', label: 'Date retour', type: 'date', value: m.dateRetour },
    { key: 'jours', label: 'Nombre de jours', type: 'static', value: m.jours,
      hint: 'Jour de départ inclus' },
    { key: 'montant', label: 'Montant des frais (F)', type: 'number', value: m.montant }
  ];
}

/** Le conducteur dont c'est le tour arrive en tete des suggestions. */
function conducteursProposes() {
  const rot = rotationConducteurs().map((r) => r.nom);
  const autres = knownDrivers().filter((n) => !rot.includes(n));
  return [...rot, ...autres];
}

export function openMissionForm(m) {
  const isEdit = !!m;
  const rot = rotationConducteurs();
  // Le parcours en cours de saisie, et les distances d'etape tapees a la
  // main, par trajet : deplacer une ville ne fait pas perdre ce qu'on a
  // saisi pour un trajet qui existe toujours.
  const parcours = destinationsDe(m || {}).map((nom) => ({ nom }));
  const saisies = new Map();
  let redessinerParcours = () => {};
  openForm({
    title: isEdit ? `Modifier la mission ${m.ref}` : 'Nouvelle mission',
    intro: !isEdit && rot.length ? `Tour de rôle : c’est au tour de ${rot[0].nom}.` : undefined,
    fields: missionFields(m || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la mission',
    extra: (scope) => { redessinerParcours = cablerParcours(scope, parcours, saisies); },
    onInput: (values, scope) => {
      // Une destination choisie dans la liste rejoint aussitot le parcours.
      // Une nouvelle, tapee a la main, attend le bouton « Ajouter » : on ne
      // l'ajoute pas lettre a lettre.
      const liste = scope.querySelector('select[data-key="destination"]');
      if (liste && liste.value && liste.value !== '__ajout__') {
        ajouterEtape(parcours, liste.value);
        liste.value = '';
        redessinerParcours();
      }

      const j = joursMission(values.dateDepart, values.dateRetour);
      const node = scope.querySelector('[data-key="jours"]');
      if (node) node.value = j === null || j < 1 ? '—' : `${j} j`;

      // La reference se lit avant d'enregistrer : c'est le rang qu'occupera
      // cette mission une fois les departs remis dans l'ordre.
      const ref = scope.querySelector('[data-key="ref"]');
      if (ref) ref.value = refPrevue(values.dateDepart, m);
    },
    onSubmit: (values) => {
      const jours = joursMission(values.dateDepart, values.dateRetour);
      if (jours !== null && jours < 1) return 'La date de retour est antérieure à la date de départ.';
      if ([...saisies.values()].some((km) => km !== '' && num(km) < 0)) return 'Une distance ne peut pas être négative.';

      // Une destination tapee sans avoir clique « Ajouter » n'est pas perdue.
      if (values.destination && values.destination !== '__ajout__') ajouterEtape(parcours, values.destination);

      // Chaque destination garde l'ecriture de la liste ; une nouvelle y entre.
      const noms = parcours.map((e) => {
        const fiche = destinationMissionParNom(e.nom) || assurerDestinationMission(e.nom);
        return fiche ? fiche.nom : e.nom;
      });

      // Une distance d'etape corrigee ici est gardee pour de bon : depuis
      // Abidjan, c'est la distance de la destination ; entre deux villes,
      // c'est un trajet enregistre, repris par les missions suivantes. Le
      // tableau de suivi et le rapport de mission lisent ainsi les memes
      // chiffres que ce formulaire.
      parcoursDe(noms).etapes.forEach((e) => {
        const km = saisies.get(cleTrajet(e.de, e.vers));
        if (km === undefined || km === '') return;
        if (norm(e.de) === norm(ORIGINE_MISSIONS)) {
          const fiche = destinationMissionParNom(e.vers);
          if (fiche && (num(km) !== num(fiche.distanceKm) || fiche.estimee)) {
            update('destinationsMission', fiche.id, { distanceKm: num(km), estimee: false });
          }
        } else if (e.km === null || num(km) !== num(e.km) || e.estimee) {
          enregistrerTrajet(e.de, e.vers, km);
        }
      });

      const payload = {
        conducteur: values.conducteur,
        vehicule: String(values.vehicule || '').trim().toUpperCase(),
        destinations: noms,
        destination: texteDestinations(noms),
        dateDepart: values.dateDepart,
        dateRetour: values.dateRetour,
        jours: jours === null ? '' : jours,
        montant: francSup(values.montant)
      };
      if (isEdit) update('missions', m.id, payload);
      else {
        insert('missions', Object.assign(
          { ref: '', paye: false, datePaiement: '', participants: [], ravitaillements: [], kmDepart: '', kmArrivee: '', observations: '' },
          payload
        ));
      }
      // Une mission ajoutee ou redatee decale toutes celles qui la suivent :
      // les references se recalculent d'un bloc plutot que de figer un rang
      // que le tableau contredirait ensuite.
      if (renumeroterMissions()) persist();
      toast(isEdit ? 'Mission mise à jour.' : 'Mission enregistrée.', 'ok');
      rerender();
      return null;
    }
  });
}

/**
 * Reference qu'aura la mission pour une date de depart donnee : son rang
 * parmi les departs deja enregistres, la mission en cours de modification
 * mise a part.
 */
function refPrevue(dateDepart, mission) {
  if (!dateDepart) return `M-${String(DB.missions.length + (mission ? 0 : 1)).padStart(3, '0')} (sans date)`;
  const avant = DB.missions.filter(
    (x) => x.id !== (mission && mission.id) && x.dateDepart && x.dateDepart <= dateDepart
  ).length;
  return `M-${String(avant + 1).padStart(3, '0')}`;
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
        montant: francSup(values.montant),
        referencePaiement: values.referencePaiement
      });
      toast('Mission marquée comme payée.', 'ok');
      rerender();
      return null;
    }
  });
}

/* ========================= DESTINATIONS ============================ */

/**
 * Cellule « Destination » : chaque etape avec sa distance depuis la
 * precedente — Abidjan pour la premiere — puis le total du parcours.
 */
function celluleDestinations(m) {
  const p = parcoursMission(m);
  const lignes = p.etapes.map((e, i) => {
    const connue = destinationMissionParNom(e.vers);
    const km = e.km === null
      ? `<small style="color:${COLORS.orange}">? km</small>`
      : `<small style="color:${COLORS.purple};white-space:nowrap"><b>${e.estimee ? '≈ ' : ''}${fmt(e.km)} km</b>` +
        `${p.etapes.length > 1 ? ` depuis ${esc(e.de)}` : ' d’Abidjan'}</small>`;
    return `${esc(e.vers)} ${km}` +
      (connue ? ` <a href="#" data-carte="${i}" title="Voir sur Google Maps" style="text-decoration:none">📍</a>` : '');
  });
  if (p.etapes.length > 1) {
    lignes.push(`<small><b>Parcours : ${esc(libelleParcours(p) || '? km')}</b></small>`);
  }
  return lignes.join('<br>');
}

function cablerCarte(tr, m) {
  const noms = destinationsDe(m);
  tr.querySelectorAll('[data-carte]').forEach((lien) => {
    lien.onclick = (ev) => {
      ev.preventDefault();
      ouvrirLien(lienCarteDestination(destinationMissionParNom(noms[Number(lien.dataset.carte)])));
    };
  });
}

/** Les liens partent dans le navigateur du systeme (voir electron/main.cjs). */
function ouvrirLien(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

/** Ajoute une destination au parcours, sans doublon, sous son nom de la liste. */
function ajouterEtape(parcours, saisie) {
  const nom = String(saisie || '').trim();
  if (!nom || parcours.some((e) => norm(e.nom) === norm(nom))) return false;
  const d = destinationMissionParNom(nom);
  parcours.push({ nom: d ? d.nom : nom });
  return true;
}

/**
 * Le parcours d'une mission, sous la liste des destinations : une ligne par
 * etape — Abidjan → Yamoussoukro, Yamoussoukro → Bouaké… — avec la distance
 * de l'etape (modifiable), la carte, l'itineraire de l'etape, et de quoi la
 * retirer ou la deplacer. En dessous, le total du parcours et l'itineraire
 * complet sur Google Maps pour le verifier.
 *
 * @param {Map} saisies distances tapees a la main, par trajet (cleTrajet)
 * @returns {Function} redessine le parcours (apres un ajout depuis la liste)
 */
function cablerParcours(scope, parcours, saisies) {
  const ligneChamp = scope.querySelector('[data-key="destination"]').closest('.fRow');
  const bloc = el(
    '<div class="subBlock" style="margin-top:8px">' +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">` +
        `<button type="button" class="miniBtn" style="background:${COLORS.purple}" data-ajout-etape>+ Ajouter cette destination</button>` +
      '</div>' +
      '<div data-etapes></div>' +
      '<div data-resume style="margin-top:6px"></div>' +
    '</div>'
  );
  ligneChamp.appendChild(bloc);
  const etapes = bloc.querySelector('[data-etapes]');
  const resume = bloc.querySelector('[data-resume]');
  const boutonAjout = bloc.querySelector('[data-ajout-etape]');

  // Le bouton ne sert qu'a la saisie libre : une destination de la liste
  // s'ajoute d'elle-meme des qu'on la choisit.
  const saisieLibre = () => {
    const n = ligneChamp.querySelector('input[data-key="destination"]');
    boutonAjout.style.display = n ? '' : 'none';
    return n;
  };

  const ajouterSaisie = () => {
    const n = saisieLibre();
    if (!n || !n.value.trim()) return toast('Tapez le nom de la nouvelle destination.', 'info');
    if (!ajouterEtape(parcours, n.value)) toast('Cette destination est déjà dans le parcours.', 'info');
    n.value = '';
    dessiner();
    n.focus();
  };
  boutonAjout.onclick = ajouterSaisie;

  // Entree dans le champ de saisie ajoute l'etape au lieu d'enregistrer la
  // mission : on tape plusieurs destinations a la suite.
  scope.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-key="destination"]')) {
      e.preventDefault();
      e.stopPropagation();
      ajouterSaisie();
    }
  }, true);
  // La bascule liste <-> saisie libre remplace le champ : on suit le mouvement.
  ligneChamp.addEventListener('change', () => setTimeout(saisieLibre, 0));
  ligneChamp.addEventListener('click', () => setTimeout(saisieLibre, 0));

  /** Les etapes, avec la distance tapee a la main quand il y en a une. */
  const calcul = () => {
    const p = parcoursDe(parcours.map((e) => e.nom));
    p.etapes.forEach((e) => {
      const tape = saisies.get(cleTrajet(e.de, e.vers));
      if (tape !== undefined && tape !== '') { e.km = num(tape); e.estimee = false; e.tape = true; }
    });
    p.total = p.etapes.reduce((t, e) => t + (e.km || 0), 0);
    p.complet = p.etapes.every((e) => e.km !== null);
    p.estimee = p.etapes.some((e) => e.estimee);
    return p;
  };

  const dessiner = () => {
    saisieLibre();
    const p = calcul();
    etapes.innerHTML = p.etapes.length
      ? p.etapes.map((e, i) =>
          '<div class="subEntryRow" style="gap:6px;flex-wrap:wrap;align-items:center">' +
            `<span style="flex:1 1 160px"><b>${i + 1}. ${esc(e.vers)}</b>` +
              `<br><small>depuis ${esc(e.de)}</small>` +
              (e.km === null
                ? '<br><small style="color:#b26a00">distance à renseigner — voir l’itinéraire 🧭</small>'
                : e.estimee ? '<br><small style="color:#b26a00">distance estimée — à vérifier</small>' : '') +
            '</span>' +
            '<span style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' +
              `<input type="number" min="0" step="any" data-km="${i}" value="${e.km === null ? '' : esc(e.km)}" placeholder="km" ` +
                `title="Distance de ${esc(e.de)} à ${esc(e.vers)} (km)" style="width:80px">` +
              '<small>km</small>' +
              `<button type="button" class="miniBtn" style="background:${COLORS.purple};padding:4px 7px" data-carte-e="${i}" title="Voir ${esc(e.vers)} sur Google Maps">📍</button>` +
              `<button type="button" class="miniBtn" style="background:${COLORS.blue};padding:4px 7px" data-itin-e="${i}" title="Itinéraire ${esc(e.de)} → ${esc(e.vers)}">🧭</button>` +
              (i > 0 ? `<button type="button" class="miniBtn" style="background:${COLORS.grey};padding:4px 7px" data-monte="${i}" title="Plus tôt dans le parcours">↑</button>` : '') +
              `<button type="button" class="miniBtn" style="background:${COLORS.red};padding:4px 7px" data-retire="${i}" title="Retirer">✕</button>` +
            '</span>' +
          '</div>'
        ).join('')
      : '<div class="subEntryRow"><span><small>Aucune destination — choisissez-en une dans la liste.</small></span></div>';

    etapes.querySelectorAll('[data-km]').forEach((n) => {
      n.oninput = () => {
        const e = p.etapes[Number(n.dataset.km)];
        saisies.set(cleTrajet(e.de, e.vers), n.value === '' ? '' : Number(n.value));
        dessinerResume();
      };
    });
    const fiche = (nom) => destinationMissionParNom(nom) || { nom, localisation: '', lat: '', lng: '' };
    etapes.querySelectorAll('[data-carte-e]').forEach((b) => {
      b.onclick = () => ouvrirLien(lienCarteDestination(fiche(p.etapes[Number(b.dataset.carteE)].vers)));
    });
    etapes.querySelectorAll('[data-itin-e]').forEach((b) => {
      b.onclick = () => { const e = p.etapes[Number(b.dataset.itinE)]; ouvrirLien(lienEtape(e.de, e.vers)); };
    });
    etapes.querySelectorAll('[data-retire]').forEach((b) => {
      b.onclick = () => { parcours.splice(Number(b.dataset.retire), 1); dessiner(); };
    });
    etapes.querySelectorAll('[data-monte]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.monte);
        [parcours[i - 1], parcours[i]] = [parcours[i], parcours[i - 1]];
        dessiner();
      };
    });
    dessinerResume();
  };

  const dessinerResume = () => {
    const p = calcul();
    if (!p.etapes.length) { resume.innerHTML = ''; return; }
    resume.innerHTML =
      `<div class="subEntryRow" style="border:none"><span><b>Distance totale du parcours</b>` +
        `${p.etapes.length > 1 ? `<br><small>${p.etapes.map((e) => (e.km === null ? '?' : fmt(e.km))).join(' + ')} km</small>` : ''}` +
      `</span><b style="color:${COLORS.purple}">${esc(libelleParcours(p) || '? km')}</b></div>` +
      `<button type="button" class="miniBtn" style="background:${COLORS.blue};margin-top:4px" data-parcours>` +
        `🧭 Parcours sur Google Maps (Abidjan → ${esc(p.etapes[p.etapes.length - 1].vers)})</button>`;
    resume.querySelector('[data-parcours]').onclick = () => ouvrirLien(lienParcours(parcours.map((e) => e.nom)));
  };

  dessiner();
  return dessiner;
}

function renderDestinations(page) {
  page.appendChild(
    card(
      'DESTINATIONS DES MISSIONS',
      'Les lieux de mission, avec leur distance depuis Abidjan et leur localisation sur Google Maps. Ils sont proposés dans le formulaire de mission ; une destination ajoutée là rejoint cette liste. Les distances des villes fournies sont indicatives : « Itinéraire » ouvre le trajet routier exact pour les vérifier.',
      COLORS.purple
    )
  );

  const list = DB.destinationsMission.slice().sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Destinations', fmt(list.length), 'enregistrées', COLORS.purple));
  grid.appendChild(statTile('Sans distance', fmt(list.filter((d) => d.distanceKm === '' || d.distanceKm === undefined).length),
    'à compléter', COLORS.orange));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouvelle destination', cls: 'addBtn', color: COLORS.purple, write: true, onClick: () => openDestinationForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => exportDestinations('excel', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => exportDestinations('pdf', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState('Aucune destination enregistrée.'));
    renderTrajets(page);
    return;
  }

  const headers = ['Destination', 'Distance<br>depuis Abidjan', 'Localisation', 'Missions', ''];
  const rows = list.map((d) => {
    const n = missionsVersDestination(d.nom).length;
    const dist = libelleDistance(d.nom);
    return [
      `<b>${esc(d.nom || '')}</b>`,
      `<span style="display:block;text-align:right">${dist
        ? `<b>${esc(dist)}</b>${d.estimee ? '<br><small>estimée</small>' : ''}`
        : `<span class="badge" style="background:${COLORS.orange}">à renseigner</span>`}</span>`,
      (d.localisation ? `${esc(d.localisation)}<br>` : '') +
        `<button class="miniBtn" style="background:${COLORS.purple};padding:5px 8px" data-carte>📍 Carte</button> ` +
        `<button class="miniBtn" style="background:${COLORS.blue};padding:5px 8px" data-itin>🧭 Itinéraire</button>`,
      `<span style="display:block;text-align:center">${fmt(n)}</span>`,
      canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const d = list[i];
      tr.dataset.search = norm(`${d.nom} ${d.localisation}`);
      tr.querySelector('[data-carte]').onclick = () => ouvrirLien(lienCarteDestination(d));
      tr.querySelector('[data-itin]').onclick = () => ouvrirLien(lienItineraire(d));

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openDestinationForm(d);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          const n = missionsVersDestination(d.nom).length;
          if (!(await confirmDialog({
            title: 'Supprimer la destination',
            message: n
              ? `« ${d.nom} » est la destination de ${n} mission(s). Elles garderont ce nom, mais sans distance. Supprimer ?`
              : `Supprimer « ${d.nom} » ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('destinationsMission', d.id);
          toast('Destination supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
  renderTrajets(page);
}

/**
 * Les trajets entre villes gardes au fil des missions : chaque distance
 * d'etape corrigee dans un formulaire de mission arrive ici, et sert aux
 * missions suivantes. On peut aussi en saisir un directement.
 */
function renderTrajets(page) {
  page.appendChild(
    groupHeader('🛣️ TRAJETS ENTRE VILLES', `${DB.trajets.length} enregistré(s)`, COLORS.purple)
  );
  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouveau trajet', cls: 'addBtn', color: COLORS.purple, write: true, onClick: () => openTrajetForm(null) }
    ])
  );
  if (!DB.trajets.length) {
    page.appendChild(emptyState(
      'Aucun trajet enregistré. Entre deux villes, la distance est déduite de leur distance depuis Abidjan ' +
      'quand elles sont sur la même route, estimée sinon. Une distance corrigée dans une mission est gardée ici.'
    ));
    return;
  }
  const list = DB.trajets.slice().sort((a, b) => `${a.a} ${a.b}`.localeCompare(`${b.a} ${b.b}`, 'fr'));
  const rows = list.map((t) => [
    `<b>${esc(t.a)}</b> ↔ <b>${esc(t.b)}</b>`,
    `<span style="display:block;text-align:right"><b>${fmt(t.km)} km</b></span>`,
    `<button class="miniBtn" style="background:${COLORS.blue};padding:5px 8px" data-itin>🧭 Itinéraire</button>`,
    canWrite()
      ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
        `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
      : ''
  ]);
  page.appendChild(
    dataTable(['Trajet', 'Distance', 'Google Maps', ''], rows, (tr, i) => {
      const t = list[i];
      tr.dataset.search = norm(`${t.a} ${t.b}`);
      tr.querySelector('[data-itin]').onclick = () => ouvrirLien(lienEtape(t.a, t.b));
      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openTrajetForm(t);
      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({
            title: 'Supprimer le trajet',
            message: `Supprimer le trajet ${t.a} ↔ ${t.b} ? La distance sera de nouveau calculée.`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('trajets', t.id);
          toast('Trajet supprimé.', 'ok');
          rerender();
        };
      }
    })
  );
}

function openTrajetForm(t) {
  const isEdit = !!t;
  const villes = [ORIGINE_MISSIONS, ...nomsDestinationsMission()];
  openForm({
    title: isEdit ? `Modifier le trajet ${t.a} ↔ ${t.b}` : 'Nouveau trajet',
    fields: [
      { key: 'a', label: 'De', required: true, value: t && t.a, list: villes },
      { key: 'b', label: 'À', required: true, value: t && t.b, list: villes },
      { key: 'km', label: 'Distance par la route (km)', type: 'number', required: true, value: t && t.km,
        hint: 'Lue par exemple sur l’itinéraire Google Maps' }
    ],
    okLabel: 'Enregistrer le trajet',
    onInput: (values, scope) => {
      const km = scope.querySelector('[data-key="km"]');
      if (!isEdit && km && km.value === '' && values.a && values.b) {
        const d = distanceEntre(values.a, values.b);
        if (d) km.placeholder = `proposé : ${d.estimee ? '≈ ' : ''}${d.km} km`;
      }
    },
    onSubmit: (values) => {
      if (norm(values.a) === norm(values.b)) return 'Les deux villes doivent être différentes.';
      if (num(values.km) < 0) return 'La distance ne peut pas être négative.';
      if (isEdit && cleTrajet(values.a, values.b) !== cleTrajet(t.a, t.b)) remove('trajets', t.id);
      enregistrerTrajet(values.a, values.b, values.km);
      toast('Trajet enregistré.', 'ok');
      rerender();
      return null;
    }
  });
}

function openDestinationForm(d) {
  const isEdit = !!d;
  // La distance proposee a partir des coordonnees n'ecrase jamais une
  // distance tapee : on ne remplace que le vide ou notre propre estimation.
  let estimationProposee = null;
  let estimee = isEdit ? !!d.estimee : false;

  openForm({
    title: isEdit ? `Modifier la destination — ${d.nom}` : 'Nouvelle destination',
    fields: [
      { key: 'nom', label: 'Destination', required: true, full: true, value: d && d.nom,
        placeholder: 'Ville, localité, site…' },
      { key: 'localisation', label: 'Localisation', full: true, value: d && d.localisation,
        placeholder: 'Coordonnées (ex. 7.6939, -5.0303), lien Google Maps ou adresse',
        hint: 'Sur Google Maps, un clic droit sur le lieu affiche ses coordonnées : un clic dessus les copie. Collées ici, elles donnent la distance.' },
      { key: 'distanceKm', label: 'Distance depuis Abidjan (km)', type: 'number', value: d && d.distanceKm,
        hint: 'Calculée à partir des coordonnées (estimation), ou lue sur « Itinéraire depuis Abidjan »' }
    ],
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la destination',
    extra: (scope) => {
      const champ = scope.querySelector('[data-key="localisation"]');
      const barre = el(
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
          `<button type="button" class="miniBtn" style="background:${COLORS.purple}" data-voir-carte>📍 Rechercher sur Google Maps</button>` +
          `<button type="button" class="miniBtn" style="background:${COLORS.blue}" data-itineraire>🧭 Itinéraire depuis Abidjan</button>` +
        '</div>'
      );
      const lue = () => {
        const nom = (scope.querySelector('[data-key="nom"]') || {}).value || '';
        const loc = champ.value.trim();
        const coord = coordonneesDe(loc);
        return { nom: nom.trim(), localisation: loc, lat: coord ? coord.lat : '', lng: coord ? coord.lng : '' };
      };
      barre.querySelector('[data-voir-carte]').onclick = () => {
        const x = lue();
        if (!x.nom && !x.localisation) return toast('Tapez d’abord le nom de la destination.', 'info');
        ouvrirLien(lienCarteDestination(x));
      };
      barre.querySelector('[data-itineraire]').onclick = () => {
        const x = lue();
        if (!x.nom && !x.localisation) return toast('Tapez d’abord le nom de la destination.', 'info');
        ouvrirLien(lienItineraire(x));
      };
      champ.closest('.fRow').appendChild(barre);
    },
    onInput: (values, scope) => {
      const champ = scope.querySelector('[data-key="distanceKm"]');
      if (!champ) return;
      const coord = coordonneesDe(values.localisation);
      const proposee = coord ? distanceEstimee(coord) : null;
      if (proposee && (champ.value === '' || Number(champ.value) === estimationProposee)) {
        champ.value = proposee;
        estimationProposee = proposee;
        estimee = true;
      } else if (champ.value !== '' && Number(champ.value) !== estimationProposee &&
                 !(isEdit && Number(champ.value) === Number(d.distanceKm))) {
        // Une distance tapee a la main n'est plus une estimation.
        estimee = false;
      }
    },
    onSubmit: (values) => {
      const nom = String(values.nom || '').trim();
      const autre = destinationMissionParNom(nom);
      if (autre && (!isEdit || autre.id !== d.id)) return `« ${autre.nom} » existe déjà dans la liste.`;
      if (values.distanceKm !== '' && num(values.distanceKm) < 0) return 'La distance ne peut pas être négative.';

      const coord = coordonneesDe(values.localisation);
      const payload = {
        nom,
        localisation: values.localisation,
        lat: coord ? coord.lat : (isEdit && !values.localisation ? d.lat : ''),
        lng: coord ? coord.lng : (isEdit && !values.localisation ? d.lng : ''),
        distanceKm: values.distanceKm === '' ? '' : num(values.distanceKm),
        estimee: values.distanceKm === '' ? false : estimee
      };
      if (isEdit) {
        const suivies = renommerDestinationMission(d.nom, nom);
        update('destinationsMission', d.id, payload);
        toast(`Destination mise à jour.${suivies ? ` ${suivies} mission(s) suivent le nouveau nom.` : ''}`, 'ok');
      } else {
        insert('destinationsMission', payload);
        toast('Destination enregistrée.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

async function exportDestinations(kind, list) {
  try {
    const datasets = [dsDestinationsMission(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_destinations_missions')
      : await exportPdf(datasets, 'PDU_destinations_missions', { title: 'Destinations des missions' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
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
