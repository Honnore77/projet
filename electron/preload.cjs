/* ===================================================================
   Pont securise entre la page et le processus principal.
   Aucune API Node n est exposee : uniquement ces cinq fonctions.
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
  openFile: () => ipcRenderer.invoke('file:open')
});
