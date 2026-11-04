/* ===================================================================
   SORTIES (cle DECHARGE) — trois sous-rubriques :

     COURSES            courriers deposes contre decharge, en tableau
     DESTINATAIRES      structures qui les recoivent : contacts, localisation
     SORTIES D'ABIDJAN  deplacements hors d'Abidjan qui ne sont pas des
                        missions : ni tour de role, ni jours, ni rang du
                        conducteur (collection `sortiesAbidjan`)

   Une structure tapee dans une decharge rejoint d'elle-meme la liste des
   destinataires : on ne la saisit qu'une fois.
   =================================================================== */

import {
  DB, insert, update, remove, knownImmats, knownDrivers, nomsUtilisateurs,
  prochaineRefDecharge, refDechargeEnDouble, nomsDestinataires, destinataireParNom,
  assurerDestinataire, renommerDestinataire, dechargesDuDestinataire, lienCarte,
  prochaineRefSortieAbidjan, refSortieAbidjanEnDouble, nomsDestinationsMission, destinationMissionParNom,
  assurerDestinationMission, parcoursMission, libelleParcours, totauxRapportMission, ravMontant
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, norm, dateFR, todayISO, sum, francSup } from '../../core/utils.js';
import {
  card, toolbar, filterBar, subtabs, emptyState, openForm, confirmDialog, toast,
  statTile, dataTable, COLORS
} from '../components.js';
import { state, rerender, moduleColor } from '../shell.js';
import { renderStatistiques, SOUS_RUBRIQUE_STATS } from './statistiques.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { dsDecharges, dsDestinataires, dsSortiesAbidjan } from '../../export/datasets.js';
import { filtrer } from '../../core/acces.js';
import { monterRavitaillements } from './missions.js';

const SUBS = [
  { key: 'decharges', label: 'COURSES' },
  { key: 'destinataires', label: 'LES DESTINATAIRES' },
  { key: 'abidjan', label: 'SORTIES D’ABIDJAN' },
  SOUS_RUBRIQUE_STATS
];

/** Couleur de la rubrique, et des teintes plus sombres pour les autres pages. */
const COULEUR = () => moduleColor('DECHARGE');
const COULEUR_DEST = '#4E342E';
const COULEUR_ABIDJAN = '#6D4C41';

export function renderDecharges(page) {
  const sub = state.sub.DECHARGE || 'decharges';
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.DECHARGE = k; rerender(); },
      { decharges: COULEUR(), destinataires: COULEUR_DEST, abidjan: COULEUR_ABIDJAN, stats: COLORS.grey })
  );
  if (sub === 'stats') renderStatistiques(page, 'DECHARGE');
  else if (sub === 'destinataires') renderDestinataires(page);
  else if (sub === 'abidjan') renderSortiesAbidjan(page);
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

/* ============================== COURSES ============================ */

