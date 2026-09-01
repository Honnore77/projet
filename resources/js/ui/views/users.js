/* ===================================================================
   UTILISATEURS — agents du PDU et historique des incidents.

   La liste s'affiche en tableau des l'ouverture, avec les informations
   du formulaire. Les sections sont celles de la liste commune, et les
   agents enregistres ici alimentent le champ « Utilisateur » des fiches
   vehicule de pool et de service.
   =================================================================== */

import {
  DB, STATUTS_USER, SECTIONS, insert, update, remove, touch, knownImmats,
  nomComplet, vehiculesDeLAgent, renommerAgentSurVehicules, detacherAgentDesVehicules,
  lignesTelephone
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast,
  dataTable, openModal, subEmpty, COLORS
} from '../components.js';
import { state, rerender } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsUsers, dsIncidents } from '../../export/datasets.js';

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
    { key: 'observations', label: 'Autres observations', type: 'textarea', full: true, value: h.observations }
  ];
}

export function renderUsers(page) {
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
      canWrite()
        ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const u = list[i];
      tr.dataset.search = norm(`${u.nom} ${u.prenoms} ${u.fonction} ${u.section} ${u.telephone || ''} ${u.email || ''}`);

      tr.querySelector('[data-hist]').onclick = () => openHistorique(u);

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
