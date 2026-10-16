/* ===================================================================
   Ouvrir une piece jointe d'une note : la lire, l'enregistrer, la
   modifier.

     PDF    lu dans le lecteur integre (ou dessine page a page par pdf.js
            sur le telephone) ;
     Word   montre comme une page, modifiable sur place : gras, italique,
            souligne, titres, listes, alignement ;
     Excel  chaque feuille en grille, cellules modifiables, lignes et
            colonnes ajoutees au besoin.

   Une modification enregistree devient une nouvelle version de la piece
   (voir core/pieces.js) : la precedente reste disponible.

   Sur le PC, « Ouvrir dans Word / Excel » ouvre une copie dans le logiciel
   installe ; une fois le fichier enregistre la-bas, « Reprendre les
   modifications » en fait la nouvelle version, sans rien perdre de la
   mise en forme.
   =================================================================== */

import * as sheetjs from 'xlsx-js-style';
import { el, esc } from '../core/utils.js';
import { saveFile } from '../core/storage.js';
import { FORMATS, mimeDe, modifiable, taillePiece, octetsPiece } from '../core/pieces.js';
import { openModal, toast, confirmDialog } from './components.js';
import { lecteurPdfIntegre, pagesPdfNode } from '../export/preview.js';

const XLSX = sheetjs && sheetjs.utils ? sheetjs : sheetjs.default;

/** Au-dela, la grille Excel n'affiche qu'un extrait : le reste est garde tel quel. */
const MAX_LIGNES = 1000;
const MAX_COLONNES = 60;

/** Date et heure lisibles. */
function quand(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Ouvre une piece.
 * @param {object} piece  fiche de la piece (core/pieces.js)
 * @param {object} opts
 * @param {boolean} opts.peutModifier
 * @param {(octets:Uint8Array) => Promise<void>} opts.enregistrer  range la nouvelle version
 */
export async function ouvrirPiece(piece, { peutModifier = false, enregistrer } = {}) {
  const octets = await octetsPiece(piece.id);
  if (!octets) {
    toast('Fichier absent de cet appareil : synchronisez avec l’appareil qui l’a reçu.', 'err', 5000);
    return;
  }
  const format = FORMATS[piece.type] || { libelle: 'Fichier', icone: '📄' };
  const peutEcrire = peutModifier && modifiable(piece) && typeof enregistrer === 'function';
  const surPC = !!(window.pduDesktop && window.pduDesktop.pieceOuvrir);

  const corps = el('<div class="pjCorps"></div>');
  const entete = el(
    '<div class="apercuEntete">' +
      `<span>${format.icone} <b>${esc(piece.nom)}</b></span>` +
      `<span>Format : <b>${esc(format.libelle)}</b></span>` +
      `<span>Taille : <b>${esc(taillePiece(octets.length))}</b></span>` +
      (piece.modifieLe ? `<span>Modifié par <b>${esc(piece.modifiePar || '—')}</b> le ${esc(quand(piece.modifieLe))}</span>` : '') +
    '</div>'
  );
  corps.appendChild(entete);
  const bandeau = el('<div class="pjBandeau" hidden></div>');
  corps.appendChild(bandeau);
  const zone = el('<div class="pjZone"></div>');
  corps.appendChild(zone);

  // Versions precedentes, a telecharger.
  if ((piece.versions || []).length) {
    const v = el(
      `<details class="pjVersions"><summary>Versions précédentes (${piece.versions.length})</summary>` +
      piece.versions.slice().reverse().map((x, i) =>
        `<button type="button" class="miniBtn" data-v="${i}" style="background:#5b7178">⬇ ${esc(quand(x.date) || 'version d’origine')}` +
        `${x.par ? ` — ${esc(x.par)}` : ''}</button>`).join('') +
      '</details>'
    );
    v.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = async () => {
        const x = piece.versions.slice().reverse()[Number(b.dataset.v)];
        const o = await octetsPiece(x.id);
        if (!o) return toast('Cette version est absente de cet appareil.', 'err');
        const nom = piece.nom.replace(/(\.[^.]+)$/, ` (version ${(quand(x.date) || 'origine').replace(/[/:]/g, '-')})$1`);
        await saveFile(nom, o, mimeDe(piece));
      };
    });
    entete.appendChild(v);
  }

  // Afficher (ou modifier) le contenu.
  let editeur = null;
  const afficher = async () => {
    zone.innerHTML = '';
    editeur = null;
    if (piece.type === 'pdf') {
      if (lecteurPdfIntegre()) {
        const url = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
        zone.appendChild(el(`<iframe class="apercuCadre" src="${url}#toolbar=1&navpanes=0"></iframe>`));
        modal.urls.push(url);
      } else zone.appendChild(pagesPdfNode(octets));
    } else if (piece.type === 'word') {
      zone.appendChild(await vueWord(octets));
    } else if (piece.type === 'excel') {
      zone.appendChild(vueExcel(octets, false).noeud);
    }
  };

  const boutons = [
    { label: '⬇ Enregistrer une copie', cls: 'cancel', onClick: () => saveFile(piece.nom, octets, mimeDe(piece)) }
  ];
  if (surPC) {
    boutons.push({
      label: `Ouvrir dans ${piece.type === 'pdf' ? 'le lecteur PDF' : format.libelle}`,
      cls: 'cancel',
      onClick: () => ouvrirSurLePC(piece, octets, bandeau, peutEcrire ? enregistrer : null, modal)
    });
  }
  if (peutEcrire) {
    boutons.push({
      label: '✎ Modifier',
      cls: 'ok',
      onClick: async () => {
        modal.root.querySelector('.foot').style.display = 'none';
        zone.innerHTML = '';
        editeur = piece.type === 'word' ? await editeurWord(octets) : vueExcel(octets, true);
        zone.appendChild(barreEdition(editeur, {
          annuler: async () => { modal.root.querySelector('.foot').style.display = ''; await afficher(); },
          enregistrer: async () => {
            const nouveaux = await editeur.octets();
            await enregistrer(nouveaux);
            toast('Modifications enregistrées : nouvelle version de la pièce.', 'ok');
            modal.close();
          }
        }));
        zone.appendChild(editeur.noeud);
      }
    });
  }
  boutons.push({ label: 'Fermer', cls: 'ok', onClick: (close) => close() });

  const modal = openModal({
    title: piece.nom,
    bodyNode: corps,
    wide: true,
    buttons: boutons,
    onClose: () => modal.urls.forEach((u) => URL.revokeObjectURL(u))
  });
  modal.urls = [];
  await afficher();
}

