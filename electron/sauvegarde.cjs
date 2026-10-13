/* ===================================================================
   Copies datees de la base, dans un dossier choisi par l'utilisateur.

   Ce module ne connait ni Electron ni l'application : il ne fait que des
   fichiers. C'est voulu — la regle de retention et le nommage se testent
   ainsi pour de vrai, sans lancer de fenetre.
   =================================================================== */

const fs = require('node:fs');
const path = require('node:path');

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

/* ===================================================================
   Sauvegarde hebdomadaire : chaque vendredi a 18 h 30, dans le
   sous-dossier « SAUVEGADE AUTOMATIQUE HEBDO » du dossier de sauvegarde.

   Elle s'ajoute aux copies quotidiennes, elle ne les remplace pas. Une
   copie par semaine, nommee d'apres le vendredi qu'elle couvre :
   pdu-parc-auto-hebdo-AAAA-MM-JJ.json.

   L'application n'est pas toujours ouverte le vendredi a 18 h 30 : la
   sauvegarde d'une semaine manquee se fait au lancement suivant. On ne
   tient donc aucun etat a part — le fichier de la semaine existe, ou non.
   =================================================================== */

/** Nom du sous-dossier, tel que demande. */
const DOSSIER_HEBDO = 'SAUVEGADE AUTOMATIQUE HEBDO';

/** Vendredi (0 = dimanche), 18 h 30, heure du poste. */
const ECHEANCE_HEBDO = { jour: 5, heure: 18, minute: 30 };

/** Cinquante-deux semaines : un an de vendredis. */
const HEBDO_CONSERVEES = 52;

const NOM_HEBDO = /^pdu-parc-auto-hebdo-(\d{4}-\d{2}-\d{2})\.json$/;

/** Date AAAA-MM-JJ selon l'heure du poste (et non UTC). */
function dateLocale(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Le dernier vendredi 18 h 30 deja passe (ou l'instant meme). */
function derniereEcheance(maintenant = new Date()) {
  const d = new Date(maintenant.getTime());
  d.setHours(ECHEANCE_HEBDO.heure, ECHEANCE_HEBDO.minute, 0, 0);
  const recul = (d.getDay() - ECHEANCE_HEBDO.jour + 7) % 7;
  d.setDate(d.getDate() - recul);
  if (d > maintenant) d.setDate(d.getDate() - 7);
  return d;
}

/** Le prochain vendredi 18 h 30. */
function prochaineEcheance(maintenant = new Date()) {
  const d = derniereEcheance(maintenant);
  d.setDate(d.getDate() + 7);
  return d;
}

function dossierHebdo(dossierParent) {
  return path.join(String(dossierParent || ''), DOSSIER_HEBDO);
}

/** Copies hebdomadaires presentes, de la plus ancienne a la plus recente. */
function listerHebdo(dossierParent) {
  const cible = dossierHebdo(dossierParent);
  try {
    return fs
      .readdirSync(cible)
      .filter((f) => NOM_HEBDO.test(f))
      .sort()
      .map((nom) => ({ nom, date: NOM_HEBDO.exec(nom)[1], taille: fs.statSync(path.join(cible, nom)).size }));
  } catch (e) {
    return [];
  }
}

/**
 * Ecrit la copie de la semaine si elle n'existe pas encore.
 *
 * Ne leve jamais, comme la copie quotidienne : l'echec est rendu dans
 * l'objet d'etat et affiche dans REGLAGES.
 *
 * @param {string} raw            contenu JSON a copier
 * @param {string} dossierParent  dossier de sauvegarde choisi dans REGLAGES
 * @param {Date}   [maintenant]   injectable pour les tests
 * @returns {{ecrite:boolean, fait:string|null, dossier:string, fichier:string,
 *            erreur:string, conservees:number, echeance:string, prochaine:string}}
 */
function sauvegardeHebdo(raw, dossierParent, maintenant = new Date()) {
  const echeance = derniereEcheance(maintenant);
  const etat = {
    ecrite: false,
    fait: null,
    dossier: '',
    fichier: '',
    erreur: '',
    conservees: 0,
    echeance: echeance.toISOString(),
    prochaine: prochaineEcheance(maintenant).toISOString()
  };
  if (!String(dossierParent || '').trim()) return etat;

  const cible = dossierHebdo(dossierParent);
  const fichier = `pdu-parc-auto-hebdo-${dateLocale(echeance)}.json`;
  const chemin = path.join(cible, fichier);
  etat.dossier = cible;
  etat.fichier = fichier;

  try {
    if (fs.existsSync(chemin)) {
      etat.fait = fs.statSync(chemin).mtime.toISOString();
      etat.conservees = listerHebdo(dossierParent).length;
      return etat;
    }
    fs.mkdirSync(cible, { recursive: true });
    const tmp = `${chemin}.tmp`;
    fs.writeFileSync(tmp, raw, 'utf8');
    fs.renameSync(tmp, chemin);

    const presentes = listerHebdo(dossierParent);
    const aJeter = presentes.slice(0, Math.max(0, presentes.length - HEBDO_CONSERVEES));
    aJeter.forEach((f) => {
      try { fs.unlinkSync(path.join(cible, f.nom)); } catch (e) { /* deja partie */ }
    });

    etat.ecrite = true;
    etat.fait = new Date().toISOString();
    etat.conservees = presentes.length - aJeter.length;
    return etat;
  } catch (e) {
    etat.erreur = String((e && e.message) || e);
    etat.conservees = listerHebdo(dossierParent).length;
    return etat;
  }
}

module.exports = {
  sauvegardeDatee, listerSauvegardes, miroirImages, NOM_SAUVEGARDE,
  sauvegardeHebdo, listerHebdo, derniereEcheance, prochaineEcheance, dossierHebdo,
  DOSSIER_HEBDO, HEBDO_CONSERVEES
};
