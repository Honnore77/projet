/* ===================================================================
   NOTES — messagerie interne. Deux sous-rubriques :

     REÇUES     notes publiques des autres et notes privees adressees
                au compte connecte ;
       ENVOYÉES   les notes ecrites par le compte connecte ;

   Ouverte a tous les comptes, quel que soit leur niveau d'acces : chacun
   ecrit, modifie et supprime ses propres notes. L'administrateur peut en
   plus supprimer une note publique (ou privee qu'il voit) qui n'a pas sa
   place.
   =================================================================== */

import { DB, insert, update, remove } from '../../core/db.js';
import { currentUser, roleLabel } from '../../core/auth.js';
import { esc, escLignes, el, fmt, norm } from '../../core/utils.js';
import { card, filterBar, subtabs, emptyState, openForm, confirmDialog, toast, statTile, toolbar, dataTable } from '../components.js';
import { state, rerender, moduleColor } from '../shell.js';
import { FORMATS, ACCEPT, TAILLE_MAX, taillePiece, ajouterPiece, ajouterPieceOctets, nouvelleVersion } from '../../core/pieces.js';
import { definirEnvoi } from '../../export/envoi.js';
import { ouvrirPiece } from '../pieceViewer.js';
import {
  PUBLIQUE, PRIVEE, notesRecues, notesEnvoyees, estLue, marquerLues, comptesDestinataires,
  nomDuCompte, peutModifierNote, peutSupprimerNote, destinatairesReponse, reponsesA,
  accusesDe, etatAccuse, pointDesComptes
} from '../../core/notes.js';

const SUBS = [
  { key: 'recues', label: 'NOTES REÇUES' },
  { key: 'envoyees', label: 'NOTES ENVOYÉES' }
];

const COULEUR = () => moduleColor('NOTES');
const COULEUR_ENVOI = '#455A64';
const COULEUR_COMPTES = '#00695C';
const COULEUR_PUBLIQUE = '#008A3B';
const COULEUR_PRIVEE = '#6A3CB4';

/** Filtres de la rubrique, gardes tant que l'application reste ouverte. */
const filtres = { recues: { type: '', etat: '' }, envoyees: { type: '' } };

/**
 * Les notes encore non lues a l'ouverture de la rubrique. Afficher une
 * note la marque lue ; elle garde pourtant sa marque « Nouvelle » tant
 * qu'on reste sur la page, filtres changes compris.
 */
let visite = -1;
const nouvelles = new Set();

export function renderNotes(page) {
  const moi = currentUser();
  if (!moi) return;
  const sub = state.sub.NOTES || 'recues';
  if (visite !== state.visite) {
    visite = state.visite;
    nouvelles.clear();
  }
  page.appendChild(
    subtabs(SUBS, sub, (k) => { state.sub.NOTES = k; rerender(); }, { recues: COULEUR(), envoyees: COULEUR_ENVOI })
  );
  if (sub === 'envoyees') renderEnvoyees(page, moi);
  else renderRecues(page, moi);
}

/* ============================ REÇUES ============================== */

function renderRecues(page, moi) {
  const f = filtres.recues;
  page.appendChild(card(
    'NOTES REÇUES',
    'Les notes publiques, lues par tous les comptes, et les notes privées qui vous sont adressées.',
    COULEUR()
  ));

  const toutes = notesRecues(moi.id);
  toutes.filter((n) => !estLue(n, moi.id)).forEach((n) => nouvelles.add(n.id));
  const nonLues = toutes.filter((n) => nouvelles.has(n.id));

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Nouvelles', fmt(nonLues.length), 'notes pas encore lues', '#D32F2F'));
  grid.appendChild(statTile('Publiques', fmt(toutes.filter((n) => n.visibilite === PUBLIQUE).length), 'pour tous les comptes', COULEUR_PUBLIQUE));
  grid.appendChild(statTile('Privées', fmt(toutes.filter((n) => n.visibilite === PRIVEE).length), 'qui vous sont adressées', COULEUR_PRIVEE));
  page.appendChild(grid);

  page.appendChild(barreActions());
  page.appendChild(filterBar([
    {
      type: 'select', value: f.type, onChange: (v) => { f.type = v; rerender(); },
      options: [{ value: '', label: 'Publiques et privées' }, { value: PUBLIQUE, label: 'Publiques' }, { value: PRIVEE, label: 'Privées' }]
    },
    {
      type: 'select', value: f.etat, onChange: (v) => { f.etat = v; rerender(); },
      options: [{ value: '', label: 'Toutes les notes' }, { value: 'nonlues', label: 'Nouvelles seulement' }]
    }
  ]));

  let list = toutes;
  if (f.type) list = list.filter((n) => n.visibilite === f.type);
  if (f.etat === 'nonlues') list = list.filter((n) => nouvelles.has(n.id));

  if (!list.length) {
    page.appendChild(emptyState(toutes.length ? 'Aucune note ne correspond aux filtres.' : 'Aucune note reçue pour l’instant.'));
    return;
  }
  list.forEach((n) => page.appendChild(carteNote(n, moi, { nouvelle: nouvelles.has(n.id) })));

  // Les notes affichees sont lues : elles restent marquees « Nouvelle »
  // le temps de cette page, et ne le sont plus a la prochaine visite.
  if (marquerLues(list.map((n) => n.id), moi.id)) {
    document.dispatchEvent(new CustomEvent('notes-lues'));
  }
}

