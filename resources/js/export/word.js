/* ===================================================================
   Export Word (.docx) — memes jeux de donnees que l'Excel et le PDF.

   Une page A4 a l'en-tete PDU, puis un tableau par jeu de donnees, qui
   occupe toute la largeur de la feuille. Au-dela de sept colonnes, la page
   passe en paysage, comme le PDF.
   =================================================================== */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, PageOrientation, Footer, PageNumber, BorderStyle, ImageRun, VerticalAlign
} from 'docx';
import { todayISO, mentionLieuDate } from '../core/utils.js';
import { DB } from '../core/db.js';
import { previewAndSave } from './preview.js';

export const MIME_WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const VERT = '008A3B';
const ENCRE = '17313B';
const GRIS = '5B7178';
const FOND_ALTERNE = 'F7FAFA';
const ROUGE_CLAIR = 'F8D7DA';
const ROUGE_TEXTE = '9B2C2C';

/** A4 en vingtiemes de point (unite de Word). */
const A4 = { largeur: 11906, hauteur: 16838 };
const MARGE = 680; // 1,2 cm

/** Police lisible a l'ecran comme a l'impression. */
const STYLES = { default: { document: { run: { font: 'Calibri', size: 20 } } } };

const texte = (v) => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return String(v);
};

/** Un texte sur plusieurs lignes devient plusieurs morceaux separes par des retours. */
function morceaux(valeur, o = {}) {
  return texte(valeur).split('\n').map((l, i) => new TextRun(Object.assign({ text: l, break: i ? 1 : 0 }, o)));
}

function cellule(valeur, o = {}) {
  return new TableCell({
    children: [new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: morceaux(valeur, o.run || {}) })],
    shading: o.fond ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fond } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 50, bottom: 50, left: 80, right: 80 }
  });
}

/** Le tableau d'un jeu de donnees, sur toute la largeur utile. */
function tableauDataset(ds) {
  const entete = new TableRow({
    tableHeader: true,
    children: ds.columns.map((c) => cellule(c.label, { fond: VERT, run: { bold: true, color: 'FFFFFF', size: 16 } }))
  });
  const lignes = ds.rows.map((r, i) => new TableRow({
    children: ds.columns.map((c) => {
      const v = r[c.key];
      const vide = v === '' || v === null || v === undefined;
      if (c.alerteSiVide && vide) {
        return cellule('non renseignée', { fond: ROUGE_CLAIR, run: { italics: true, color: ROUGE_TEXTE, size: 16 } });
      }
      return cellule(v, {
        fond: i % 2 ? FOND_ALTERNE : undefined,
        align: typeof v === 'number' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        run: { color: ENCRE, size: 16 }
      });
    })
  }));
  const total = ds.columns.reduce((t, c) => t + (c.width || Math.max(12, c.label.length + 2)), 0);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: ds.columns.map((c) => Math.round(((c.width || Math.max(12, c.label.length + 2)) / total) * 10000)),
    rows: [entete, ...(lignes.length ? lignes : [new TableRow({ children: [cellule('Aucune donnée', { run: { italics: true, color: GRIS } })].concat(ds.columns.slice(1).map(() => cellule(''))) })])]
  });
}

/** Bandeau vert de l'en-tete, comme le PDF. */
function bandeau(titre, sousTitre) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE }
    },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: VERT },
        margins: { top: 120, bottom: 120, left: 200, right: 200 },
        children: [
          new Paragraph({ children: [new TextRun({ text: titre, bold: true, color: 'FFFFFF', size: 28 })] }),
          ...(sousTitre ? [new Paragraph({ children: [new TextRun({ text: sousTitre, color: 'FFFFFF', size: 18 })] })] : [])
        ]
      })]
    })]
  });
}

function piedDePage(org) {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `${org} - Application de gestion du parc automobile   ·   Page `, size: 14, color: '787878' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '787878' }),
        new TextRun({ text: `   ·   ${mentionLieuDate(DB.settings && DB.settings.ville)}`, size: 14, color: '787878' })
      ]
    })]
  });
}

function section(enfants, paysage) {
  const org = (DB.settings && DB.settings.organisation) || 'PDU';
  return {
    properties: {
      page: {
        size: paysage
          ? { width: A4.hauteur, height: A4.largeur, orientation: PageOrientation.LANDSCAPE }
          : { width: A4.largeur, height: A4.hauteur, orientation: PageOrientation.PORTRAIT },
        margin: { top: MARGE, bottom: MARGE, left: MARGE, right: MARGE }
      }
    },
    footers: { default: piedDePage(org) },
    children: enfants
  };
}

