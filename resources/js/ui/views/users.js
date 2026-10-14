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
import {
  TYPES_DEMANDE, MOTIF_DEMANDE, lendemain, dureeConge, totalAbsence, periodeAuTableau, etatValidation,
  validationAbsence, decisionPourDemande, MOTIFS_SANS_VALIDATION
} from '../../core/demandes.js';
import { exporterDemande } from '../../export/demandes.js';
import { urlImage } from '../../core/images.js';
import { canWrite } from '../../core/auth.js';
import {
  voit, filtrer, seulementSiennes, peutModifier, peutValider, peutValiderPour, agentConnecte, estAMoi
} from '../../core/acces.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast,
  dataTable, openModal, subEmpty, subtabs, statTile, sectionLabel, COLORS
} from '../components.js';
import { state, rerender, openUserSheet } from '../shell.js';
import { renderStatistiques, SOUS_RUBRIQUE_STATS } from './statistiques.js';
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
    // Trois lignes pre-inscrites : le numero de la flotte, le personnel et le
    // numero de poste. Chacun sait ainsi lequel il renseigne, et un tableau se
    // lit de la meme facon d'une fiche a l'autre.
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
  { key: 'indisponibilites', label: 'CONGÉS ET ABSENCES AU POOL' },
  SOUS_RUBRIQUE_STATS
];

export function renderUsers(page) {
  const sub = state.sub.UTILISATEURS || 'liste';
  // Chaque sous-rubrique a son propre niveau d'acces (REGLAGES).
  const subs = SUBS.filter((s) => (s.key === 'liste' ? voit('UTILISATEURS') : s.key === 'indisponibilites' ? voit('CONGES') : true));
  page.appendChild(
    subtabs(subs, sub, (k) => { state.sub.UTILISATEURS = k; rerender(); },
      { liste: COLORS.blue, indisponibilites: COLORS.purple, stats: COLORS.grey })
  );
  if (sub === 'stats') renderStatistiques(page, 'UTILISATEURS');
  else if (sub === 'indisponibilites') renderIndisponibilites(page);
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

  // Un conducteur n'y voit que sa propre fiche.
  let list = filtrer('UTILISATEURS', DB.users.slice().reverse());
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
  renderTableauAbsences(page);
  renderDemandes(page);
}