/* =========================== ENVOYÉES ============================= */

function renderEnvoyees(page, moi) {
  const f = filtres.envoyees;
  page.appendChild(card(
    'NOTES ENVOYÉES',
    'Les notes que vous avez écrites. Vous pouvez les modifier ou les supprimer.',
    COULEUR_ENVOI
  ));

  const toutes = notesEnvoyees(moi.id);
  page.appendChild(barreActions());
  page.appendChild(filterBar([
    {
      type: 'select', value: f.type, onChange: (v) => { f.type = v; rerender(); },
      options: [{ value: '', label: 'Publiques et privées' }, { value: PUBLIQUE, label: 'Publiques' }, { value: PRIVEE, label: 'Privées' }]
    }
  ]));

  const list = f.type ? toutes.filter((n) => n.visibilite === f.type) : toutes;
  if (!list.length) {
    page.appendChild(emptyState(toutes.length ? 'Aucune note ne correspond au filtre.' : 'Vous n’avez encore écrit aucune note.'));
    return;
  }
  list.forEach((n) => page.appendChild(carteNote(n, moi, {})));
}

/* ======================= Rubrique COMPTE ========================== */

/**
 * Rubrique COMPTE : tous les comptes crees, en tableau, sans formulaire.
 * On y lit le point des notes de chacun. Le voyant vert s'allume pour les
 * comptes dont une session est ouverte en ce moment ; il reste eteint
 * pour les autres.
 */
export function renderComptes(page) {
  const moi = currentUser();
  if (!moi) return;
  page.appendChild(card(
    'COMPTES',
    'Tous les comptes créés dans l’application et le point de leurs notes. ' +
      'Voyant vert allumé : compte en utilisation ; éteint : compte existant mais pas connecté.',
    COULEUR_COMPTES
  ));

  const point = pointDesComptes();
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Comptes', fmt(point.length), 'créés dans l’application', COULEUR_COMPTES));
  grid.appendChild(statTile('En utilisation', fmt(point.filter((p) => p.enUtilisation).length), 'connectés en ce moment', '#2E7D32'));
  grid.appendChild(statTile('Notes', fmt((DB.notes || []).length), 'écrites au total', COULEUR()));
  page.appendChild(grid);

  const etat = (a) => (a.enAttente ? 'En attente' : a.actif ? 'Actif' : 'Désactivé');
  const couleurEtat = (a) => (a.enAttente ? '#F47B20' : a.actif ? '#008A3B' : '#8aa0a6');
  const chiffre = (n, couleur) => (n ? `<b style="color:${couleur}">${fmt(n)}</b>` : '<span style="color:#8aa0a6">0</span>');

  const headers = ['Compte', 'Identifiant', 'Rôle', 'État', 'Dernière connexion', 'Notes<br>envoyées', 'Notes<br>reçues', 'Lues', 'Non lues'];
  const rows = point.map((p) => {
    const a = p.compte;
    return [
      '<span style="white-space:nowrap">' +
        `<span class="voyantCompte${p.enUtilisation ? ' allume' : ''}" title="${p.enUtilisation ? 'En utilisation' : 'Pas connecté'}"></span>` +
        `<b>${esc(a.nom || a.login)}</b>${a.id === moi.id ? ' <span class="badge" style="background:#5b7178">vous</span>' : ''}</span>`,
      esc(a.login || ''),
      esc(roleLabel(a.role)),
      `<span class="badge" style="background:${couleurEtat(a)}">${esc(etat(a))}</span>`,
      esc(a.lastLogin ? quand(a.lastLogin) : 'jamais'),
      chiffre(p.envoyees, COULEUR_ENVOI),
      chiffre(p.recues, COULEUR()),
      chiffre(p.lues, '#1976D2'),
      chiffre(p.nonLues, '#D32F2F')
    ];
  });
  page.appendChild(dataTable(headers, rows, (tr, i) => {
    const a = point[i].compte;
    tr.dataset.search = norm(`${a.nom} ${a.login} ${roleLabel(a.role)} ${etat(a)}`);
  }, { fiche: false }));

  // Les voyants changent avec le temps, sans que la base bouge : la page
  // se redessine chaque minute tant qu'elle reste affichee.
  if (!rafraichissement) {
    rafraichissement = setInterval(() => {
      if (state.module === 'COMPTE' && !document.querySelector('.modalBack, .modal')) rerender();
      else { clearInterval(rafraichissement); rafraichissement = null; }
    }, 60 * 1000);
  }
}

