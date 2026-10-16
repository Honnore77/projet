/* ===================================================================
   « Envoyer à… » — un export qui part en piece jointe d'une note.

   Les menus d'export (Excel, PDF, Word ; simple ou complet) proposent
   d'envoyer le fichier a des comptes de l'application au lieu de
   l'enregistrer. Le fichier produit arrive alors joint a une nouvelle
   note (rubrique NOTES), ou l'on choisit les destinataires, l'objet et le
   message avant d'envoyer.

   Ce module ne depend de rien : la rubrique NOTES s'y declare au
   demarrage (definirEnvoi), l'aperçu d'export y lit la demande en cours,
   et les barres de boutons y passent leurs exports.
   =================================================================== */

let envoyer = null;
/** Date de la demande d'envoi, consommee par le prochain export (une minute au plus). */
let envoiDemande = 0;

/** @param {({bytes:Uint8Array, filename:string}) => Promise<void>} fn */
export function definirEnvoi(fn) {
  envoyer = fn;
}

export const envoiDisponible = () => typeof envoyer === 'function';

/** Lance un export pour l'envoyer : le fichier arrivera joint a une note. */
export function exporterPourEnvoi(lancer) {
  envoiDemande = Date.now();
  return lancer();
}

/** Un export ordinaire : une demande d'envoi restee en suspens est oubliee. */
export function exporterNormalement(lancer) {
  envoiDemande = 0;
  return lancer();
}

/** Une demande d'envoi est-elle en cours ? La lire la consomme. */
export function prendreDemandeEnvoi() {
  const oui = !!envoiDemande && Date.now() - envoiDemande < 60 * 1000 && envoiDisponible();
  envoiDemande = 0;
  return oui;
}

/**
 * Apres un envoi, chaque rubrique annonce encore « Export terminé » ou
 * « Export annulé » (l'export n'a rien enregistre) : ce message n'a pas
 * lieu d'etre, le formulaire de la note est deja ouvert. Il est tu
 * pendant un court instant.
 */
let silenceJusqua = 0;
export const messagesExportTus = () => Date.now() < silenceJusqua;

/** Joint le fichier a une nouvelle note. */
export function envoyerFichier(filename, bytes) {
  silenceJusqua = Date.now() + 2000;
  return envoyer({ bytes, filename });
}
