/* ===================================================================
   UTILISATEURS — deux sous-rubriques :

     LISTE DES UTILISATEURS     agents du PDU et historique des incidents
     CONGES ET ABSENCES AU POOL conges, permissions et repos maladie des
                                conducteurs du pool, avec leur interimaire

   La liste s'affiche en tableau des l'ouverture, avec les informations
   du formulaire. Les sections sont celles de la liste commune, et les
   agents enregistres ici alimentent le champ « Utilisateur » des fiches
   vehicule de pool et de service.
   =================================================================== */

import {
  DB, STATUTS_USER, SECTIONS, insert, update, remove, touch, knownImmats,
  nomComplet, vehiculesDeLAgent, renommerAgentSurVehicules, detacherAgentDesVehicules,
  lignesTelephone, MOTIFS_INDISPONIBILITE, dureeIndisponibilite, etatIndisponibilite,
  conducteursDuPool, chevauchementIndisponibilite, indisponibilitesEnCours,
  renommerAgentDansIndisponibilites, nomsUtilisateurs
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast,
  dataTable, openModal, subEmpty, subtabs, statTile, COLORS
} from '../components.js';
import { state, rerender, openUserSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsUsers, dsIncidents, dsIndisponibilites } from '../../export/datasets.js';

function userFields(u = {}) {
  return [
    { key: 'nom', label: 'Nom', required: true, value: u.nom },
    { key: 'prenoms', label: 'Prénoms', value: u.prenoms },
    { key: 'fonction', label: 'Fonction au PDU', value: u.fonction },
    {
      key: 'section',
      label: 'Section',
      type: 'select',
      options: SECTIONS,
      allowEmpty: true,
      emptyLabel: '— aucune —',
      value: u.section
    },
    { key: 'statut', label: 'Statut', type: 'select', options: STATUTS_USER, value: u.statut || 'Actif' },
    {
      key: 'poolConducteur',
      label: 'Conducteur du pool',
      type: 'select',
      options: [{ value: 'Non', label: 'Non' }, { value: 'Oui', label: 'Oui' }],
      value: u.poolConducteur === 'Oui' ? 'Oui' : 'Non',
      hint: 'Entre dans le tour de rôle des missions'
    },
    // Trois lignes pre-inscrites : le numero de la flotte et les deux
    // personnels. Chacun sait ainsi lequel il renseigne, et un tableau se lit
    // de la meme facon d'une fiche a l'autre.
    { key: 'telephone', label: 'Téléphone', type: 'textarea', full: true, rows: 3,
      value: lignesTelephone(u.telephone),
      hint: 'Une ligne par numéro — complétez après les deux-points' },
    { key: 'email', label: 'Adresse email', value: u.email, full: true },
    { key: 'permis', label: 'N° de permis', value: u.permis },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: u.observations },
    { key: 'images', label: 'Photos et documents', type: 'images', full: true, value: u.images,
      hint: 'Photo de l’agent, permis de conduire' }
  ];
}

function incidentFields(h = {}) {
  return [
    { key: 'nature', label: 'Nature (accident, retard, dégradation…)', required: true, full: true, value: h.nature },
    { key: 'date', label: 'Date', type: 'date', value: h.date || todayISO() },
    { key: 'vehicule', label: 'Véhicule concerné', value: h.vehicule, list: knownImmats() },
    { key: 'circonstances', label: 'Circonstances', type: 'textarea', full: true, value: h.circonstances },
    { key: 'responsabilite', label: 'Responsabilité', value: h.responsabilite },
    { key: 'suite', label: 'Suite donnée', value: h.suite },
    { key: 'observations', label: 'Autres observations', type: 'textarea', full: true, value: h.observations },
    { key: 'images', label: 'Photos et documents', type: 'images', full: true, value: h.images,
      hint: 'Constat, photo des dégâts, courrier' }
  ];
}

const SUBS = [
  { key: 'liste', label: 'LISTE DES UTILISATEURS' },
  { key: 'indisponibilites', label: 'CONGÉS ET ABSENCES AU POOL' }
];

export function renderUsers(page) {
  const sub = state.sub.UTILISATEURS || 'liste';
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.UTILISATEURS = k; rerender(); },
      { liste: COLORS.blue, indisponibilites: COLORS.purple })
  );
  if (sub === 'indisponibilites') renderIndisponibilites(page);
  else renderListe(page);
}