/**
 * Image PNG centree, a la largeur de la page (en pixels : 1 px = 15 twips),
 * sans depasser 380 px de haut.
 */
function paragrapheImage(image, paysage) {
  const largeurPage = ((paysage ? A4.hauteur : A4.largeur) - 2 * MARGE) / 15;
  const k = Math.min((largeurPage - 10) / image.largeur, 380 / image.hauteur);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new ImageRun({
      type: 'png',
      data: image.png,
      transformation: { width: Math.round(image.largeur * k), height: Math.round(image.hauteur * k) }
    })]
  });
}

/**
 * Construit le document sans l'ecrire.
 * @param {Array} datasets  memes jeux que buildExcel / buildPdf
 * @param {{title?:string, orientation?:'p'|'l', enchaine?:boolean}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function buildWord(datasets, opts = {}) {
  const org = (DB.settings && DB.settings.organisation) || 'PDU';
  const titre = `${org} - ${opts.title || 'Gestion du parc automobile'}`;
  const larges = datasets.some((d) => d.columns.length > 7);
  const paysage = opts.orientation ? opts.orientation === 'l' : larges;
  const sections = [];
  let courant = [];
  datasets.forEach((ds, i) => {
    if (i === 0 || !opts.enchaine) {
      if (courant.length) sections.push(section(courant, paysage));
      courant = [bandeau(titre, ds.title), new Paragraph({ text: '' })];
    } else {
      courant.push(new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: ds.title, bold: true, color: VERT, size: 22 })] }));
    }
    // Un graphique joint (STATISTIQUES) passe au-dessus de son tableau.
    if (ds.image) courant.push(paragrapheImage(ds.image, paysage));
    courant.push(tableauDataset(ds));
    if (ds.note) courant.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: ds.note, italics: true, color: GRIS, size: 16 })] }));
  });
  if (courant.length) sections.push(section(courant, paysage));
  return octets(new Document({ creator: org, title: titre, styles: STYLES, sections }));
}

/**
 * Fiche en carte d'identite, comme a l'ecran : photo a gauche, titre et
 * informations a droite, puis les compteurs et les historiques.
 * @param {object} f
 * @param {string} f.titreDocument  « Fiche véhicule », « Fiche agent »...
 * @param {string} f.titre          nom de la fiche (marque modele, nom de l'agent)
 * @param {string} [f.sousTitre]    immatriculation, fonction...
 * @param {{libelle:string, valeur:string, rouge?:boolean}[]} f.infos
 * @param {{titre:string, valeur:string, detail:string}[]} [f.compteurs]
 * @param {Uint8Array|null} [f.photo]  octets JPEG/PNG
 * @param {string} [f.observations]
 * @param {Array} [f.datasets]  historiques (version complete)
 * @param {boolean} [f.sansPhoto]  carte sans cadre photo (fiche d'une ligne de tableau)
 */
