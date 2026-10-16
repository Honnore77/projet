/* ===================================================================
   Point d'entree unique — application de bureau et PWA.
   =================================================================== */

import './styles/app.css';
import { initDB, persistNow, imagesCitees } from './core/db.js';
import { menageImages } from './core/images.js';
import { restoreSession, isLogged, arreterActivite } from './core/auth.js';
import { renderLogin } from './ui/login.js';
import { mountShell } from './ui/shell.js';
import { destroyCharts } from './ui/charts.js';
import { toast } from './ui/components.js';
import { traiterDemandePC } from './core/synchroClient.js';
import { appliquerTheme, appliquerZoom } from './ui/theme.js';
import { suivrePastille } from './ui/pastille.js';
import { installerMajuscule } from './ui/majuscule.js';
import { isAndroid, isDesktop } from './core/storage.js';

// Le style choisi sur cet appareil, avant tout affichage (ecran de
// connexion compris).
appliquerTheme();
appliquerZoom();

// Premiere lettre en majuscule dans les champs de saisie (sauf identifiant,
// mot de passe, email, liens).
installerMajuscule();

// Sur le telephone, pas d'export PDF : les boutons ecrits a la main dans
// les pages (rapports, imprime d'une demande) se cachent par la feuille de style.
if (isAndroid) document.documentElement.classList.add('sansPdf');

/*
 * Cache hors ligne (service worker) : utile a la seule version web.
 *
 * L'APK et l'application de bureau embarquent deja tous leurs fichiers.
 * Dans l'APK, le cache servait l'ancienne version au premier lancement
 * apres une mise a jour : une rubrique ajoutee n'apparaissait qu'au
 * lancement suivant. On l'y retire donc, avec ce qu'il avait garde, et on
 * recharge une fois sur les fichiers de l'APK.
 */
if ('serviceWorker' in navigator) {
  if (isAndroid || isDesktop) {
    navigator.serviceWorker.getRegistrations().then(async (inscrits) => {
      if (!inscrits.length) return;
      await Promise.all(inscrits.map((r) => r.unregister()));
      if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      location.reload();
    }).catch(() => { /* rien a retirer */ });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* hors ligne indisponible */ });
    });
  }
}

const root = document.getElementById('app');

async function boot() {
  let ctx = { firstRun: false, migrated: false };
  try {
    ctx = await initDB();
  } catch (e) {
    console.error('Initialisation impossible', e);
    root.innerHTML =
      '<div class="bootSplash"><p style="color:#D32F2F;max-width:420px;text-align:center">' +
      'Impossible de charger les données de l’application.<br>Vérifiez que le stockage local est autorisé, puis relancez.</p></div>';
    return;
  }

  // Les images abandonnees en cours de saisie s'effacent ici, une fois la
  // base connue. Sans attendre : le menage ne bloque pas l'ouverture, et
  // rater un tour ne coute que quelques kilo-octets jusqu'au prochain.
  menageImages(imagesCitees()).catch((e) => console.error('Ménage des images', e));

  // Sur le PC, le raccourci du bureau porte le nombre d'alertes.
  suivrePastille();

  // Sur le PC, la fenetre repond aux demandes de synchronisation du
  // telephone (voir electron/synchro-serveur.cjs).
  if (window.pduDesktop && window.pduDesktop.traiterDemandesSynchro) {
    window.pduDesktop.traiterDemandesSynchro(traiterDemandePC);
  }

  // Une session ouverte dans le meme onglet survit a un rafraichissement.
  if (restoreSession() && isLogged()) {
    showApp();
  } else {
    showLogin(ctx);
  }
}

function showLogin(ctx = {}) {
  destroyCharts();
  document.body.classList.remove('readonly');
  renderLogin(root, {
    firstRun: ctx.firstRun,
    migrated: ctx.migrated,
    onSuccess: showApp
  });
}

function showApp() {
  mountShell(root, { onLogout: () => showLogin({}) });
}

// Ecriture immediate avant fermeture, pour ne perdre aucune saisie.
// Le voyant du compte s'eteint : l'application se ferme.
window.addEventListener('beforeunload', () => {
  arreterActivite();
  persistNow();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistNow();
});

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  if (document.querySelector('#dashboard')) toast('Une opération a échoué. Consultez la console.', 'err');
});

boot();
