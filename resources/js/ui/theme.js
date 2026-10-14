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
import apercuTableau from '../styles/decor/tableau-gauche.svg';
import apercuLumiereBleue from '../styles/decor/lumiere-bleue.svg';
import apercuLumierePdu from '../styles/decor/lumiere-pdu.svg';
import apercuFondCristal from '../styles/decor/fond-cristal.svg';
import photoCampus from '../styles/decor/photo-campus.jpg';
import apercuFondCadres from '../styles/decor/fond-cadres.svg';
import apercuFondEclats from '../styles/decor/fond-eclats.svg';
import apercuFondSoie from '../styles/decor/fond-soie.svg';
import apercuFondFaisceaux from '../styles/decor/fond-faisceaux.svg';
import apercuFondAurore from '../styles/decor/fond-aurore.svg';
import apercuFondEau from '../styles/decor/fond-eau.svg';
import apercuFondPrismes from '../styles/decor/fond-prismes.svg';

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
  { id: 'tableau', nom: 'Tableau de bord', detail: 'Compteur, volant, pompe et clé : l’univers du parc, en trait fin.', apercu: apercuTableau },
  { id: 'lumiere-bleue', nom: 'Lumière bleue', detail: 'Toute la page : rubans de lumière, étincelles et bulles, en bleu.', apercu: apercuLumiereBleue, plein: true },
  { id: 'lumiere-pdu', nom: 'Lumière PDU', detail: 'Toute la page : rubans de lumière aux couleurs vert et orange du PDU.', apercu: apercuLumierePdu, plein: true },
  { id: 'photo-campus', nom: 'Campus (photo)', detail: 'Toute la page : photo du campus universitaire.', apercu: photoCampus, plein: true },
  { id: 'fond-cristal', nom: 'Cristal', detail: 'Carrés blancs en relief sur gris clair : sobre et élégant.', apercu: apercuFondCristal, plein: true },
  { id: 'fond-cadres', nom: 'Cadres PDU', detail: 'Cadres en diagonale, orange et vert du PDU, sur fond clair.', apercu: apercuFondCadres, plein: true },
  { id: 'fond-eclats', nom: 'Éclats', detail: 'Triangles en relief, blancs, orange et verts, sur fond clair.', apercu: apercuFondEclats, plein: true },
  { id: 'fond-soie', nom: 'Soie bleue', detail: 'Voiles bleus soyeux traversés de fils de lumière.', apercu: apercuFondSoie, plein: true },
  { id: 'fond-faisceaux', nom: 'Faisceaux', detail: 'Plans de lumière bleue sur fond nuit.', apercu: apercuFondFaisceaux, plein: true },
  { id: 'fond-aurore', nom: 'Aurore', detail: 'Vague rose, poussière dorée et bulles de lumière.', apercu: apercuFondAurore, plein: true },
  { id: 'fond-eau', nom: 'Eau scintillante', detail: 'Eau irisée et bulles de lumière, tons pastel.', apercu: apercuFondEau, plein: true },
  { id: 'fond-prismes', nom: 'Prismes', detail: 'Triangles translucides en haut et en bas, fond clair.', apercu: apercuFondPrismes, plein: true }
];

const CLE_DECOR = 'pdu_decor_connexion';

/** Un fond qui couvre toute la page de connexion (et pas seulement ses cotes). */
export function decorPleinePage(id) {
  const d = DECORS.find((x) => x.id === id);
  return !!(d && d.plein);
}

/** Le decor retenu sur cet appareil (vide : sans decor). */
/** Le fond tant que l'appareil n'en a choisi aucun. */
export const DECOR_PAR_DEFAUT = 'photo-campus';

export function decorActuel() {
  try {
    const d = localStorage.getItem(CLE_DECOR);
    // Jamais choisi : le fond par defaut. « Sans décor » choisi : rien.
    if (d === null) return DECOR_PAR_DEFAUT;
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
