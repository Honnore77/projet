/* ===================================================================
   Fenetre flottante des notes : annonce les notes non lues — nom de
   l'expediteur et objet — a la connexion, puis a chaque note qui arrive
   (saisie sur ce poste ou recue par la synchronisation).

   Elle annonce aussi les accuses de lecture : « Bob a lu votre note » des
   qu'un destinataire ouvre une note que l'on a ecrite (lecture faite sur
   ce poste, ou apportee par la synchronisation).

   Une note n'est annoncee qu'une fois par session : fermer la fenetre
   ne la fait pas revenir a la modification suivante de la base. Un clic
   sur une note, ou sur « Voir les notes », ouvre la rubrique NOTES, ce
   qui les marque lues.
   =================================================================== */

import { el, esc } from '../core/utils.js';
import { notesNonLues, nomDuCompte, lecturesDeMesNotes } from '../core/notes.js';

/** Au-dela, la fenetre dit « et N autre(s) ». */
const MAX_LIGNES = 5;

let annoncees = new Set();
let compteId = null;
let fenetre = null;
/** Lectures de ses notes deja connues : seules les suivantes s'annoncent. */
let lecturesConnues = new Set();
/** Lectures annoncees et pas encore fermees, gardees d'un dessin a l'autre. */
let lecturesAffichees = [];
let notesAffichees = [];

/** Repart de zero pour le compte qui vient de se connecter. */
export function demarrerNotesFlottantes(id) {
  compteId = id;
  annoncees = new Set();
  lecturesConnues = new Set(id ? lecturesDeMesNotes(id).map((l) => l.cle) : []);
  lecturesAffichees = [];
  notesAffichees = [];
  fermer();
}

export function fermer() {
  if (fenetre) fenetre.remove();
  fenetre = null;
  lecturesAffichees = [];
  notesAffichees = [];
}

/**
 * Affiche (ou complete) la fenetre s'il y a des notes non lues pas encore
 * annoncees. `ouvrirNotes(sub)` ouvre la rubrique NOTES sur une sous-rubrique.
 */
export function annoncerNotes({ ouvrirNotes, surNotes = false }) {
  if (!compteId) return;
  const nonLues = notesNonLues(compteId);
  const lectures = lecturesDeMesNotes(compteId).filter((l) => !lecturesConnues.has(l.cle));
  lectures.forEach((l) => lecturesConnues.add(l.cle));
  // Sur la page NOTES, tout s'y lit deja : rien a annoncer.
  if (surNotes) {
    nonLues.forEach((n) => annoncees.add(n.id));
    fermer();
    return;
  }
  const nouvelles = nonLues.filter((n) => !annoncees.has(n.id));
  if (!nouvelles.length && !lectures.length) return;
  nouvelles.forEach((n) => annoncees.add(n.id));
  const garder = lecturesAffichees;
  if (nouvelles.length || notesAffichees.length) notesAffichees = nonLues;
  dessiner(notesAffichees, garder.concat(lectures), ouvrirNotes);
}

function dessiner(notes, lectures, ouvrirNotes) {
  if (fenetre) fenetre.remove();
  notesAffichees = notes;
  lecturesAffichees = lectures;
  const lignes = notes.slice(0, MAX_LIGNES);
  const reste = notes.length - lignes.length;
  const titre = notes.length
    ? `📬 ${notes.length} nouvelle${notes.length > 1 ? 's' : ''} note${notes.length > 1 ? 's' : ''}`
    : '✓✓ Accusé de lecture';
  fenetre = el(
    '<div class="notesFlottante" role="status" aria-live="polite">' +
      '<div class="nfTete">' +
        `<b>${titre}</b>` +
        '<button type="button" class="nfFermer" title="Fermer">✕</button>' +
      '</div>' +
      '<div class="nfListe">' +
        lectures.slice(-MAX_LIGNES).map((l) =>
          '<button type="button" class="nfLigne nfLu">' +
            `<span class="nfDe"><b class="nfCoches">✓✓</b> ${esc(l.nom)} a lu votre note</span>` +
            `<span class="nfObjet">${esc(l.sujet || '(sans objet)')}</span>` +
          '</button>').join('') +
        lignes.map((n) =>
          '<button type="button" class="nfLigne">' +
            `<span class="nfDe">${esc(n.auteurNom || nomDuCompte(n.auteurId))}` +
              `${n.visibilite === 'privee' ? ' <i title="Note privée">🔒</i>' : ''}</span>` +
            `<span class="nfObjet">${esc(n.sujet || '(sans objet)')}</span>` +
          '</button>').join('') +
        (reste > 0 ? `<div class="nfReste">et ${reste} autre${reste > 1 ? 's' : ''}…</div>` : '') +
      '</div>' +
      '<button type="button" class="nfVoir">Voir les notes →</button>' +
    '</div>'
  );
  // Une note recue s'ouvre dans NOTES REÇUES ; un accuse de lecture,
  // dans NOTES ENVOYÉES, ou se lit le detail.
  const aller = (sub) => { fermer(); ouvrirNotes(sub); };
  fenetre.querySelector('.nfFermer').onclick = fermer;
  fenetre.querySelector('.nfVoir').onclick = () => aller(notes.length ? 'recues' : 'envoyees');
  fenetre.querySelectorAll('.nfLigne').forEach((b) => {
    b.onclick = () => aller(b.classList.contains('nfLu') ? 'envoyees' : 'recues');
  });
  document.body.appendChild(fenetre);
}
