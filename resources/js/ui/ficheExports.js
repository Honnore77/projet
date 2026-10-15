/* ===================================================================
   Boutons d'export d'une fiche : Excel, PDF et Word, chacun en deux
   versions au choix dans une liste deroulante.

   - simple  : la carte de la fiche, telle qu'on la voit a l'ecran ;
   - complet : la carte, puis tous les historiques (l'export d'avant).
   =================================================================== */

import { COLORS } from './components.js';

/**
 * @param {(kind:'excel'|'pdf'|'word', mode:'simple'|'complet') => void} lancer
 * @returns {object[]} elements de toolbar()
 */
export function menusExportFiche(lancer) {
  const choix = (kind) => [
    { label: `${NOMS[kind]} simple`, detail: 'La carte de la fiche, comme à l’écran', onClick: () => lancer(kind, 'simple') },
    { label: `${NOMS[kind]} complet`, detail: 'La carte et tous les historiques', onClick: () => lancer(kind, 'complet') }
  ];
  return [
    { label: '⬇ Excel', color: COLORS.blue, menu: choix('excel') },
    { label: '⬇ PDF', color: COLORS.red, menu: choix('pdf') },
    { label: '⬇ Word', color: '#2B579A', menu: choix('word') }
  ];
}

const NOMS = { excel: 'Excel', pdf: 'PDF', word: 'Word' };
