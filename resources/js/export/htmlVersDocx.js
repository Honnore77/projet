/* ===================================================================
   Document Word modifie dans l'application -> fichier .docx.

   L'editeur de pieces jointes (ui/pieceViewer.js) montre un document Word
   sous forme de page HTML modifiable. A l'enregistrement, ce module
   reecrit la page en .docx : titres, paragraphes, gras, italique,
   souligne, listes, tableaux, images et alignement.

   Ce qui n'a pas d'equivalent dans la page (en-tetes et pieds de page,
   styles propres au document, zones de texte…) ne revient pas : le
   document est simplifie. Sur le PC, « Ouvrir dans Word » modifie le
   fichier d'origine sans rien perdre.
   =================================================================== */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel,
  AlignmentType, ImageRun, LevelFormat, BorderStyle
} from 'docx';

const TITRES = {
  H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6
};

const ALIGNEMENTS = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };

/** Largeur maximale d'une image dans la page, en pixels. */
const LARGEUR_IMAGE = 600;

/** Octets d'une image en data URI, et son format pour docx. */
function imageDe(img) {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(img.getAttribute('src') || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) octets[i] = bin.charCodeAt(i);
  const type = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  let l = img.naturalWidth || img.width || 300;
  let h = img.naturalHeight || img.height || 200;
  if (l > LARGEUR_IMAGE) { h = Math.round((h * LARGEUR_IMAGE) / l); l = LARGEUR_IMAGE; }
  return new ImageRun({ type, data: octets, transformation: { width: l, height: h } });
}

/** Les morceaux de texte d'un element, avec la mise en forme heritee. */
function morceaux(noeud, style = {}) {
  const out = [];
  noeud.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      const texte = n.textContent.replace(/\s+/g, ' ');
      if (texte) out.push(new TextRun(Object.assign({ text: texte }, style)));
      return;
    }
    if (n.nodeType !== 1) return;
    const t = n.tagName;
    if (t === 'BR') { out.push(new TextRun({ text: '', break: 1 })); return; }
    if (t === 'IMG') { const im = imageDe(n); if (im) out.push(im); return; }
    const s = Object.assign({}, style);
    const css = n.style || {};
    if (t === 'B' || t === 'STRONG' || css.fontWeight === 'bold' || Number(css.fontWeight) >= 600) s.bold = true;
    if (t === 'I' || t === 'EM' || css.fontStyle === 'italic') s.italics = true;
    if (t === 'U' || /underline/.test(css.textDecoration || '')) s.underline = {};
    if (t === 'S' || t === 'STRIKE' || /line-through/.test(css.textDecoration || '')) s.strike = true;
    if (t === 'SUP') s.superScript = true;
    if (t === 'SUB') s.subScript = true;
    out.push(...morceaux(n, s));
  });
  return out;
}

function alignementDe(n) {
  const a = (n.style && n.style.textAlign) || n.getAttribute('align') || '';
  return ALIGNEMENTS[a.toLowerCase()];
}

/** Convertit les blocs d'un conteneur en paragraphes et tableaux docx. */
function blocs(conteneur, ctx, niveauListe = 0) {
  const out = [];
  let enLigne = [];
  const viderEnLigne = () => {
    if (enLigne.length) out.push(new Paragraph({ children: enLigne }));
    enLigne = [];
  };

  conteneur.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      if (n.textContent.trim()) enLigne.push(new TextRun(n.textContent.replace(/\s+/g, ' ')));
      return;
    }
    if (n.nodeType !== 1) return;
    const t = n.tagName;

    if (t === 'P' || TITRES[t]) {
      viderEnLigne();
      const enfants = morceaux(n);
      out.push(new Paragraph({
        children: enfants.length ? enfants : [new TextRun('')],
        heading: TITRES[t],
        alignment: alignementDe(n)
      }));
    } else if (t === 'UL' || t === 'OL') {
      viderEnLigne();
      // Chaque liste numerotee repart de 1 : une instance de numerotation par liste.
      const instance = t === 'OL' ? (ctx.instance += 1) : 0;
      [...n.children].filter((li) => li.tagName === 'LI').forEach((li) => {
        const texte = document.createElement('div');
        const sousListes = [];
        li.childNodes.forEach((c) => {
          if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) sousListes.push(c);
          else texte.appendChild(c.cloneNode(true));
        });
        out.push(new Paragraph({
          children: morceaux(texte),
          alignment: alignementDe(li),
          ...(t === 'OL'
            ? { numbering: { reference: 'numeros', level: Math.min(niveauListe, 8), instance } }
            : { bullet: { level: Math.min(niveauListe, 8) } })
        }));
        sousListes.forEach((sl) => {
          const enveloppe = document.createElement('div');
          enveloppe.appendChild(sl.cloneNode(true));
          out.push(...blocs(enveloppe, ctx, niveauListe + 1));
        });
      });
    } else if (t === 'TABLE') {
      viderEnLigne();
      const lignes = [...n.querySelectorAll('tr')].filter((tr) => tr.closest('table') === n);
      if (!lignes.length) return;
      const bord = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: bord, bottom: bord, left: bord, right: bord, insideHorizontal: bord, insideVertical: bord },
        rows: lignes.map((tr) => new TableRow({
          children: [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map((c) => {
            const contenu = blocs(c, ctx);
            return new TableCell({
              columnSpan: Number(c.getAttribute('colspan')) || undefined,
              rowSpan: Number(c.getAttribute('rowspan')) || undefined,
              children: contenu.length ? contenu : [new Paragraph('')]
            });
          })
        }))
      }));
      // Un paragraphe vide apres le tableau : Word en veut un entre deux tableaux.
      out.push(new Paragraph(''));
    } else if (['DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE'].includes(t)) {
      viderEnLigne();
      out.push(...blocs(n, ctx, niveauListe));
    } else if (t === 'HR') {
      viderEnLigne();
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } }, children: [] }));
    } else {
      // Texte en ligne (gras, lien, image…) hors de tout paragraphe.
      enLigne.push(...morceaux({ childNodes: [n] }));
    }
  });
  viderEnLigne();
  return out;
}

/**
 * Le contenu d'un element HTML, en octets .docx.
 * @param {HTMLElement} racine
 * @returns {Promise<Uint8Array>}
 */
export async function htmlVersDocx(racine) {
  const ctx = { instance: 0 };
  const enfants = blocs(racine, ctx);
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'numeros',
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
        }))
      }]
    },
    sections: [{ children: enfants.length ? enfants : [new Paragraph('')] }]
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
