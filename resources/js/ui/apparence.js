/* ===================================================================
   APPARENCE — style de l'interface, taille de l'affichage, fond de la
   page de connexion.

   Chacun regle l'ecran qu'il a sous les yeux : les choix sont gardes sur
   l'appareil (theme.js), pas dans la base. Le meme panneau sert dans
   REGLAGES, derriere le bouton 🎨 de l'en-tete (tous les comptes) et sur
   la page de connexion (fond seulement).
   =================================================================== */

import { esc } from '../core/utils.js';
import { openModal, toast } from './components.js';
import {
  THEMES, themeActuel, appliquerTheme, zoomActuel, appliquerZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_PAS,
  DECORS, decorActuel, choisirDecor
} from './theme.js';

function carte(titre, texte) {
  const c = document.createElement('div');
  c.className = 'card';
  c.innerHTML = `<h3>${titre}</h3><p>${texte}</p>`;
  return c;
}

function blocStyle(refaire, surChoix) {
  const bloc = carte('STYLE DE L’INTERFACE',
    'Choisissez l’allure de l’application. Le choix ne vaut que pour cet appareil : ' +
    'le PC et le téléphone peuvent avoir chacun le leur. Les données ne changent pas.');
  const grille = document.createElement('div');
  grille.className = 'themeChoix';
  const actuel = themeActuel();
  THEMES.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'themeCarte' + (t.id === actuel ? ' choisi' : '');
    b.type = 'button';
    b.innerHTML =
      '<div class="nuancier">' + t.apercu.map((c) => `<span style="background:${c}"></span>`).join('') + '</div>' +
      (t.id === actuel ? '<span class="coche">✓ Actif</span>' : '') +
      `<b>${esc(t.nom)}</b><small>${esc(t.detail)}</small>`;
    b.addEventListener('click', () => {
      if (t.id === themeActuel()) return;
      appliquerTheme(t.id);
      toast(`Style « ${t.nom} » appliqué.`);
      refaire();
      if (surChoix) surChoix();
    });
    grille.appendChild(b);
  });
  bloc.appendChild(grille);
  return bloc;
}

function blocTaille() {
  const taille = carte('TAILLE DE L’AFFICHAGE',
    'Agrandit ou réduit toute l’application sur cet appareil. Sur téléphone, on peut aussi zoomer ' +
    'à deux doigts, comme sur une photo.');
  taille.insertAdjacentHTML('beforeend',
    '<div class="zoomBarre">' +
    '<button type="button" class="zoomBtn" data-moins aria-label="Réduire">−</button>' +
    '<b class="zoomValeur"></b>' +
    '<button type="button" class="zoomBtn" data-plus aria-label="Agrandir">+</button>' +
    '<button type="button" class="smallBtn" data-normal>Taille normale</button>' +
    '</div>');
  const valeur = taille.querySelector('.zoomValeur');
  const afficher = (z) => {
    valeur.textContent = `${z} %`;
    taille.querySelector('[data-moins]').disabled = z <= ZOOM_MIN;
    taille.querySelector('[data-plus]').disabled = z >= ZOOM_MAX;
  };
  const regler = (z) => afficher(appliquerZoom(z));
  taille.querySelector('[data-moins]').addEventListener('click', () => regler(zoomActuel() - ZOOM_PAS));
  taille.querySelector('[data-plus]').addEventListener('click', () => regler(zoomActuel() + ZOOM_PAS));
  taille.querySelector('[data-normal]').addEventListener('click', () => regler(100));
  afficher(zoomActuel());
  return taille;
}

/**
 * Choix du fond : un clic montre un apercu (sur la page de connexion, le
 * fond change aussitot), un double clic valide et ferme la fenetre. Fermer
 * sans valider rend le fond d'avant.
 */
function blocDecor(refaire, o) {
  const decor = carte('FOND DE LA PAGE DE CONNEXION',
    'Un clic pour voir un fond, <b>double clic pour le valider</b>. Les fonds « pleine page » couvrent toute ' +
    'la page, sur tous les écrans ; le décor « Tableau de bord » habille les côtés du formulaire sur un grand ' +
    'écran. Le choix vaut pour cet appareil.');
  const grille = document.createElement('div');
  grille.className = 'themeChoix';
  const actuel = decorActuel();
  const cartes = [];
  DECORS.forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Clic : aperçu — double clic : valider';
    b.className = 'themeCarte' + (d.id === actuel ? ' choisi' : '');
    b.innerHTML =
      (d.apercu
        ? `<div class="decorApercu" style="background-image:url('${d.apercu}')"></div>`
        : '<div class="decorApercu decorVide">Aucun</div>') +
      (d.id === actuel ? '<span class="coche">✓ Actif</span>' : '<span class="coche apercuMarque">👁 Aperçu</span>') +
      `<b>${esc(d.nom)}</b><small>${esc(d.detail)}</small>`;
    // Pas de redessin au simple clic : le double clic doit tomber sur la
    // meme carte que les deux clics qui le composent.
    b.addEventListener('click', () => {
      cartes.forEach((c) => c.classList.toggle('apercu', c === b));
      if (o.surApercu) o.surApercu(d.id);
    });
    b.addEventListener('dblclick', () => {
      choisirDecor(d.id);
      toast(d.id ? `Fond « ${d.nom} » validé.` : 'Page de connexion sans fond.');
      if (o.surDecor) o.surDecor(d.id);
      if (o.fermer) o.fermer();
      else refaire();
    });
    cartes.push(b);
    grille.appendChild(b);
  });
  decor.appendChild(grille);
  return decor;
}

/**
 * Le panneau, qui se redessine lui-meme a chaque choix.
 * @param {object} o
 * @param {boolean} [o.style=true]   style de l'interface
 * @param {boolean} [o.taille=true]  taille de l'affichage
 * @param {boolean} [o.decor=true]   fond de la page de connexion
 * @param {Function} [o.surChoix]    apres un changement de style (redessiner la page)
 * @param {Function} [o.surDecor]    apres un changement de fond
 */
export function apparenceNode(o = {}) {
  const zone = document.createElement('div');
  const refaire = () => {
    zone.innerHTML = '';
    if (o.style !== false) zone.appendChild(blocStyle(refaire, o.surChoix));
    if (o.taille !== false) zone.appendChild(blocTaille());
    if (o.decor !== false) zone.appendChild(blocDecor(refaire, o));
  };
  refaire();
  return zone;
}

/** Le panneau dans une fenetre : bouton 🎨 de l'en-tete et de la connexion. */
export function ouvrirApparence(o = {}) {
  let fenetre = null;
  const options = Object.assign({}, o, { fermer: () => fenetre && fenetre.close() });
  fenetre = openModal({
    title: o.titre || '🎨 Apparence',
    bodyNode: apparenceNode(options),
    wide: true,
    // Un apercu non valide s'efface a la fermeture : le fond retenu revient.
    onClose: () => { if (o.surApercu && o.surDecor) o.surDecor(decorActuel()); },
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }]
  });
}
