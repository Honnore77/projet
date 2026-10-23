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
import JSZip from 'jszip';

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
    // Marges d'une feuille A4 (en pouces) : la mise en page les complete.
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 };
    XLSX.utils.book_append_sheet(wb, ws, sheetName(ds.title));
  });

  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

/**
 * Mise en page A4 de chaque onglet : a l'impression, le tableau occupe
 * toute la largeur de la feuille (« ajuster a une page de large »), centre,
 * en portrait pour une fiche ou un tableau etroit, en paysage au-dela de
 * sept colonnes. SheetJS n'ecrit pas ces reglages : on les pose dans le
 * classeur deja produit.
 * @param {Uint8Array} octets
 * @param {Dataset[]} datasets
 * @param {{fiche?:boolean}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function miseEnPageA4(octets, datasets, opts = {}) {
  const zip = await JSZip.loadAsync(octets);
  await Promise.all(datasets.map(async (ds, i) => {
    const chemin = `xl/worksheets/sheet${i + 1}.xml`;
    const fichier = zip.file(chemin);
    if (!fichier) return;
    let xml = await fichier.async('string');
    const paysage = !opts.fiche && ds.columns.length > 7;
    const ajuster = '<pageSetUpPr fitToPage="1"/>';
    if (/<sheetPr\b[^>]*\/>/.test(xml)) {
      xml = xml.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1>${ajuster}</sheetPr>`);
    } else if (/<sheetPr\b[^>]*>/.test(xml)) {
      xml = xml.replace(/<sheetPr\b([^>]*)>/, `<sheetPr$1>${ajuster}`);
    } else {
      xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr>${ajuster}</sheetPr>`);
    }
    const page = `<printOptions horizontalCentered="1"/>`;
    const format = `<pageSetup paperSize="9" orientation="${paysage ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`;
    if (/<pageMargins\b[^>]*\/>/.test(xml)) {
      xml = xml.replace(/(<pageMargins\b[^>]*\/>)/, `${page}$1${format}`);
    }
    if (ds.image) xml = await insererImage(zip, xml, i + 1, ds);
    zip.file(chemin, xml);
  }));
  if (datasets.some((ds) => ds.image)) await declarerImages(zip, datasets);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * Un graphique joint (STATISTIQUES) se pose a droite du tableau de son
 * onglet, en image : SheetJS n'ecrit pas d'images, on ajoute au classeur
 * l'image, son dessin et les liens qui les rattachent a la feuille.
 * @returns {Promise<string>} le XML de la feuille, qui pointe vers le dessin
 */
async function insererImage(zip, xml, n, ds) {
  const { largeur, hauteur } = ds.image;
  // Environ 620 px de large a l'ecran, proportions gardees (1 px = 9525 EMU).
  const k = Math.min(620 / largeur, 380 / hauteur);
  const cx = Math.round(largeur * k * 9525);
  const cy = Math.round(hauteur * k * 9525);
  zip.file(`xl/media/graphique${n}.png`, ds.image.png);
  zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="../media/graphique${n}.png"/></Relationships>`);
  zip.file(`xl/drawings/drawing${n}.xml`,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">` +
    '<xdr:oneCellAnchor>' +
      `<xdr:from><xdr:col>${ds.columns.length + 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:ext cx="${cx}" cy="${cy}"/>` +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Graphique"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
      '<xdr:clientData/>' +
    '</xdr:oneCellAnchor></xdr:wsDr>');

  // Le lien feuille → dessin, dans les liens de la feuille (crees au besoin).
  const cheminRels = `xl/worksheets/_rels/sheet${n}.xml.rels`;
  const rels = zip.file(cheminRels)
    ? await zip.file(cheminRels).async('string')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  zip.file(cheminRels, rels.replace('</Relationships>',
    `<Relationship Id="rIdGraphique" Type="${REL}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`));

  // <drawing> vient apres la mise en page, juste avant la fin de la feuille
  // (ou avant ses eventuels elements de fin, que SheetJS n'ecrit pas ici).
  if (!/xmlns:r=/.test(xml)) xml = xml.replace(/<worksheet\b/, `<worksheet xmlns:r="${REL}"`);
  return xml.replace('</worksheet>', '<drawing r:id="rIdGraphique"/></worksheet>');
}

/** Les types des images et des dessins, dans [Content_Types].xml. */
async function declarerImages(zip, datasets) {
  const chemin = '[Content_Types].xml';
  let types = await zip.file(chemin).async('string');
  if (!/Extension="png"/i.test(types)) {
    types = types.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
  }
  datasets.forEach((ds, i) => {
    if (!ds.image) return;
    types = types.replace('</Types>',
      `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  });
  zip.file(chemin, types);
}

/**
 * Montre le contenu du classeur, puis l'ecrit si l'utilisateur confirme.
 * @param {Dataset[]} datasets
 * @param {string} baseName nom de fichier sans extension
 * @param {{fiche?:boolean}} [opts]  fiche : feuille A4 en portrait
 * @returns {Promise<string|null>} chemin ecrit, ou null si annule
 */
export async function exportExcel(datasets, baseName, opts = {}) {
  let octets = buildExcel(datasets);
  try {
    octets = await miseEnPageA4(octets, datasets, opts);
  } catch (e) {
    // Sans mise en page, le classeur reste juste : on l'enregistre tel quel.
    console.error('Mise en page A4 du classeur', e);
  }
  return previewAndSave({
    kind: 'excel',
    bytes: octets,
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