function renderTableauAbsences(page) {
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

  // Un conducteur n'y voit que ses propres absences.
  let list = filtrer('CONGES', DB.indisponibilites.slice());
  if (f.etat) list = list.filter((i) => etatIndisponibilite(i, jour) === f.etat);
  if (f.motif) list = list.filter((i) => i.motif === f.motif);
  if (f.conducteur) list = list.filter((i) => norm(i.conducteur || '').includes(norm(f.conducteur)));
  // Les plus recentes en tete.
  list.sort((a, b) => String(b.dateDepart || '').localeCompare(String(a.dateDepart || '')));

  const enCours = filtrer('CONGES', indisponibilitesEnCours(jour));
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('En cours', fmt(enCours.length),
    enCours.length ? enCours.map((i) => i.conducteur).join(', ') : 'aucun conducteur absent', COLORS.red));
  grid.appendChild(statTile('À venir', fmt(filtrer('CONGES', DB.indisponibilites).filter((i) => etatIndisponibilite(i, jour) === 'à venir').length),
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

  const headers = ['Conducteur', 'Motif', 'Date de départ', 'Date de reprise', 'Durée', 'Intérimaire', 'État', 'Validation', 'Justificatif', ''];
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
      `<span style="white-space:nowrap">${voyantValidation(validationAbsence(i, DB.demandes || []))}</span>`,
      (i.images || []).length
        ? `<button class="miniBtn" style="background:${COLORS.purple};padding:5px 8px" data-photo>📎 ${(i.images || []).length}</button>`
        : '<span style="color:#8aa0a6">—</span>',
      `<button class="miniBtn" style="background:${COLORS.blue};padding:5px 8px" data-fiche>Fiche</button>` +
      (canWrite()
        ? ` <button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : '')
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, k) => {
      const i = list[k];
      tr.dataset.search = norm(`${i.conducteur} ${i.motif} ${i.interimaire} ${i.dateDepart} ${i.dateReprise}`);
      tr.querySelector('[data-fiche]').onclick = () => openFicheIndisponibilite(i);
      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openIndisponibiliteForm(i);
      // Le justificatif se consulte sur la fiche : un agent en lecture seule
      // le voit aussi.
      const ph = tr.querySelector('[data-photo]');
      if (ph) ph.onclick = () => openFicheIndisponibilite(i);
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
    ...(!peutValider() ? [] : [{ key: 'validee', label: 'Validation', type: 'select', allowEmpty: true, emptyLabel: '— en cours —',
      options: ['Oui', 'Non'], value: valeurValidation(i),
      hint: demandeDeLAbsence(i)
        ? 'Reprise de la demande liée, et reportée sur elle si vous la changez ici'
        : 'Sans objet pour un repos maladie' }]),
    { key: 'images', label: 'Ajout d’image', type: 'images', full: true, value: i.images,
      hint: 'Titre de congé, autorisation de permission, certificat médical (JPEG ou PNG)' }
  ];
}

/** La demande dont une absence du tableau est issue, s'il y en a une. */
function demandeDeLAbsence(i) {
  if (!i || !i.id) return null;
  return (DB.demandes || []).find((x) => x.id === i.demandeId || (x.indispoId && x.indispoId === i.id)) || null;
}

/** La decision d'une absence, telle que la liste « Validation » l'affiche. */
function valeurValidation(i) {
  const v = validationAbsence(i, DB.demandes || []);
  return v === 'oui' ? 'Oui' : v === 'non' ? 'Non' : '';
}

/** Voyant de validation, ou mention quand rien n'est decide ou a decider. */
function voyantValidation(v) {
  if (v === 'oui') return '<span class="voyant vert" title="Validée"></span><span class="voyantTexte">Validée</span>';
  if (v === 'non') return '<span class="voyant rouge" title="Refusée"></span><span class="voyantTexte">Refusée</span>';
  if (v === 'information') return '<span class="voyantInfo">ℹ Information</span>';
  return '<em class="voyantAttente">En cours…</em>';
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
      // Un repos maladie ne se valide pas : la liste se vide et se fige.
      const v = scope.querySelector('[data-key="validee"]');
      if (v) {
        const sans = MOTIFS_SANS_VALIDATION.includes(values.motif);
        if (sans) v.value = '';
        v.disabled = sans;
      }
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
      // Le champ « Validation » n'est propose qu'a qui peut valider : absent,
      // la decision deja prise reste telle quelle.
      const decide = values.validee !== undefined;
      if (decide && values.validee && !peutValiderPour(conducteur)) {
        return 'Vous ne pouvez pas décider de votre propre absence : un autre responsable doit la valider.';
      }
      const payload = {
        conducteur,
        motif: values.motif,
        dateDepart: values.dateDepart,
        dateReprise: values.dateReprise,
        duree: d,
        interimaire,
        validee: MOTIFS_SANS_VALIDATION.includes(values.motif) ? ''
          : decide ? values.validee || '' : (i && i.validee) || '',
        images: values.images
      };
      // La decision suit la demande liee : les deux tableaux disent la meme chose.
      const demande = isEdit ? demandeDeLAbsence(i) : null;
      if (decide && demande && !MOTIFS_SANS_VALIDATION.includes(values.motif)) {
        update('demandes', demande.id, decisionPourDemande(demande, payload.validee));
      }
      if (isEdit) update('indisponibilites', i.id, payload);
      else insert('indisponibilites', Object.assign({ createdAt: new Date().toISOString() }, payload));
      toast(isEdit ? 'Indisponibilité mise à jour.' : 'Indisponibilité enregistrée.', 'ok');
      rerender();
      return null;
    }
  });
}

/* ============== DEMANDES DE CONGE ET D'ABSENCE (imprimes) ============= */

const COULEUR_DEMANDE = { conge: COLORS.blue, absence: COLORS.orange };

function renderDemandes(page) {
  page.appendChild(sectionLabel('DEMANDES DE CONGÉ ET D’ABSENCE', COLORS.purple));
  page.appendChild(
    card(
      'DEMANDES DE CONGÉ ET D’ABSENCE',
      'Remplissez la demande ici, puis exportez-la : le PDF reprend l’imprimé officiel du PDU, prêt à signer. ' +
      'La demande de congé comprend la fiche d’intérim. Une demande peut aussi s’inscrire au tableau ci-dessus, ' +
      'pour que le conducteur sorte du tour de rôle pendant son absence.',
      COLORS.purple
    )
  );
  page.appendChild(
    toolbar([
      peutDeposer() && { label: '+ Demande de congé', cls: 'addBtn', color: COLORS.blue, write: true, onClick: () => openDemandeForm('conge', null) },
      peutDeposer() && { label: '+ Demande d’absence', cls: 'addBtn', color: COLORS.orange, write: true, onClick: () => openDemandeForm('absence', null) }
    ])
  );

  const list = filtrer('CONGES', (DB.demandes || []).slice())
    .sort((a, b) => String(b.dateDemande || b.createdAt || '').localeCompare(String(a.dateDemande || a.createdAt || '')));
  if (!list.length) {
    page.appendChild(emptyState('Aucune demande enregistrée.'));
    return;
  }

  const headers = ['Formulaire', 'Agent', 'Du', 'Au', 'Durée', 'Demandé le', 'Validation', 'Au tableau', ''];
  const rows = list.map((d) => {
    const conge = d.type === 'conge';
    const auTableau = d.indispoId && DB.indisponibilites.some((i) => i.id === d.indispoId);
    const etat = etatValidation(d);
    const validation = etat === 'oui'
      ? '<span class="voyant vert" title="Demande validée"></span><span class="voyantTexte">Validée</span>'
      : etat === 'non'
        ? '<span class="voyant rouge" title="Demande refusée"></span><span class="voyantTexte">Refusée</span>'
        : '<em class="voyantAttente">En cours…</em>';
    return [
      `<span class="badge" style="background:${COULEUR_DEMANDE[d.type] || COLORS.grey}">${esc(TYPES_DEMANDE[d.type] || '')}</span>`,
      `<b>${esc(d.agent || d.nomPrenoms || `${d.nom || ''} ${d.prenoms || ''}`)}</b>`,
      esc(dateFR(d.dateDebut)) + (!conge && d.heureDebut ? ` <small>${esc(d.heureDebut)}</small>` : ''),
      esc(dateFR(conge ? d.dateFin : d.dateRetour)) + (!conge && d.heureRetour ? ` <small>${esc(d.heureRetour)}</small>` : ''),
      esc((conge ? d.duree : d.total) || '—'),
      esc(dateFR(d.dateDemande)),
      `<span style="white-space:nowrap">${validation}</span>`,
      auTableau ? '✓' : '<span style="color:#8aa0a6">—</span>',
      `<button class="miniBtn" style="background:${COLORS.blue};padding:5px 8px" data-fiche>Fiche${(d.images || []).length ? ` 📎${(d.images || []).length}` : ''}</button> ` +
      `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-pdf title="Exporter l’imprimé">📄 PDF</button> ` +
      (demandeModifiable(d)
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : '')
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, k) => {
      const d = list[k];
      tr.dataset.search = norm(`${d.agent} ${d.nomPrenoms} ${d.nom} ${d.prenoms} ${TYPES_DEMANDE[d.type]} ${d.dateDebut}`);
      tr.querySelector('[data-fiche]').onclick = () => openFicheDemande(d);
      tr.querySelector('[data-pdf]').onclick = () => exporterImprime(d);
      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openDemandeForm(d.type, d);
      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          const lie = d.indispoId && DB.indisponibilites.find((i) => i.id === d.indispoId);
          if (!(await confirmDialog({
            title: 'Supprimer la demande',
            message: `Supprimer la ${(TYPES_DEMANDE[d.type] || 'demande').toLowerCase()} de ${d.agent || d.nomPrenoms || '—'} ?` +
              (lie ? ' L’absence inscrite au tableau reste ; supprimez-la à part si elle n’a plus lieu d’être.' : ''),
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('demandes', d.id);
          toast('Demande supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

async function exporterImprime(d) {
  try {
    const res = await exporterDemande(d);
    if (res) toast('Export terminé.', 'ok');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

/**
 * La fiche d'une demande : tout ce qu'elle contient, sa decision et ses
 * images, en consultation. L'imprime s'exporte et la demande se modifie
 * depuis la fiche.
 */
function openFicheDemande(d) {
  const conge = d.type === 'conge';
  const etat = etatValidation(d);
  const auTableau = d.indispoId && DB.indisponibilites.some((i) => i.id === d.indispoId);
  const quand = (date, heure) => [dateFR(date), heure].filter(Boolean).join(' à ');
  const lignes = conge
    ? [
      ['Agent', d.agent], ['Nom', d.nom], ['Prénoms', d.prenoms], ['Fonction', d.fonction], ['Service', d.service],
      ['Date d’embauche', dateFR(d.dateEmbauche)], ['Début du congé', dateFR(d.dateDebut)], ['Fin du congé', dateFR(d.dateFin)],
      ['Reprise du service', dateFR(d.dateReprise)], ['Durée', d.duree], ['Fait à', d.faitA],
      ['Date de la demande', dateFR(d.dateDemande)], ['Intérimaire', d.interimaire],
      ['Activités en cours', d.activites, true], ['Points clés à suivre', d.pointsCles, true]
    ]
    : [
      ['Agent', d.agent], ['Matricule', d.matricule], ['Nom & Prénoms', d.nomPrenoms], ['Fonction', d.fonction],
      ['Début', quand(d.dateDebut, d.heureDebut)], ['Retour', quand(d.dateRetour || (d.heureRetour ? d.dateDebut : ''), d.heureRetour)],
      ['Total demandé', d.total], ['Date de la demande', dateFR(d.dateDemande)],
      ['Motif', d.motif, true], ['Commentaires', d.commentaires, true]
    ];
  const decision = etat === 'oui'
    ? '<span class="voyant vert"></span>Validée'
    : etat === 'non' ? '<span class="voyant rouge"></span>Refusée' : '<em class="voyantAttente">En cours…</em>';

  const corps = el(
    '<div class="ficheDemande">' +
      `<div class="ficheDemandeTete" style="border-color:${COULEUR_DEMANDE[d.type] || COLORS.grey}">` +
        `<span class="badge" style="background:${COULEUR_DEMANDE[d.type] || COLORS.grey}">${esc(TYPES_DEMANDE[d.type] || '')}</span>` +
        `<b>${esc(d.agent || d.nomPrenoms || `${d.nom || ''} ${d.prenoms || ''}`)}</b>` +
        `<span class="ficheDemandeDecision">${decision}</span>` +
      '</div>' +
      '<dl class="ficheDemandeGrille">' +
        lignes.map(([k, v, large]) =>
          `<div class="${large ? 'large' : ''}"><dt>${esc(k)}</dt><dd>${v ? escLignes(String(v)) : '<span class="vide">—</span>'}</dd></div>`
        ).join('') +
        `<div><dt>Au tableau des absences</dt><dd>${auTableau ? 'Oui — sort du tour de rôle' : 'Non'}</dd></div>` +
      '</dl>' +
      `<h4 class="ficheDemandeTitre">IMAGES (${(d.images || []).length})</h4>` +
    '</div>'
  );
  corps.appendChild(galerieDemande(d.images || []));

  openModal({
    title: `${TYPES_DEMANDE[d.type] || 'Demande'} — ${d.agent || d.nomPrenoms || ''}`,
    bodyNode: corps,
    buttons: [
      { label: 'Fermer', cls: 'cancel', onClick: (close) => close() },
      { label: '📄 Imprimé PDF', cls: 'ok', onClick: () => exporterImprime(d) },
      ...(demandeModifiable(d) ? [{ label: '✎ Modifier', cls: 'ok', onClick: (close) => { close(); openDemandeForm(d.type, d); } }] : [])
    ]
  });
}

/**
 * La fiche d'une absence du tableau : periode, interimaire, etat, la
 * demande dont elle vient s'il y en a une, et le justificatif.
 */
function openFicheIndisponibilite(i) {
  const etat = etatIndisponibilite(i, todayISO());
  const d = dureeIndisponibilite(i.dateDepart, i.dateReprise);
  const demande = (DB.demandes || []).find((x) => x.id === i.demandeId || (x.indispoId && x.indispoId === i.id)) || null;
  const lignes = [
    ['Conducteur', i.conducteur], ['Motif', i.motif],
    ['Date de départ', dateFR(i.dateDepart)], ['Date de reprise', dateFR(i.dateReprise)],
    ['Durée', d === null ? '' : `${fmt(d)} jour${d > 1 ? 's' : ''}`], ['Intérimaire', i.interimaire],
    ['Tour de rôle', etat === 'en cours' ? 'Hors du tour de rôle jusqu’à la reprise' : etat === 'à venir' ? 'Sortira du tour de rôle au départ' : 'De retour dans le tour de rôle'],
    ['Demande liée', demande ? `${TYPES_DEMANDE[demande.type] || 'Demande'} du ${dateFR(demande.dateDemande)}` : '']
  ];
  const validation = voyantValidation(validationAbsence(i, DB.demandes || []));
  const couleur = COULEUR_MOTIF[i.motif] || COLORS.purple;
  const corps = el(
    '<div class="ficheDemande">' +
      `<div class="ficheDemandeTete" style="border-color:${couleur}">` +
        `<span class="badge" style="background:${couleur}">${esc(i.motif || 'Absence')}</span>` +
        `<b>${esc(i.conducteur || '')}</b>` +
        (etat ? `<span class="ficheDemandeDecision"><span class="badge" style="background:${COULEUR_ETAT[etat]}">${esc(etat)}</span></span>` : '') +
      '</div>' +
      '<dl class="ficheDemandeGrille">' +
        lignes.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v ? esc(String(v)) : '<span class="vide">—</span>'}</dd></div>`).join('') +
        `<div><dt>Validation</dt><dd>${validation}</dd></div>` +
      '</dl>' +
      `<h4 class="ficheDemandeTitre">JUSTIFICATIF (${(i.images || []).length})</h4>` +
    '</div>'
  );
  corps.appendChild(galerieDemande(i.images || []));

  openModal({
    title: `Absence — ${i.conducteur || ''}`,
    bodyNode: corps,
    buttons: [
      { label: 'Fermer', cls: 'cancel', onClick: (close) => close() },
      ...(demande ? [{ label: '📋 Voir la demande', cls: 'ok', onClick: (close) => { close(); openFicheDemande(demande); } }] : []),
      ...(canWrite() ? [{ label: '✎ Modifier', cls: 'ok', onClick: (close) => { close(); openIndisponibiliteForm(i); } }] : [])
    ]
  });
}