function renderListe(page) {
  const f = state.filters.users;

  page.appendChild(
    card('UTILISATEURS', 'Agents du PDU. Le champ « Utilisateur » des fiches véhicule de pool et de service est synchronisé avec cette liste : un nom saisi là-bas apparaît ici, un nom modifié ici suit sur les fiches. Ils alimentent aussi le tour de rôle des missions.', COLORS.blue)
  );

  page.appendChild(
    filterBar([
      {
        type: 'select',
        value: f.statut,
        options: [{ value: '', label: 'Tous les statuts' }, ...STATUTS_USER],
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

  let list = DB.users.slice().reverse();
  if (f.statut) list = list.filter((u) => u.statut === f.statut);
  if (f.section) list = list.filter((u) => u.section === f.section);

  page.appendChild(
    toolbar([
      canWrite() && {
        label: '+ Ajouter un utilisateur',
        cls: 'addBtn',
        color: COLORS.blue,
        write: true,
        onClick: () => openUserForm(null)
      },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.users.length ? 'Aucun utilisateur ne correspond aux filtres.' : 'Aucun utilisateur enregistré.'));
    return;
  }

  const headers = [
    'Nom', 'Prénoms', 'Fonction au PDU', 'Section', 'Statut',
    'Conducteur<br>du pool', 'Véhicule(s)<br>attribué(s)', 'Téléphone', 'Adresse email',
    'N° de permis', 'Incidents', 'Observations', ''
  ];

  const rows = list.map((u) => {
    const hist = u.historique || [];
    return [
      `<b>${esc(u.nom || '')}</b>`,
      esc(u.prenoms || ''),
      esc(u.fonction || ''),
      esc(u.section || ''),
      `<span class="badge" style="background:${u.statut === 'Actif' ? COLORS.green : COLORS.red}">${esc(u.statut || '')}</span>`,
      `<span style="display:block;text-align:center">${u.poolConducteur === 'Oui' ? '🔁 Oui' : '—'}</span>`,
      vehiculesDeLAgent(nomComplet(u))
        .map((v) => `<span class="badge" style="background:${v._cat === 'pool' ? COLORS.green : COLORS.purple}">${esc(v.immatNouvelle || v.immatAncienne || '?')}</span>`)
        .join(' ') || '<span style="color:#8aa0a6">—</span>',
      `<span style="white-space:nowrap">${escLignes(u.telephone || '')}</span>`,
      esc(u.email || ''),
      esc(u.permis || ''),
      `<button class="miniBtn" style="background:${hist.length ? COLORS.orange : COLORS.grey};padding:5px 8px" data-hist>${hist.length} incident(s)</button>`,
      esc(u.observations || ''),
      `<button class="miniBtn" style="background:${COLORS.blue};padding:5px 8px" data-fiche>Fiche</button>` +
        (canWrite()
          ? ` <button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
            `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
          : '')
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const u = list[i];
      tr.dataset.search = norm(`${u.nom} ${u.prenoms} ${u.fonction} ${u.section} ${u.telephone || ''} ${u.email || ''}`);

      tr.querySelector('[data-hist]').onclick = () => openHistorique(u);
      tr.querySelector('[data-fiche]').onclick = () => openUserSheet(u.id);

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openUserForm(u);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          const attribues = vehiculesDeLAgent(nomComplet(u));
          const ok = await confirmDialog({
            title: 'Supprimer l’utilisateur',
            message:
              `Supprimer définitivement ${u.nom} ${u.prenoms} et son historique d’incidents ?` +
              (attribues.length
                ? `\n\n${attribues.length} véhicule(s) lui sont attribué(s) (${attribues.map((v) => v.immatNouvelle || v.immatAncienne || '?').join(', ')}). Le champ « Utilisateur » de ces fiches sera vidé ; les véhicules eux-mêmes sont conservés.`
                : ''),
            okLabel: 'Supprimer',
            danger: true
          });
          if (!ok) return;
          detacherAgentDesVehicules(nomComplet(u));
          remove('users', u.id);
          toast('Utilisateur supprimé.', 'ok');
          rerender();
        };
      }
    })
  );
}

/** Historique des incidents d'un agent, en fenetre dediee. */
function openHistorique(u) {
  const corps = el('<div></div>');

  const dessiner = () => {
    const hist = (u.historique || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    corps.innerHTML =
      `<div class="subBlock"><h5>Incidents et observations (${hist.length})</h5>` +
      (hist.length
        ? hist
            .map(
              (h, i) =>
                `<div class="subEntryRow"><span><b>${esc(h.nature || 'Incident')}</b> — ${esc(dateFR(h.date))}` +
                `${h.vehicule ? ` · ${esc(h.vehicule)}` : ''}` +
                `${h.circonstances ? `<br><small>${esc(h.circonstances)}</small>` : ''}` +
                `${h.responsabilite ? `<br><small>Responsabilité : ${esc(h.responsabilite)}</small>` : ''}` +
                `${h.suite ? `<br><small>Suite : ${esc(h.suite)}</small>` : ''}</span>` +
                (canWrite()
                  ? `<span style="white-space:nowrap"><button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-hedit="${i}">✎</button> ` +
                    `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-hdel="${i}">✕</button></span>`
                  : '')
            )
            .join('')
        : subEmpty('Aucun incident enregistré')) +
      '</div>';

    corps.querySelectorAll('[data-hedit]').forEach((b) => {
      b.onclick = () => openIncidentForm(u, hist[Number(b.dataset.hedit)], dessiner);
    });
    corps.querySelectorAll('[data-hdel]').forEach((b) => {
      b.onclick = async () => {
        const h = hist[Number(b.dataset.hdel)];
        if (!(await confirmDialog({ title: 'Supprimer l’incident', message: `Supprimer « ${h.nature || 'incident'} » du ${dateFR(h.date)} ?`, okLabel: 'Supprimer', danger: true }))) return;
        u.historique = u.historique.filter((x) => x !== h);
        touch('users', u);
        toast('Incident supprimé.', 'ok');
        dessiner();
        rerender();
      };
    });
  };
  dessiner();

  openModal({
    title: `${u.nom} ${u.prenoms} — incidents`,
    bodyNode: corps,
    buttons: [
      { label: 'Fermer', cls: 'cancel', onClick: (close) => close() },
      ...(canWrite()
        ? [{ label: '+ Ajouter un incident', cls: 'ok', onClick: () => openIncidentForm(u, null, dessiner) }]
        : [])
    ]
  });
}

export function openUserForm(u) {
  const isEdit = !!u;
  openForm({
    title: isEdit ? `Modifier — ${u.nom} ${u.prenoms}` : 'Nouvel utilisateur',
    fields: userFields(u || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer cet utilisateur',
    onSubmit: (values) => {
      values.telephone = lignesTelephone(values.telephone);
      if (isEdit) {
        // Le nom change ici doit changer sur les fiches vehicule : elles ne
        // retiennent qu'un nom, pas un identifiant.
        const ancien = nomComplet(u);
        update('users', u.id, values);
        const suivis = renommerAgentSurVehicules(ancien, nomComplet(u));
        renommerAgentDansIndisponibilites(ancien, nomComplet(u));
        toast(
          suivis
            ? `Utilisateur mis à jour — ${suivis} fiche(s) véhicule suivies.`
            : 'Utilisateur mis à jour.',
          'ok'
        );
      } else {
        insert('users', Object.assign({ historique: [] }, values));
        toast('Utilisateur enregistré.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

function openIncidentForm(u, incident, onDone) {
  const isEdit = !!incident;
  openForm({
    title: isEdit ? 'Modifier l’incident' : `Nouvel incident — ${u.nom} ${u.prenoms}`,
    fields: incidentFields(incident || {}),
    okLabel: isEdit ? 'Enregistrer' : 'Ajouter l’incident',
    onSubmit: (values) => {
      if (isEdit) Object.assign(incident, values);
      else {
        u.historique = u.historique || [];
        u.historique.push(values);
      }
      touch('users', u);
      toast(isEdit ? 'Incident mis à jour.' : 'Incident ajouté.', 'ok');
      if (onDone) onDone();
      rerender();
      return null;
    }
  });
}

/* ==================== CONGES ET ABSENCES AU POOL ==================== */

const COULEUR_ETAT = { 'en cours': COLORS.red, 'à venir': COLORS.orange, terminée: COLORS.grey };
const COULEUR_MOTIF = { 'En congé': COLORS.blue, Permissionnaire: COLORS.purple, 'Repos maladie': COLORS.red };

function renderIndisponibilites(page) {
  const f = state.filters.indisponibilites;
  const jour = todayISO();

  page.appendChild(
    card(
      'CONGÉS ET ABSENCES AU POOL',
      'Congés, permissions et repos maladie des conducteurs du pool, avec l’intérimaire qui les remplace. La date de reprise est le jour du retour au poste : partir le 5 et reprendre le 8 fait 3 jours d’absence.',
      COLORS.purple
    )
  );

  page.appendChild(
    filterBar([
      {
        type: 'select', value: f.etat,
        options: [{ value: '', label: 'Toutes' }, { value: 'en cours', label: 'En cours' },
          { value: 'à venir', label: 'À venir' }, { value: 'terminée', label: 'Terminées' }],
        onChange: (v) => { f.etat = v; rerender(); }
      },
      {
        type: 'select', value: f.motif,
        options: [{ value: '', label: 'Tous les motifs' }, ...MOTIFS_INDISPONIBILITE],
        onChange: (v) => { f.motif = v; rerender(); }
      },
      { type: 'text', placeholder: 'Conducteur', value: f.conducteur, onChange: (v) => { f.conducteur = v; rerender(); } }
    ])
  );

  let list = DB.indisponibilites.slice();
  if (f.etat) list = list.filter((i) => etatIndisponibilite(i, jour) === f.etat);
  if (f.motif) list = list.filter((i) => i.motif === f.motif);
  if (f.conducteur) list = list.filter((i) => norm(i.conducteur || '').includes(norm(f.conducteur)));
  // Les plus recentes en tete.
  list.sort((a, b) => String(b.dateDepart || '').localeCompare(String(a.dateDepart || '')));

  const enCours = indisponibilitesEnCours(jour);
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('En cours', fmt(enCours.length),
    enCours.length ? enCours.map((i) => i.conducteur).join(', ') : 'aucun conducteur absent', COLORS.red));
  grid.appendChild(statTile('À venir', fmt(DB.indisponibilites.filter((i) => etatIndisponibilite(i, jour) === 'à venir').length),
    'départs programmés', COLORS.orange));
  grid.appendChild(statTile('Indisponibilités', fmt(list.length), 'dans la liste filtrée', COLORS.purple));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Ajout d’indisponibilité', cls: 'addBtn', color: COLORS.purple, write: true, onClick: () => openIndisponibiliteForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => exportIndisponibilites('excel', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => exportIndisponibilites('pdf', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.indisponibilites.length ? 'Aucune indisponibilité ne correspond aux filtres.' : 'Aucune indisponibilité enregistrée.'));
    return;
  }

  const headers = ['Conducteur', 'Motif', 'Date de départ', 'Date de reprise', 'Durée', 'Intérimaire', 'État', 'Justificatif', ''];
  const rows = list.map((i) => {
    const d = dureeIndisponibilite(i.dateDepart, i.dateReprise);
    const etat = etatIndisponibilite(i, jour);
    return [
      `<b>${esc(i.conducteur || '')}</b>`,
      `<span class="badge" style="background:${COULEUR_MOTIF[i.motif] || COLORS.grey}">${esc(i.motif || '')}</span>`,
      esc(dateFR(i.dateDepart)),
      esc(dateFR(i.dateReprise)),
      `<span style="display:block;text-align:right;white-space:nowrap">${d === null ? '—' : `${fmt(d)} j`}</span>`,
      esc(i.interimaire || '—'),
      etat ? `<span class="badge" style="background:${COULEUR_ETAT[etat]}">${esc(etat)}</span>` : '',
      (i.images || []).length
        ? `<button class="miniBtn" style="background:${COLORS.purple};padding:5px 8px" data-photo>📎 ${(i.images || []).length}</button>`
        : '<span style="color:#8aa0a6">—</span>',
      canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, k) => {
      const i = list[k];
      tr.dataset.search = norm(`${i.conducteur} ${i.motif} ${i.interimaire} ${i.dateDepart} ${i.dateReprise}`);
      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openIndisponibiliteForm(i);
      const ph = tr.querySelector('[data-photo]');
      if (ph) ph.onclick = () => openIndisponibiliteForm(i);
      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({
            title: 'Supprimer l’indisponibilité',
            message: `Supprimer l’indisponibilité de ${i.conducteur} (${i.motif || '—'}, du ${dateFR(i.dateDepart)} au ${dateFR(i.dateReprise) || '…'}) ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('indisponibilites', i.id);
          toast('Indisponibilité supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

function indisponibiliteFields(i = {}) {
  const conducteurs = conducteursDuPool();
  return [
    // Les conducteurs du pool d'abord ; un autre agent reste possible.
    { key: 'conducteur', label: 'Nom du conducteur', type: 'selectAdd', required: true, value: i.conducteur,
      options: conducteurs, emptyLabel: '— choisir un conducteur du pool —', addLabel: 'Autre agent',
      hint: 'Conducteurs marqués « conducteur du pool » dans la liste des utilisateurs' },
    { key: 'motif', label: 'Motif', type: 'select', required: true, options: MOTIFS_INDISPONIBILITE,
      allowEmpty: true, emptyLabel: '— choisir —', value: i.motif },
    { key: 'dateDepart', label: 'Date de départ', type: 'date', required: true, value: i.dateDepart || todayISO() },
    { key: 'dateReprise', label: 'Date de reprise', type: 'date', required: true, value: i.dateReprise,
      hint: 'Jour du retour au poste' },
    { key: 'duree', label: 'Durée de l’indisponibilité', type: 'static', value: '',
      hint: 'Du départ à la veille de la reprise' },
    { key: 'interimaire', label: 'Nom de l’intérimaire', type: 'selectAdd', value: i.interimaire,
      options: nomsUtilisateurs().slice().sort((a, b) => a.localeCompare(b, 'fr')),
      emptyLabel: '— aucun —', addLabel: 'Autre personne',
      hint: 'Agent qui assure le remplacement pendant l’absence' },
    { key: 'images', label: 'Ajout d’image', type: 'images', full: true, value: i.images,
      hint: 'Titre de congé, autorisation de permission, certificat médical (JPEG ou PNG)' }
  ];
}

function openIndisponibiliteForm(i) {
  const isEdit = !!i;
  openForm({
    title: isEdit ? `Modifier l’indisponibilité — ${i.conducteur}` : 'Ajout d’indisponibilité',
    fields: indisponibiliteFields(i || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer l’indisponibilité',
    onInput: (values, scope) => {
      const d = dureeIndisponibilite(values.dateDepart, values.dateReprise);
      const n = scope.querySelector('[data-key="duree"]');
      if (n) n.value = d === null ? '—' : d < 1 ? 'reprise à corriger' : `${d} jour(s)`;
    },
    onSubmit: (values) => {
      const conducteur = String(values.conducteur || '').trim();
      const interimaire = String(values.interimaire || '').trim();
      const d = dureeIndisponibilite(values.dateDepart, values.dateReprise);
      if (d === null || d < 1) return 'La date de reprise doit être postérieure à la date de départ.';
      if (interimaire && norm(interimaire) === norm(conducteur)) return 'L’intérimaire ne peut pas être le conducteur absent.';
      const autre = chevauchementIndisponibilite(conducteur, values.dateDepart, values.dateReprise, i && i.id);
      if (autre) {
        return `${conducteur} est déjà indisponible du ${dateFR(autre.dateDepart)} au ${dateFR(autre.dateReprise) || '…'} (${autre.motif || '—'}).`;
      }
      const payload = {
        conducteur,
        motif: values.motif,
        dateDepart: values.dateDepart,
        dateReprise: values.dateReprise,
        duree: d,
        interimaire,
        images: values.images
      };
      if (isEdit) update('indisponibilites', i.id, payload);
      else insert('indisponibilites', Object.assign({ createdAt: new Date().toISOString() }, payload));
      toast(isEdit ? 'Indisponibilité mise à jour.' : 'Indisponibilité enregistrée.', 'ok');
      rerender();
      return null;
    }
  });
}

async function exportIndisponibilites(kind, list) {
  try {
    const datasets = [dsIndisponibilites(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_conges_et_absences_au_pool')
      : await exportPdf(datasets, 'PDU_conges_et_absences_au_pool', { title: 'Congés et absences au pool' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

async function doExport(kind, list) {
  try {
    const datasets = [dsUsers(list), dsIncidents(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_utilisateurs')
      : await exportPdf(datasets, 'PDU_utilisateurs', { title: 'Utilisateurs du parc' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
