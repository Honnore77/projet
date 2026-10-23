/* ===================================================================
   ENTRETIEN → GARAGES : les garages ou passent les vehicules.

   Tableau : nom, contacts, point focal et son contact, localisation, et
   les vehicules sur lesquels le garage est intervenu (fiche d'entretien
   ou intervention a son nom), chacun ouvrant la fiche du vehicule.
   =================================================================== */

import {
  DB, insert, update, remove, lienCarte, garageParNom, renommerGarage, passagesDuGarage, vehiculesDuGarage,
  nomsGarages, assurerGarage
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, norm } from '../../core/utils.js';
import { card, toolbar, emptyState, openForm, confirmDialog, toast, statTile, dataTable, COLORS } from '../components.js';
import { rerender, openVehicleSheet } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsGarages } from '../../export/datasets.js';

export const COULEUR_GARAGES = '#5D4037';

/** Ouvre la localisation dans Google Maps, dans le navigateur du systeme. */
function ouvrirCarte(localisation) {
  const url = lienCarte(localisation);
  if (!url) return toast('Aucune localisation renseignée.', 'info');
  window.open(url, '_blank', 'noopener');
}

/** Bouton d'action d'une ligne de tableau. */
function miniBtn(couleur, attr, libelle, titre = '') {
  return `<button class="miniBtn" style="background:${couleur};padding:5px 8px" ${attr}` +
    `${titre ? ` title="${esc(titre)}"` : ''}>${libelle}</button>`;
}

export function renderGarages(page) {
  page.appendChild(card(
    'GARAGES',
    'Les garages où passent les véhicules : contacts, point focal, localisation à ouvrir dans Google Maps, et les véhicules sur lesquels chacun est intervenu. ' +
      'Un garage saisi dans une fiche d’entretien ou une intervention s’ajoute ici de lui-même.',
    COULEUR_GARAGES
  ));

  // Les garages deja cites dans l'entretien, avant que la liste existe, la
  // rejoignent : leurs interventions s'y lisent aussitot.
  if (canWrite()) nomsGarages().forEach((n) => assurerGarage(n));

  const list = (DB.garages || []).slice().sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Garages', fmt(list.length), 'enregistrés', COULEUR_GARAGES));
  grid.appendChild(statTile('Avec interventions', fmt(list.filter((g) => passagesDuGarage(g.nom).length).length), 'sur au moins un véhicule', COLORS.green));
  grid.appendChild(statTile('Localisés', fmt(list.filter((g) => lienCarte(g.localisation)).length), 'avec une localisation', COLORS.blue));
  page.appendChild(grid);

  page.appendChild(toolbar([
    canWrite() && { label: '+ Nouveau garage', cls: 'addBtn', color: COULEUR_GARAGES, write: true, onClick: () => ouvrirGarage(null) },
    { label: '⬇ Excel', color: COLORS.blue, onClick: () => exporter('excel', list) },
    { label: '⬇ PDF', color: COLORS.red, onClick: () => exporter('pdf', list) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => exporter('word', list) }
  ]));

  if (!list.length) {
    page.appendChild(emptyState('Aucun garage enregistré.'));
    return;
  }

  const headers = ['Nom', 'Contacts', 'Point focal<br>et son contact', 'Localisation', 'Interventions<br><small>(véhicules)</small>', ''];
  const rows = list.map((g) => {
    const vehicules = vehiculesDuGarage(g.nom);
    return [
      `<b>${esc(g.nom || '')}</b>`,
      escLignes(g.contacts || '') || '<span style="color:#8a9ba0">—</span>',
      [g.pointFocal ? `<b>${esc(g.pointFocal)}</b>` : '', g.contactPointFocal ? esc(g.contactPointFocal) : '']
        .filter(Boolean).join('<br>') || '<span style="color:#8a9ba0">—</span>',
      g.localisation
        ? `${esc(g.localisation)}<br>${miniBtn(COULEUR_GARAGES, 'data-carte', '📍 Google Maps', 'Ouvrir dans Google Maps')}`
        : '<span style="color:#8a9ba0">—</span>',
      vehicules.length
        ? vehicules.map((im) => `<a href="#" data-veh="${esc(im)}" title="Ouvrir la fiche du véhicule" style="color:${COLORS.blue};white-space:nowrap">${esc(im)}</a>`).join('<br>')
        : '<span style="color:#8a9ba0">aucune</span>',
      canWrite() ? `${miniBtn('#008A3B', 'data-edit data-write', '✎')} ${miniBtn('#D32F2F', 'data-del data-write', '✕')}` : ''
    ];
  });

  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const g = list[i];
    tr.dataset.search = norm(`${g.nom} ${g.contacts} ${g.pointFocal} ${g.contactPointFocal} ${g.localisation} ${vehiculesDuGarage(g.nom).join(' ')}`);
    const carte = tr.querySelector('[data-carte]');
    if (carte) carte.onclick = () => ouvrirCarte(g.localisation);
    tr.querySelectorAll('[data-veh]').forEach((a) => {
      a.onclick = (ev) => { ev.preventDefault(); openVehicleSheet(a.dataset.veh); };
    });
    const ed = tr.querySelector('[data-edit]');
    if (ed) ed.onclick = () => ouvrirGarage(g);
    const del = tr.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        const n = passagesDuGarage(g.nom).length;
        if (!(await confirmDialog({
          title: 'Supprimer le garage',
          message: n
            ? `« ${g.nom} » figure sur ${n} passage(s) au garage. Ils garderont ce nom, mais le garage ne sera plus dans la liste. Supprimer ?`
            : `Supprimer « ${g.nom} » ?`,
          okLabel: 'Supprimer', danger: true
        }))) return;
        remove('garages', g.id);
        toast('Garage supprimé.', 'ok');
        rerender();
      };
    }
  }));
}