/** Les images d'une demande, en vignettes : un toucher les agrandit. */
function galerieDemande(images) {
  const zone = el('<div class="imgChamp"><div class="imgGalerie"></div></div>');
  const galerie = zone.querySelector('.imgGalerie');
  if (!images.length) {
    galerie.appendChild(el('<p class="apercuNote" style="margin:4px 0">Aucune image jointe.</p>'));
    return zone;
  }
  images.forEach((img) => {
    const fig = el(
      '<figure class="imgVignette"><span class="imgAbsente">chargement…</span>' +
      `<figcaption>${esc(img.nom || '')}</figcaption></figure>`
    );
    galerie.appendChild(fig);
    urlImage(img.id).then((url) => {
      if (!url) {
        fig.querySelector('.imgAbsente').textContent = 'introuvable';
        return;
      }
      const vue = el(`<img src="${url}" alt="${esc(img.nom || '')}">`);
      vue.onclick = () => openModal({
        title: img.nom || 'Image',
        bodyNode: el(`<div style="text-align:center"><img src="${url}" alt="${esc(img.nom || '')}" ` +
          'style="max-width:100%;max-height:70vh;border-radius:10px"></div>'),
        buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }]
      });
      fig.replaceChild(vue, fig.querySelector('.imgAbsente'));
    });
  });
  return zone;
}

