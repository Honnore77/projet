/* ===================================================================
   Export Excel (.xlsx) — un onglet par jeu de donnees.
   =================================================================== */

// Fork de SheetJS 0.18.5 qui sait *ecrire* les styles de cellule ; l'API est
// celle de « xlsx », dont il reprend le numero de version.
import * as sheetjs from 'xlsx-js-style';

/**
 * Le paquet est en CommonJS : selon l'outil qui l'assemble, l'API arrive a
 * plat sur le module ou rangee derriere `default`. On resout les deux, comme
 * pour autoTable dans pdf.js — un export silencieusement casse ne se voit
 * qu'au moment ou quelqu'un en a besoin.
 */
const XLSX = sheetjs && sheetjs.utils ? sheetjs : sheetjs.default;
if (!XLSX || !XLSX.utils) throw new Error('SheetJS introuvable : export Excel indisponible.');
import { todayISO, mentionLieuDate } from '../core/utils.js';
import { DB } from '../core/db.js';
import { previewAndSave } from './preview.js';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * @typedef {{title:string, columns:{key:string,label:string,width?:number,alerteSiVide?:boolean}[], rows:object[]}} Dataset
 */

/** Rouge clair des cellules vides a signaler, en hexadecimal Excel. */
const ROUGE_CLAIR = 'FFF8D7DA';
const ROUGE_TEXTE = 'FF9B2C2C';

/** Met en forme la mention de lieu et de date qui ferme la feuille. */
function styleMention(ws, ligne, colonne) {
  const ref = XLSX.utils.encode_cell({ r: ligne, c: colonne });
  if (!ws[ref]) return;
  ws[ref].s = {
    font: { italic: true, color: { rgb: 'FF5B7178' } },
    alignment: { horizontal: 'right' }
  };
}

/**
 * Peint en rouge clair les cellules vides des colonnes marquees
 * `alerteSiVide`. Un trou doit se voir dans le fichier transmis, pas
 * seulement a l'ecran de celui qui l'a produit.
 */
function peindreManquants(ws, ds, body) {
  const signalees = ds.columns
    .map((c, i) => (c.alerteSiVide ? i : -1))
    .filter((i) => i >= 0);
  if (!signalees.length) return;

  body.forEach((ligne, l) => {
    signalees.forEach((c) => {
      const valeur = ligne[c];
      if (valeur !== '' && valeur !== null && valeur !== undefined) return;
      const ref = XLSX.utils.encode_cell({ r: l + 1, c });
      // aoa_to_sheet n'ecrit pas de cellule pour une chaine vide : on la cree,
      // sans quoi il n'y aurait rien a colorer.
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = {
        fill: { patternType: 'solid', fgColor: { rgb: ROUGE_CLAIR } },
        font: { color: { rgb: ROUGE_TEXTE }, italic: true }
      };
    });
  });
}

/**
 * Fait respirer les cellules qui portent plusieurs lignes — telephone d'un
 * agent, motif d'entretien, observation du conducteur. Sans le renvoi a la
 * ligne, Excel les affiche d'un bloc sur une seule ligne, et le classeur ne
 * dit plus ce que la fiche disait.
 */
function habillerMultilignes(ws, ds, body) {
  body.forEach((ligne, l) => {
    ligne.forEach((valeur, c) => {
      if (typeof valeur !== 'string' || !valeur.includes('\n')) return;
      const ref = XLSX.utils.encode_cell({ r: l + 1, c });
      if (!ws[ref]) return;
      ws[ref].s = Object.assign({}, ws[ref].s, {
        alignment: { wrapText: true, vertical: 'top' }
      });
    });
  });
}

/** Construit le classeur sans l'ecrire. @returns {Uint8Array} */
export function buildExcel(datasets) {
  const wb = XLSX.utils.book_new();

  datasets.forEach((ds) => {
    const header = ds.columns.map((c) => c.label);
    const body = ds.rows.map((r) => ds.columns.map((c) => cell(r[c.key])));
    // La mention de lieu et de date ferme la feuille, dans la derniere
    // colonne : c'est le bas a droite d'un tableur, la ou on la cherche.
    const mention = new Array(ds.columns.length).fill('');
    mention[ds.columns.length - 1] = mentionLieuDate(DB.settings && DB.settings.ville);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body, [], mention]);
    habillerMultilignes(ws, ds, body);
    peindreManquants(ws, ds, body);
    styleMention(ws, body.length + 2, ds.columns.length - 1);
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
