/* ===================================================================
   IMPRIMES DES DEMANDES DE CONGE ET D'ABSENCE.

   Le fond de chaque page est l'imprimé officiel du PDU, vierge, tel qu'il
   a été fourni (modeles/*.jpg) : en-tête, armoiries, logo, filigrane et
   cadres sont donc exactement ceux du papier. Les informations de la
   demande s'écrivent par-dessus, sur les lignes prévues pour elles.

   Les positions sont en points (1/72 de pouce), mesurées sur les imprimés.

     DEMANDE DE CONGE   deux pages A4 portrait : la demande de départ en
                        congé, puis la fiche d'intérim ;
     DEMANDE D'ABSENCE  une page A4 paysage.
   =================================================================== */

import { jsPDF } from 'jspdf';
import { dateFR, todayISO } from '../core/utils.js';
import { lignes } from '../core/demandes.js';
import { previewAndSave } from './preview.js';
import { toWinAnsi as clean } from './winansi.js';
import fondConge from './modeles/demande-conge.jpg?inline';
import fondInterim from './modeles/fiche-interim.jpg?inline';
import fondAbsence from './modeles/demande-absence.jpg?inline';

const ENCRE = [20, 20, 20];

/**
 * Écrit un texte sur une ligne de l'imprimé ; trop long pour la place, il
 * est réduit jusqu'à y tenir.
 */
function ecrire(doc, texte, x, y, { largeur = 400, taille = 11, gras = false, centre = false } = {}) {
  const t = clean(String(texte || '').trim());
  if (!t) return;
  doc.setFont('helvetica', gras ? 'bold' : 'normal');
  let s = taille;
  doc.setFontSize(s);
  while (s > 6 && doc.getTextWidth(t) > largeur) {
    s -= 0.5;
    doc.setFontSize(s);
  }
  doc.text(t, centre ? x + largeur / 2 : x, y, centre ? { align: 'center' } : undefined);
}

/** Un texte sur plusieurs lignes, coupé à la largeur donnée. */
function paragraphe(doc, texte, x, y, { largeur = 400, taille = 10, interligne = 12, max = 3 } = {}) {
  const t = clean(String(texte || '').trim());
  if (!t) return;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(taille);
  doc.splitTextToSize(t, largeur).slice(0, max).forEach((l, i) => doc.text(l, x, y + i * interligne));
}

function nouveauDoc(orientation) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation });
  doc.setTextColor(...ENCRE);
  return doc;
}

function fond(doc, image) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.addImage(image, 'JPEG', 0, 0, w, h, undefined, 'FAST');
}

/* -------------------------- Demande de congé ------------------------ */

/** Page 1 : DEMANDE DE DEPART EN CONGE. */
function pageDemandeConge(doc, d) {
  fond(doc, fondConge);
  const fin = 530;
  const champ = (texte, x, y) => ecrire(doc, texte, x, y - 1.5, { largeur: fin - x });
  champ(d.nom, 106, 245);
  champ(d.prenoms, 118, 272);
  champ(d.fonction, 126, 298);
  champ(d.service, 110, 325);
  champ(dateFR(d.dateEmbauche), 349, 352);
  champ(d.duree, 166, 380);
  champ(dateFR(d.dateDebut), 182, 406);
  champ(dateFR(d.dateFin), 182, 433);
  champ(dateFR(d.dateReprise), 198, 460);
  ecrire(doc, d.faitA, 170, 513, { largeur: 92 });
  ecrire(doc, dateFR(d.dateDemande), 285, 513, { largeur: 240 });
}

/** Page 2 : FICHE D'INTERIM. */
function pageInterim(doc, d) {
  fond(doc, fondInterim);
  ecrire(doc, `${d.nom || ''} ${d.prenoms || ''}`, 98, 248, { largeur: 126 });
  ecrire(doc, d.service, 297, 248, { largeur: 245 });
  ecrire(doc, dateFR(d.dateDebut), 146, 263, { largeur: 86 });
  ecrire(doc, dateFR(d.dateReprise), 327, 263, { largeur: 215 });
  ecrire(doc, d.interimaire, 274, 277, { largeur: 268 });
  const activites = [340, 362, 383, 402, 424, 445];
  lignes(d.activites, activites.length).forEach((l, i) => ecrire(doc, l, 84, activites[i] - 2, { largeur: 458, taille: 10.5 }));
  const points = [498, 520, 541, 560, 582];
  lignes(d.pointsCles, points.length).forEach((l, i) => ecrire(doc, l, 84, points[i] - 2, { largeur: 458, taille: 10.5 }));
}

export function buildDemandeCongePdf(d) {
  const doc = nouveauDoc('portrait');
  pageDemandeConge(doc, d);
  doc.addPage('a4', 'portrait');
  pageInterim(doc, d);
  return new Uint8Array(doc.output('arraybuffer'));
}

/* ------------------------- Demande d'absence ------------------------ */

export function buildDemandeAbsencePdf(d) {
  const doc = nouveauDoc('landscape');
  fond(doc, fondAbsence);
  // Ligne 1 : Matricule | Nom & Prénoms | Fonction
  ecrire(doc, d.matricule, 76, 250, { largeur: 160, centre: true });
  ecrire(doc, d.nomPrenoms, 248, 250, { largeur: 195, centre: true });
  ecrire(doc, d.fonction, 453, 250, { largeur: 364, centre: true });
  // Début et retour
  ecrire(doc, dateFR(d.dateDebut), 284, 279, { largeur: 138 });
  ecrire(doc, d.heureDebut, 293, 306, { largeur: 129 });
  ecrire(doc, dateFR(d.dateRetour), 284, 333, { largeur: 138 });
  ecrire(doc, d.heureRetour, 293, 360, { largeur: 129 });
  ecrire(doc, d.total, 600, 278, { largeur: 215, gras: true });
  // Absence autorisée : une croix dans la case cochée.
  const croix = { OUI: 588.5, NON: 640.5 }[d.autorisee];
  if (croix) {
    doc.setLineWidth(1.2);
    doc.setDrawColor(...ENCRE);
    doc.line(croix - 3.2, 320, croix + 3.2, 326.4);
    doc.line(croix - 3.2, 326.4, croix + 3.2, 320);
  }
  paragraphe(doc, d.motif, 250, 389, { largeur: 565, max: 3, interligne: 11.5 });
  ecrire(doc, d.commentaires, 158, 436, { largeur: 658, taille: 10 });
  ecrire(doc, `Le ${dateFR(d.dateDemande)}`, 77, 507, { largeur: 160, taille: 10 });
  return new Uint8Array(doc.output('arraybuffer'));
}

/* ------------------------------ Export ------------------------------ */

function nomFichier(d) {
  const qui = String(d.nomPrenoms || `${d.nom || ''} ${d.prenoms || ''}`).trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const quoi = d.type === 'conge' ? 'Demande_de_conge' : 'Demande_d_absence';
  return `PDU_${quoi}${qui ? `_${qui}` : ''}_${d.dateDebut || todayISO()}.pdf`;
}

export function exporterDemande(d) {
  return previewAndSave({
    kind: 'pdf',
    bytes: d.type === 'conge' ? buildDemandeCongePdf(d) : buildDemandeAbsencePdf(d),
    filename: nomFichier(d),
    mime: 'application/pdf',
    title: d.type === 'conge' ? 'Aperçu — Demande de congé' : 'Aperçu — Demande d’absence'
  });
}
