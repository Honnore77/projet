/* ===================================================================
   Écran de connexion, et — sur le bureau — configuration de l'adresse
   du serveur au premier lancement.
   =================================================================== */

import { el, esc } from '../core/utils.js';
import { login } from '../core/auth.js';
import { isDesktop } from '../core/storage.js';
import { api, setServerUrl, getServerUrl, needsServerUrl, ApiError } from '../core/api.js';
import { DB, persist, outboxSize } from '../core/db.js';
import { toast, infoDialog } from './components.js';
import { openChangeOwnPassword } from './views/settings.js';

const logoUrl = './logo-pdu.jpg';

/**
 * @param {HTMLElement} root
 * @param {{onSuccess:Function, firstRun?:boolean, migrated?:boolean}} opts
 */
export function renderLogin(root, opts) {
  if (needsServerUrl()) return renderServerSetup(root, opts);
  return renderCredentials(root, opts);
}

/* ---------------------- Adresse du serveur ------------------------- */

function renderServerSetup(root, opts) {
  root.innerHTML = '';
  const screen = el(`
    <div id="login">
      <img class="brand" src="${logoUrl}" alt="PDU">
      <h1>CONNEXION AU SERVEUR</h1>
      <p class="note" style="margin:0 0 6px">Indiquez l'adresse du serveur de l'application.
        Elle vous a été communiquée par l'administrateur, et ressemble à
        <b>https://parc-pdu.laravel.cloud</b>.</p>
      <div class="field"><label for="srv">Adresse du serveur</label>
        <input id="srv" type="url" inputmode="url" autocapitalize="none" placeholder="https://…" value="${esc(getServerUrl())}"></div>
      <div class="err" id="srvErr"></div>
      <button class="btnPrimary" id="srvBtn" type="button">Tester et enregistrer</button>
      <div class="note">Cette adresse n'est demandée qu'une fois. Vous pourrez la modifier
        plus tard dans Réglages.</div>
    </div>`);
  root.appendChild(screen);

  const input = screen.querySelector('#srv');
  const err = screen.querySelector('#srvErr');
  const btn = screen.querySelector('#srvBtn');

  btn.onclick = async () => {
    const url = input.value.trim();
    if (!url) {
      err.textContent = "Renseignez l'adresse du serveur.";
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Vérification…';
    err.textContent = '';
    setServerUrl(url);
    try {
      const res = await api.health();
      DB.sync.serverUrl = getServerUrl();
      persist({ silent: true });
      toast(`Serveur joint : ${res.app || 'PDU Parc Auto'}`, 'ok');
      renderCredentials(root, opts);
    } catch (e) {
      setServerUrl(DB.sync.serverUrl || '');
      err.textContent =
        e instanceof ApiError && e.isOffline
          ? "Serveur injoignable. Vérifiez l'adresse et votre connexion."
          : `Le serveur a répondu, mais ce n'est pas l'application attendue (${e.message}).`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Tester et enregistrer';
    }
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
  setTimeout(() => input.focus(), 120);
}

/* -------------------------- Identifiants --------------------------- */

function renderCredentials(root, { onSuccess, firstRun, migrated }) {
  root.innerHTML = '';
  const attente = outboxSize();
  const screen = el(`
    <div id="login">
      <img class="brand" src="${logoUrl}" alt="PDU">
      <h1>GESTION DU PARC AUTOMOBILE</h1>
      <div class="field"><label for="user">Identifiant</label>
        <input id="user" type="text" autocomplete="username" autocapitalize="none"></div>
      <div class="field"><label for="pass">Mot de passe</label>
        <input id="pass" type="password" autocomplete="current-password"></div>
      <div class="err" id="loginErr"></div>
      <button class="btnPrimary" id="loginBtn" type="button">Se connecter</button>
      ${isDesktop ? '<button class="btnGhost" id="srvChange" type="button">Changer l\'adresse du serveur</button>' : ''}
      <div class="note" id="loginNote">${
        attente
          ? `${attente} modification(s) faite(s) hors ligne attendent d'être envoyées au serveur.`
          : 'Les données sont partagées avec le serveur ; ce poste en garde une copie utilisable sans connexion.'
      }</div>
    </div>`);
  root.appendChild(screen);

  const userInput = screen.querySelector('#user');
  const passInput = screen.querySelector('#pass');
  const errBox = screen.querySelector('#loginErr');
  const loginBtn = screen.querySelector('#loginBtn');

  if (firstRun) {
    infoDialog({
      title: 'Première utilisation',
      html:
        '<div class="modalMsg">Le serveur crée un compte administrateur au premier déploiement :\n\n' +
        '<b>Identifiant : admin</b>\n<b>Mot de passe : admin</b>\n\n' +
        'Vous devrez choisir un nouveau mot de passe dès la première connexion.</div>'
    });
    userInput.value = 'admin';
  }
  if (migrated) {
    toast('Données locales reprises : elles seront envoyées au serveur à la connexion.', 'ok', 5000);
  }

  const srvChange = screen.querySelector('#srvChange');
  if (srvChange) {
    srvChange.onclick = () => {
      DB.sync.serverUrl = '';
      setServerUrl('');
      persist({ silent: true });
      renderServerSetup(root, { onSuccess, firstRun, migrated });
    };
  }

  const attempt = async () => {
    const u = userInput.value.trim();
    const p = passInput.value;
    if (!u || !p) {
      errBox.textContent = 'Veuillez renseigner l’identifiant et le mot de passe.';
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connexion…';
    errBox.textContent = '';

    const res = await login(u, p);

    loginBtn.disabled = false;
    loginBtn.textContent = 'Se connecter';

    if (!res.ok) {
      errBox.textContent = res.error;
      passInput.value = '';
      passInput.focus();
      return;
    }
    if (res.offline) {
      toast('Serveur injoignable — session ouverte hors ligne.', 'info', 4500);
    }
    if (res.mustChange) {
      errBox.textContent = 'Choisissez un nouveau mot de passe pour continuer.';
      openChangeOwnPassword(() => onSuccess());
      return;
    }
    onSuccess();
  };

  loginBtn.onclick = attempt;
  [userInput, passInput].forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  });

  setTimeout(() => (firstRun ? passInput : userInput).focus(), 120);
}