function champsGarage(g = {}) {
  return [
    { key: 'nom', label: 'Nom du garage', required: true, full: true, value: g.nom },
    { key: 'contacts', label: 'Contacts', type: 'textarea', full: true, lignesTiret: true, rows: 3, value: g.contacts,
      placeholder: 'Téléphone, email…', hint: 'Un contact par ligne' },
    { key: 'pointFocal', label: 'Point focal', value: g.pointFocal, placeholder: 'Nom de la personne à joindre' },
    { key: 'contactPointFocal', label: 'Contact du point focal', value: g.contactPointFocal, placeholder: 'Téléphone, email…' },
    { key: 'localisation', label: 'Localisation', full: true, value: g.localisation,
      placeholder: 'Adresse, quartier, ou lien copié depuis Google Maps',
      hint: 'Collez le lien « Partager » de Google Maps, ou tapez une adresse puis vérifiez-la sur la carte' }
  ];
}

function ouvrirGarage(g) {
  const isEdit = !!g;
  openForm({
    title: isEdit ? `Modifier le garage — ${g.nom}` : 'Nouveau garage',
    fields: champsGarage(g || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer le garage',
    // Sous la localisation : chercher le lieu sur la carte avant d'enregistrer.
    extra: (scope) => {
      const champ = scope.querySelector('[data-key="localisation"]');
      if (!champ) return;
      const barre = el(
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
          `<button type="button" class="miniBtn" style="background:${COULEUR_GARAGES}">📍 Rechercher sur Google Maps</button>` +
        '</div>'
      );
      barre.querySelector('button').onclick = () => {
        const nom = (scope.querySelector('[data-key="nom"]') || {}).value || '';
        ouvrirCarte(champ.value.trim() || nom.trim());
      };
      champ.closest('.fRow').appendChild(barre);
    },
    onSubmit: (v) => {
      const nom = String(v.nom || '').trim();
      const autre = garageParNom(nom);
      if (autre && (!isEdit || autre.id !== g.id)) return `« ${autre.nom} » existe déjà dans la liste des garages.`;
      const payload = {
        nom, contacts: v.contacts, pointFocal: v.pointFocal, contactPointFocal: v.contactPointFocal, localisation: v.localisation
      };
      if (isEdit) {
        const reportes = renommerGarage(g.nom, nom);
        update('garages', g.id, payload);
        toast(`Garage mis à jour.${reportes ? ` ${reportes} fiche(s) d’entretien suivent le nouveau nom.` : ''}`, 'ok');
      } else {
        insert('garages', Object.assign({ createdAt: new Date().toISOString() }, payload));
        toast('Garage enregistré.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

async function exporter(kind, list) {
  try {
    const datasets = [dsGarages(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_garages')
      : kind === 'word'
        ? await exportWord(datasets, 'PDU_garages', { title: 'Garages' })
        : await exportPdf(datasets, 'PDU_garages', { title: 'Garages' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