/* ---------------------- Ouvrir dans le logiciel du PC ---------------------- */

async function ouvrirSurLePC(piece, octets, bandeau, enregistrer, modal) {
  const res = await window.pduDesktop.pieceOuvrir(piece.nom, Array.from(octets));
  if (!res || !res.ok) {
    toast(`Ouverture impossible : ${(res && res.erreur) || 'aucun logiciel pour ce fichier'}.`, 'err', 5000);
    return;
  }
  const logiciel = piece.type === 'word' ? 'Word' : piece.type === 'excel' ? 'Excel' : 'le lecteur PDF';
  bandeau.hidden = false;
  bandeau.innerHTML = '';
  if (!enregistrer) {
    bandeau.appendChild(el(`<span>Le fichier est ouvert dans ${esc(logiciel)}.</span>`));
    return;
  }
  bandeau.appendChild(el(
    `<span>Le fichier est ouvert dans ${esc(logiciel)}. Modifiez-le, <b>enregistrez-le dans ${esc(logiciel)}</b>, ` +
    'puis reprenez les modifications ici.</span>'
  ));
  const b = el('<button type="button" class="miniBtn" style="background:#008A3B">↻ Reprendre les modifications</button>');
  b.onclick = async () => {
    const relu = await window.pduDesktop.pieceRelire(res.chemin);
    if (!relu) return toast('La copie de travail est introuvable.', 'err');
    const nouveaux = new Uint8Array(relu);
    const identique = nouveaux.length === octets.length && nouveaux.every((x, i) => x === octets[i]);
    if (identique) return toast(`Aucune modification enregistrée dans ${logiciel} pour l’instant.`, 'info', 4000);
    await enregistrer(nouveaux);
    toast('Modifications reprises : nouvelle version de la pièce.', 'ok');
    modal.close();
  };
  bandeau.appendChild(b);
}

/* --------------------------------- Word --------------------------------- */

async function chargerMammoth() {
  const m = await import('mammoth/mammoth.browser.min.js');
  return m.convertToHtml ? m : m.default;
}

