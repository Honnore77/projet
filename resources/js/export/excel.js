/* ===================================================================
   Export Excel (.xlsx) — un onglet par jeu de donnees.
   =================================================================== */

import * as XLSX from 'xlsx';
import { todayISO } from '../core/utils.js';
import { previewAndSave } from './preview.js';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * @typedef {{title:string, columns:{key:string,label:string,width?:number}[], rows:object[]}} Dataset
 */

/** Construit le classeur sans l'ecrire. @returns {Uint8Array} */
export function buildExcel(datasets) {
  const wb = XLSX.utils.book_new();

  datasets.forEach((ds) => {
    const header = ds.columns.map((c) => c.label);
    const body = ds.rows.map((r) => ds.columns.map((c) => cell(r[c.key])));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = ds.columns.map((c) => ({ wch: c.width || Math.max(12, c.label.length + 2) }));
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(body.length, 1), c: ds.columns.length - 1 } })
    };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, sheetName(ds.title));
  });

  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

/**
 * Montre le contenu du classeur, puis l'ecrit si l'utilisateur confirme.
 * @param {Dataset[]} datasets
 * @param {string} baseName nom de fichier sans extension
 * @returns {Promise<string|null>} chemin ecrit, ou null si annule
 */
export async function exportExcel(datasets, baseName) {
  return previewAndSave({
    kind: 'excel',
    bytes: buildExcel(datasets),
    filename: `${baseName}_${todayISO()}.xlsx`,
    mime: MIME,
    datasets,
    title: 'Aperçu avant export Excel'
  });
}

function cell(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return v;
}

/** Excel limite les noms d onglet a 31 caracteres et interdit certains signes. */
function sheetName(t) {
  return String(t).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille';
}
