/* ===================================================================
   Sauvegarde en archive : la base et les images dans un seul fichier.

   Tant que les fiches ne portaient que du texte, un .json suffisait. Depuis
   qu'elles portent des photos rangees hors de la base, un .json seul ne
   ramenerait qu'une moitie de sauvegarde : les fiches citeraient des images
   introuvables. L'archive tient les deux.

   Les anciennes sauvegardes .json restent lisibles : une restauration ne
   doit pas dependre de la version qui l'a produite.
   =================================================================== */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { octetsImage, poserImage } from './images.js';
import { imagesCitees } from './db.js';

/** Nom du fichier de donnees a l'interieur de l'archive. */
const FICHIER_BASE = 'base.json';

/** Signature d'un ZIP : « PK\x03\x04 » en tete de fichier. */
function estArchive(octets) {
  return octets.length > 4 && octets[0] === 0x50 && octets[1] === 0x4b && octets[2] === 0x03 && octets[3] === 0x04;
}

/**
 * Construit l'archive de sauvegarde.
 *
 * Seules les images encore citees par une fiche y entrent : une photo
 * retiree d'une fiche n'a pas a voyager indefiniment. Une image citee mais
 * introuvable est simplement omise — mieux vaut une archive incomplete
 * qu'aucune archive, et la liste des manquantes est rendue a l'appelant.
 *
 * @param {object} base contenu de la base
 * @returns {Promise<{octets:Uint8Array, images:number, manquantes:string[]}>}
 */
export async function construireArchive(base) {
  const contenu = { [FICHIER_BASE]: strToU8(JSON.stringify(base, null, 2)) };
  const manquantes = [];
  let images = 0;

  for (const id of imagesCitees(base)) {
    const octets = await octetsImage(id);
    if (!octets) {
      manquantes.push(id);
      continue;
    }
    // Les images sont deja compressees : les recompresser ne gagnerait rien
    // et couterait du temps sur une centaine de fichiers.
    contenu[`images/${id}.jpg`] = [octets, { level: 0 }];
    images += 1;
  }

  return { octets: zipSync(contenu, { level: 6 }), images, manquantes };
}

/**
 * Relit une sauvegarde, archive ou ancien .json.
 *
 * Les images de l'archive sont reposees sous leur identifiant d'origine :
 * les fiches restaurees les retrouvent sans qu'on ait a les renommer.
 *
 * @param {Uint8Array} octets
 * @returns {Promise<{base:object, images:number, format:'archive'|'json'}>}
 */
export async function lireArchive(octets) {
  if (!estArchive(octets)) {
    // Ancienne sauvegarde : du JSON, sans image.
    return { base: JSON.parse(strFromU8(octets)), images: 0, format: 'json' };
  }

  const fichiers = unzipSync(octets);
  const brut = fichiers[FICHIER_BASE];
  if (!brut) throw new Error('Archive sans fichier de données.');

  let images = 0;
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const trouve = /^images\/(img_[A-Za-z0-9]+)\.jpg$/.exec(nom);
    if (!trouve) continue;
    await poserImage(trouve[1], contenu);
    images += 1;
  }

  return { base: JSON.parse(strFromU8(brut)), images, format: 'archive' };
}