/** L'agent enregistre dans UTILISATEURS sous ce nom. */
function agentParNom(nom) {
  const cle = norm(nom || '');
  return cle ? DB.users.find((u) => norm(nomComplet(u)) === cle) || null : null;
}

/** La derniere demande du meme agent : on y reprend matricule et date d'embauche. */
function derniereDemandeDe(nom) {
  const cle = norm(nom || '');
  return (DB.demandes || []).filter((d) => cle && norm(d.agent || '') === cle)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))).pop() || null;
}

const OUI_NON = [{ value: 'Oui', label: 'Oui' }, { value: 'Non', label: 'Non' }];

/** Deposer une demande : en saisie, ou pour soi-meme quand on ne voit que ses fiches. */
function peutDeposer() {
  return canWrite() || (seulementSiennes('CONGES') && !!agentConnecte());
}

/**
 * Modifier une demande : en saisie, ou la sienne tant qu'aucune decision
 * n'est prise.
 */
function demandeModifiable(d) {
  if (canWrite()) return true;
  return peutModifier('CONGES', d) && etatValidation(d) === 'en cours';
}

function demandeFields(type, d) {
  const agents = nomsUtilisateurs().slice().sort((a, b) => a.localeCompare(b, 'fr'));
  // Qui ne voit que ses fiches depose ses demandes a son nom, et a lui seul.
  const pourSoi = seulementSiennes('CONGES');
  const agent = pourSoi
    ? { key: 'agent', label: 'Agent (demandeur)', type: 'static', value: d.agent || agentConnecte() }
    : { key: 'agent', label: 'Agent (demandeur)', type: 'selectAdd', required: true, value: d.agent,
      options: agents, emptyLabel: '— choisir un agent —', addLabel: 'Autre personne',
      hint: 'Nom, fonction et service se remplissent depuis UTILISATEURS' };
  // La decision n'est proposee qu'a qui peut valider, et jamais sur sa
  // propre demande.
  const decide = peutValider() && (!d.agent || peutValiderPour(d.agent));
  const inscrire = { key: 'inscrire', label: 'Inscrire au tableau des congés et absences', type: 'select', options: OUI_NON,
    value: d.inscrire || 'Oui', hint: 'Le conducteur sort du tour de rôle pendant son absence' };
  const dateDemande = { key: 'dateDemande', label: 'Date de la demande', type: 'date', value: d.dateDemande || todayISO() };
  const images = { key: 'images', label: 'Ajout d’image', type: 'images', full: true, value: d.images,
    hint: 'Demande signée, titre de congé, justificatif, certificat (JPEG ou PNG)' };
  if (type === 'conge') {
    return [
      agent,
      { key: 'nom', label: 'Nom', required: true, value: d.nom },
      { key: 'prenoms', label: 'Prénoms', value: d.prenoms },
      { key: 'fonction', label: 'Fonction', value: d.fonction },
      { key: 'service', label: 'Service', value: d.service },
      { key: 'dateEmbauche', label: 'Date de la prise de service (date d’embauche)', type: 'date', value: d.dateEmbauche },
      { key: 'dateDebut', label: 'Date début congé', type: 'date', required: true, value: d.dateDebut },
      { key: 'dateFin', label: 'Date de fin congé', type: 'date', required: true, value: d.dateFin },
      { key: 'dateReprise', label: 'Date reprise du service', type: 'date', value: d.dateReprise,
        hint: 'Proposée : le lendemain de la fin du congé' },
      { key: 'duree', label: 'Durée du congé', value: d.duree, hint: 'Calculée du début à la fin, modifiable' },
      { key: 'faitA', label: 'Fait à', value: d.faitA || DB.settings.ville || 'Abidjan' },
      dateDemande,
      ...(decide ? [{ key: 'validee', label: 'Demande validée', type: 'select', allowEmpty: true, emptyLabel: '— en cours —',
        options: ['Oui', 'Non'], value: d.validee, hint: 'Voyant vert si oui, rouge si non dans le tableau' }] : []),
      { key: 'interimaire', label: 'Intérimaire (fiche d’intérim)', type: 'selectAdd', value: d.interimaire,
        options: agents, emptyLabel: '— aucun —', addLabel: 'Autre personne' },
      { key: 'activites', label: 'Activités principales en cours', type: 'textarea', rows: 6, full: true, value: d.activites,
        hint: 'Une activité par ligne (6 au plus)' },
      { key: 'pointsCles', label: 'Points clés à suivre', type: 'textarea', rows: 5, full: true, value: d.pointsCles,
        hint: 'Un point par ligne (5 au plus)' },
      images,
      inscrire
    ];
  }
  return [
    agent,
    { key: 'matricule', label: 'Matricule', value: d.matricule },
    { key: 'nomPrenoms', label: 'Nom & Prénoms', required: true, value: d.nomPrenoms },
    { key: 'fonction', label: 'Fonction', value: d.fonction },
    { key: 'dateDebut', label: 'Début — date', type: 'date', required: true, value: d.dateDebut || todayISO() },
    { key: 'heureDebut', label: 'Début — heure', type: 'time', value: d.heureDebut },
    { key: 'dateRetour', label: 'Retour — date', type: 'date', value: d.dateRetour },
    { key: 'heureRetour', label: 'Retour — heure', type: 'time', value: d.heureRetour },
    { key: 'total', label: 'Total jour/heures demandés', value: d.total, hint: 'Calculé, modifiable' },
    ...(decide ? [{ key: 'autorisee', label: 'Absence autorisée', type: 'select', allowEmpty: true, emptyLabel: '— pas encore décidé —',
      options: ['OUI', 'NON'], value: d.autorisee,
      hint: 'Voyant vert ou rouge dans le tableau ; vide : « en cours », case à cocher à la main sur l’imprimé' }] : []),
    { key: 'motif', label: 'Motif de la demande', type: 'textarea', rows: 3, full: true, required: true, value: d.motif },
    { key: 'commentaires', label: 'Commentaires', full: true, value: d.commentaires },
    dateDemande,
    images,
    inscrire
  ];
}

