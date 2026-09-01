/* ===================================================================
   Support commun des tests.

   Le code metier est ecrit pour le navigateur : « storage.js » range la base
   dans localStorage. Node n'en a pas, alors on lui en pose un en memoire —
   c'est la seule chose qui manque pour que db.js s'execute tel quel, sans
   qu'on ait a l'adapter pour les tests. Adapter le code a ses tests revient
   a tester autre chose que ce qui tourne.
   =================================================================== */

const memoire = new Map();

globalThis.localStorage = {
  getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
  setItem: (k, v) => memoire.set(k, String(v)),
  removeItem: (k) => memoire.delete(k),
  clear: () => memoire.clear()
};

// `window` reste absent : « isDesktop » vaut alors false et la couche de
// persistance prend son chemin navigateur, celui de la version web et de
// l'APK. Le chemin Electron, lui, n'est qu'une lecture-ecriture de fichier.

export const db = await import('../resources/js/core/db.js');

/**
 * Installe une base de test et renvoie l'objet vivant.
 *
 * Passe par `replaceDB`, donc par `normalize` : les tests voient exactement
 * ce que verrait l'application au chargement d'une sauvegarde, reprises
 * comprises.
 */
export async function charger(donnees = {}) {
  const base = Object.assign(
    {
      accounts: [{ id: 'c1', login: 'admin', role: 'admin', actif: true }],
      users: [],
      vehicles: { pool: [], mission: [], service: [] },
      dotationPool: [],
      missions: [],
      maintenance: []
    },
    donnees
  );
  return db.replaceDB(base);
}

/** Vehicule minimal, complete par ce qu'on lui passe. */
export function vehicule(o = {}) {
  return Object.assign({ marque: 'NISSAN', modele: 'NAVARA', statut: 'Disponible' }, o);
}

/** Agent minimal. */
export function agent(o = {}) {
  return Object.assign({ nom: 'AGENT', prenoms: 'TEST', statut: 'Actif', poolConducteur: 'Non' }, o);
}
