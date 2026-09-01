/* ===================================================================
   Processus principal Electron — application de bureau Windows.

   Les donnees sont stockees dans un fichier JSON du dossier utilisateur
   (%APPDATA%\PDU Parc Auto\pdu-parc-auto.json), avec une copie de
   securite a chaque ecriture.
   =================================================================== */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const isDev = !app.isPackaged && process.env.PDU_DEV !== '0';

let win = null;

function dataFile() {
  return path.join(app.getPath('userData'), 'pdu-parc-auto.json');
}
function backupFile() {
  return path.join(app.getPath('userData'), 'pdu-parc-auto.backup.json');
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
    return true;
  } catch (e) {
    console.error('Ecriture impossible', e);
    return false;
  }
});

ipcMain.handle('db:path', () => dataFile());

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
    json: { name: 'Sauvegarde PDU', extensions: ['json'] }
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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
