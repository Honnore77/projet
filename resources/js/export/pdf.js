/* ===================================================================
   Export PDF — rapports tabulaires avec en-tete PDU.
   =================================================================== */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveFile } from '../core/storage.js';
import { todayISO, dateFR } from '../core/utils.js';
import { DB } from '../core/db.js';

const GREEN = [0, 138, 59];

/**
 * @param {{title:string, columns:{key:string,label:string,width?:number}[], rows:object[], note?:string}[]} datasets
 * @param {string} baseName
 * @param {{orientation?:'p'|'l', title?:string}} [opts]
 */
export async function exportPdf(datasets, baseName, opts = {}) {
  const doc = new jsPDF({ orientation: opts.orientation || 'l', unit: 'mm', format: 'a4' });
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

    autoTable(doc, {
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

  const blob = doc.output('arraybuffer');
  return saveFile(`${baseName}_${todayISO()}.pdf`, new Uint8Array(blob), 'application/pdf');
}

/**
 * Les polices standard du PDF sont encodees en WinAnsi : les caracteres
 * typographiques (tirets longs, apostrophes courbes, puces) n y figurent
 * pas et disparaitraient silencieusement. On les remplace par leur
 * equivalent ASCII ; les accents francais, eux, sont bien pris en charge.
 */
function clean(s) {
  return String(s)
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[•·]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[«»]/g, '"')
    .replace(/[→←]/g, '->');
}

function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return clean(v);
}
