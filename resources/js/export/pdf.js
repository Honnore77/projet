/* ===================================================================
   Export PDF — rapports tabulaires avec en-tete PDU.
   =================================================================== */

import { jsPDF } from 'jspdf';
import autoTableModule from 'jspdf-autotable';
import { previewAndSave } from './preview.js';
import { todayISO, dateFR } from '../core/utils.js';
import { DB } from '../core/db.js';
import { toWinAnsi as clean } from './winansi.js';

const GREEN = [0, 138, 59];

/**
 * Dessine un tableau dans le document.
 *
 * jspdf-autotable se presente de deux facons selon la maniere dont le module
 * est resolu : une fonction exportee par defaut, ou une methode greffee sur
 * l'instance jsPDF. Les deux ont existe au fil des versions de l'outil de
 * construction, et une seule des deux suffit a produire un PDF vide sans
 * lever d'erreur visible. On accepte donc les deux formes.
 */
function drawTable(doc, options) {
  const fn =
    typeof autoTableModule === 'function'
      ? autoTableModule
      : autoTableModule && typeof autoTableModule.default === 'function'
        ? autoTableModule.default
        : null;

  if (fn) return fn(doc, options);
  if (typeof doc.autoTable === 'function') return doc.autoTable(options);
  throw new Error("jspdf-autotable n'a pas pu être chargé : impossible de produire le PDF.");
}

/**
 * Construit le document sans l'ecrire.
 * @param {{title:string, columns:{key:string,label:string,width?:number}[], rows:object[], note?:string}[]} datasets
 * @param {{orientation?:'p'|'l', title?:string}} [opts]
 * @returns {Uint8Array}
 */
export function buildPdf(datasets, opts = {}) {
  const doc = new jsPDF({ orientation: opts.orientation || 'l', unit: 'mm', format: 'a4' });

  // Tout texte ecrit dans ce document passe par l'assainisseur WinAnsi —
  // y compris celui que jspdf-autotable dessine lui-meme dans les cellules.
  const ecrireBrut = doc.text.bind(doc);
  doc.text = (txt, x, y, o) =>
    ecrireBrut(Array.isArray(txt) ? txt.map(clean) : clean(txt), x, y, o);

  const pageW = doc.internal.pageSize.getWidth();
  const org = (DB.settings && DB.settings.organisation) || 'PDU';

  let first = true;
  datasets.forEach((ds) => {
    if (!first) doc.addPage();
    first = false;

    doc.setFillColor(...GREEN);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setTextColor(255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(clean(`${org} - ${opts.title || 'Gestion du parc automobile'}`), 10, 8);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(clean(ds.title), 10, 14);
    doc.text(clean(`Édité le ${dateFR(todayISO())}`), pageW - 10, 14, { align: 'right' });

    drawTable(doc, {
      startY: 24,
      head: [ds.columns.map((c) => clean(c.label))],
      body: ds.rows.map((r) => ds.columns.map((c) => text(r[c.key]))),
      styles: { fontSize: 7.5, cellPadding: 1.8, overflow: 'linebreak', textColor: [23, 49, 59] },
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: [247, 250, 250] },
      margin: { left: 8, right: 8, bottom: 14 },
      didDrawPage: () => {
        const h = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5);
        doc.setTextColor(120);
        doc.text(
          clean(`${org} - Application de gestion du parc automobile`),
          8,
          h - 6
        );
        doc.text(
          `Page ${doc.internal.getNumberOfPages()}`,
          pageW - 8,
          h - 6,
          { align: 'right' }
        );
      }
    });

    if (ds.note) {
      const y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : 24) + 6;
      doc.setFontSize(8);
      doc.setTextColor(90);
      doc.text(doc.splitTextToSize(clean(ds.note), pageW - 20), 10, y);
    }
  });

  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Montre le document dans une fenêtre d'aperçu, puis l'écrit si
 * l'utilisateur confirme.
 * @returns {Promise<string|null>} chemin écrit, ou null si annulé
 */
export async function exportPdf(datasets, baseName, opts = {}) {
  return previewAndSave({
    kind: 'pdf',
    bytes: buildPdf(datasets, opts),
    filename: `${baseName}_${todayISO()}.pdf`,
    mime: 'application/pdf',
    title: 'Aperçu avant export PDF'
  });
}

function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return clean(v);
}
