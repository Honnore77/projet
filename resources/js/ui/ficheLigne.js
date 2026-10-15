/* ===================================================================
   Fiche d'une ligne de tableau.

   Les tableaux qui n'ont pas de fiche a eux (vehicule, agent, demande...)
   recoivent un bouton « Fiche » par ligne : la ligne s'ouvre en carte,
   colonne par colonne, et s'exporte en PDF, Excel ou Word, en A4.
   =================================================================== */

import { el, esc } from '../core/utils.js';
import { openModal, toast } from './components.js';
import { exportExcel } from '../export/excel.js';
import { exportFicheWord } from '../export/word.js';
import { exportFicheLignePdf } from '../export/ficheLigne.js';

/** Texte d'un en-tete ou d'une cellule : retours a la ligne gardes, boutons ignores. */
function texteDe(noeud, garderBoutons) {
  const copie = noeud.cloneNode(true);
  copie.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const boutons = [...copie.querySelectorAll('button, input, select, textarea')];
  const texteBoutons = boutons.map((b) => b.textContent.trim()).filter(Boolean).join(' ');
  boutons.forEach((b) => b.remove());
  // Un bloc (div, p) commence une nouvelle ligne.
  copie.querySelectorAll('div, p, li').forEach((d) => d.prepend('\n'));
  // Les pastilles emoji (🟢 Actif, 🔴 Non payée) n'existent pas dans les
  // polices du PDF : le mot qui les suit suffit.
  const sansEmoji = (x) => x.replace(/\p{Extended_Pictographic}️?/gu, '');
  const t = sansEmoji(copie.textContent)
    .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').replace(/^[ \t]+/gm, '').trim();
  return t || (garderBoutons ? sansEmoji(texteBoutons).trim() : '');
}

/** Rubrique et sous-rubrique ouvertes : « VÉHICULES · POOL (2) ». */
function rubriqueAffichee() {
  const titre = document.querySelector('header.top h2');
  const sous = document.querySelector('.subtab.active');
  return [titre && titre.textContent.trim(), sous && sous.textContent.replace(/\s*\(\d+\)\s*$/, '').trim()]
    .filter(Boolean).join(' · ');
}

const nomFichier = (t) => String(t || 'fiche').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'fiche';

/**
 * Lit la ligne du tableau et ouvre sa fiche.
 * @param {HTMLTableRowElement} tr
 * @param {string[]} entetes  textes des en-tetes, '' pour la colonne d'actions
 */
export function ouvrirFicheLigne(tr, entetes) {
  const cellules = [...tr.children];
  const infos = [];
  cellules.forEach((td, i) => {
    const libelle = entetes[i];
    if (!libelle || /^actions?$/i.test(libelle)) return;
    infos.push({ libelle, valeur: texteDe(td, true) || '—' });
  });
  if (!infos.length) return;
  const rubrique = rubriqueAffichee();
  const titre = infos[0].valeur.split('\n')[0];
  const sousTitre = infos[1] && infos[1].valeur !== '—' ? infos[1].valeur.split('\n')[0] : '';
  const fiche = {
    titreDocument: `Fiche${rubrique ? ` — ${rubrique}` : ''}`,
    titre,
    sousTitre,
    infos
  };
  const base = `PDU_fiche_${nomFichier(`${rubrique}_${titre}`)}`;

  const corps = el(
    '<div class="card" style="margin:0;border-left:5px solid var(--green)">' +
      `<div style="color:#5b7178;font-size:12px;font-weight:700;text-transform:uppercase">${esc(rubrique)}</div>` +
      `<h3 style="margin:4px 0 0;color:var(--green)">${esc(titre)}</h3>` +
      (sousTitre ? `<div style="font-size:1.4em;font-weight:800;margin:2px 0 8px">${esc(sousTitre)}</div>` : '<div style="height:8px"></div>') +
      '<div style="display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:4px 14px;font-size:13.5px">' +
        infos.map((l) => `<span style="color:#5b7178">${esc(l.libelle)}</span>` +
          `<b style="overflow-wrap:anywhere;white-space:pre-line">${esc(l.valeur)}</b>`).join('') +
      '</div>' +
    '</div>'
  );

  const lancer = (kind) => exporterFicheInfos(kind, fiche, base);

  openModal({
    title: fiche.titreDocument,
    bodyNode: corps,
    buttons: [
      { label: '⬇ Excel', cls: 'ok', onClick: () => lancer('excel') },
      { label: '⬇ PDF', cls: 'ok', onClick: () => lancer('pdf') },
      { label: '⬇ Word', cls: 'ok', onClick: () => lancer('word') },
      { label: 'Fermer', cls: 'cancel', onClick: (close) => close() }
    ]
  });
}

/**
 * Exporte une fiche « rubrique : valeur » en Excel, PDF ou Word, en A4.
 * @param {'excel'|'pdf'|'word'} kind
 * @param {{titreDocument:string, titre:string, sousTitre?:string, infos:{libelle:string, valeur:string}[]}} fiche
 * @param {string} base  nom de fichier sans extension ni date
 */
export async function exporterFicheInfos(kind, fiche, base) {
  const dataset = {
    title: `Fiche ${fiche.titre || ''}`.slice(0, 31),
    columns: [{ key: 'libelle', label: 'Rubrique', width: 28 }, { key: 'valeur', label: 'Valeur', width: 60 }],
    rows: fiche.infos.map((l) => ({ libelle: l.libelle, valeur: l.valeur }))
  };
  try {
    const res = kind === 'excel'
      ? await exportExcel([dataset], base, { fiche: true })
      : kind === 'word'
        ? await exportFicheWord(Object.assign({ sansPhoto: true }, fiche), base, [dataset])
        : await exportFicheLignePdf(fiche, base);
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

export { nomFichier };

/** Texte brut des en-tetes HTML (« Immat.<br>nouvelle » → « Immat. nouvelle »). */
export function texteEntete(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
  return d.textContent.replace(/\s+/g, ' ').trim();
}