function openDemandeForm(type, d) {
  const isEdit = !!d;
  const conge = type === 'conge';
  const nomType = TYPES_DEMANDE[type];
  // Ce que le formulaire a rempli lui-meme : une valeur retouchee a la main
  // n'est plus recalculee.
  let dernierAgent = isEdit ? d.agent : '';
  const auto = { duree: isEdit ? d.duree : '', total: isEdit ? d.total : '', dateReprise: isEdit ? d.dateReprise : '' };

  openForm({
    title: isEdit ? `Modifier — ${nomType}` : nomType.toUpperCase(),
    fields: demandeFields(type, d || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la demande',
    onInput: (v, scope) => {
      const poser = (k, val) => {
        const n = scope.querySelector(`[data-key="${k}"]`);
        if (n && val !== undefined && val !== null) n.value = val;
      };
      // Un autre agent choisi : ses informations remplacent les precedentes.
      if (v.agent && v.agent !== dernierAgent) {
        dernierAgent = v.agent;
        const u = agentParNom(v.agent);
        const avant = derniereDemandeDe(v.agent);
        if (conge) {
          poser('nom', u ? u.nom || '' : v.agent);
          poser('prenoms', u ? u.prenoms || '' : '');
          poser('service', u ? u.section || '' : '');
          if (avant && avant.dateEmbauche) poser('dateEmbauche', avant.dateEmbauche);
        } else {
          poser('nomPrenoms', v.agent);
          if (avant && avant.matricule) poser('matricule', avant.matricule);
        }
        poser('fonction', u ? u.fonction || '' : '');
        // Un conducteur du pool s'inscrit au tableau ; un autre agent, non.
        if (!isEdit) poser('inscrire', u && u.poolConducteur === 'Oui' ? 'Oui' : 'Non');
      }
      if (conge) {
        const rep = lendemain(v.dateFin);
        if (rep && (!v.dateReprise || v.dateReprise === auto.dateReprise)) { poser('dateReprise', rep); auto.dateReprise = rep; }
        const du = dureeConge(v.dateDebut, v.dateFin);
        if (du && (!v.duree || v.duree === auto.duree)) { poser('duree', du); auto.duree = du; }
      } else {
        const t = totalAbsence(v.dateDebut, v.heureDebut, v.dateRetour, v.heureRetour);
        if (t && (!v.total || v.total === auto.total)) { poser('total', t); auto.total = t; }
      }
    },
    onSubmit: (values) => {
      const agentNom = String(values.agent || '').trim();
      if (seulementSiennes('CONGES') && !estAMoi('CONGES', { agent: agentNom })) {
        return 'Vous ne pouvez déposer une demande qu’à votre nom.';
      }
      if ((values.validee || values.autorisee) && !peutValiderPour(agentNom)) {
        return 'Vous ne pouvez pas décider de votre propre demande : un autre responsable doit la valider.';
      }
      if (conge) {
        if (!dureeConge(values.dateDebut, values.dateFin)) return 'La date de fin du congé ne peut pas précéder la date de début.';
        if (values.dateReprise && values.dateReprise <= values.dateFin) return 'La reprise du service doit suivre la fin du congé.';
        if (values.interimaire && norm(values.interimaire) === norm(agentNom)) return 'L’intérimaire ne peut pas être le demandeur.';
      } else if (values.dateRetour && values.dateRetour < values.dateDebut) {
        return 'La date de retour ne peut pas précéder la date de début.';
      }
      const fiche = Object.assign({}, values, { type, agent: agentNom });

      // L'absence au tableau : celle deja liee a la demande, ou une nouvelle.
      const lie = isEdit && d.indispoId ? DB.indisponibilites.find((i) => i.id === d.indispoId) : null;
      let absence = null;
      if (values.inscrire === 'Oui') {
        const periode = periodeAuTableau(fiche);
        if (periode) {
          const autre = chevauchementIndisponibilite(agentNom, periode.dateDepart, periode.dateReprise, lie && lie.id);
          if (autre) {
            return `${agentNom} est déjà au tableau des absences du ${dateFR(autre.dateDepart)} au ${dateFR(autre.dateReprise) || '…'} ` +
              `(${autre.motif || '—'}). Modifiez cette absence, ou répondez « Non » à l’inscription au tableau.`;
          }
          absence = {
            conducteur: agentNom,
            motif: MOTIF_DEMANDE[type],
            dateDepart: periode.dateDepart,
            dateReprise: periode.dateReprise,
            duree: dureeIndisponibilite(periode.dateDepart, periode.dateReprise),
            interimaire: conge ? String(values.interimaire || '').trim() : (lie ? lie.interimaire || '' : '')
          };
        }
      }

      const enreg = isEdit
        ? update('demandes', d.id, fiche)
        : insert('demandes', Object.assign({ createdAt: new Date().toISOString() }, fiche));
      if (absence) {
        if (lie) update('indisponibilites', lie.id, absence);
        else {
          const cree = insert('indisponibilites', Object.assign({ createdAt: new Date().toISOString(), demandeId: enreg.id }, absence));
          update('demandes', enreg.id, { indispoId: cree.id });
        }
      }
      toast((isEdit ? 'Demande mise à jour.' : 'Demande enregistrée.') + (absence ? ' Absence inscrite au tableau.' : ''), 'ok');
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
