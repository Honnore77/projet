/* ===================================================================
   UTILISATEURS — agents du PDU et historique des incidents.
   =================================================================== */

import { DB, STATUTS_USER, insert, update, remove, touch, knownImmats } from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast, subEmpty, COLORS
} from '../components.js';
import { state, rerender } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsUsers, dsIncidents } from '../../export/datasets.js';

function userFields(u = {}) {
  const sections = [...new Set(DB.users.map((x) => x.section).filter(Boolean))];
  return [
    { key: 'nom', label: 'Nom', required: true, value: u.nom },
    { key: 'prenoms', label: 'Prénoms', value: u.prenoms },
    { key: 'fonction', label: 'Fonction au PDU', value: u.fonction },
    { key: 'section', label: 'Section', value: u.section, list: sections },
    { key: 'statut', label: 'Statut', type: 'select', options: STATUTS_USER, value: u.statut || 'Actif' },
    { key: 'telephone', label: 'Téléphone', value: u.telephone },
    { key: 'permis', label: 'N° de permis', value: u.permis },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true, value: u.observations }
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
    card('UTILISATEURS', 'Nom · Prénoms · Fonction au PDU · Section · Statut · Historique des incidents et observations.', COLORS.blue)
  );

  page.appendChild(
    filterBar([
      {
        type: 'select',
        value: f.statut,
        options: [{ value: '', label: 'Tous les statuts' }, ...STATUTS_USER],
        onChange: (v) => { f.statut = v; rerender(); }
      },
      { type: 'text', placeholder: 'Filtrer par section', value: f.section, onChange: (v) => { f.section = v; rerender(); } }
    ])
  );

  let list = DB.users.slice().reverse();
  if (f.statut) list = list.filter((u) => u.statut === f.statut);
  if (f.section) list = list.filter((u) => norm(u.section || '').includes(norm(f.section)));

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

  list.forEach((u) => page.appendChild(userEntry(u)));
}

function userEntry(u) {
  const hist = (u.historique || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const e = el('<div class="entry"></div>');
  e.style.borderLeftColor = u.statut === 'Actif' ? COLORS.blue : COLORS.red;
  e.dataset.search = norm(`${u.nom} ${u.prenoms} ${u.fonction} ${u.section} ${u.telephone || ''}`);

  const histHtml = hist.length
    ? hist
        .map(
          (h, i) =>
            `<div class="subEntryRow"><span><b>${esc(h.nature || 'Incident')}</b> — ${esc(dateFR(h.date))}` +
            `${h.vehicule ? ` · ${esc(h.vehicule)}` : ''}${h.circonstances ? `<br><small>${esc(h.circonstances)}</small>` : ''}` +
            `${h.responsabilite ? `<br><small>Responsabilité : ${esc(h.responsabilite)}</small>` : ''}</span>` +
            (canWrite()
              ? `<span data-write><button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-hedit="${i}">✎</button> ` +
                `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-hdel="${i}">✕</button></span>`
              : '') +
            '</div>'
        )
        .join('')
    : subEmpty('Aucun incident enregistré');

  e.innerHTML =
    `<div class="row1"><h4>${esc(u.nom)} ${esc(u.prenoms)}</h4>` +
    `<span class="badge" style="background:${u.statut === 'Actif' ? COLORS.green : COLORS.red}">${esc(u.statut)}</span></div>` +
    `<div class="meta">${esc(u.fonction || '—')}${u.section ? ` · ${esc(u.section)}` : ''}${u.telephone ? ` · ${esc(u.telephone)}` : ''}</div>` +
    (u.permis || u.observations
      ? `<div class="fields">${u.permis ? `<b>Permis :</b> ${esc(u.permis)}<br>` : ''}${u.observations ? `<b>Observations :</b> ${esc(u.observations)}` : ''}</div>`
      : '') +
    `<div class="subBlock"><h5>Historique incidents / observations (${hist.length})</h5>${histHtml}` +
    (canWrite() ? '<button class="smallBtn" data-addhist>+ Ajouter un incident</button>' : '') +
    '</div>' +
    '<div class="actions">' +
    (canWrite() ? `<button class="miniBtn" style="background:${COLORS.green}" data-edit data-write>✎ Modifier</button>` : '') +
    (canWrite() ? `<button class="miniBtn" style="background:${COLORS.red}" data-del data-write>Supprimer</button>` : '') +
    '</div>';

  const addHist = e.querySelector('[data-addhist]');
  if (addHist) addHist.onclick = () => openIncidentForm(u, null);

  e.querySelectorAll('[data-hedit]').forEach((btn) => {
    btn.onclick = () => openIncidentForm(u, hist[Number(btn.dataset.hedit)]);
  });
  e.querySelectorAll('[data-hdel]').forEach((btn) => {
    btn.onclick = async () => {
      const h = hist[Number(btn.dataset.hdel)];
      const ok = await confirmDialog({
        title: 'Supprimer l’incident',
        message: `Supprimer « ${h.nature || 'incident'} » du ${dateFR(h.date)} ?`,
        okLabel: 'Supprimer',
        danger: true
      });
      if (!ok) return;
      u.historique = u.historique.filter((x) => x !== h);
      touch('users', u);
      toast('Incident supprimé.', 'ok');
      rerender();
    };
  });

  const editBtn = e.querySelector('[data-edit]');
  if (editBtn) editBtn.onclick = () => openUserForm(u);
  const delBtn = e.querySelector('[data-del]');
  if (delBtn) {
    delBtn.onclick = async () => {
      const ok = await confirmDialog({
        title: 'Supprimer l’utilisateur',
        message: `Supprimer définitivement ${u.nom} ${u.prenoms} et son historique d’incidents ?`,
        okLabel: 'Supprimer',
        danger: true
      });
      if (!ok) return;
      remove('users', u.id);
      toast('Utilisateur supprimé.', 'ok');
      rerender();
    };
  }
  return e;
}

export function openUserForm(u) {
  const isEdit = !!u;
  openForm({
    title: isEdit ? `Modifier — ${u.nom} ${u.prenoms}` : 'Nouvel utilisateur',
    fields: userFields(u || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer cet utilisateur',
    onSubmit: (values) => {
      if (isEdit) {
        update('users', u.id, values);
        toast('Utilisateur mis à jour.', 'ok');
      } else {
        insert('users', Object.assign({ historique: [] }, values));
        toast('Utilisateur enregistré.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

function openIncidentForm(u, incident) {
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
