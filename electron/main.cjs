/* ===================================================================
   Processus principal Electron — application de bureau Windows.

   Les donnees sont stockees dans un fichier JSON du dossier utilisateur
   (%APPDATA%\PDU Parc Auto\pdu-parc-auto.json), avec une copie de
   securite a chaque ecriture.
   =================================================================== */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { sauvegardeDatee, listerSauvegardes, miroirImages, sauvegardeHebdo, listerHebdo } = require('./sauvegarde.cjs');

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
  etatSauvegarde = sauvegardeDatee(
    raw,
    reglages.dossierSauvegarde,
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

/* ---------------------- Sauvegarde hebdomadaire --------------------- */

let etatHebdo = { ecrite: false, fait: null, dossier: '', fichier: '', erreur: '', conservees: 0 };

/**
 * Chaque vendredi a 18 h 30, une copie dans « SAUVEGADE AUTOMATIQUE HEBDO ».
 *
 * Verifiee au lancement puis chaque minute : la semaine manquee parce que
 * l'application etait fermee le vendredi soir se rattrape au lancement
 * suivant. La copie part du fichier de la base tel qu'il est sur le disque.
 */
function verifierSauvegardeHebdo() {
  try {
    const file = dataFile();
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    let reglages = {};
    try { reglages = (JSON.parse(raw) || {}).settings || {}; } catch (e) { return; }
    etatHebdo = sauvegardeHebdo(raw, reglages.dossierSauvegarde);
    // Les photos aussi : la copie de la semaine doit se suffire a elle-meme.
    if (etatHebdo.ecrite && etatHebdo.dossier) {
      const im = miroirImages(imagesDir(), etatHebdo.dossier);
      etatHebdo.images = im.copiees;
      if (im.erreur) etatHebdo.erreur = `images : ${im.erreur}`;
    }
  } catch (e) {
    etatHebdo = Object.assign({}, etatHebdo, { erreur: String((e && e.message) || e) });
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

ipcMain.handle('db:save', (_evt, raw) => {
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

/** Etat de la sauvegarde hebdomadaire, verifiee a la demande. */
ipcMain.handle('backup:hebdo', () => {
  verifierSauvegardeHebdo();
  return Object.assign({}, etatHebdo, {
    liste: etatHebdo.dossier ? listerHebdo(path.dirname(etatHebdo.dossier)).slice().reverse() : []
  });
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
  listerSauvegardes(dossier).slice().reverse());

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
    // Laisse a l'application le temps de charger (et de reprendre une base
    // ancienne) avant la premiere verification ; ensuite, chaque minute.
    setTimeout(verifierSauvegardeHebdo, 15000);
    setInterval(verifierSauvegardeHebdo, 60 * 1000);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
