/* ===================================================================
   Processus principal Electron — application de bureau Windows.

   Les donnees sont stockees dans un fichier JSON du dossier utilisateur
   (%APPDATA%\PDU Parc Auto\pdu-parc-auto.json), avec une copie de
   securite a chaque ecriture.
   =================================================================== */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { sauvegardeDatee, listerSauvegardes, miroirImages, dossierCopies } = require('./sauvegarde.cjs');
const { creerServeurSynchro, adressesLocales, codeLisible } = require('./synchro-serveur.cjs');
const os = require('node:os');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const isDev = !app.isPackaged && process.env.PDU_DEV !== '0';

let win = null;

function dataFile() {
  return path.join(app.getPath('userData'), 'pdu-parc-auto.json');
}
function backupFile() {
  return path.join(app.getPath('userData'), 'pdu-parc-auto.backup.json');
}

/**
 * Dossier des images jointes aux fiches.
 *
 * Elles ne sont pas dans la base : celle-ci est reecrite en entier a chaque
 * saisie, et sur le web elle tient dans localStorage. Les octets vivent donc
 * a cote, nommes par leur identifiant, et la fiche ne retient que celui-ci.
 */
function imagesDir() {
  return path.join(app.getPath('userData'), 'images');
}

/** Chemin d'une image. Rejette tout identifiant qui sortirait du dossier. */
function imageFile(id) {
  const nom = String(id || '');
  if (!/^img_[A-Za-z0-9]+$/.test(nom)) return null;
  return path.join(imagesDir(), `${nom}.jpg`);
}

/* ------------------------ Sauvegarde datee ------------------------- */

/**
 * Etat de la derniere tentative de copie datee, lu par la rubrique REGLAGES.
 * On ne fait jamais echouer un enregistrement a cause d'une sauvegarde : la
 * cle USB peut etre debranchee, le disque reseau injoignable. La saisie
 * prime, et l'ecran dit ensuite ce qui n'a pas pu se faire.
 */
let etatSauvegarde = { fait: null, dossier: '', fichier: '', erreur: '', conservees: 0 };

