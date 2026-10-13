/* ===================================================================
   DÉCHARGE — deux sous-rubriques :

     DECHARGES      courriers deposes contre decharge, en tableau
     DESTINATAIRES  structures qui les recoivent : contacts, localisation

   Une structure tapee dans une decharge rejoint d'elle-meme la liste des
   destinataires : on ne la saisit qu'une fois.
   =================================================================== */

import {
  DB, insert, update, remove, knownImmats, knownDrivers, nomsUtilisateurs,
  prochaineRefDecharge, refDechargeEnDouble, nomsDestinataires, destinataireParNom,
  assurerDestinataire, renommerDestinataire, dechargesDuDestinataire, lienCarte
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast,
  statTile, dataTable
} from '../components.js';
import { state, rerender, moduleColor } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsDecharges, dsDestinataires } from '../../export/datasets.js';

const SUBS = [
  { key: 'decharges', label: 'LES DÉCHARGES' },
  { key: 'destinataires', label: 'LES DESTINATAIRES' }
];

/** Couleur de la rubrique, et une teinte plus sombre pour la seconde page. */
const COULEUR = () => moduleColor('DECHARGE');
const COULEUR_DEST = '#4E342E';

export function renderDecharges(page) {
  const sub = state.sub.DECHARGE || 'decharges';
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.DECHARGE = k; rerender(); },
      { decharges: COULEUR(), destinataires: COULEUR_DEST })
  );
  if (sub === 'destinataires') renderDestinataires(page);
  else renderListeDecharges(page);
}

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

/* =========================== LES DÉCHARGES ========================= */

