/* ===================================================================
   PIÈCES JOINTES des notes — PDF, Excel et Word.

   Les octets ne vont pas dans la base, pour les memes raisons que les
   photos (voir images.js) : ils sont ranges a cote, dans le meme magasin
   que les images, et la note ne retient que leur fiche. Le magasin ne
   regarde pas ce qu'il garde : il range des octets sous un identifiant.
   Les pieces suivent donc, sans rien de plus, la synchronisation PC ↔
   telephone, l'archive de sauvegarde et le menage des orphelines — a
   condition d'etre citees (voir imagesCitees dans db.js).

   Un fichier range ne change jamais : la synchronisation reconnait les
   octets a leur identifiant. Modifier une piece range donc une nouvelle
   version sous un nouvel identifiant ; l'ancienne reste dans `versions`,
   pour qu'une modification faite par un destinataire n'efface pas ce
   que l'expediteur avait envoye.
   =================================================================== */

import { uid } from './utils.js';
import { poserImage, octetsImage } from './images.js';

/** Au-dela, la synchronisation par le reseau local deviendrait trop lente. */
export const TAILLE_MAX = 15 * 1024 * 1024;

/** Les formats acceptes, reconnus a l'extension du nom. */
export const FORMATS = {
  pdf: { libelle: 'PDF', icone: '📕', mime: 'application/pdf', extensions: ['pdf'] },
  word: {
    libelle: 'Word', icone: '📘', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extensions: ['docx']
  },
  excel: {
    libelle: 'Excel', icone: '📗', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['xlsx', 'xls']
  }
};

/** Pour le champ de choix du fichier. */
export const ACCEPT = '.pdf,.docx,.xlsx,.xls';

const extension = (nom) => (String(nom || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

/** Le format d'un fichier d'apres son nom, ou null s'il n'est pas accepte. */
export function formatDe(nom) {
  const ext = extension(nom);
  return Object.keys(FORMATS).find((k) => FORMATS[k].extensions.includes(ext)) || null;
}

/** Le type MIME a donner au fichier enregistre. */
export function mimeDe(piece) {
  if (extension(piece.nom) === 'xls') return 'application/vnd.ms-excel';
  return (FORMATS[piece.type] || {}).mime || 'application/octet-stream';
}

/** Un format que l'application sait modifier. */
export const modifiable = (piece) => piece.type === 'word' || (piece.type === 'excel' && extension(piece.nom) !== 'xls');

/** Taille lisible : « 245 Ko », « 1,2 Mo ». */
export function taillePiece(octets) {
  const n = Number(octets) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/** Raison du refus d'un fichier, ou null s'il est accepte. */
export function refusPiece(nom, taille) {
  if (/\.doc$/i.test(nom)) return `« ${nom} » est un ancien document Word (.doc) : enregistrez-le d’abord en .docx depuis Word.`;
  if (!formatDe(nom)) return `« ${nom} » n’est pas un fichier PDF, Excel ou Word.`;
  if (taille > TAILLE_MAX) return `« ${nom} » dépasse ${taillePiece(TAILLE_MAX)}.`;
  if (!taille) return `« ${nom} » est vide.`;
  return null;
}

/**
 * Range des octets et rend leur identifiant. Le prefixe « img_ » est celui
 * que le magasin du PC accepte (il refuse tout identifiant qui pourrait
 * sortir de son dossier) ; « pj » distingue la piece d'une photo.
 */
async function ranger(octets) {
  const id = `img_pj${uid()}`;
  await poserImage(id, octets);
  return id;
}

/**
 * Range un fichier choisi et rend la fiche de la piece.
 * @param {File} fichier
 * @param {{id:string, nom:string}} auteur  compte connecte
 */
export async function ajouterPiece(fichier, auteur) {
  const refus = refusPiece(fichier.name, fichier.size);
  if (refus) throw new Error(refus);
  const octets = new Uint8Array(await fichier.arrayBuffer());
  return {
    id: await ranger(octets),
    nom: fichier.name,
    type: formatDe(fichier.name),
    taille: octets.length,
    ajouteLe: new Date().toISOString(),
    ajoutePar: auteur ? auteur.nom : '',
    versions: []
  };
}

/** Les octets d'une piece (ou d'une de ses versions), ou null s'ils manquent. */
export function octetsPiece(id) {
  return octetsImage(id);
}

/**
 * Enregistre une nouvelle version d'une piece. La fiche est modifiee sur
 * place : a l'appelant d'enregistrer la note.
 */
export async function nouvelleVersion(piece, octets, auteur) {
  const avant = {
    id: piece.id,
    taille: piece.taille,
    date: piece.modifieLe || piece.ajouteLe || '',
    par: piece.modifiePar || piece.ajoutePar || ''
  };
  piece.versions = (piece.versions || []).concat([avant]);
  piece.id = await ranger(octets);
  piece.taille = octets.length;
  piece.modifieLe = new Date().toISOString();
  piece.modifiePar = auteur ? auteur.nom : '';
  return piece;
}

/** Identifiants des octets cites par une liste de pieces, versions comprises. */
export function idsDesPieces(pieces) {
  return (pieces || []).flatMap((p) => [p && p.id].concat((p && p.versions || []).map((v) => v.id))).filter(Boolean);
}
