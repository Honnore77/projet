/* ===================================================================
   Point d'entree unique — site web, PWA et application de bureau.
   =================================================================== */

import './styles/app.css';
import { initDB, persistNow } from './core/db.js';
import { restoreSession, isLogged, loadStoredCredentials, invalidateSession } from './core/auth.js';
import { startSync, stopSync, syncNow } from './core/sync.js';
import { needsServerUrl, hasToken } from './core/api.js';
import { renderLogin } from './ui/login.js';
import { mountShell, rerender } from './ui/shell.js';
import { destroyCharts } from './ui/charts.js';
import { toast } from './ui/components.js';

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

  // Adresse du serveur et jeton d'acces conserves sur ce poste.
  loadStoredCredentials();

  // Sur le bureau, tant qu'aucune base n'a jamais ete jointe, on considere
  // qu'il s'agit d'une premiere mise en service.
  if (needsServerUrl()) ctx.firstRun = ctx.firstRun || !hasToken();

  if (restoreSession() && isLogged()) {
    showApp();
  } else {
    showLogin(ctx);
  }
}

function showLogin(ctx = {}) {
  destroyCharts();
  stopSync();
  document.body.classList.remove('readonly');
  renderLogin(root, {
    firstRun: ctx.firstRun,
    migrated: ctx.migrated,
    onSuccess: showApp
  });
}

function showApp() {
  mountShell(root, { onLogout: () => showLogin({}) });

  startSync({
    onSessionLost: () => {
      invalidateSession();
      toast('Session expirée sur le serveur — reconnectez-vous.', 'err', 5000);
      showLogin({});
    }
  });

  // Premiere descente au plus tot : l'interface affiche le miroir local en
  // attendant, puis se rafraichit quand le serveur a repondu.
  syncNow({ quiet: true }).then((res) => {
    if (res && res.ok && (res.received || res.sent)) rerender();
  });
}

// Ecriture immediate avant fermeture, pour ne perdre aucune saisie.
window.addEventListener('beforeunload', () => {
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
