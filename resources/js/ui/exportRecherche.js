/* ===================================================================
   Export du resultat d'une recherche.

   La recherche de l'en-tete masque les lignes qui ne correspondent pas
   (shell.js, applyLocalFilter). L'export reprend ce qui reste a l'ecran :
   chaque tableau de la page, avec ses colonnes et ses seules lignes
   trouvees, et les fiches de la RECHERCHE GLOBALE (type, titre, detail).
   Les colonnes de boutons (Fiche, ✎, ✕) n'y passent pas.
   =================================================================== */

import { exportExcel } from '../export/excel.js';
import { exportPdf } from '../export/pdf.js';
import { exportWord } from '../export/word.js';
import { ouvrirMenuChoix, pdfDisponible, toast } from './components.js';

/** Un element est-il affiche (ni lui ni un parent masque par la recherche) ? */
function affiche(node) {
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    if (n.style && n.style.display === 'none') return false;
    if (n.hidden) return false;
  }
  return true;
}

/**
 * Texte d'une cellule : sans ses boutons ni ses pictogrammes (🟢, 📍, ✎),
 * un <br> devenant un retour a la ligne. Un element marque `data-export`
 * (un bouton « Marquer payée ») s'exporte sous le texte qu'il donne.
 */
function texteCellule(cellule) {
  const c = cellule.cloneNode(true);
  c.querySelectorAll('[data-export]').forEach((x) => x.replaceWith(x.dataset.export));
  c.querySelectorAll('button, select, input, textarea, [data-fiche]').forEach((x) => x.remove());
  c.querySelectorAll('br').forEach((x) => x.replaceWith('\n'));
  return c.textContent
    .split('\n')
    .map((l) => l.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * « 12 500 » ou « 1 865 » se lisent comme des nombres dans le classeur ;
 * « 25 000 F » ou « 03/08/2026 » restent du texte, tels qu'a l'ecran.
 */
function valeur(texte) {
  const t = texte.replace(/[\s  ]/g, '');
  return /^-?\d+(,\d+)?$/.test(t) ? Number(t.replace(',', '.')) : texte;
}

/**
 * Le titre d'un tableau : le bandeau de section juste au-dessus, sinon la
 * page et sa sous-rubrique ouverte (MISSION — TABLEAU DE SUIVI).
 */
function titreDe(wrap, contenu, titrePage) {
  const avant = wrap.previousElementSibling;
  if (avant && avant.matches('.groupHeader')) return avant.textContent.replace(/\s+/g, ' ').trim();
  const onglet = contenu.querySelector('.subtab.active');
  return onglet ? `${titrePage} — ${onglet.textContent.trim()}` : titrePage;
}

const largeur = (textes) => Math.max(10, Math.min(40, Math.max(...textes.map((t) => String(t).split('\n').reduce((m, l) => Math.max(m, l.length), 0))) + 2));

/**
 * Les jeux de donnees du resultat affiche.
 * @param {HTMLElement} contenu  la zone de contenu de la page
 * @param {string} titrePage
 * @returns {{title:string, columns:object[], rows:object[]}[]}
 */
export function jeuxDuResultat(contenu, titrePage) {
  const jeux = [];

  contenu.querySelectorAll('.tableWrap').forEach((wrap) => {
    const table = wrap.querySelector('table.dataTable');
    if (!table || !affiche(wrap)) return;
    // Seules les lignes que la recherche a parcourues — et gardees.
    const lignes = [...table.querySelectorAll('tbody > tr')].filter((tr) => tr.dataset.search !== undefined && affiche(tr));
    if (!lignes.length) return;
    const entetes = [...table.querySelectorAll('thead th')].map(texteCellule).map((h) => h.replace(/\n/g, ' '));
    const cellules = lignes.map((tr) => [...tr.children].map(texteCellule));
    // Une colonne sans titre ni contenu n'est qu'une colonne de boutons.
    const gardees = entetes
      .map((h, i) => i)
      .filter((i) => entetes[i] || cellules.some((l) => l[i]));
    const columns = gardees.map((i) => ({
      key: `c${i}`,
      label: entetes[i] || '—',
      width: largeur([entetes[i] || '', ...cellules.map((l) => l[i] || '')])
    }));
    jeux.push({
      title: titreDe(wrap, contenu, titrePage),
      columns,
      rows: cellules.map((l) => Object.fromEntries(gardees.map((i) => [`c${i}`, valeur(l[i] || '')])))
    });
  });

  // Les fiches (RECHERCHE GLOBALE, passages au garage...) : un tableau de plus.
  const fiches = [...contenu.querySelectorAll('.entry')]
    .filter((e) => (e.dataset.search !== undefined || e.dataset.resultat !== undefined) && affiche(e));
  if (fiches.length) {
    const rows = fiches.map((e) => ({
      type: e.querySelector('.badge') ? texteCellule(e.querySelector('.badge')) : '',
      titre: e.querySelector('h4') ? texteCellule(e.querySelector('h4')) : '',
      detail: e.querySelector('.meta') ? texteCellule(e.querySelector('.meta')) : ''
    }));
    jeux.push({
      title: titrePage,
      columns: [
        { key: 'type', label: 'Type', width: 16 },
        { key: 'titre', label: 'Titre', width: largeur(rows.map((r) => r.titre)) },
        { key: 'detail', label: 'Détail', width: Math.max(30, largeur(rows.map((r) => r.detail))) }
      ],
      rows
    });
  }
  return jeux;
}

/** Nombre de lignes du resultat affiche (pour le libelle du bouton). */
export function tailleDuResultat(contenu) {
  return jeuxDuResultat(contenu, '').reduce((t, j) => t + j.rows.length, 0);
}

/**
 * Ouvre la liste Excel / PDF / Word sous le bouton, puis exporte.
 * @param {HTMLElement} bouton
 * @param {HTMLElement} contenu
 * @param {string} titrePage
 * @param {string} recherche  le texte cherche
 */
export function ouvrirExportRecherche(bouton, contenu, titrePage, recherche) {
  const lancer = async (kind) => {
    const datasets = jeuxDuResultat(contenu, titrePage);
    if (!datasets.length) { toast('Aucun résultat à exporter.', 'info'); return; }
    const titre = `${titrePage} — recherche « ${recherche.trim()} »`;
    const nom = `PDU_recherche_${recherche.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 30) || 'resultat'}`;
    try {
      const res = kind === 'excel'
        ? await exportExcel(datasets, nom)
        : kind === 'word'
          ? await exportWord(datasets, nom, { title: titre, enchaine: true })
          : await exportPdf(datasets, nom, { title: titre, enchaine: true });
      toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
    } catch (e) {
      console.error(e);
      toast("L'export a échoué.", 'err');
    }
  };
  ouvrirMenuChoix(bouton, [
    { label: 'Excel', detail: 'Le résultat de la recherche, en classeur', onClick: () => lancer('excel') },
    pdfDisponible() && { label: 'PDF', detail: 'Le résultat de la recherche, en PDF', onClick: () => lancer('pdf') },
    { label: 'Word', detail: 'Le résultat de la recherche, en document Word', onClick: () => lancer('word') }
  ]);
}
