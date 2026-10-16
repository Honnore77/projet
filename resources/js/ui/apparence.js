/* ===================================================================
   APPARENCE — style de l'interface, taille de l'affichage, fond de la
   page de connexion.

   Chacun regle l'ecran qu'il a sous les yeux : les choix sont gardes sur
   l'appareil (theme.js), pas dans la base. Le meme panneau sert dans
   REGLAGES, derriere le bouton 🎨 de l'en-tete (tous les comptes) et sur
   la page de connexion (fond seulement).
   =================================================================== */

import { esc } from '../core/utils.js';
import { DB, saveSettings } from '../core/db.js';
import { canAdmin } from '../core/auth.js';
import { ajouterImage, urlImage } from '../core/images.js';
import { openModal, toast, confirmDialog } from './components.js';
import {
  THEMES, themeActuel, appliquerTheme, apercuTheme, annulerApercuTheme, zoomActuel, appliquerZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_PAS,
  tousLesDecors, decorActuel, choisirDecor
} from './theme.js';

function carte(titre, texte) {
  const c = document.createElement('div');
  c.className = 'card';
  c.innerHTML = `<h3>${titre}</h3><p>${texte}</p>`;
  return c;
}

/**
 * Comme pour le fond : un clic montre le style sur toute l'application,
 * un double clic le valide (et ferme la fenetre). Sans validation, le style
 * retenu revient a la fermeture.
 */
function blocStyle(refaire, o) {
  const bloc = carte('STYLE DE L’INTERFACE',
    'Un clic pour voir un style, <b>double clic pour le valider</b>. Le choix ne vaut que pour cet appareil : ' +
    'le PC et le téléphone peuvent avoir chacun le leur. Les données ne changent pas.');
  const grille = document.createElement('div');
  grille.className = 'themeChoix';
  const actuel = themeActuel();
  const cartes = [];
  THEMES.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'themeCarte' + (t.id === actuel ? ' choisi' : '');
    b.type = 'button';
    b.title = 'Clic : aperçu — double clic : valider';
    b.innerHTML =
      '<div class="nuancier">' + t.apercu.map((c) => `<span style="background:${c}"></span>`).join('') + '</div>' +
      (t.id === actuel ? '<span class="coche">✓ Actif</span>' : '<span class="coche apercuMarque">👁 Aperçu</span>') +
      `<b>${esc(t.nom)}</b><small>${esc(t.detail)}</small>`;
    // Pas de redessin au simple clic : le double clic doit tomber sur la
    // meme carte que les deux clics qui le composent.
    b.addEventListener('click', () => {
      cartes.forEach((c) => c.classList.toggle('apercu', c === b && t.id !== themeActuel()));
      apercuTheme(t.id);
    });
    b.addEventListener('dblclick', () => {
      const change = t.id !== themeActuel();
      appliquerTheme(t.id);
      if (change) toast(`Style « ${t.nom} » validé.`);
      if (o.surChoix) o.surChoix();
      if (o.fermer) o.fermer();
      else refaire();
    });
    cartes.push(b);
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
  // Ajouter et retirer des fonds : l'administrateur, connecte. La liste
  // vaut pour tous les appareils ; le choix du fond, pour celui-ci.
  const gerer = canAdmin();
  tousLesDecors().forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Clic : aperçu — double clic : valider';
    b.className = 'themeCarte' + (d.id === actuel ? ' choisi' : '');
    b.innerHTML =
      (d.apercu || d.perso
        ? `<div class="decorApercu" style="${d.apercu ? `background-image:url('${d.apercu}')` : ''}"></div>`
        : '<div class="decorApercu decorVide">Aucun</div>') +
      (d.id === actuel ? '<span class="coche">✓ Actif</span>' : '<span class="coche apercuMarque">👁 Aperçu</span>') +
      `<b>${esc(d.nom)}</b><small>${esc(d.detail)}</small>`;
    // La vignette d'une image ajoutee se charge depuis le magasin d'images.
    if (d.perso) {
      urlImage(d.imageId).then((url) => {
        const vignette = b.querySelector('.decorApercu');
        if (url) vignette.style.backgroundImage = `url('${url}')`;
        else { vignette.classList.add('decorVide'); vignette.textContent = 'Image absente'; }
      });
    }
    if (gerer && d.id) {
      const retirer = document.createElement('span');
      retirer.className = 'decorRetirer';
      retirer.title = d.perso ? 'Supprimer cette image' : 'Retirer ce fond de la liste';
      retirer.textContent = '✕';
      retirer.addEventListener('click', (ev) => { ev.stopPropagation(); retirerFond(d, refaire, o); });
      retirer.addEventListener('dblclick', (ev) => ev.stopPropagation());
      b.appendChild(retirer);
    }
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

  if (gerer) {
    // Derniere carte : ajouter une image (JPEG ou PNG).
    const ajout = document.createElement('label');
    ajout.className = 'themeCarte decorAjout';
    ajout.innerHTML =
      '<div class="decorApercu decorVide">＋</div><b>Ajouter une image</b>' +
      '<small>Une photo ou une image (JPEG, PNG) pour toute la page.</small>' +
      '<input type="file" accept="image/jpeg,image/png" hidden>';
    const entree = ajout.querySelector('input');
    entree.addEventListener('change', async () => {
      const f = entree.files[0];
      entree.value = '';
      if (!f) return;
      try {
        // Un fond couvre tout l'ecran : il garde plus de definition qu'une photo de fiche.
        const img = await ajouterImage(f, { coteMax: 2560 });
        const nom = String(f.name || 'Image').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Image ajoutée';
        const id = `perso-${img.id}`;
        saveSettings({ fondsPerso: (DB.settings.fondsPerso || []).concat([{ id, nom, imageId: img.id }]) });
        toast(`Image « ${nom} » ajoutée aux fonds. Double-cliquez dessus pour la choisir.`, 'ok', 4000);
        refaire();
      } catch (e) {
        toast((e && e.message) || 'Image refusée.', 'err');
      }
    });
    grille.appendChild(ajout);
  }
  decor.appendChild(grille);

  if (gerer && (DB.settings.fondsMasques || []).length) {
    const retablir = document.createElement('button');
    retablir.type = 'button';
    retablir.className = 'miniBtn';
    retablir.style.cssText = 'background:#5b7178;margin-top:10px';
    retablir.textContent = `↺ Rétablir les fonds d’origine retirés (${DB.settings.fondsMasques.length})`;
    retablir.onclick = () => { saveSettings({ fondsMasques: [] }); refaire(); };
    decor.appendChild(retablir);
  }
  return decor;
}