function renderListeDecharges(page) {
  const f = state.filters.decharges;

  page.appendChild(
    card(
      'COURSES',
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

  // Un conducteur n'y voit que les decharges qu'il a deposees.
  let list = filtrer('DECHARGE', DB.decharges.slice());
  if (f.dateFrom) list = list.filter((d) => !d.date || d.date >= f.dateFrom);
  if (f.dateTo) list = list.filter((d) => !d.date || d.date <= f.dateTo);
  if (f.destinataire) list = list.filter((d) => norm(d.destinataire || '') === norm(f.destinataire));
  // Les plus recentes en tete ; a date egale, la reference la plus haute.
  list.sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.ref || '').localeCompare(String(a.ref || ''), 'fr', { numeric: true }));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Courses', fmt(list.length), 'sur la période filtrée', COULEUR()));
  grid.appendChild(statTile('Destinataires', fmt(new Set(list.map((d) => norm(d.destinataire || '')).filter(Boolean)).size),
    'structures concernées', COULEUR_DEST));
  grid.appendChild(statTile('Sans décharge signée', fmt(list.filter((d) => !(d.images || []).length).length),
    'photo à joindre', '#F47B20'));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouvelle course', cls: 'addBtn', color: COULEUR(), write: true, onClick: () => openDechargeForm(null) },
      { label: '⬇ Excel', color: '#1976D2', onClick: () => doExport('excel', 'decharges', list) },
      { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', 'decharges', list) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', 'decharges', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState(DB.decharges.length ? 'Aucune course ne correspond aux filtres.' : 'Aucune course enregistrée.'));
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
            title: 'Supprimer la course',
            message: `Supprimer la course ${d.ref || ''} adressée à ${d.destinataire || '—'} ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('decharges', d.id);
          toast('Course supprimée.', 'ok');
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
    // Les agents, plus les noms deja saisis sur une decharge : un nom ajoute
    // par « + Ajouter un nom » est repropose la fois suivante.
    { key: 'recuperePar', label: 'Décharge récupérée par', type: 'selectAdd', value: d.recuperePar,
      options: nomsRecuperePar(), emptyLabel: '— choisir —', addLabel: 'Ajouter un nom' },
    { key: 'conducteur', label: 'Nom du conducteur', value: d.conducteur, list: knownDrivers() },
    { key: 'immat', label: 'Immatriculation du véhicule', value: d.immat, list: knownImmats() },
    { key: 'images', label: 'Photo de la décharge signée', type: 'images', full: true, value: d.images,
      hint: 'Photo ou scan de la décharge signée par le destinataire (JPEG ou PNG)' }
  ];
}

/** Noms proposes pour « Décharge récupérée par », sans doublon, dans l'ordre alphabetique. */
function nomsRecuperePar() {
  const vus = new Map();
  nomsUtilisateurs().concat(DB.decharges.map((x) => x.recuperePar)).forEach((n) => {
    const nom = String(n || '').trim();
    if (nom && !vus.has(nom.toUpperCase())) vus.set(nom.toUpperCase(), nom);
  });
  return [...vus.values()].sort((x, y) => x.localeCompare(y, 'fr'));
}

export function openDechargeForm(d) {
  const isEdit = !!d;
  openForm({
    title: isEdit ? `Modifier la course — ${d.ref || ''}` : 'Nouvelle course',
    fields: dechargeFields(d || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la course',
    onSubmit: (values) => {
      const ref = String(values.ref || '').trim().toUpperCase();
      if (refDechargeEnDouble(ref, d && d.id)) {
        return `La référence ${ref} est déjà attribuée à une autre course.`;
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
        (isEdit ? 'Course mise à jour.' : 'Course enregistrée.') +
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
      { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', 'destinataires', list) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', 'destinataires', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState('Aucun destinataire enregistré.'));
    return;
  }

  const headers = ['Nom de la structure', 'Contacts', 'Localisation', 'Courses', ''];

  const rows = list.map((d) => {
    const n = dechargesDuDestinataire(d.nom).length;
    return [
      `<b>${esc(d.nom || '')}</b>`,
      escLignes(d.contacts || ''),
      d.localisation
        ? `${esc(d.localisation)}<br>${miniBtn(COULEUR(), 'data-carte', '📍 Google Maps', 'Ouvrir dans Google Maps')}`
        : '<span style="color:#8a9ba0">—</span>',
      `<span style="display:block;text-align:right">${n ? `<button class="miniBtn" style="background:${COULEUR()};padding:5px 8px" data-voir data-export="${n}" title="Voir ses courses">${fmt(n)}</button>` : '0'}</span>`,
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
              ? `« ${d.nom} » figure sur ${n} course(s). Elles garderont ce nom, mais la structure ne sera plus proposée. Supprimer ?`
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
        toast(`Destinataire mis à jour.${reportees ? ` ${reportees} course(s) suivent le nouveau nom.` : ''}`, 'ok');
      } else {
        insert('destinataires', Object.assign({ createdAt: new Date().toISOString() }, payload));
        toast('Destinataire enregistré.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

/* ========================= SORTIES D'ABIDJAN ======================= */

function renderSortiesAbidjan(page) {
  const f = state.filters.sortiesAbidjan;

  page.appendChild(
    card(
      'SORTIES D’ABIDJAN',
      'Déplacements hors d’Abidjan qui ne sont pas des missions : ils ne comptent ni dans le tour de rôle, ' +
        'ni dans les jours, ni dans le nombre de missions des conducteurs.',
      COULEUR_ABIDJAN
    )
  );

  // Un conducteur n'y voit que ses propres sorties.
  const tous = filtrer('DECHARGE', (DB.sortiesAbidjan || []).slice());
  const conducteurs = [...new Set(tous.map((x) => x.conducteur).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  page.appendChild(
    filterBar([
      { type: 'date', title: 'Du', value: f.dateFrom, onChange: (v) => { f.dateFrom = v; rerender(); } },
      { type: 'date', title: 'Au', value: f.dateTo, onChange: (v) => { f.dateTo = v; rerender(); } },
      {
        type: 'select', value: f.conducteur,
        options: [{ value: '', label: 'Tous les conducteurs' }].concat(conducteurs),
        onChange: (v) => { f.conducteur = v; rerender(); }
      }
    ])
  );

  let list = tous;
  if (f.dateFrom) list = list.filter((x) => !x.date || x.date >= f.dateFrom);
  if (f.dateTo) list = list.filter((x) => !x.date || x.date <= f.dateTo);
  if (f.conducteur) list = list.filter((x) => norm(x.conducteur || '') === norm(f.conducteur));
  list.sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.ref || '').localeCompare(String(a.ref || ''), 'fr', { numeric: true }));

  const rav = list.flatMap((x) => x.ravitaillements || []);
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Sorties', fmt(list.length), 'sur la période filtrée', COULEUR_ABIDJAN));
  grid.appendChild(statTile('Carburant', `${fmt(sum(rav, (r) => r.quantite))} L`, `${fmt(sum(rav, ravMontant))} F`, '#F47B20'));
  grid.appendChild(statTile('Dépenses', `${fmt(sum(list, (x) => totauxRapportMission(x).total))} F`,
    'carburant, frais OM, péage, divers', COULEUR()));
  page.appendChild(grid);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouvelle sortie d’Abidjan', cls: 'addBtn', color: COULEUR_ABIDJAN, write: true, onClick: () => openSortieAbidjanForm(null) },
      { label: '⬇ Excel', color: '#1976D2', onClick: () => doExport('excel', 'abidjan', list) },
      { label: '⬇ PDF', color: '#D32F2F', onClick: () => doExport('pdf', 'abidjan', list) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => doExport('word', 'abidjan', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState((DB.sortiesAbidjan || []).length
      ? 'Aucune sortie d’Abidjan ne correspond aux filtres.' : 'Aucune sortie d’Abidjan enregistrée.'));
    return;
  }

  const headers = [
    'Réf.', 'Date', 'Conducteur', 'Véhicule', 'Destination', 'Km<br>départ', 'Km<br>arrivée',
    'Parcours<br>(A-R)', 'Participants', 'Dotation', 'Carburant', 'Péage', 'Total', ''
  ];
  const droite = (v) => `<span style="display:block;text-align:right;white-space:nowrap">${v}</span>`;
  const vide = (v) => v === '' || v === undefined || v === null;
  const francs = (v) => (vide(v) ? '' : `${fmt(v)} F`);

  const rows = list.map((x) => {
    const t = totauxRapportMission(x);
    return [
      `<b style="white-space:nowrap">${esc(x.ref || '')}</b>`,
      esc(dateFR(x.date)),
      esc(x.conducteur || ''),
      esc(x.vehicule || ''),
      esc(x.destination || ''),
      droite(vide(x.kmDepart) ? '' : esc(fmt(x.kmDepart))),
      droite(vide(x.kmArrivee) ? '' : esc(fmt(x.kmArrivee))),
      droite(esc(libelleParcours(parcoursMission(x)) || '—')),
      escLignes((x.participants || []).filter(Boolean).join('\n')),
      droite(esc(francs(x.dotationCarburant))),
      droite(esc(francs(t.carburant))),
      droite(esc(francs(t.fraisPeage))),
      droite(`<b>${esc(francs(t.total))}</b>`),
      canWrite()
        ? `${miniBtn('#008A3B', 'data-edit data-write', '✎')} ${miniBtn('#D32F2F', 'data-del data-write', '✕')}`
        : ''
    ];
  });

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const x = list[i];
      tr.dataset.search = norm(
        `${x.ref} ${x.date} ${x.conducteur} ${x.vehicule} ${x.destination} ${(x.participants || []).join(' ')}`
      );

      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openSortieAbidjanForm(x);

      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({
            title: 'Supprimer la sortie d’Abidjan',
            message: `Supprimer la sortie ${x.ref || ''} de ${x.conducteur || '—'} vers ${x.destination || '—'} ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('sortiesAbidjan', x.id);
          toast('Sortie d’Abidjan supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

/** « 640 km » aller-retour, ou ce qui manque pour le calculer. */
function texteParcoursSortie(destination) {
  if (!String(destination || '').trim()) return 'choisir une destination';
  return libelleParcours(parcoursMission({ destinations: [destination] })) ||
    'distance inconnue — à renseigner dans MISSION → DESTINATIONS';
}

function sortieAbidjanFields(x = {}) {
  const p = x.participants || [];
  return [
    { key: 'ref', label: 'Référence', required: true, value: x.ref || prochaineRefSortieAbidjan(),
      hint: 'Proposée à la suite de la dernière ; modifiable' },
    { key: 'date', label: 'Date de la sortie', type: 'date', required: true, value: x.date || todayISO() },
    { key: 'conducteur', label: 'Conducteur', required: true, value: x.conducteur, list: knownDrivers() },
    { key: 'vehicule', label: 'Véhicule', value: x.vehicule, list: knownImmats() },
    // Les memes destinations que les missions : la distance depuis Abidjan
    // ne se renseigne qu'une fois, dans MISSION → DESTINATIONS.
    { key: 'destination', label: 'Destination', type: 'selectAdd', required: true, value: x.destination,
      options: nomsDestinationsMission(), emptyLabel: '— choisir —', addLabel: 'Nouvelle destination',
      hint: 'Une nouvelle destination rejoint MISSION → DESTINATIONS' },
    { key: 'kmDepart', label: 'Kilométrage départ', type: 'nombre', value: x.kmDepart },
    { key: 'kmArrivee', label: 'Kilométrage arrivée', type: 'nombre', value: x.kmArrivee },
    { key: 'dotationCarburant', label: 'Dotation (F)', type: 'montant', value: x.dotationCarburant },
    { key: 'participant1', label: 'Participant 1', value: p[0] },
    { key: 'participant2', label: 'Participant 2', value: p[1] },
    { key: 'participant3', label: 'Participant 3', value: p[2] },
    { key: 'participant4', label: 'Participant 4', value: p[3] },
    { key: 'parcours', label: 'Parcours calculé (aller-retour)', type: 'static', value: texteParcoursSortie(x.destination),
      hint: 'Abidjan → destination → Abidjan' },
    { key: 'fraisPeage', label: 'Frais de péage (F)', type: 'montant', value: x.fraisPeage },
    { key: 'fraisOm', label: 'Frais OM (F)', type: 'montant', value: x.fraisOm },
    { key: 'depenseDivers', label: 'Dépense divers (F)', type: 'montant', value: x.depenseDivers },
    { key: 'justificationDivers', label: 'Justification de la dépense divers', value: x.justificationDivers }
  ];
}

export function openSortieAbidjanForm(x) {
  const isEdit = !!x;
  const rav = ((x && x.ravitaillements) || []).map((r) => Object.assign({}, r));
  let majTotaux = () => {};
  const francsOuVide = (v) => (v === '' ? '' : francSup(v));

  openForm({
    title: isEdit ? `Modifier la sortie d’Abidjan — ${x.ref || ''}` : 'Nouvelle sortie d’Abidjan',
    fields: sortieAbidjanFields(x || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la sortie',
    onInput: (values, scope) => {
      majTotaux();
      const node = scope.querySelector('[data-key="parcours"]');
      if (node) node.value = texteParcoursSortie(values.destination);
    },
    // Les points de ravitaillement et le total des depenses, comme dans le
    // rapport de mission.
    extra: (scope) => { majTotaux = monterRavitaillements(scope, rav); },
    onSubmit: (v) => {
      const ref = String(v.ref || '').trim().toUpperCase();
      if (refSortieAbidjanEnDouble(ref, x && x.id)) {
        return `La référence ${ref} est déjà attribuée à une autre sortie d’Abidjan.`;
      }
      // Une destination deja connue garde son ecriture ; une nouvelle
      // rejoint la liste des destinations des missions.
      const connue = destinationMissionParNom(v.destination);
      const destination = connue ? connue.nom : String(v.destination || '').trim();
      const creee = connue ? null : assurerDestinationMission(destination);

      const payload = {
        ref,
        date: v.date,
        conducteur: v.conducteur,
        vehicule: String(v.vehicule || '').trim().toUpperCase(),
        destination,
        destinations: destination ? [destination] : [],
        kmDepart: v.kmDepart,
        kmArrivee: v.kmArrivee,
        dotationCarburant: francsOuVide(v.dotationCarburant),
        participants: [v.participant1, v.participant2, v.participant3, v.participant4].filter(Boolean),
        ravitaillements: rav,
        fraisPeage: francsOuVide(v.fraisPeage),
        fraisOm: francsOuVide(v.fraisOm),
        depenseDivers: francsOuVide(v.depenseDivers),
        justificationDivers: v.justificationDivers
      };
      if (isEdit) update('sortiesAbidjan', x.id, payload);
      else insert('sortiesAbidjan', Object.assign({ createdAt: new Date().toISOString() }, payload));

      toast(
        (isEdit ? 'Sortie d’Abidjan mise à jour.' : 'Sortie d’Abidjan enregistrée.') +
          (creee ? ` « ${creee.nom} » ajoutée aux destinations, distance à renseigner.` : ''),
        'ok', creee ? 4500 : 2600
      );
      rerender();
      return null;
    }
  });
}

/* ============================== Exports ============================ */

async function doExport(kind, sub, list) {
  try {
    const [ds, name, titre] = {
      decharges: [dsDecharges, 'PDU_courses', 'Courses'],
      destinataires: [dsDestinataires, 'PDU_destinataires', 'Destinataires des courses'],
      abidjan: [dsSortiesAbidjan, 'PDU_sorties_abidjan', 'Sorties d’Abidjan']
    }[sub];
    const datasets = [ds(list)];
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
