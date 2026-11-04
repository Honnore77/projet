/* ===================================================================
   Dictionnaire francais des propositions de mots (ui/suggestions.js).

   La liste « an-array-of-french-words » (licence MIT, ~336 000 mots,
   formes conjuguees et accordees comprises) est livree avec l'application :
   elle sert sans connexion. Elle ne se charge qu'a la premiere saisie, dans
   un morceau a part, pour ne pas ralentir le demarrage.

   Les mots y sont ranges par cle sans accent ni casse : un debut de mot se
   cherche alors par dichotomie, sans parcourir toute la liste.
   =================================================================== */

import { norm } from './utils.js';

let cles = null;
let mots = null;
let chargement = null;

/**
 * Range une liste de mots pour la recherche par debut. Les mots de moins
 * de quatre lettres sont laisses : ils se tapent plus vite qu'ils ne se
 * choisissent.
 */
export function preparerDictionnaire(liste) {
  const paires = (liste || []).filter((m) => m.length >= 4).map((m) => [norm(m), m]);
  paires.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  cles = paires.map((p) => p[0]);
  mots = paires.map((p) => p[1]);
}

/** Charge la liste une fois ; les appels suivants rendent la meme promesse. */
export function chargerDictionnaire() {
  if (!chargement) {
    chargement = import('an-array-of-french-words/index.json')
      .then((m) => preparerDictionnaire(m.default || m))
      .catch((e) => { console.error(e); chargement = null; });
  }
  return chargement;
}

export function dictionnairePret() {
  return !!cles;
}

/**
 * Mots du dictionnaire qui commencent par `debut` (sans accent ni casse),
 * les plus courts d'abord : la forme de base passe avant ses conjugaisons
 * (« vidange » avant « vidangeaient »).
 */
export function motsDuDictionnaire(debut, max = 6) {
  const cle = norm(debut);
  if (!cles || !cle) return [];
  let bas = 0;
  let haut = cles.length;
  while (bas < haut) {
    const mil = (bas + haut) >> 1;
    if (cles[mil] < cle) bas = mil + 1;
    else haut = mil;
  }
  // On ne garde, en passant, que les `max` meilleurs : deux lettres peuvent
  // ouvrir des milliers de mots, inutile de tous les trier.
  const avant = (a, b) => a.c - b.c || a.m.length - b.m.length || a.m.localeCompare(b.m, 'fr');
  const meilleurs = [];
  for (let i = bas; i < cles.length && cles[i].startsWith(cle); i += 1) {
    if (cles[i].length <= cle.length) continue;
    const m = { m: mots[i], c: conjugue(cles[i]) ? 1 : 0 };
    if (meilleurs.length === max && avant(m, meilleurs[max - 1]) >= 0) continue;
    let j = meilleurs.length < max ? meilleurs.length : max - 1;
    while (j > 0 && avant(m, meilleurs[j - 1]) < 0) { meilleurs[j] = meilleurs[j - 1]; j -= 1; }
    meilleurs[j] = m;
  }
  return meilleurs.map((x) => x.m);
}

/** Le mot existe-t-il dans la liste (cle sans accent ni casse) ? */
function existe(cle) {
  let bas = 0;
  let haut = cles.length;
  while (bas < haut) {
    const mil = (bas + haut) >> 1;
    if (cles[mil] < cle) bas = mil + 1;
    else haut = mil;
  }
  return cles[bas] === cle;
}

/**
 * Terminaisons d'un verbe en -er conjugue (sur la cle sans accent). Restent
 * hors liste l'infinitif, « -e » (vidange, carbure, carburé) et « -ant »
 * (carburant) : ce sont aussi les noms et adjectifs qu'on tape le plus.
 */
const TERMINAISONS = /(eraient|erions|assions|assiez|erais|erait|eriez|erons|eront|assent|asses|aient|erent|erai|eras|erez|asse|ames|ates|era|ais|ait|ions|iez|ons|ent|ees|ai|as|at|ez|ee|es|a)$/;

/**
 * Forme conjuguee d'un verbe en -er que la liste connait : « carbura »,
 * « vidangeaient ». Elle passe apres les autres mots. « accident » n'en est
 * pas une : il n'y a pas de verbe « accider ».
 */
function conjugue(cle) {
  const t = TERMINAISONS.exec(cle);
  if (!t) return false;
  const radical = cle.slice(0, cle.length - t[1].length);
  if (radical.length < 2) return false;
  // Les verbes en -ger gardent leur « e » devant a et o : vidangeait.
  return existe(`${radical}er`) || (radical.endsWith('ge') && existe(`${radical.slice(0, -1)}r`));
}
