/* ===================================================================
   Barre de defilement horizontal flottante.

   Un tableau plus large que l'ecran a sa barre de defilement tout en bas :
   sur une longue liste, il fallait descendre jusqu'a la derniere ligne
   pour aller voir les colonnes de droite. Tant que cette barre est cachee
   sous le bas de l'ecran, une copie flotte en bas de la zone visible, a la
   largeur du tableau ; les deux bougent ensemble. Elle disparait des que
   la vraie barre redevient visible.

   Une seule barre pour toute l'application : elle suit le premier tableau
   concerne a l'ecran (rubriques et fenetres).
   =================================================================== */

/** Ce qui fait defiler un tableau en largeur. */
const TABLEAUX = '.tableWrap';
/** Les zones qui font defiler la page en hauteur. */
const ZONES = '#content, .modal .body';

let barre = null;
let largeur = null;
let suivi = null;
let attente = false;

function creer() {
  barre = document.createElement('div');
  barre.className = 'barreFlottante';
  largeur = document.createElement('div');
  barre.appendChild(largeur);
  // Chacune suit l'autre ; a position egale, rien ne bouge, donc pas de
  // va-et-vient sans fin.
  barre.addEventListener('scroll', () => {
    if (suivi && suivi.scrollLeft !== barre.scrollLeft) suivi.scrollLeft = barre.scrollLeft;
  }, { passive: true });
  document.body.appendChild(barre);
}

/** Bas de la zone visible pour ce tableau : la fenetre, ou la zone qui defile. */
function basVisible(wrap) {
  const zone = wrap.closest(ZONES);
  let bas = Math.min(zone ? zone.getBoundingClientRect().bottom : window.innerHeight, window.innerHeight);
  // Sur un ecran etroit, les rubriques passent en bandeau en bas de
  // l'ecran, par-dessus la page : la barre se pose juste au-dessus.
  const menu = !wrap.closest('.modalBack') && document.querySelector('nav.tabs');
  if (menu) {
    const m = menu.getBoundingClientRect();
    if (m.height && m.top > window.innerHeight / 2) bas = Math.min(bas, m.top);
  }
  return bas;
}

/** Le premier tableau large dont la barre est cachee sous le bas de l'ecran. */
function tableauASuivre() {
  // Une fenetre ouverte cache la rubrique : seuls ses propres tableaux
  // comptent, la barre ne vient pas flotter par-dessus elle.
  const fenetres = document.querySelectorAll('.modalBack');
  const racine = fenetres.length ? fenetres[fenetres.length - 1] : document;
  for (const wrap of racine.querySelectorAll(TABLEAUX)) {
    if (wrap.scrollWidth <= wrap.clientWidth + 1 || !wrap.offsetParent) continue;
    const r = wrap.getBoundingClientRect();
    const bas = basVisible(wrap);
    // Assez de tableau a l'ecran pour que la barre serve, et sa vraie
    // barre en dessous du bord.
    if (r.top < bas - 60 && r.bottom > bas) return { wrap, r, bas };
  }
  return null;
}

function placer() {
  attente = false;
  const t = tableauASuivre();
  if (!t) {
    if (barre) barre.style.display = 'none';
    suivi = null;
    return;
  }
  if (!barre) creer();
  if (suivi !== t.wrap) {
    if (suivi) suivi.removeEventListener('scroll', suivreTableau);
    suivi = t.wrap;
    suivi.addEventListener('scroll', suivreTableau, { passive: true });
  }
  barre.style.display = 'block';
  barre.style.left = `${t.r.left}px`;
  barre.style.width = `${t.wrap.clientWidth}px`;
  barre.style.top = `${t.bas - barre.offsetHeight}px`;
  largeur.style.width = `${t.wrap.scrollWidth}px`;
  suivreTableau();
}

function suivreTableau() {
  if (barre && suivi && barre.scrollLeft !== suivi.scrollLeft) barre.scrollLeft = suivi.scrollLeft;
}

/** Une mise a jour par image au plus, quoi qui bouge. */
function demander() {
  if (attente) return;
  attente = true;
  requestAnimationFrame(placer);
}

export function installerBarreFlottante() {
  document.addEventListener('scroll', (e) => { if (e.target !== barre) demander(); }, { capture: true, passive: true });
  window.addEventListener('resize', demander);
  // Une rubrique redessinee, une fenetre ouverte ou fermee, un filtre...
  new MutationObserver(demander).observe(document.body, { childList: true, subtree: true });
  demander();
}