let rafraichissement = null;

function barreActions() {
  return toolbar([{ label: '+ Nouvelle note', cls: 'addBtn', color: COULEUR(), onClick: () => ouvrirNote(null) }]);
}

/* ============================ Une note ============================ */

/** Date et heure lisibles : « 16/10/2026 à 14:05 ». */
function quand(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function libelleVisibilite(n) {
  if (n.visibilite === PUBLIQUE) return `<span class="badge" style="background:${COULEUR_PUBLIQUE}">🌐 Publique</span>`;
  return `<span class="badge" style="background:${COULEUR_PRIVEE}">🔒 Privée</span>`;
}

function carteNote(n, moi, { nouvelle }) {
  const destinataires = n.visibilite === PRIVEE
    ? (n.destinataires || []).map((id) => nomDuCompte(id)).join(', ')
    : 'Tous les comptes';
  const parent = n.reponseA ? (DB.notes || []).find((x) => x.id === n.reponseA) : null;
  const nbReponses = reponsesA(n.id, moi.id).length;

  const carte = el(
    `<div class="noteCarte${nouvelle ? ' nouvelle' : ''}" style="--c:${n.visibilite === PUBLIQUE ? COULEUR_PUBLIQUE : COULEUR_PRIVEE}">` +
      '<div class="noteTete">' +
        `<b class="noteSujet">${esc(n.sujet || '(sans sujet)')}</b>` +
        (nouvelle ? '<span class="badge" style="background:#D32F2F">Nouvelle</span>' : '') +
        libelleVisibilite(n) +
      '</div>' +
      '<div class="noteMeta">' +
        `De <b>${esc(n.auteurId === moi.id ? 'vous' : (n.auteurNom || nomDuCompte(n.auteurId)))}</b>` +
        ` · À <b>${esc(destinataires)}</b> · ${esc(quand(n.date))}` +
        (n.modifieLe ? ` · <i>modifiée le ${esc(quand(n.modifieLe))}</i>` : '') +
      '</div>' +
      (n.reponseA
        ? `<div class="noteReponseA">↩ En réponse à « ${esc(parent ? parent.sujet || '(sans sujet)' : 'une note supprimée')} »</div>`
        : '') +
      `<div class="noteTexte">${escLignes(n.texte || '')}</div>` +
      ((n.pieces || []).length
        ? `<div class="notePieces">${n.pieces.map((p, i) =>
          `<button type="button" class="notePiece" data-piece="${i}" title="Ouvrir ${esc(p.nom)}">` +
            `<span>${(FORMATS[p.type] || {}).icone || '📄'}</span><b>${esc(p.nom)}</b>` +
            `<i>${esc(taillePiece(p.taille))}${p.modifieLe ? ` · modifié par ${esc(p.modifiePar || '—')}` : ''}</i></button>`).join('')}</div>`
        : '') +
      (n.auteurId === moi.id ? accuseHtml(n) : '') +
      '<div class="noteActions">' +
        (n.auteurId !== moi.id ? '<button type="button" class="miniBtn" data-repondre style="background:#1976D2">↩ Répondre</button>' : '') +
        (peutModifierNote(n, moi) ? '<button type="button" class="miniBtn" data-modifier style="background:#008A3B">✎ Modifier</button>' : '') +
        (peutSupprimerNote(n, moi) ? '<button type="button" class="miniBtn" data-supprimer style="background:#D32F2F">✕ Supprimer</button>' : '') +
        (nbReponses ? `<span class="noteNbRep">${nbReponses} réponse${nbReponses > 1 ? 's' : ''}</span>` : '') +
      '</div>' +
    '</div>'
  );
  carte.dataset.search = norm(`${n.sujet} ${n.texte} ${n.auteurNom} ${destinataires}`);

  // Une piece s'ouvre pour tous ses lecteurs ; chacun peut la modifier
  // (Word, Excel) : la modification devient une nouvelle version.
  carte.querySelectorAll('[data-piece]').forEach((b) => {
    b.onclick = () => {
      const p = n.pieces[Number(b.dataset.piece)];
      ouvrirPiece(p, {
        peutModifier: true,
        enregistrer: async (octets) => {
          await nouvelleVersion(p, octets, moi);
          update('notes', n.id, { pieces: n.pieces });
          rerender();
        }
      });
    };
  });

  const rep = carte.querySelector('[data-repondre]');
  if (rep) rep.onclick = () => ouvrirNote(null, n);
  const mod = carte.querySelector('[data-modifier]');
  if (mod) mod.onclick = () => ouvrirNote(n);
  const sup = carte.querySelector('[data-supprimer]');
  if (sup) {
    sup.onclick = async () => {
      if (!(await confirmDialog({
        title: 'Supprimer la note',
        message: `Supprimer la note « ${n.sujet || '(sans sujet)'} » ? Elle disparaîtra pour tous ses lecteurs.`,
        okLabel: 'Supprimer', danger: true
      }))) return;
      remove('notes', n.id);
      toast('Note supprimée.', 'ok');
      rerender();
    };
  }
  return carte;
}

/**
 * Accuse de reception, sur les notes que l'on a ecrites : ✓ envoyee,
 * ✓✓ gris lue par une partie des lecteurs, ✓✓ bleu lue par tous. Le
 * detail dit qui a lu, et quand.
 */
function accuseHtml(n) {
  const a = accusesDe(n);
  if (!a.length) return '';
  const etat = etatAccuse(n);
  const lus = a.filter((x) => x.luLe !== null);
  const pasLus = a.filter((x) => x.luLe === null);
  const coche = etat === 'envoyee' ? '✓' : '✓✓';
  const resume = etat === 'lue' ? (a.length > 1 ? `Lue par tous (${a.length})` : 'Lue')
    : etat === 'partielle' ? `Lue par ${lus.length} sur ${a.length}` : 'Envoyée — pas encore lue';
  const detail = [
    lus.length ? `Lue par : ${lus.map((x) => `${x.nom}${x.luLe ? ` (${quand(x.luLe)})` : ''}`).join(', ')}` : '',
    pasLus.length ? `Pas encore lue : ${pasLus.map((x) => x.nom).join(', ')}` : ''
  ].filter(Boolean).join('\n');
  return `<details class="noteAccuse ${etat}"><summary><span class="noteCoches">${coche}</span> ${esc(resume)}</summary>` +
    `<div>${escLignes(detail)}</div></details>`;
}

/* ========================== Formulaire ============================ */

/**
 * Ecrire une note, en modifier une (note), ou repondre a une autre
 * (parent). Une reponse reprend la visibilite de la note d'origine et,
 * pour une note privee, s'adresse a son auteur et a ses autres
 * destinataires.
 */
function ouvrirNote(note, parent = null, depart = {}) {
  const moi = currentUser();
  if (!moi) return;
  const comptes = comptesDestinataires(moi.id);
  const visibilite = note ? note.visibilite : parent ? parent.visibilite : PRIVEE;
  const coches = new Set(note ? note.destinataires || [] : parent ? destinatairesReponse(parent, moi.id) : depart.destinataires || []);
  const sujet = note ? note.sujet : parent ? `Re : ${String(parent.sujet || '').replace(/^Re\s*:\s*/i, '')}` : depart.sujet || '';
  // Les pieces de la note, modifiees sur une copie : Annuler n'y touche pas.
  const pieces = (note ? note.pieces || [] : depart.pieces || []).map((p) => Object.assign({}, p));

  const fields = [
    {
      key: 'visibilite', label: 'Visibilité', type: 'select', required: true, value: visibilite, full: true,
      options: [
        { value: PRIVEE, label: '🔒 Privée — seulement les destinataires choisis' },
        { value: PUBLIQUE, label: '🌐 Publique — tous les comptes de l’application' }
      ]
    },
    { key: 'sujet', label: 'Sujet', required: true, full: true, value: sujet },
    { key: 'texte', label: 'Message', type: 'textarea', required: true, full: true, rows: 7, value: note ? note.texte : '' }
  ];

  const zone = el(
    '<div class="noteDest">' +
      '<div class="noteDestTete"><b>Destinataires *</b>' +
        '<button type="button" class="miniBtn" data-tous style="background:#5b7178">Tout cocher</button></div>' +
      (comptes.length
        ? `<div class="noteDestListe">${comptes.map((c) =>
          `<label><input type="checkbox" value="${esc(c.id)}"${coches.has(c.id) ? ' checked' : ''}> ` +
          `${esc(c.nom || c.login)} <span>(${esc(c.login)})</span></label>`).join('')}</div>`
        : '<p class="hint">Aucun autre compte actif pour l’instant.</p>') +
    '</div>'
  );

  // Pieces jointes : PDF, Excel, Word. Rangees des qu'on les choisit (comme
  // les photos) ; une piece abandonnee part au menage du demarrage.
  const zonePieces = el(
    '<div class="noteDest">' +
      '<div class="noteDestTete"><b>Pièces jointes</b>' +
        `<label class="miniBtn" style="background:#1976D2;cursor:pointer">📎 Joindre un fichier` +
        `<input type="file" accept="${ACCEPT}" multiple hidden></label></div>` +
      '<div class="notePieces" data-liste></div>' +
      `<p class="hint">PDF, Excel (.xlsx, .xls) ou Word (.docx), ${esc(taillePiece(TAILLE_MAX))} au plus par fichier.</p>` +
    '</div>'
  );
  const liste = zonePieces.querySelector('[data-liste]');
  const dessinerPieces = () => {
    liste.innerHTML = '';
    pieces.forEach((p, i) => {
      const puce = el(
        `<span class="notePiece"><span>${(FORMATS[p.type] || {}).icone || '📄'}</span><b>${esc(p.nom)}</b>` +
        `<i>${esc(taillePiece(p.taille))}</i><button type="button" title="Retirer">✕</button></span>`
      );
      puce.querySelector('button').onclick = () => { pieces.splice(i, 1); dessinerPieces(); };
      liste.appendChild(puce);
    });
  };
  const entree = zonePieces.querySelector('input[type="file"]');
  entree.onchange = async () => {
    const fichiers = [...entree.files];
    entree.value = '';
    for (const f of fichiers) {
      try {
        pieces.push(await ajouterPiece(f, moi));
      } catch (e) {
        toast((e && e.message) || 'Fichier refusé.', 'err', 5000);
      }
    }
    dessinerPieces();
  };
  dessinerPieces();

  openForm({
    title: note ? 'MODIFIER LA NOTE' : parent ? 'RÉPONDRE' : 'NOUVELLE NOTE',
    okLabel: note ? 'Enregistrer' : 'Envoyer',
    fields,
    extra: (scope) => {
      scope.querySelector('.fGrid').after(zone);
      zone.after(zonePieces);
      const tous = zone.querySelector('[data-tous]');
      tous.onclick = () => {
        const cases = [...zone.querySelectorAll('input[type="checkbox"]')];
        const cocher = cases.some((x) => !x.checked);
        cases.forEach((x) => { x.checked = cocher; });
      };
    },
    onInput: (v) => { zone.style.display = v.visibilite === PRIVEE ? '' : 'none'; },
    onSubmit: (v) => {
      const destinataires = v.visibilite === PRIVEE
        ? [...zone.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value)
        : [];
      if (v.visibilite === PRIVEE && !destinataires.length) return 'Choisissez au moins un destinataire, ou rendez la note publique.';
      const contenu = { visibilite: v.visibilite, sujet: v.sujet, texte: v.texte, destinataires, pieces };
      if (note) {
        update('notes', note.id, Object.assign(contenu, { modifieLe: new Date().toISOString() }));
        toast('Note modifiée.', 'ok');
      } else {
        insert('notes', Object.assign(contenu, {
          auteurId: moi.id,
          auteurNom: moi.nom,
          date: new Date().toISOString(),
          reponseA: parent ? parent.id : ''
        }));
        toast(v.visibilite === PUBLIQUE ? 'Note publiée pour tous les comptes.' : 'Note envoyée.', 'ok');
        if (!parent) state.sub.NOTES = 'envoyees';
      }
      rerender();
      return null;
    }
  });
}

/**
 * Ecrire une nouvelle note depuis une autre rubrique — un export envoye a
 * un compte, par exemple : le fichier arrive deja joint.
 * @param {{sujet?:string, pieces?:object[], destinataires?:string[]}} depart
 */
export function ecrireNote(depart = {}) {
  ouvrirNote(null, null, depart);
}

// « Envoyer à… » des menus d'export : le fichier produit arrive joint a une
// nouvelle note, son nom pour objet ; on choisit les comptes et on ecrit
// le message avant d'envoyer.
definirEnvoi(async ({ bytes, filename }) => {
  const moi = currentUser();
  if (!moi) return;
  const piece = await ajouterPieceOctets(filename, bytes, moi);
  ecrireNote({ sujet: String(filename).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), pieces: [piece] });
});
