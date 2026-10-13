/* ===================================================================
   Copies datees de la base, dans un dossier choisi par l'utilisateur.

   Ce module ne connait ni Electron ni l'application : il ne fait que des
   fichiers. C'est voulu — la regle de retention et le nommage se testent
   ainsi pour de vrai, sans lancer de fenetre.
   =================================================================== */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Sous-dossier ou vont les copies datees, a l'interieur du dossier choisi
 * dans REGLAGES : elles y sont rangees a part, sans se meler aux autres
 * fichiers du dossier.
 */
const SOUS_DOSSIER = 'SAUVEGARDE AUTOMATIQUE QUOTIDIENNE';

/** Dossier des copies datees pour un dossier de sauvegarde choisi ; vide s'il n'y en a pas. */
function dossierCopies(dossier) {
  const d = String(dossier || '').trim();
  return d ? path.join(d, SOUS_DOSSIER) : '';
}

/** Nom d'une copie datee : pdu-parc-auto-AAAA-MM-JJ.json */
const NOM_SAUVEGARDE = /^pdu-parc-auto-(\d{4}-\d{2}-\d{2})\.json$/;

/** Copies presentes dans le dossier, de la plus ancienne a la plus recente. */
function listerSauvegardes(dossier) {
  try {
    return fs
      .readdirSync(String(dossier || ''))
      .filter((f) => NOM_SAUVEGARDE.test(f))
      .sort()
      .map((nom) => ({
        nom,
        date: NOM_SAUVEGARDE.exec(nom)[1],
        taille: fs.statSync(path.join(dossier, nom)).size
      }));
  } catch (e) {
    return [];
  }
}

/**
 * Ecrit la copie du jour puis elague les plus anciennes.
 *
 * Une copie par jour, pas une par enregistrement : le fichier du jour est
 * reecrit tant que la journee dure, ce qui garde la derniere version sans
 * couvrir le support de milliers de fichiers. Celui de la veille reste
 * intact — c'est tout l'interet, puisqu'une erreur se remarque souvent le
 * lendemain, quand la copie de securite du poste a deja ete ecrasee.
 *
 * Ne leve jamais : une cle debranchee ou un disque reseau injoignable ne
 * doit pas faire echouer l'enregistrement qui vient d'avoir lieu. L'echec
 * est rendu dans l'objet d'etat, que la rubrique REGLAGES affiche.
 *
 * @param {string} raw      contenu JSON a copier
 * @param {string} dossier  dossier de destination
 * @param {number} garder   nombre de copies conservees
 * @param {string} [jour]   date ISO du jour (injectable pour les tests)
 * @returns {{fait:string|null, dossier:string, fichier:string, erreur:string, conservees:number}}
 */
function sauvegardeDatee(raw, dossier, garder, jour) {
  const cible = String(dossier || '').trim();
  if (!cible) return { fait: null, dossier: '', fichier: '', erreur: '', conservees: 0 };

  // Une valeur en dessous de un, ou illisible, vaut « non renseigne » et
  // retombe sur trente. Zero ne peut pas vouloir dire « garder zero copie » :
  // la sauvegarde s'effacerait elle-meme aussitot ecrite.
  const demande = Number(garder);
  const n = Number.isFinite(demande) && demande >= 1 ? Math.floor(demande) : 30;
  const date = jour || new Date().toISOString().slice(0, 10);
  const fichier = `pdu-parc-auto-${date}.json`;
  const chemin = path.join(cible, fichier);

  try {
    fs.mkdirSync(cible, { recursive: true });
    // Fichier temporaire puis renommage : une copie interrompue ne doit pas
    // remplacer une sauvegarde valide par un fichier tronque.
    const tmp = `${chemin}.tmp`;
    fs.writeFileSync(tmp, raw, 'utf8');
    fs.renameSync(tmp, chemin);

    const presentes = listerSauvegardes(cible);
    const aJeter = presentes.slice(0, Math.max(0, presentes.length - n));
    aJeter.forEach((f) => {
      try { fs.unlinkSync(path.join(cible, f.nom)); } catch (e) { /* deja partie */ }
    });

    return {
      fait: new Date().toISOString(),
      dossier: cible,
      fichier,
      erreur: '',
      conservees: presentes.length - aJeter.length
    };
  } catch (e) {
    return {
      fait: null,
      dossier: cible,
      fichier: '',
      erreur: String((e && e.message) || e),
      conservees: listerSauvegardes(cible).length
    };
  }
}

/**
 * Recopie les images vers le dossier de sauvegarde.
 *
 * Un miroir, et non une copie par jour : une image ne change jamais apres
 * son ajout, son nom suffit a savoir si elle est deja la. Trente copies
 * datees partagent ainsi un seul jeu d'images, au lieu de le dupliquer
 * trente fois.
 *
 * Rien n'est efface ici. Une photo retiree d'une fiche disparait du poste,
 * mais sa copie reste : c'est une sauvegarde, elle est faite pour survivre
 * a une suppression — y compris a une suppression regrettee.
 *
 * @returns {{copiees:number, erreur:string}}
 */
function miroirImages(sourceDir, dossier) {
  const cible = path.join(String(dossier || ''), 'images');
  try {
    if (!fs.existsSync(sourceDir)) return { copiees: 0, erreur: '' };
    fs.mkdirSync(cible, { recursive: true });
    let copiees = 0;
    for (const nom of fs.readdirSync(sourceDir)) {
      if (!nom.endsWith('.jpg')) continue;
      const dest = path.join(cible, nom);
      if (fs.existsSync(dest)) continue;
      fs.copyFileSync(path.join(sourceDir, nom), dest);
      copiees += 1;
    }
    return { copiees, erreur: '' };
  } catch (e) {
    return { copiees: 0, erreur: String((e && e.message) || e) };
  }
}

module.exports = { sauvegardeDatee, listerSauvegardes, miroirImages, dossierCopies, NOM_SAUVEGARDE, SOUS_DOSSIER };