async function htmlDuWord(octets) {
  const mammoth = await chargerMammoth();
  const res = await mammoth.convertToHtml({ arrayBuffer: octets.slice().buffer });
  return res.value || '<p></p>';
}

async function vueWord(octets) {
  const page = el('<div class="pjPapier"><div class="docPage"><p class="apercuNote">Ouverture du document…</p></div></div>');
  try {
    page.firstChild.innerHTML = await htmlDuWord(octets);
  } catch (e) {
    console.error(e);
    page.firstChild.innerHTML = '<p>Le document n’a pas pu être lu. Enregistrez une copie pour l’ouvrir dans Word.</p>';
  }
  return page;
}

async function editeurWord(octets) {
  const page = await vueWord(octets);
  const doc = page.firstChild;
  doc.contentEditable = 'true';
  doc.spellcheck = true;
  return {
    noeud: page,
    outils: [
      { t: 'B', titre: 'Gras', cmd: 'bold', style: 'font-weight:800' },
      { t: 'I', titre: 'Italique', cmd: 'italic', style: 'font-style:italic' },
      { t: 'S', titre: 'Souligné', cmd: 'underline', style: 'text-decoration:underline' },
      { t: 'Titre 1', titre: 'Titre 1', cmd: 'formatBlock', val: 'H1' },
      { t: 'Titre 2', titre: 'Titre 2', cmd: 'formatBlock', val: 'H2' },
      { t: '¶', titre: 'Paragraphe', cmd: 'formatBlock', val: 'P' },
      { t: '• Liste', titre: 'Liste à puces', cmd: 'insertUnorderedList' },
      { t: '1. Liste', titre: 'Liste numérotée', cmd: 'insertOrderedList' },
      { t: '⯇', titre: 'Aligner à gauche', cmd: 'justifyLeft' },
      { t: '≡', titre: 'Centrer', cmd: 'justifyCenter' },
      { t: '⯈', titre: 'Aligner à droite', cmd: 'justifyRight' },
      { t: '↶', titre: 'Annuler', cmd: 'undo' },
      { t: '↷', titre: 'Rétablir', cmd: 'redo' }
    ].map((o) => Object.assign(o, { action: () => { doc.focus(); document.execCommand(o.cmd, false, o.val ? `<${o.val}>` : null); } })),
    avertissement: 'La mise en forme courante est conservée (titres, gras, listes, tableaux, images). ' +
      'Les en-têtes, pieds de page et styles particuliers du document peuvent être simplifiés' +
      (window.pduDesktop && window.pduDesktop.pieceOuvrir ? ' : pour les garder, utilisez « Ouvrir dans Word ».' : '.'),
    octets: async () => {
      const { htmlVersDocx } = await import('../export/htmlVersDocx.js');
      return htmlVersDocx(doc);
    }
  };
}

/* --------------------------------- Excel -------------------------------- */

const lettreCol = (c) => XLSX.utils.encode_col(c);

/** Valeur numerique d'une cellule pour un calcul (0 si vide ou texte). */
function valeurNum(ws, ref) {
  const c = ws[ref.toUpperCase()];
  return c && typeof c.v === 'number' ? c.v : 0;
}

/**
 * Calcule les formules simples saisies dans l'application : references de
 * cellules, + − × ÷, parentheses et SUM / SOMME d'une plage. La
 * bibliotheque Excel ne calcule pas les formules : sans cela, une formule
 * tapee ici afficherait 0 jusqu'a l'ouverture dans Excel. Une formule
 * plus elaboree garde sa valeur vide ; Excel la calculera a l'ouverture.
 */
export function calculerFormule(ws, formule) {
  let f = String(formule || '').replace(/\$/g, '');
  f = f.replace(/\b(?:SUM|SOMME)\(\s*([A-Z]{1,3}\d+)\s*:\s*([A-Z]{1,3}\d+)\s*\)/gi, (_, a, b) => {
    const r = XLSX.utils.decode_range(`${a.toUpperCase()}:${b.toUpperCase()}`);
    let s = 0;
    for (let l = r.s.r; l <= r.e.r; l += 1) for (let c = r.s.c; c <= r.e.c; c += 1) s += valeurNum(ws, XLSX.utils.encode_cell({ r: l, c }));
    return `(${s})`;
  });
  f = f.replace(/\b[A-Z]{1,3}\d+\b/gi, (ref) => `(${valeurNum(ws, ref)})`).replace(/,/g, '.');
  if (!/^[\d.\s+\-*/()]+$/.test(f)) return undefined;
  try {
    // Le texte ne contient plus que des chiffres et des operateurs.
    const v = Function(`"use strict";return (${f});`)();
    return Number.isFinite(v) ? v : undefined;
  } catch (e) {
    return undefined;
  }
}

