/* ===================================================================
   Export Excel (.xlsx) — un onglet par jeu de donnees.
   =================================================================== */

import * as XLSX from 'xlsx';
import { saveFile } from '../core/storage.js';
import { todayISO } from '../core/utils.js';

/**
 * @typedef {{title:string, columns:{key:string,label:string,width?:number}[], rows:object[]}} Dataset
 */

/**
 * Ecrit un classeur Excel.
 * @param {Dataset[]} datasets
 * @param {string} baseName nom de fichier sans extension
 * @returns {Promise<string|null>} chemin ecrit, ou null si annule
 */
export async function exportExcel(datasets, baseName) {
  const wb = XLSX.utils.book_new();

  datasets.forEach((ds) => {
    const header = ds.columns.map((c) => c.label);
    const body = ds.rows.map((r) => ds.columns.map((c) => cell(r[c.key])));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = ds.columns.map((c) => ({ wch: c.width || Math.max(12, c.label.length + 2) }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(body.length, 1), c: ds.columns.length - 1 } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, sheetName(ds.title));
  });

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return saveFile(
    `${baseName}_${todayISO()}.xlsx`,
    new Uint8Array(out),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
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
