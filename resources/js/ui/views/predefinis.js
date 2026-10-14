/* ===================================================================
   RÉGLAGES PRÉDÉFINIS — ouverte à tous les comptes.

   Le style de l'interface et la taille de l'affichage : des choix propres
   à l'appareil, que chacun règle pour l'écran qu'il a sous les yeux, sans
   avoir besoin des droits d'administration de RÉGLAGES.
   =================================================================== */

import { card } from '../components.js';
import { rerender, moduleColor } from '../shell.js';
import { apparenceNode } from '../apparence.js';

export function renderPredefinis(page) {
  page.appendChild(
    card(
      'RÉGLAGES PRÉDÉFINIS',
      'Le style de l’interface et la taille de l’affichage, pour cet appareil. Chacun peut les régler : ' +
      'ils ne changent rien aux données ni aux autres utilisateurs.',
      moduleColor('PREDEFINIS')
    )
  );
  page.appendChild(apparenceNode({ decor: false, surChoix: rerender }));
}