/**
 * Retire un fond : une image ajoutee est supprimee (ses octets partent au
 * menage du prochain demarrage), un fond de l'application est seulement
 * masque — « Rétablir » le fait revenir.
 */
async function retirerFond(d, refaire, o) {
  const ok = await confirmDialog({
    title: d.perso ? 'Supprimer l’image' : 'Retirer le fond',
    message: d.perso
      ? `Supprimer l’image « ${d.nom} » des fonds de la page de connexion ? Elle disparaîtra sur tous les appareils.`
      : `Retirer « ${d.nom} » de la liste des fonds ? Il pourra être rétabli.`,
    okLabel: d.perso ? 'Supprimer' : 'Retirer',
    danger: true
  });
  if (!ok) return;
  if (d.perso) saveSettings({ fondsPerso: (DB.settings.fondsPerso || []).filter((f) => f.id !== d.id) });
  else saveSettings({ fondsMasques: [...new Set((DB.settings.fondsMasques || []).concat([d.id]))] });
  // Si c'etait le fond de cet appareil, la page de connexion revient sans fond.
  if (o.surDecor) o.surDecor(decorActuel());
  toast(d.perso ? 'Image supprimée.' : 'Fond retiré de la liste.', 'ok');
  refaire();
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
    if (o.style !== false) zone.appendChild(blocStyle(refaire, o));
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
    onClose: () => {
      annulerApercuTheme();
      if (o.surApercu && o.surDecor) o.surDecor(decorActuel());
    },
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }]
  });
}
