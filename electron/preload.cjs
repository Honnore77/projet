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

  /* --- Synchronisation avec le telephone (code QR) --- */

  /** Ouvre le serveur local. @returns {Promise<{adresses:string[],port:number,jeton:string,expire:number,nom:string}>} */
  synchroDemarrer: () => ipcRenderer.invoke('synchro:demarrer'),
  synchroArreter: () => ipcRenderer.invoke('synchro:arreter'),
  /** Avancement : connexion du telephone, fusion, fin. Rend de quoi se desabonner. */
  surEtatSynchro: (cb) => {
    const f = (_e, etat) => cb(etat);
    ipcRenderer.on('synchro:etat', f);
    return () => ipcRenderer.removeListener('synchro:etat', f);
  },
  /** La fenetre fusionne la base du telephone avec la sienne et rend le resultat. */
  traiterDemandesSynchro: (traiter) => {
    ipcRenderer.on('synchro:demande', async (_e, { id, payload }) => {
      try {
        ipcRenderer.send('synchro:reponse', { id, resultat: await traiter(payload) });
      } catch (err) {
        ipcRenderer.send('synchro:reponse', { id, erreur: String((err && err.message) || err) });
      }
    });
  },

  /** Ouvre le selecteur de dossier. @returns {Promise<string|null>} */
  backupChoisirDossier: () => ipcRenderer.invoke('backup:dossier'),

  /** @param {string} dossier @returns {Promise<{nom:string,taille:number,date:string}[]>} */
  backupListe: (dossier) => ipcRenderer.invoke('backup:liste', dossier),

  /** Ouvre un fichier et rend ses octets. @returns {Promise<{nom:string,octets:number[]}|null>} */
  openBytes: () => ipcRenderer.invoke('file:openBytes'),

  /* --- Images jointes aux fiches, rangees hors de la base --- */

  /** @param {string} id @param {number[]} bytes @returns {Promise<boolean>} */
  imageEcrire: (id, bytes) => ipcRenderer.invoke('image:write', id, bytes),

  /** @param {string} id @returns {Promise<number[]|null>} */
  imageLire: (id) => ipcRenderer.invoke('image:read', id),

  /** @param {string} id @returns {Promise<boolean>} */
  imageSupprimer: (id) => ipcRenderer.invoke('image:delete', id),

  /** @returns {Promise<string[]>} identifiants presents dans le dossier */
  imageListe: () => ipcRenderer.invoke('image:list')
});
