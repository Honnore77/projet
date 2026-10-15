/* ===================================================================
   Fiche d'une ligne de tableau, en PDF — A4 portrait.

   Toute ligne d'un tableau de l'application peut s'ouvrir en fiche : ses
   colonnes deviennent des lignes « rubrique : valeur », presentees comme
   la carte d'une fiche vehicule, sur toute la largeur de la feuille.
   =================================================================== */

import { jsPDF } from 'jspdf';
import { DB } from '../core/db.js';
import { mentionLieuDate, todayISO } from '../core/utils.js';
import { toWinAnsi as clean } from './winansi.js';
import { previewAndSave } from './preview.js';

const VERT = [0, 138, 59];
const ENCRE = [23, 49, 59];
const GRIS = [91, 113, 120];
const FOND = [244, 247, 248];
const ROUGE = [198, 40, 40];

/**
 * @param {object} f
 * @param {string} f.titreDocument  « Fiche — MISSION · TABLEAU DE SUIVI »
 * @param {string} f.titre
 * @param {string} [f.sousTitre]
 * @param {{libelle:string, valeur:string, rougeSi?:Function}[]} f.infos
 * @returns {Uint8Array}
 */
export function buildFicheLignePdf(f) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const org = (DB.settings && DB.settings.organisation) || 'PDU';

  const entete = () => {
    doc.setFillColor(...VERT);
    doc.rect(0, 0, W, 18, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(clean(`${org} - ${f.titreDocument}`), M, 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(clean([f.titre, f.sousTitre].filter(Boolean).join(' - ')), M, 14);
  };
  const pied = () => {
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(clean(`${org} - Application de gestion du parc automobile`), M, H - 6);
    doc.text(`Page ${doc.internal.getNumberOfPages()}`, W / 2, H - 6, { align: 'center' });
    doc.text(clean(mentionLieuDate(DB.settings && DB.settings.ville)), W - M, H - 6, { align: 'right' });
  };

  entete();
  const xLib = M + 6;
  const xVal = M + 62;
  const largeurVal = W - M - 6 - xVal;
  // Hauteur de la carte : chaque valeur peut tenir sur plusieurs lignes.
  doc.setFontSize(9.5);
  const lignes = f.infos.map((l) => ({
    l,
    morceaux: String(l.valeur === undefined || l.valeur === null || l.valeur === '' ? '—' : l.valeur)
      .split('\n').flatMap((x) => doc.splitTextToSize(clean(x), largeurVal))
  }));
  let y = 24;
  const hTitre = 22;
  const hCorps = lignes.reduce((t, x) => t + Math.max(1, x.morceaux.length) * 4.6 + 2.4, 0);
  doc.setFillColor(...FOND);
  doc.roundedRect(M, y, W - 2 * M, Math.min(hTitre + hCorps + 6, H - y - 14), 2.5, 2.5, 'F');
  doc.setFillColor(...VERT);
  doc.rect(M, y, 1.6, Math.min(hTitre + hCorps + 6, H - y - 14), 'F');

  doc.setTextColor(...VERT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(doc.splitTextToSize(clean(f.titre || 'Fiche'), W - 2 * M - 12)[0], xLib, y + 9);
  if (f.sousTitre) {
    doc.setTextColor(...ENCRE);
    doc.setFontSize(15);
    doc.text(doc.splitTextToSize(clean(f.sousTitre), W - 2 * M - 12)[0], xLib, y + 17);
  }
  y += hTitre + 2;

  lignes.forEach(({ l, morceaux }) => {
    const h = Math.max(1, morceaux.length) * 4.6 + 2.4;
    if (y + h > H - 16) {
      pied();
      doc.addPage();
      entete();
      y = 26;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...GRIS);
    doc.text(clean(l.libelle), xLib, y);
    doc.setFont('helvetica', 'bold');
    morceaux.forEach((m, k) => {
      doc.setTextColor(...(l.rougeSi && l.rougeSi(m) ? ROUGE : ENCRE));
      doc.text(m, xVal, y + k * 4.6);
    });
    // Filet discret entre deux rubriques.
    doc.setDrawColor(225, 232, 234);
    doc.setLineWidth(0.2);
    doc.line(xLib, y + h - 3.4, W - M - 6, y + h - 3.4);
    y += h;
  });
  pied();
  return new Uint8Array(doc.output('arraybuffer'));
}

export function exportFicheLignePdf(f, baseName) {
  return previewAndSave({
    kind: 'pdf',
    bytes: buildFicheLignePdf(f),
    filename: `${baseName}_${todayISO()}.pdf`,
    mime: 'application/pdf',
    title: 'Aperçu avant export PDF'
  });
}
