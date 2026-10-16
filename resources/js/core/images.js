/* ===================================================================
   Images jointes aux fiches — photos de vehicule, cartes grises, factures
   du garage, recus de station.

   Les images ne sont PAS rangees dans la base.

   La base est un seul fichier JSON, reecrit en entier a chaque saisie, et
   sur le web elle vit dans localStorage, dont le quota tient en quelques
   mega-octets. Deux photos par fiche y feraient une quinzaine de
   mega-octets : la version web et l'APK cesseraient d'enregistrer, chaque
   sauvegarde quotidienne pesserait autant, et la moindre modification
   reecrirait le tout.

   Les octets vivent donc a cote — un dossier sur le bureau, IndexedDB dans
   le navigateur — et la fiche ne retient qu'un identifiant. Une image ne
   change jamais apres son ajout : son identifiant suffit a la retrouver, et
   deux fiches peuvent pointer la meme sans la dupliquer.
   =================================================================== */

import { isDesktop } from './storage.js';
import { uid } from './utils.js';

/** Cote maximal apres reduction. Au-dela, on ne gagne plus en lisibilite. */
const COTE_MAX = 1600;

/** Qualite JPEG. 0,82 garde un texte de carte grise lisible. */
const QUALITE = 0.82;

/** Types acceptes a l'import. */
export const TYPES_IMAGE = ['image/jpeg', 'image/png'];

/* ------------------------- Stockage navigateur --------------------- */

const BASE_IDB = 'pdu_images';
const MAGASIN = 'images';

function ouvrirIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE_IDB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MAGASIN)) req.result.createObjectStore(MAGASIN);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function operationIDB(mode, fn) {
  return ouvrirIDB().then(
    (base) =>
      new Promise((resolve, reject) => {
        const tx = base.transaction(MAGASIN, mode);
        const req = fn(tx.objectStore(MAGASIN));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/* --------------------------- API commune --------------------------- */

/**
 * Reduit une image et la rend en octets JPEG.
 *
 * Une photo de telephone pese trois a cinq mega-octets pour une definition
 * dont on n'a que faire ici : ramenee a 1 600 px, elle en fait deux cents
 * kilo-octets et reste parfaitement lisible, carte grise comprise. Une
 * image deja plus petite n'est pas agrandie.
 *
 * @param {File|Blob} fichier
 * @param {number} [coteMax] cote maximal en pixels (un fond d'ecran en veut plus)
 * @returns {Promise<{octets:Uint8Array, largeur:number, hauteur:number}>}
 */
export async function reduire(fichier, coteMax = COTE_MAX) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible'));
      i.src = url;
    });

    const facteur = Math.min(1, coteMax / Math.max(img.naturalWidth, img.naturalHeight));
    const largeur = Math.max(1, Math.round(img.naturalWidth * facteur));
    const hauteur = Math.max(1, Math.round(img.naturalHeight * facteur));

    const toile = document.createElement('canvas');
    toile.width = largeur;
    toile.height = hauteur;
    const ctx = toile.getContext('2d');
    // Un PNG transparent deviendrait noir en JPEG : on pose un fond blanc,
    // qui est ce qu'on attend d'un document scanne.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, largeur, hauteur);
    ctx.drawImage(img, 0, 0, largeur, hauteur);

    const blob = await new Promise((r) => toile.toBlob(r, 'image/jpeg', QUALITE));
    const octets = new Uint8Array(await blob.arrayBuffer());
    return { octets, largeur, hauteur };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Enregistre une image et rend la fiche a coller dans l'enregistrement.
 *
 * @param {File} fichier
 * @returns {Promise<{id:string, nom:string, taille:number, largeur:number, hauteur:number, ajouteLe:string}>}
 */
export async function ajouterImage(fichier, { coteMax } = {}) {
  if (!TYPES_IMAGE.includes(fichier.type)) {
    throw new Error('Seuls les fichiers JPEG et PNG sont acceptés.');
  }
  const { octets, largeur, hauteur } = await reduire(fichier, coteMax);
  const id = `img_${uid()}`;

  if (isDesktop) await window.pduDesktop.imageEcrire(id, Array.from(octets));
  else await operationIDB('readwrite', (m) => m.put(octets, id));

  return {
    id,
    nom: fichier.name || 'image.jpg',
    taille: octets.length,
    largeur,
    hauteur,
    ajouteLe: new Date().toISOString()
  };
}

/**
 * Rend une URL affichable pour une image enregistree, ou null si elle a
 * disparu — un dossier vide, une base de navigateur effacee. L'appelant
 * libere l'URL avec `libererUrl` quand il a fini.
 */
export async function urlImage(id) {
  try {
    let octets;
    if (isDesktop) {
      const tableau = await window.pduDesktop.imageLire(id);
      if (!tableau) return null;
      octets = new Uint8Array(tableau);
    } else {
      octets = await operationIDB('readonly', (m) => m.get(id));
      if (!octets) return null;
    }
    return URL.createObjectURL(new Blob([octets], { type: 'image/jpeg' }));
  } catch (e) {
    return null;
  }
}

/** Libere une URL rendue par `urlImage`. */
export function libererUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/** Octets bruts d'une image, pour l'export en archive. */
export async function octetsImage(id) {
  try {
    if (isDesktop) {
      const tableau = await window.pduDesktop.imageLire(id);
      return tableau ? new Uint8Array(tableau) : null;
    }
    const octets = await operationIDB('readonly', (m) => m.get(id));
    return octets || null;
  } catch (e) {
    return null;
  }
}

/** Ecrit une image recue d'une archive, sous son identifiant d'origine. */
export async function poserImage(id, octets) {
  if (isDesktop) await window.pduDesktop.imageEcrire(id, Array.from(octets));
  else await operationIDB('readwrite', (m) => m.put(octets, id));
}

/**
 * Efface une image.
 *
 * Sans consequence si elle n'existe plus : une fiche peut avoir ete
 * supprimee deux fois, ou l'image avoir disparu du dossier.
 */
export async function supprimerImage(id) {
  try {
    if (isDesktop) await window.pduDesktop.imageSupprimer(id);
    else await operationIDB('readwrite', (m) => m.delete(id));
  } catch (e) {
    /* deja partie */
  }
}

/**
 * Efface les images que plus aucune fiche ne cite.
 *
 * Une image est ecrite des qu'on la choisit, avant meme que le formulaire
 * soit valide : annuler la saisie laisse donc des octets orphelins. Le
 * menage se fait au demarrage, quand la base est connue.
 *
 * Il ne se fait PAS si la base ne cite aucune image alors que le dossier en
 * contient : cela signifierait qu'on vient d'echouer a lire la base, et le
 * menage effacerait alors toutes les photos du parc. Devant ce doute, on ne
 * touche a rien — quelques kilo-octets en trop ne coutent rien, une photo
 * perdue ne se rattrape pas.
 *
 * @param {Set<string>} citees identifiants cites par les fiches
 * @returns {Promise<number>} nombre d'images effacees
 */
export async function menageImages(citees) {
  const rangees = await toutesLesImages();
  if (!rangees.length) return 0;
  if (!citees || citees.size === 0) return 0;

  const orphelines = rangees.filter((id) => !citees.has(id));
  for (const id of orphelines) await supprimerImage(id);
  return orphelines.length;
}

/** Identifiants de toutes les images rangees, pour le menage et l'export. */
export async function toutesLesImages() {
  try {
    if (isDesktop) return (await window.pduDesktop.imageListe()) || [];
    return (await operationIDB('readonly', (m) => m.getAllKeys())) || [];
  } catch (e) {
    return [];
  }
}
