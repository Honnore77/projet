/* ===================================================================
   Fenetre flottante des notes : annonce les notes non lues — nom de
   l'expediteur et objet — a la connexion, puis a chaque note qui arrive
   (saisie sur ce poste ou recue par la synchronisation).

   Une note n'est annoncee qu'une fois par session : fermer la fenetre
   ne la fait pas revenir a la modification suivante de la base. Un clic
   sur une note, ou sur « Voir les notes », ouvre la rubrique NOTES, ce
   qui les marque lues.
   =================================================================== */

import { el, esc } from '../core/utils.js';
import { notesNonLues, nomDuCompte } from '../core/notes.js';

/** Au-dela, la fenetre dit « et N autre(s) ». */
const MAX_LIGNES = 5;

let annoncees = new Set();
let compteId = null;
let fenetre = null;

/** Repart de zero pour le compte qui vient de se connecter. */
export function demarrerNotesFlottantes(id) {
  compteId = id;
  annoncees = new Set();
  fermer();
}

export function fermer() {
  if (fenetre) fenetre.remove();
  fenetre = null;
}

/**
 * Affiche (ou complete) la fenetre s'il y a des notes non lues pas encore
 * annoncees. `ouvrirNotes` ouvre la rubrique NOTES.
 */
export function annoncerNotes({ ouvrirNotes, surNotes = false }) {
  if (!compteId) return;
  const nonLues = notesNonLues(compteId);
  // Sur la page NOTES, elles s'affichent deja : rien a annoncer.
  if (surNotes) {
    nonLues.forEach((n) => annoncees.add(n.id));
    fermer();
    return;
  }
  const nouvelles = nonLues.filter((n) => !annoncees.has(n.id));
  if (!nouvelles.length) return;
  nouvelles.forEach((n) => annoncees.add(n.id));
  dessiner(nonLues, ouvrirNotes);
}

function dessiner(notes, ouvrirNotes) {
  fermer();
  const lignes = notes.slice(0, MAX_LIGNES);
  const reste = notes.length - lignes.length;
  fenetre = el(
    '<div class="notesFlottante" role="status" aria-live="polite">' +
      '<div class="nfTete">' +
        `<b>📬 ${notes.length} nouvelle${notes.length > 1 ? 's' : ''} note${notes.length > 1 ? 's' : ''}</b>` +
        '<button type="button" class="nfFermer" title="Fermer">✕</button>' +
      '</div>' +
      '<div class="nfListe">' +
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
  const aller = () => { fermer(); ouvrirNotes(); };
  fenetre.querySelector('.nfFermer').onclick = fermer;
  fenetre.querySelector('.nfVoir').onclick = aller;
  fenetre.querySelectorAll('.nfLigne').forEach((b) => { b.onclick = aller; });
  document.body.appendChild(fenetre);
}