/** Une saisie de cellule en valeur Excel : formule, nombre, ou texte. */
function poserCellule(ws, adresse, texte) {
  const ancienne = ws[adresse];
  const t = String(texte).replace(/ /g, ' ').trim();
  if (!t) {
    if (ancienne && ancienne.s) ws[adresse] = { t: 'z', s: ancienne.s };
    else delete ws[adresse];
    return;
  }
  const cell = { s: ancienne && ancienne.s, z: ancienne && ancienne.z };
  if (t.startsWith('=')) {
    cell.f = t.slice(1);
    const v = calculerFormule(ws, cell.f);
    if (v !== undefined) { cell.t = 'n'; cell.v = v; } else { cell.t = 's'; cell.v = ''; }
  } else {
    // « 1 234,50 » ou « 1234.5 » : un nombre ; tout le reste reste du texte.
    const n = /^-?[\d\s]+([.,]\d+)?$/.test(t) ? Number(t.replace(/\s/g, '').replace(',', '.')) : NaN;
    if (!Number.isNaN(n)) { cell.t = 'n'; cell.v = n; } else { cell.t = 's'; cell.v = t; }
  }
  if (!cell.s) delete cell.s;
  if (!cell.z) delete cell.z;
  ws[adresse] = cell;
}

function vueExcel(octets, edition) {
  const wb = XLSX.read(octets, { type: 'array', cellStyles: true, cellFormula: true, cellDates: false });
  const noeud = el('<div class="pjClasseur"><div class="pjOnglets"></div><div class="pjGrille"></div></div>');
  const onglets = noeud.querySelector('.pjOnglets');
  const grille = noeud.querySelector('.pjGrille');
  let feuille = wb.SheetNames[0];
  const modifiees = new Set();

  const dessiner = () => {
    onglets.innerHTML = '';
    wb.SheetNames.forEach((nom) => {
      const b = el(`<button type="button" class="pjOnglet${nom === feuille ? ' actif' : ''}">${esc(nom)}</button>`);
      b.onclick = () => { feuille = nom; dessiner(); };
      onglets.appendChild(b);
    });
    const ws = wb.Sheets[feuille];
    const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    const derL = Math.min(ref.e.r, MAX_LIGNES - 1);
    const derC = Math.min(ref.e.c, MAX_COLONNES - 1);
    let html = '<table class="pjTable"><thead><tr><th></th>';
    for (let c = 0; c <= derC; c += 1) html += `<th>${lettreCol(c)}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r <= derL; r += 1) {
      html += `<tr><th>${r + 1}</th>`;
      for (let c = 0; c <= derC; c += 1) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        // En modification, une formule se montre telle quelle : on la retouche, pas son resultat.
        let texte = !cell ? '' : edition && cell.f ? `=${cell.f}` : (cell.w !== undefined ? cell.w : cell.v !== undefined ? String(cell.v) : '');
        // Une formule sans resultat enregistre : on la calcule si elle est simple.
        if (cell && cell.f && !edition && (cell.v === undefined || cell.v === '')) {
          const v = calculerFormule(ws, cell.f);
          texte = v !== undefined ? String(v) : `=${cell.f}`;
        }
        const nombre = cell && cell.t === 'n';
        html += `<td data-r="${r}" data-c="${c}"${edition ? ' contenteditable="true"' : ''}${nombre ? ' class="nb"' : ''}>${esc(texte)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (ref.e.r >= MAX_LIGNES || ref.e.c >= MAX_COLONNES) {
      html += `<p class="apercuNote">Extrait : ${MAX_LIGNES} lignes et ${MAX_COLONNES} colonnes au plus sont affichées. Le reste de la feuille est conservé.</p>`;
    }
    grille.innerHTML = html;
    if (edition) {
      grille.querySelectorAll('td[contenteditable]').forEach((td) => {
        td.addEventListener('input', () => { td.classList.add('modifiee'); modifiees.add(`${feuille}|${td.dataset.r}|${td.dataset.c}`); });
        td.addEventListener('blur', () => {
          if (!td.classList.contains('modifiee')) return;
          poserCellule(ws, XLSX.utils.encode_cell({ r: Number(td.dataset.r), c: Number(td.dataset.c) }), td.innerText);
        });
        td.addEventListener('keydown', (e) => {
          // Entree passe a la cellule du dessous, comme dans Excel.
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          const dessous = grille.querySelector(`td[data-r="${Number(td.dataset.r) + 1}"][data-c="${td.dataset.c}"]`);
          if (dessous) dessous.focus(); else td.blur();
        });
      });
    }
  };

  /** Agrandit la plage de la feuille d'une ligne ou d'une colonne. */
  const agrandir = (lignes, colonnes) => {
    const ws = wb.Sheets[feuille];
    const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    ref.e.r += lignes;
    ref.e.c += colonnes;
    ws['!ref'] = XLSX.utils.encode_range(ref);
    dessiner();
  };

  dessiner();
  return {
    noeud,
    outils: [
      { t: '+ Ligne', titre: 'Ajouter une ligne en bas', action: () => agrandir(1, 0) },
      { t: '+ Colonne', titre: 'Ajouter une colonne à droite', action: () => agrandir(0, 1) }
    ],
    avertissement: 'Cliquez dans une cellule pour la modifier ; « = » commence une formule. ' +
      'Les valeurs et formules sont conservées ; certaines mises en forme du classeur peuvent être simplifiées' +
      (window.pduDesktop && window.pduDesktop.pieceOuvrir ? ' : pour les garder, utilisez « Ouvrir dans Excel ».' : '.'),
    octets: async () => {
      // La cellule en cours de saisie n'a pas encore ete quittee.
      if (document.activeElement && grille.contains(document.activeElement)) document.activeElement.blur();
      // Les formules simples se recalculent : une cellule dont elles
      // dependent a pu changer apres elles. Deux passes suffisent aux
      // formules qui en citent d'autres.
      if (modifiees.size) {
        for (let passe = 0; passe < 2; passe += 1) {
          wb.SheetNames.forEach((nom) => {
            const ws = wb.Sheets[nom];
            Object.keys(ws).filter((k) => k[0] !== '!' && ws[k].f).forEach((k) => {
              const v = calculerFormule(ws, ws[k].f);
              if (v !== undefined) { ws[k].t = 'n'; ws[k].v = v; delete ws[k].w; }
            });
          });
        }
      }
      const sortie = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
      return new Uint8Array(sortie);
    }
  };
}

/* --------------------------- Barre d'edition ---------------------------- */

function barreEdition(editeur, { annuler, enregistrer }) {
  const barre = el('<div class="pjBarre"><div class="pjOutils"></div><div class="pjActions"></div></div>');
  const outils = barre.querySelector('.pjOutils');
  editeur.outils.forEach((o) => {
    const b = el(`<button type="button" class="pjOutil" title="${esc(o.titre)}"${o.style ? ` style="${o.style}"` : ''}>${esc(o.t)}</button>`);
    // Garder la selection du document : le clic ne doit pas lui voler le focus.
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = o.action;
    outils.appendChild(b);
  });
  const actions = barre.querySelector('.pjActions');
  const bAnnuler = el('<button type="button" class="miniBtn" style="background:#5b7178">Annuler</button>');
  const bEnr = el('<button type="button" class="miniBtn" style="background:#008A3B">💾 Enregistrer les modifications</button>');
  bAnnuler.onclick = async () => {
    if (await confirmDialog({ title: 'Abandonner les modifications', message: 'Les modifications non enregistrées seront perdues.', okLabel: 'Abandonner', danger: true })) annuler();
  };
  bEnr.onclick = async () => {
    bEnr.disabled = true;
    bEnr.textContent = 'Enregistrement…';
    try {
      await enregistrer();
    } catch (e) {
      console.error(e);
      toast('L’enregistrement a échoué.', 'err');
      bEnr.disabled = false;
      bEnr.textContent = '💾 Enregistrer les modifications';
    }
  };
  actions.appendChild(bAnnuler);
  actions.appendChild(bEnr);
  barre.appendChild(el(`<p class="pjAvert">${esc(editeur.avertissement)}</p>`));
  return barre;
}
