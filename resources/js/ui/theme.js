/* ===================================================================
   APPARENCE — le style de l'interface, choisi dans REGLAGES.

   Le choix est propre a l'appareil : il est garde sur le poste (ou le
   telephone), pas dans la base, et ne passe donc pas par la
   synchronisation. Chacun regle l'ecran qu'il a sous les yeux.

   Un style n'est qu'un attribut sur la page (`data-theme`) ; la feuille de
   style fait le reste. Les graphiques, dessines par Chart.js, recoivent la
   couleur de texte du style.
   =================================================================== */

import Chart from 'chart.js/auto';
// Vignettes des decors de la page de connexion (REGLAGES → Apparence).
import apercuItineraires from '../styles/decor/itineraires-gauche.svg';
import apercuPagne from '../styles/decor/pagne-gauche.svg';
import apercuVagues from '../styles/decor/vagues-gauche.svg';
import apercuTableau from '../styles/decor/tableau-gauche.svg';
import apercuCampus from '../styles/decor/campus-gauche.svg';

export const THEMES = [
  { id: 'classique', nom: 'Lumineux 3D', detail: 'L’interface actuelle : lumineuse, avec relief.', apercu: ['#ffffff', '#008A3B', '#F47B20', '#f3f8f6'] },
  { id: 'moderne', nom: 'Moderne et lumineux', detail: 'En-tête vert dégradé, icônes, cartes douces et aérées.', apercu: ['#00a650', '#ffffff', '#e7f6ee', '#f4f7f8'] },
  { id: 'institutionnel', nom: 'Institutionnel PDU', detail: 'Sobre et officiel : bandeau vert et filet orange.', apercu: ['#00632b', '#F47B20', '#f3f5f4', '#ffffff'] },
  { id: 'colore', nom: 'Coloré et chaleureux', detail: 'Chaque rubrique dans sa couleur vive, grands chiffres.', apercu: ['#C2185B', '#1976D2', '#F47B20', '#fff5f9'] },
  { id: 'sombre', nom: 'Mode sombre', detail: 'Fond sombre, reposant le soir et en faible lumière.', apercu: ['#0f1a1e', '#16262d', '#3cc47a', '#e04387'] }
];

const CLE = 'pdu_theme';

/* --------------------- Decor de la page de connexion ---------------- */

export const DECORS = [
  { id: '', nom: 'Sans décor', detail: 'La page de connexion telle qu’elle était.', apercu: '' },
  { id: 'itineraires', nom: 'Itinéraires', detail: 'Routes de Côte d’Ivoire et étapes de mission, sur fond de relief.', apercu: apercuItineraires },
  { id: 'pagne', nom: 'Pagne', detail: 'Motif tissé inspiré des pagnes ivoiriens, aux couleurs du PDU.', apercu: apercuPagne },
  { id: 'vagues', nom: 'Vagues', detail: 'Orange, blanc, vert : les couleurs du drapeau en ondes douces.', apercu: apercuVagues },
  { id: 'tableau', nom: 'Tableau de bord', detail: 'Compteur, volant, pompe et clé : l’univers du parc, en trait fin.', apercu: apercuTableau },
  { id: 'campus', nom: 'Campus', detail: 'Université, palmiers et soleil : l’esprit du PDU.', apercu: apercuCampus }
];

const CLE_DECOR = 'pdu_decor_connexion';

/** Le decor retenu sur cet appareil (vide : sans decor). */
export function decorActuel() {
  try {
    const d = localStorage.getItem(CLE_DECOR) || '';
    return DECORS.some((x) => x.id === d) ? d : '';
  } catch (e) {
    return '';
  }
}

export function choisirDecor(id) {
  try { localStorage.setItem(CLE_DECOR, id || ''); } catch (e) { /* vaut pour la session */ }
}

/* ------------------------ Taille de l'affichage --------------------- */

const CLE_ZOOM = 'pdu_zoom';
export const ZOOM_MIN = 70;
export const ZOOM_MAX = 160;
export const ZOOM_PAS = 10;

/** La taille d'affichage retenue sur cet appareil, en pour cent. */
export function zoomActuel() {
  try {
    const z = Number(localStorage.getItem(CLE_ZOOM));
    return z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 100;
  } catch (e) {
    return 100;
  }
}

/**
 * Agrandit ou reduit toute l'application, comme le zoom d'un navigateur,
 * et retient la taille sur cet appareil.
 */
export function appliquerZoom(z = zoomActuel()) {
  const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(Number(z) / ZOOM_PAS) * ZOOM_PAS || 100));
  document.documentElement.style.zoom = v === 100 ? '' : String(v / 100);
  try { localStorage.setItem(CLE_ZOOM, String(v)); } catch (e) { /* la taille vaut pour la session */ }
  corrigerHauteurEcran();
  return v;
}

/**
 * Sous un zoom, « 100vh » ne vaut plus forcement la hauteur de l'ecran :
 * selon la version du navigateur, il est agrandi avec le reste. Une
 * fenetre de formulaire deborderait alors, boutons hors d'atteinte. On
 * mesure ce que vaut 100vh et on en tire le facteur qui le ramene a
 * l'ecran (--k-ecran, utilise par la feuille de style).
 */
function corrigerHauteurEcran() {
  const racine = document.documentElement;
  racine.style.setProperty('--k-ecran', '1');
  if (!racine.style.zoom || !document.body) return;
  const sonde = document.createElement('div');
  sonde.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:100vh;visibility:hidden;pointer-events:none';
  document.body.appendChild(sonde);
  const h = sonde.getBoundingClientRect().height;
  sonde.remove();
  if (h > 0) racine.style.setProperty('--k-ecran', String(window.innerHeight / h));
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => corrigerHauteurEcran());
  window.addEventListener('DOMContentLoaded', () => corrigerHauteurEcran());
}

/** Le style retenu sur cet appareil. */
export function themeActuel() {
  try {
    const t = localStorage.getItem(CLE);
    return THEMES.some((x) => x.id === t) ? t : 'classique';
  } catch (e) {
    return 'classique';
  }
}

/** Applique un style et le retient sur cet appareil. */
export function appliquerTheme(id = themeActuel()) {
  const t = THEMES.some((x) => x.id === id) ? id : 'classique';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(CLE, t); } catch (e) { /* stockage indisponible : le style vaut pour la session */ }
  // Les graphiques ne lisent pas la feuille de style : on leur passe la
  // couleur du texte et des lignes du style choisi.
  const sombre = t === 'sombre';
  Chart.defaults.color = sombre ? '#a9bdc4' : '#5b7178';
  Chart.defaults.borderColor = sombre ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.08)';
  // La barre du navigateur (et d'Android) prend la teinte du style.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', sombre ? '#0f1a1e' : t === 'institutionnel' ? '#00632b' : '#008A3B');
  return t;
}
