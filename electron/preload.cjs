/* ===================================================================
   Pont securise entre la page et le processus principal.
   Aucune API Node n est exposee : uniquement les fonctions listees ici.
   =================================================================== */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pduDesktop', {
  /** @returns {Promise<string|null>} contenu JSON brut de la base */
  load: () => ipcRenderer.invoke('db:load'),

  /** @param {string} raw @returns {Promise<boolean>} */
  save: (raw) => ipcRenderer.invoke('db:save', raw),

  /** @returns {Promise<string>} chemin du fichier de donnees */
  dataPath: () => ipcRenderer.invoke('db:path'),

  /**
   * Boite de dialogue « Enregistrer sous ».
   * @param {string} filename @param {number[]} bytes
   * @returns {Promise<string|null>} chemin ecrit, ou null si annule
   */
  saveFile: (filename, bytes) => ipcRenderer.invoke('file:save', filename, bytes),

  /** @returns {Promise<string|null>} contenu texte du fichier choisi */
  openFile: () => ipcRenderer.invoke('file:open'),

  /* --- Sauvegardes datees automatiques --- */

  /** @returns {Promise<{fait:string|null,dossier:string,fichier:string,erreur:string,conservees:number}>} */
  backupEtat: () => ipcRenderer.invoke('backup:etat'),

  /** Ouvre le selecteur de dossier. @returns {Promise<string|null>} */
  backupChoisirDossier: () => ipcRenderer.invoke('backup:dossier'),

  /** @param {string} dossier @returns {Promise<{nom:string,taille:number,date:string}[]>} */
  backupListe: (dossier) => ipcRenderer.invoke('backup:liste', dossier)
});