function renderListeDecharges(page) {
  const f = state.filters.decharges;

  page.appendChild(
    card(
      'LES DÉCHARGES',
      'Réf. · N° courrier · Objet · Destinataire · Date · Décharge récupérée par · Conducteur · Véhicule.',
      COULEUR()
    )
  );

  page.appendChild(
    filterBar([
      { type: 'date', title: 'Du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
      { type: 'date', title: 'Au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
      {
        type: 'select', value: f.destinataire,
        options: [{ value: '', label: 'Tous les destinataires' }].concat(nomsDestinataires()),
        onChange: (v) => { f.destinataire = v; rerender(); }
      }
    ])
  );

  let list = DB.decharges.slice();
  if (f.dateFrom) list = list.filter((d) => !d.date || d.date >= f.dateFrom);
  if (f.dateTo) list = list.filter((d) => !d.date || d.date <= f.dateTo);
  if (f.destinataire) list = list.filter((d) => norm(d.destinataire || '') === norm(f.destinataire));
  // Les plus recentes en tete ; a date egale, la reference la plus haute.
  list.sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.ref || '').localeCompare(String(a.ref || ''), 'fr', { numeric: true }));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Décharges', fmt(list.length), 'sur la période filtrée', COULEUR()));
  grid.appendChild(statTile('Destinataires', fmt(new Set(list.map((d) => norm(d.destinataire || '')).filter(Boolean)).size),
    'structures concernées', COULEUR_DEST));
  grid.appendChild(statTile('Sans décharge signée', fmt(list.filter((d) => !(d.images || []).length).length),
    'photo à joindre', '#F47B20'));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouvelle décharge', cls: 'addBtn', color: COULEUR(), write: true, onClick: () => openDechargeForm(null) },
      { label: '⬇ Excel', color: '#1976D2', onClick: () => doExport('excel', 'decharges', list) },
      { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', 'decharges', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.decharges.length ? 'Aucune décharge ne correspond aux filtres.' : 'Aucune décharge enregistrée.'));
    return;
  }

  const headers = [
    'Réf.', 'N° courrier', 'Objet', 'Destinataire', 'Date',
    'Décharge<br>récupérée par', 'Conducteur', 'Véhicule', 'Décharge<br>signée', ''
  ];

  const rows = list.map((d) => [
    `<b style="white-space:nowrap">${esc(d.ref || '')}</b>`,
    esc(d.numeroCourrier || ''),
    escLignes(d.objet || ''),
    esc(d.destinataire || ''),
    esc(dateFR(d.date)),
    esc(d.recuperePar || ''),
    esc(d.conducteur || ''),
    esc(d.immat || ''),
    // La decharge signee est la preuve de remise : son absence se voit.
    (d.images || []).length
      ? miniBtn(COULEUR(), 'data-photo', `📎 ${(d.images || []).length}`, 'Voir la décharge signée')
      : '<span class="badge" style="background:#F47B20">à joindre</span>',
    canWrite()
      ? `${miniBtn('#008A3B', 'data-edit data-write', '✎')} ${miniBtn('#D32F2F', 'data-del data-write', '✕')}`
      : ''
  ]);

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const d = list[i];
      tr.dataset.search = norm(
        `${d.ref} ${d.numeroCourrier} ${d.objet} ${d.destinataire} ${d.date} ${d.recuperePar} ${d.conducteur} ${d.immat}`
      );

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openDechargeForm(d);

      // Les images s'ouvrent dans le formulaire, ou chaque vignette s'agrandit.
      const photo = tr.querySelector('[data-photo]');
      if (photo) photo.onclick = () => openDechargeForm(d);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({
            title: 'Supprimer la décharge',
            message: `Supprimer la décharge ${d.ref || ''} adressée à ${d.destinataire || '—'} ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('decharges', d.id);
          toast('Décharge supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

function dechargeFields(d = {}) {
  return [
    { key: 'ref', label: 'Réf.', required: true, value: d.ref || prochaineRefDecharge(),
      hint: 'Proposée à la suite de la dernière ; modifiable' },
    { key: 'numeroCourrier', label: 'N° courrier(s)', value: d.numeroCourrier },
    { key: 'date', label: 'Date', type: 'date', required: true, value: d.date || todayISO() },
    // On choisit la structure dans la liste, ou on en tape une nouvelle :
    // elle rejoint alors « Les destinataires » a l'enregistrement.
    { key: 'destinataire', label: 'Destinataire', type: 'selectAdd', required: true, value: d.destinataire,
      options: nomsDestinataires(), emptyLabel: '— choisir —', addLabel: 'Nouveau destinataire',
      hint: 'Un nouveau destinataire est ajouté à la liste des destinataires' },
    { key: 'objet', label: 'Objet(s)', type: 'textarea', required: true, full: true, lignesTiret: true, rows: 3, value: d.objet,
      hint: 'Un objet par ligne' },
    { key: 'recuperePar', label: 'Décharge récupérée par', value: d.recuperePar, list: nomsUtilisateurs() },
    { key: 'conducteur', label: 'Nom du conducteur', value: d.conducteur, list: knownDrivers() },
    { key: 'immat', label: 'Immatriculation du véhicule', value: d.immat, list: knownImmats() },
    { key: 'images', label: 'Photo de la décharge signée', type: 'images', full: true, value: d.images,
      hint: 'Photo ou scan de la décharge signée par le destinataire (JPEG ou PNG)' }
  ];
}

function openDechargeForm(d) {
  const isEdit = !!d;
  openForm({
    title: isEdit ? `Modifier la décharge — ${d.ref || ''}` : 'Nouvelle décharge',
    fields: dechargeFields(d || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la décharge',
    onSubmit: (values) => {
      const ref = String(values.ref || '').trim().toUpperCase();
      if (refDechargeEnDouble(ref, d && d.id)) {
        return `La référence ${ref} est déjà attribuée à une autre décharge.`;
      }

      // Une structure deja connue garde l'ecriture de sa fiche : « mairie de
      // cocody » tape en minuscules ne doit pas creer un second destinataire.
      const connu = destinataireParNom(values.destinataire);
      const destinataire = connu ? connu.nom : values.destinataire;
      const cree = connu ? null : assurerDestinataire(destinataire);

      const payload = {
        ref,
        numeroCourrier: values.numeroCourrier,
        objet: values.objet,
        destinataire,
        date: values.date,
        recuperePar: values.recuperePar,
        conducteur: values.conducteur,
        immat: String(values.immat || '').trim().toUpperCase(),
        images: values.images
      };
      if (isEdit) update('decharges', d.id, payload);
      else insert('decharges', Object.assign({ createdAt: new Date().toISOString() }, payload));

      toast(
        (isEdit ? 'Décharge mise à jour.' : 'Décharge enregistrée.') +
          (cree ? ` « ${cree.nom} » ajouté aux destinataires.` : ''),
        'ok'
      );
      rerender();
      return null;
    }
  });
}

/* ========================= LES DESTINATAIRES ======================= */

function renderDestinataires(page) {
  page.appendChild(
    card(
      'LES DESTINATAIRES',
      'Structures auxquelles les courriers sont remis : nom, contacts et localisation, à ouvrir dans Google Maps.',
      COULEUR_DEST
    )
  );

  const list = DB.destinataires.slice().sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Destinataires', fmt(list.length), 'structures enregistrées', COULEUR_DEST));
  grid.appendChild(statTile('Localisés', fmt(list.filter((d) => lienCarte(d.localisation)).length),
    'avec une localisation', COULEUR()));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouveau destinataire', cls: 'addBtn', color: COULEUR_DEST, write: true, onClick: () => openDestinataireForm(null) },
      { label: '⬇ Excel', color: '#1976D2', onClick: () => doExport('excel', 'destinataires', list) },
      { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', 'destinataires', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState('Aucun destinataire enregistré.'));
    return;
  }

  const headers = ['Nom de la structure', 'Contacts', 'Localisation', 'Décharges', ''];

  const rows = list.map((d) => {
    const n = dechargesDuDestinataire(d.nom).length;
    return [
      `<b>${esc(d.nom || '')}</b>`,
      escLignes(d.contacts || ''),
      d.localisation
        ? `${esc(d.localisation)}<br>${miniBtn(COULEUR(), 'data-carte', '📍 Google Maps', 'Ouvrir dans Google Maps')}`
        : '<span style="color:#8a9ba0">—</span>',
      `<span style="display:block;text-align:right">${n ? `<button class="miniBtn" style="background:${COULEUR()};padding:5px 8px" data-voir title="Voir ses décharges">${fmt(n)}</button>` : '0'}</span>`,
      canWrite()
        ? `${miniBtn('#008A3B', 'data-edit data-write', '✎')} ${miniBtn('#D32F2F', 'data-del data-write', '✕')}`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const d = list[i];
      tr.dataset.search = norm(`${d.nom} ${d.contacts} ${d.localisation}`);

      const carte = tr.querySelector('[data-carte]');
      if (carte) carte.onclick = () => ouvrirCarte(d.localisation);

      const voir = tr.querySelector('[data-voir]');
      if (voir) {
        voir.onclick = () => {
          state.filters.decharges.destinataire = d.nom;
          state.sub.DECHARGE = 'decharges';
          rerender();
        };
      }

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openDestinataireForm(d);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          const n = dechargesDuDestinataire(d.nom).length;
          if (!(await confirmDialog({
            title: 'Supprimer le destinataire',
            message: n
              ? `« ${d.nom} » figure sur ${n} décharge(s). Elles garderont ce nom, mais la structure ne sera plus proposée. Supprimer ?`
              : `Supprimer « ${d.nom} » ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('destinataires', d.id);
          toast('Destinataire supprimé.', 'ok');
          rerender();
        };
      }
    })
  );
}

