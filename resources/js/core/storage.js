/* ===================================================================
   Couche de persistance — un seul code, deux plateformes.

   - Bureau (Electron) : window.pduDesktop expose par electron/preload.cjs,
     les donnees sont ecrites dans un fichier JSON du dossier utilisateur.
   - Web / PWA         : localStorage du navigateur.

   L API est asynchrone dans les deux cas pour que le reste de
   l application ne connaisse jamais la plateforme.
   =================================================================== */

const WEB_KEY = 'pdu_parc_db_v4';

// Cles des versions precedentes, de la plus recente a la plus ancienne :
// v3 = version connectee a un serveur, v2 = version autonome,
// v1 = fichier HTML unique d'origine.
const LEGACY_KEYS = ['pdu_parc_db_v3', 'pdu_parc_db_v2', 'pdu_parc_data_v1'];

export const isDesktop = typeof window !== 'undefined' && !!window.pduDesktop;

export const platformName = isDesktop ? 'Bureau (Windows)' : 'Web / PWA';

/** Charge la base. Renvoie null si aucune donnee n existe encore. */
export async function readDB() {
  if (isDesktop) {
    const raw = await window.pduDesktop.load();
    return raw ? safeParse(raw) : null;
  }
  const raw = localStorage.getItem(WEB_KEY);
  return raw ? safeParse(raw) : null;
}

/** Ecrit la base. */
export async function writeDB(db) {
  const raw = JSON.stringify(db);
  if (isDesktop) return window.pduDesktop.save(raw);
  try {
    localStorage.setItem(WEB_KEY, raw);
    return true;
  } catch (e) {
    console.error('Ecriture impossible (quota localStorage ?)', e);
    return false;
  }
}

/**
 * Recupere les donnees de l ancienne version mono-fichier si elles existent
 * encore dans le navigateur, pour ne rien perdre lors de la migration.
 */
export function readLegacy() {
  try {
    for (const key of LEGACY_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) return safeParse(raw);
    }
  } catch (e) {
    return null;
  }
  return null;
}

/** Chemin du fichier de donnees (bureau uniquement), pour l affichage. */
export async function dataLocation() {
  if (isDesktop) return window.pduDesktop.dataPath();
  return 'Navigateur — stockage local (localStorage)';
}

/**
 * Enregistre un fichier binaire produit par l application (export Excel/PDF,
 * sauvegarde JSON). Sur le bureau on ouvre une vraie boite de dialogue,
 * sur le web on declenche un telechargement.
 * @returns {Promise<string|null>} chemin/fichier ecrit, ou null si annule
 */
export async function saveFile(filename, data, mime) {
  const bytes = toUint8(data);
  if (isDesktop) {
    return window.pduDesktop.saveFile(filename, Array.from(bytes));
  }
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

/* ------------------- Sauvegardes datees (bureau) ------------------- */

/**
 * Etat de la derniere copie datee.
 *
 * Sur le web il n'y a pas de dossier ou copier : la fonction repond alors
 * qu'aucune sauvegarde automatique n'existe, plutot que d'echouer, pour que
 * la rubrique REGLAGES s'affiche pareil des deux cotes.
 */
export async function backupEtat() {
  if (isDesktop && window.pduDesktop.backupEtat) return window.pduDesktop.backupEtat();
  return { fait: null, dossier: '', fichier: '', erreur: '', conservees: 0, indisponible: true };
}

/** Choix du dossier de sauvegarde (bureau uniquement). */
export async function backupChoisirDossier() {
  if (isDesktop && window.pduDesktop.backupChoisirDossier) return window.pduDesktop.backupChoisirDossier();
  return null;
}

/** Sauvegardes presentes dans le dossier, la plus recente en tete. */
export async function backupListe(dossier) {
  if (isDesktop && window.pduDesktop.backupListe) return window.pduDesktop.backupListe(dossier);
  return [];
}

/**
 * Ouvre un fichier et rend ses octets.
 *
 * La sauvegarde est devenue une archive, donc binaire : la lecture en texte
 * ne suffit plus. Les anciennes sauvegardes .json restent acceptees, elles
 * se decodent depuis ces memes octets.
 *
 * @returns {Promise<{nom:string, octets:Uint8Array}|null>}
 */
export async function openBinaryFile() {
  if (isDesktop && window.pduDesktop.openBytes) {
    const res = await window.pduDesktop.openBytes();
    return res ? { nom: res.nom, octets: new Uint8Array(res.octets) } : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.json,application/zip,application/json';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      resolve({ nom: f.name, octets: new Uint8Array(await f.arrayBuffer()) });
    };
    input.click();
  });
}

/** Ouvre un fichier texte (restauration de sauvegarde). */
export async function openTextFile() {
  if (isDesktop) return window.pduDesktop.openFile();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    input.click();
  });
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Donnees illisibles', e);
    return null;
  }
}

function toUint8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(data);
}