/** Lance la copie datee a partir des reglages contenus dans la base. */
function copierSelonReglages(raw) {
  let reglages = {};
  try {
    reglages = (JSON.parse(raw) || {}).settings || {};
  } catch (e) {
    return; // base illisible : rien a copier
  }
  // Les copies vont dans le sous-dossier « SAUVEGARDE AUTOMATIQUE QUOTIDIENNE »
  // du dossier choisi ; les photos suivent, dans son sous-dossier images.
  etatSauvegarde = sauvegardeDatee(
    raw,
    dossierCopies(reglages.dossierSauvegarde),
    reglages.sauvegardesConservees
  );

  // Les photos vivent hors de la base : sans elles, la copie datee ne
  // ramenerait que des fiches citant des images introuvables.
  if (etatSauvegarde.dossier && !etatSauvegarde.erreur) {
    const im = miroirImages(imagesDir(), etatSauvegarde.dossier);
    etatSauvegarde.images = im.copiees;
    if (im.erreur) etatSauvegarde.erreur = `images : ${im.erreur}`;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    show: false,
    backgroundColor: '#F5F7F8',
    title: 'PDU Parc Auto',
    // L'icone de la fenetre — donc celle de la barre des taches — doit venir
    // d'un chemin reellement empaquete. « resources/static » ne l'est pas :
    // seuls « public/app » et « electron » le sont, et Vite y recopie les
    // icones. Pointer ailleurs ne provoque aucune erreur, la fenetre retombe
    // simplement sur l'icone du binaire, ce qui donnait l'atome d'Electron.
    // Le .ico est prefere sous Windows : il porte les petites tailles
    // dessinees a la main, la barre des taches en affiche une de 32 px.
    icon: path.join(__dirname, '..', 'public', 'app', 'icons',
      process.platform === 'win32' ? 'icon.ico' : 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Le lecteur PDF integre de Chromium sert les apercus avant export.
      plugins: true
    }
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(DEV_URL).catch(() => win.loadFile(path.join(__dirname, '..', 'public', 'app', 'index.html')));
  } else {
    win.loadFile(path.join(__dirname, '..', 'public', 'app', 'index.html'));
  }

  // L impression des rapports ouvre une fenetre dediee ; les liens
  // externes partent dans le navigateur du systeme.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Ouvrir le dossier des données',
          click: () => shell.showItemInFolder(dataFile())
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { role: 'toggleDevTools', label: 'Outils de développement' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'À propos',
              message: 'PDU — Gestion de parc automobile',
              detail:
                `Version ${app.getVersion()}\n\n` +
                `Données : ${dataFile()}\n\n` +
                'Véhicules, utilisateurs, dotations carburant, missions et entretien.'
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------ IPC -------------------------------- */

ipcMain.handle('db:load', () => {
  try {
    if (fs.existsSync(dataFile())) return fs.readFileSync(dataFile(), 'utf8');
    if (fs.existsSync(backupFile())) return fs.readFileSync(backupFile(), 'utf8');
    return null;
  } catch (e) {
    console.error('Lecture impossible', e);
    return null;
  }
});

/**
 * Version de la base de ce PC : l'heure du dernier enregistrement. Les
 * postes du bureau la demandent toutes les quelques secondes et ne
 * synchronisent que si elle a change (ou s'ils ont eux-memes du nouveau).
 */
let versionBase = Date.now();

ipcMain.handle('db:save', (_evt, raw) => {
  versionBase = Date.now();
  try {
    const file = dataFile();
    // copie de securite de la version precedente avant d ecraser
    if (fs.existsSync(file)) fs.copyFileSync(file, backupFile());
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, raw, 'utf8');
    fs.renameSync(tmp, file);
    // La copie datee vient apres, et ne peut rien compromettre : l'ecriture
    // qui compte est deja faite.
    copierSelonReglages(raw);
    return true;
  } catch (e) {
    console.error('Ecriture impossible', e);
    return false;
  }
});

ipcMain.handle('db:path', () => dataFile());

/** Etat de la derniere copie datee, pour l'affichage dans REGLAGES. */
ipcMain.handle('backup:etat', () => etatSauvegarde);

/* ------------------- Synchronisation avec le telephone ------------------- */

// La base du PC vit dans la fenetre : c'est elle qui fusionne. Le serveur lui
// transmet chaque demande et attend sa reponse.
let demandesEnCours = new Map();
let numeroDemande = 0;
function demanderFusion(payload) {
  return new Promise((resolve, reject) => {
    if (!win) return reject(new Error('application fermée'));
    numeroDemande += 1;
    const id = numeroDemande;
    const delai = setTimeout(() => { demandesEnCours.delete(id); reject(new Error('pas de réponse de l’application')); }, 60000);
    demandesEnCours.set(id, { resolve, reject, delai });
    win.webContents.send('synchro:demande', { id, payload });
  });
}
ipcMain.on('synchro:reponse', (_evt, { id, resultat, erreur }) => {
  const d = demandesEnCours.get(id);
  if (!d) return;
  clearTimeout(d.delai);
  demandesEnCours.delete(id);
  if (erreur) d.reject(new Error(erreur)); else d.resolve(resultat);
});

const serveurSynchro = creerServeurSynchro({
  imagesDir,
  imageFile,
  demanderFusion,
  surEtat: (etat) => { if (win) win.webContents.send('synchro:etat', etat); },
  nom: `PC ${os.hostname()}`
});

/** Affiche le code QR : ouvre le serveur et rend son adresse et son jeton. */
ipcMain.handle('synchro:demarrer', async () => serveurSynchro.demarrer());
ipcMain.handle('synchro:arreter', () => { serveurSynchro.arreter(); return true; });

/* ------------------------- Réseau du bureau ------------------------- */

/**
 * Plusieurs PC, une seule base, sans Internet : un PC est le serveur du
 * bureau (sa base fait reference), les autres sont des postes qui s'y
 * synchronisent en continu sur le reseau local.
 *
 * Le reglage est propre a chaque PC : il vit dans un fichier a cote de la
 * base, pas dans la base (qui se synchronise, elle).
 *   mode     'seul' (par defaut), 'serveur' ou 'poste'
 *   port     port du serveur (47800 par defaut)
 *   code     code du bureau, exige a chaque echange
 *   serveur  adresse du PC serveur (poste)
 */
const PORT_BUREAU = 47800;

function fichierReseau() {
  return path.join(app.getPath('userData'), 'reseau.json');
}

function lireReseau() {
  try {
    const c = JSON.parse(fs.readFileSync(fichierReseau(), 'utf8'));
    return Object.assign({ mode: 'seul', port: PORT_BUREAU, code: '', serveur: '' }, c);
  } catch (e) {
    return { mode: 'seul', port: PORT_BUREAU, code: '', serveur: '' };
  }
}

function ecrireReseau(c) {
  fs.mkdirSync(path.dirname(fichierReseau()), { recursive: true });
  fs.writeFileSync(fichierReseau(), JSON.stringify(c, null, 2));
}

/** Le code du bureau : lisible, a recopier sur chaque poste. */
const nouveauCodeBureau = codeLisible;

const serveurBureau = creerServeurSynchro({
  imagesDir,
  imageFile,
  demanderFusion,
  version: () => versionBase,
  surEtat: (etat) => { if (win) win.webContents.send('reseau:etat', etat); },
  nom: `PC ${os.hostname()}`
});
let erreurBureau = '';

/** Ouvre ou ferme le serveur du bureau selon le reglage. */
async function appliquerReseau() {
  const c = lireReseau();
  erreurBureau = '';
  if (c.mode !== 'serveur') { serveurBureau.arreter(); return; }
  try {
    await serveurBureau.demarrerPermanent({ port: c.port || PORT_BUREAU, code: c.code });
  } catch (e) {
    erreurBureau = e && e.code === 'EADDRINUSE'
      ? `Le port ${c.port || PORT_BUREAU} est déjà utilisé sur ce PC (une autre copie de l’application est-elle ouverte ?).`
      : String((e && e.message) || e);
  }
}

function etatReseau() {
  const c = lireReseau();
  return Object.assign({}, c, {
    nomPC: `PC ${os.hostname()}`,
    adresses: adressesLocales(),
    actif: serveurBureau.permanent(),
    erreur: erreurBureau
  });
}

ipcMain.handle('reseau:lire', () => etatReseau());

/** Enregistre le reglage (mode, adresse du serveur, code) et l'applique. */
ipcMain.handle('reseau:enregistrer', async (_evt, choix) => {
  const c = lireReseau();
  const mode = ['seul', 'serveur', 'poste'].includes(choix && choix.mode) ? choix.mode : 'seul';
  const suite = Object.assign({}, c, { mode });
  if (mode === 'serveur' && !suite.code) suite.code = nouveauCodeBureau();
  if (mode === 'poste') {
    suite.serveur = String((choix && choix.serveur) || '').trim();
    suite.code = String((choix && choix.code) || '').trim().toUpperCase();
  }
  if (choix && choix.port) suite.port = Number(choix.port) || PORT_BUREAU;
  ecrireReseau(suite);
  await appliquerReseau();
  return etatReseau();
});

/** Nouveau code du bureau : les postes devront saisir le nouveau. */
ipcMain.handle('reseau:nouveauCode', async () => {
  const c = lireReseau();
  c.code = nouveauCodeBureau();
  ecrireReseau(c);
  await appliquerReseau();
  return etatReseau();
});

/** Choix du dossier de sauvegarde. @returns {Promise<string|null>} */
ipcMain.handle('backup:dossier', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Dossier des sauvegardes automatiques',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Choisir ce dossier'
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

/** Liste des sauvegardes presentes dans un dossier, la plus recente en tete. */
ipcMain.handle('backup:liste', (_evt, dossier) =>
  listerSauvegardes(dossierCopies(dossier)).slice().reverse());

/* ---------------------------- Images ------------------------------- */

ipcMain.handle('file:openBytes', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Ouvrir une sauvegarde',
    properties: ['openFile'],
    filters: [{ name: 'Sauvegarde PDU', extensions: ['zip', 'json'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  try {
    return {
      nom: path.basename(res.filePaths[0]),
      octets: Array.from(fs.readFileSync(res.filePaths[0]))
    };
  } catch (e) {
    console.error('Lecture impossible', e);
    return null;
  }
});

ipcMain.handle('image:write', (_evt, id, bytes) => {
  const f = imageFile(id);
  if (!f) return false;
  try {
    fs.mkdirSync(imagesDir(), { recursive: true });
    fs.writeFileSync(f, Buffer.from(bytes));
    return true;
  } catch (e) {
    console.error('Image non enregistree', e);
    return false;
  }
});

ipcMain.handle('image:read', (_evt, id) => {
  const f = imageFile(id);
  if (!f) return null;
  try {
    return fs.existsSync(f) ? Array.from(fs.readFileSync(f)) : null;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('image:delete', (_evt, id) => {
  const f = imageFile(id);
  if (!f) return false;
  try {
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('image:list', () => {
  try {
    return fs.readdirSync(imagesDir())
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => f.slice(0, -4));
  } catch (e) {
    return [];
  }
});

/* -------------- Pieces jointes ouvertes dans Word ou Excel -------------- */

/**
 * Une piece jointe d'une note s'ouvre dans le logiciel du PC (Word, Excel,
 * le lecteur PDF) a partir d'une copie de travail. Quand l'utilisateur a
 * enregistre ses modifications, l'application relit cette copie et en fait
 * une nouvelle version de la piece.
 */
function piecesOuvertesDir() {
  return path.join(app.getPath('userData'), 'pieces-ouvertes');
}

/** Les copies de travail de plus d'une semaine sont oubliees. */
function menagePiecesOuvertes() {
  const limite = Date.now() - 7 * 24 * 3600 * 1000;
  try {
    fs.readdirSync(piecesOuvertesDir()).forEach((d) => {
      const p = path.join(piecesOuvertesDir(), d);
      if (fs.statSync(p).mtimeMs < limite) fs.rmSync(p, { recursive: true, force: true });
    });
  } catch (e) { /* aucun dossier */ }
}

ipcMain.handle('piece:ouvrir', async (_evt, nom, bytes) => {
  menagePiecesOuvertes();
  const propre = path.basename(String(nom || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'document';
  const dossier = path.join(piecesOuvertesDir(), `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    const f = path.join(dossier, propre);
    fs.writeFileSync(f, Buffer.from(bytes));
    const erreur = await shell.openPath(f);
    return erreur ? { ok: false, erreur } : { ok: true, chemin: f };
  } catch (e) {
    return { ok: false, erreur: String(e.message || e) };
  }
});

ipcMain.handle('piece:relire', (_evt, chemin) => {
  const f = path.resolve(String(chemin || ''));
  // Seules les copies de travail se relisent : rien d'autre sur le disque.
  if (!f.startsWith(piecesOuvertesDir() + path.sep)) return null;
  try {
    return fs.existsSync(f) ? Array.from(fs.readFileSync(f)) : null;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('file:save', async (_evt, filename, bytes) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Enregistrer le fichier',
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: filtersFor(filename)
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, Buffer.from(bytes));
  return res.filePath;
});

ipcMain.handle('file:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Ouvrir une sauvegarde',
    properties: ['openFile'],
    filters: [{ name: 'Sauvegarde PDU', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return fs.readFileSync(res.filePaths[0], 'utf8');
});

function filtersFor(filename) {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  const known = {
    xlsx: { name: 'Classeur Excel', extensions: ['xlsx'] },
    pdf: { name: 'Document PDF', extensions: ['pdf'] },
    json: { name: 'Sauvegarde PDU (ancien format)', extensions: ['json'] },
    zip: { name: 'Sauvegarde PDU (données et images)', extensions: ['zip'] }
  };
  return [known[ext] || { name: 'Fichier', extensions: [ext || '*'] }];
}

/* ------------------------- Pastille d'alertes ----------------------- */

/*
 * La fenetre dessine l'icone (logo + pastille rouge portant le nombre
 * d'alertes, voir resources/js/ui/pastille.js) ; on l'applique ici :
 *   - au raccourci « PDU Parc Auto » du bureau, s'il existe ;
 *   - au bouton de la fenetre dans la barre des taches.
 * Sans alerte, le raccourci reprend l'icone de son programme.
 *
 * Chaque icone porte un nom neuf : l'Explorateur garde en cache l'image
 * d'un fichier deja vu, il afficherait encore l'ancien nombre.
 */
const NOM_RACCOURCI = 'PDU Parc Auto.lnk';

function dossierPastilles() {
  return path.join(app.getPath('userData'), 'pastilles');
}

function appliquerPastille(n, ico, seule) {
  if (process.platform !== 'win32') return { ok: false, raison: 'Windows seulement' };

  if (win) {
    win.setOverlayIcon(n && seule ? nativeImage.createFromBuffer(Buffer.from(seule)) : null,
      n ? `${n} alerte${n > 1 ? 's' : ''}` : '');
  }

  const lnk = path.join(app.getPath('desktop'), NOM_RACCOURCI);
  if (!fs.existsSync(lnk)) return { ok: false, raison: 'pas de raccourci sur le bureau' };
  let lien;
  try { lien = shell.readShortcutLink(lnk); } catch (e) { return { ok: false, raison: String(e.message || e) }; }

  const dossier = dossierPastilles();
  let icone = lien.target;
  let garder = '';
  if (n && ico) {
    fs.mkdirSync(dossier, { recursive: true });
    garder = `alertes-${n}-${Date.now()}.ico`;
    icone = path.join(dossier, garder);
    fs.writeFileSync(icone, Buffer.from(ico));
  }
  shell.writeShortcutLink(lnk, 'update', { icon: icone, iconIndex: 0 });

  // Les icones precedentes ne servent plus.
  try {
    fs.readdirSync(dossier).filter((f) => f.endsWith('.ico') && f !== garder)
      .forEach((f) => fs.rmSync(path.join(dossier, f), { force: true }));
  } catch (e) { /* dossier absent : rien a nettoyer */ }

  // Demande a Windows de rafraichir les icones affichees.
  try {
    spawn('ie4uinit.exe', ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { /* le bureau se mettra a jour a son rythme */ }
  return { ok: true };
}

ipcMain.handle('pastille:alertes', (_evt, n, ico, seule) => {
  try {
    return appliquerPastille(Number(n) || 0, ico, seule);
  } catch (e) {
    return { ok: false, raison: String((e && e.message) || e) };
  }
});

/* ---------------------------- Cycle de vie -------------------------- */

// Une seule instance : eviter deux fenetres qui ecrivent le meme fichier.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    // PC serveur du bureau : le serveur s'ouvre avec l'application. Les
    // demandes qui arrivent avant que la fenetre soit prete attendent sa
    // reponse (voir demanderFusion).
    appliquerReseau();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => { serveurSynchro.arreter(); serveurBureau.arreter(); });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