function destinataireFields(d = {}) {
  return [
    { key: 'nom', label: 'Nom de la structure', required: true, full: true, value: d.nom },
    { key: 'contacts', label: 'Contacts', type: 'textarea', full: true, lignesTiret: true, rows: 3, value: d.contacts,
      placeholder: 'Téléphone, email, personne à contacter…', hint: 'Un contact par ligne' },
    { key: 'localisation', label: 'Localisation', full: true, value: d.localisation,
      placeholder: 'Adresse, quartier, ou lien copié depuis Google Maps',
      hint: 'Collez le lien « Partager » de Google Maps, ou tapez une adresse puis vérifiez-la sur la carte' }
  ];
}

function openDestinataireForm(d) {
  const isEdit = !!d;
  openForm({
    title: isEdit ? `Modifier le destinataire — ${d.nom}` : 'Nouveau destinataire',
    fields: destinataireFields(d || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer le destinataire',
    // Sous le champ Localisation : de quoi chercher le lieu sur la carte
    // avant de l'enregistrer, et verifier qu'un lien colle mene au bon endroit.
    extra: (scope) => {
      const champ = scope.querySelector('[data-key="localisation"]');
      if (!champ) return;
      const barre = el(
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
          `<button type="button" class="miniBtn" style="background:${COULEUR()}">📍 Rechercher sur Google Maps</button>` +
        '</div>'
      );
      barre.querySelector('button').onclick = () => {
        const v = champ.value.trim();
        const nom = (scope.querySelector('[data-key="nom"]') || {}).value || '';
        // Rien de tape : on cherche la structure par son nom, c'est souvent
        // ainsi qu'elle est connue de Google Maps.
        ouvrirCarte(v || nom.trim());
      };
      champ.closest('.fRow').appendChild(barre);
    },
    onSubmit: (values) => {
      const nom = String(values.nom || '').trim();
      const autre = destinataireParNom(nom);
      if (autre && (!isEdit || autre.id !== d.id)) {
        return `« ${autre.nom} » existe déjà dans la liste des destinataires.`;
      }
      const payload = { nom, contacts: values.contacts, localisation: values.localisation };

      if (isEdit) {
        const reportees = renommerDestinataire(d.nom, nom);
        update('destinataires', d.id, payload);
        toast(`Destinataire mis à jour.${reportees ? ` ${reportees} décharge(s) suivent le nouveau nom.` : ''}`, 'ok');
      } else {
        insert('destinataires', Object.assign({ createdAt: new Date().toISOString() }, payload));
        toast('Destinataire enregistré.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

/* ============================== Exports ============================ */

async function doExport(kind, sub, list) {
  try {
    const datasets = sub === 'decharges' ? [dsDecharges(list)] : [dsDestinataires(list)];
    const name = sub === 'decharges' ? 'PDU_decharges' : 'PDU_destinataires';
    const titre = sub === 'decharges' ? 'Décharges' : 'Destinataires des décharges';
    const res = kind === 'excel'
      ? await exportExcel(datasets, name)
      : await exportPdf(datasets, name, { title: titre });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