export async function buildFicheWord(f) {
  const org = (DB.settings && DB.settings.organisation) || 'PDU';
  const sansBord = {
    top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE }
  };
  const lignesInfos = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: sansBord,
    columnWidths: [3800, 6200],
    rows: f.infos.map((l) => new TableRow({
      children: [
        cellule(l.libelle, { run: { color: GRIS, size: 18 } }),
        new TableCell({
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          children: [new Paragraph({
            children: texte(l.valeur).split('\n').map((x, i) => new TextRun({
              text: x, break: i ? 1 : 0, bold: true, size: 18,
              color: l.rouge || (l.rougeSi && l.rougeSi(x)) ? 'C62828' : ENCRE
            }))
          })]
        })
      ]
    }))
  });
  const droite = [
    new Paragraph({ children: [new TextRun({ text: f.titre || '', bold: true, color: VERT, size: 26 })] }),
    ...(f.sousTitre ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: f.sousTitre, bold: true, color: ENCRE, size: 34 })] })] : []),
    lignesInfos
  ];
  const photo = f.photo
    ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'jpg', data: f.photo, transformation: { width: 220, height: 165 } })] })
    : new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 900 }, children: [new TextRun({ text: 'Aucune photo', color: GRIS, size: 18 })] });
  const celluleInfos = new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F7F8' }, margins: { top: 160, bottom: 160, left: 240, right: 200 }, children: droite });
  // Une fiche de ligne de tableau n'a pas de photo : la carte prend toute la largeur.
  const carte = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: sansBord,
    columnWidths: f.sansPhoto ? [10000] : [3300, 6700],
    rows: [new TableRow({
      children: f.sansPhoto ? [celluleInfos] : [
        new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2F3' }, margins: { top: 120, bottom: 120, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER, children: [photo] }),
        celluleInfos
      ]
    })]
  });
  const enfants = [bandeau(`${org} - ${f.titreDocument}`, [f.titre, f.sousTitre].filter(Boolean).join(' - ')), new Paragraph({ text: '' }), carte];
  if (f.compteurs && f.compteurs.length) {
    enfants.push(new Paragraph({ text: '' }));
    enfants.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: sansBord,
      rows: [new TableRow({
        children: f.compteurs.map((c) => new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F7F8' },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [
            new Paragraph({ children: [new TextRun({ text: c.titre.toUpperCase(), bold: true, color: GRIS, size: 15 })] }),
            new Paragraph({ children: [new TextRun({ text: texte(c.valeur), bold: true, color: ENCRE, size: 30 })] }),
            new Paragraph({ children: [new TextRun({ text: texte(c.detail), color: GRIS, size: 15 })] })
          ]
        }))
      })]
    }));
  }
  if (f.observations) {
    enfants.push(new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: 'OBSERVATIONS', bold: true, color: GRIS, size: 16 })] }));
    enfants.push(new Paragraph({ children: morceaux(f.observations, { color: ENCRE, size: 18 }) }));
  }
  (f.datasets || []).forEach((ds) => {
    enfants.push(new Paragraph({ spacing: { before: 280, after: 80 }, children: [new TextRun({ text: ds.title.toUpperCase(), bold: true, color: VERT, size: 20 })] }));
    enfants.push(tableauDataset(ds));
  });
  return octets(new Document({ creator: org, title: f.titreDocument, styles: STYLES, sections: [section(enfants, false)] }));
}

/**
 * Fiche en sections « libelle / valeur » (fiche de simulation) : chaque
 * section dans son cadre, le detail sous le libelle, le total en avant.
 * @param {{titre:string, sousTitre?:string, sections:{titre:string, lignes:{libelle:string, detail?:string, valeur:string, total?:boolean, sousTotal?:boolean}[]}[]}} modele
 */
export async function buildModeleWord(modele) {
  const org = (DB.settings && DB.settings.organisation) || 'PDU';
  const enfants = [bandeau(`${org} - ${modele.titre}`, modele.sousTitre || ''), new Paragraph({ text: '' })];
  modele.sections.forEach((sec) => {
    enfants.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: sec.titre.toUpperCase(), bold: true, color: GRIS, size: 17 })] }));
    enfants.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [7000, 3000],
      rows: sec.lignes.map((l) => new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F7F8' },
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            children: [
              new Paragraph({ children: [new TextRun({ text: texte(l.libelle), bold: !!(l.total || l.sousTotal), size: l.total ? 22 : 19, color: ENCRE })] }),
              ...(l.detail ? [new Paragraph({ children: [new TextRun({ text: texte(l.detail), italics: true, size: 15, color: '78868C' })] })] : [])
            ]
          }),
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F7F8' },
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: texte(l.valeur), bold: true, size: l.total ? 24 : 19, color: l.total ? '3949AB' : ENCRE })] })]
          })
        ]
      }))
    }));
  });
  return octets(new Document({ creator: org, title: modele.titre, styles: STYLES, sections: [section(enfants, false)] }));
}

export async function exportModeleWord(modele, baseName, apercu) {
  return previewAndSave({
    kind: 'word',
    bytes: await buildModeleWord(modele),
    filename: `${baseName}_${todayISO()}.docx`,
    mime: MIME_WORD,
    datasets: apercu || [],
    title: 'Aperçu avant export Word'
  });
}

async function octets(doc) {
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Montre le contenu du document, puis l'ecrit si l'utilisateur confirme.
 * @returns {Promise<string|null>} chemin ecrit, ou null si annule
 */
export async function exportWord(datasets, baseName, opts = {}) {
  return previewAndSave({
    kind: 'word',
    bytes: await buildWord(datasets, opts),
    filename: `${baseName}_${todayISO()}.docx`,
    mime: MIME_WORD,
    datasets,
    title: 'Aperçu avant export Word'
  });
}

/** Fiche en Word : apercu de ses lignes, puis enregistrement. */
export async function exportFicheWord(f, baseName, apercu) {
  return previewAndSave({
    kind: 'word',
    bytes: await buildFicheWord(f),
    filename: `${baseName}_${todayISO()}.docx`,
    mime: MIME_WORD,
    datasets: apercu || [],
    title: 'Aperçu avant export Word'
  });
}
