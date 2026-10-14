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

export const THEMES = [
  { id: 'classique', nom: 'Lumineux 3D', detail: 'L’interface actuelle : lumineuse, avec relief.', apercu: ['#ffffff', '#008A3B', '#F47B20', '#f3f8f6'] },
  { id: 'moderne', nom: 'Moderne et lumineux', detail: 'En-tête vert dégradé, icônes, cartes douces et aérées.', apercu: ['#00a650', '#ffffff', '#e7f6ee', '#f4f7f8'] },
  { id: 'institutionnel', nom: 'Institutionnel PDU', detail: 'Sobre et officiel : bandeau vert et filet orange.', apercu: ['#00632b', '#F47B20', '#f3f5f4', '#ffffff'] },
  { id: 'colore', nom: 'Coloré et chaleureux', detail: 'Chaque rubrique dans sa couleur vive, grands chiffres.', apercu: ['#C2185B', '#1976D2', '#F47B20', '#fff5f9'] },
  { id: 'sombre', nom: 'Mode sombre', detail: 'Fond sombre, reposant le soir et en faible lumière.', apercu: ['#0f1a1e', '#16262d', '#3cc47a', '#e04387'] }
];

const CLE = 'pdu_theme';

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
