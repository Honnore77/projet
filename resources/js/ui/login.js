/* ===================================================================
   Écran de connexion.
   =================================================================== */

import { el, esc } from '../core/utils.js';
import { login, inscrire } from '../core/auth.js';
import { toast, infoDialog, openForm } from './components.js';
import { openChangeOwnPassword } from './views/settings.js';
import { decorActuel, decorPleinePage } from './theme.js';
import { ouvrirApparence } from './apparence.js';

const logoUrl = './logo-pdu.png';
const armoiriesUrl = './armoiries-ci.png';

/** Identifiant retenu par « Se souvenir de moi ». Jamais le mot de passe. */
const CLE_MEMOIRE = 'pdu_dernier_identifiant';

/* ---------------------- pictogrammes en ligne ---------------------- */

const ICONES = {
  voiture:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/>' +
    '<path d="M3 13h18v4a1 1 0 0 1-1 1h-1.5"/><path d="M5.5 18H4a1 1 0 0 1-1-1v-4"/>' +
    '<circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
  personne:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg>',
  cadenas:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>' +
    '<circle cx="12" cy="15.5" r="1.4"/></svg>',
  oeil:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  oeilBarre:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 12s3.6-6.5 10-6.5c1.7 0 3.2.4 4.5 1"/><path d="M20.6 8.4C21.5 9.6 22 12 22 12s-3.6 6.5-10 6.5c-2 0-3.7-.5-5.1-1.2"/>' +
    '<path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>'
};

/**
 * @param {HTMLElement} root
 * @param {{onSuccess:Function, firstRun?:boolean, migrated?:boolean}} opts
 */
export function renderLogin(root, { onSuccess, firstRun, migrated }) {
  const memorise = lireIdentifiantRetenu();
  const annee = new Date().getFullYear();

  root.innerHTML = '';
  const screen = el(`
    <div id="login"${decorActuel() ? ` data-decor="${decorActuel()}"` : ''}${decorPleinePage(decorActuel()) ? ' data-plein' : ''}>
      <header class="cxEntete">
        <img class="cxLogo" src="${logoUrl}" alt="Programme de Décentralisation des Universités">
        <div class="cxTitre">
          <span>GESTION DE PARC<br>AUTOMOBILE</span>
          <span class="cxTrait"></span>
        </div>
        <div class="cxEtat">
          <img src="${armoiriesUrl}" alt="Armoiries de la République de Côte d'Ivoire">
          <small>RÉPUBLIQUE DE<br>CÔTE D'IVOIRE</small>
        </div>
      </header>

      <div class="cxMilieu">
      <main class="cxCorps">
        <div class="cxBadge">${ICONES.voiture}</div>
        <h1>CONNEXION</h1>
        <p class="cxSous">Veuillez vous connecter à votre compte</p>

        <div class="cxChampBloc">
          <label for="user">Identifiant</label>
          <div class="cxChamp">
            <span class="cxIcone">${ICONES.personne}</span>
            <input id="user" type="text" placeholder="Entrez votre identifiant"
                   autocomplete="username" autocapitalize="none" value="${esc(memorise)}">
          </div>
        </div>

        <div class="cxChampBloc">
          <label for="pass">Mot de passe</label>
          <div class="cxChamp">
            <span class="cxIcone">${ICONES.cadenas}</span>
            <input id="pass" type="password" placeholder="Entrez votre mot de passe"
                   autocomplete="current-password">
            <button type="button" class="cxOeil" id="voirMdp"
                    aria-label="Afficher le mot de passe">${ICONES.oeilBarre}</button>
          </div>
          <div class="cxMaj" id="alerteMaj" role="alert" hidden>⇪ Attention : la touche Majuscule (Verr. Maj) est activée.</div>
        </div>

        <div class="cxOptions">
          <label class="cxCase">
            <input type="checkbox" id="seSouvenir"${memorise ? ' checked' : ''}>
            <span>Se souvenir de moi</span>
          </label>
          <button type="button" class="cxLien" id="mdpOublie">Mot de passe oublié ?</button>
        </div>

        <div class="err" id="loginErr"></div>

        <button class="cxBouton" id="loginBtn" type="button">
          ${ICONES.cadenas}<span>SE CONNECTER</span>
        </button>

        <button class="cxApparence" id="apparenceBtn" type="button" title="Choisir le fond de cette page">🎨 Fond</button>
        <button class="cxInscrire" id="inscrireBtn" type="button">
          Pas encore de compte ? <b>S’inscrire</b>
        </button>

        <div class="cxIllustration"><span class="cxPhoto"></span></div>
      </main>
      </div>

      <footer class="cxPied">
        © ${annee} PDU – Programme de Décentralisation des Universités<br>
        Tous droits réservés
      </footer>
    </div>`);
  root.appendChild(screen);

  const userInput = screen.querySelector('#user');
  const passInput = screen.querySelector('#pass');
  const errBox = screen.querySelector('#loginErr');
  const loginBtn = screen.querySelector('#loginBtn');
  const seSouvenir = screen.querySelector('#seSouvenir');

  // Une image absente laisse son emplacement vide, sans icône cassée.
  screen.querySelectorAll('.cxEntete img').forEach((img) => {
    img.onerror = () => img.remove();
  });

  /* ---- alerte touche Majuscule ---- */
  // Un mot de passe tape en majuscules par megarde est refuse sans que l'on
  // comprenne pourquoi : on previent des que Verr. Maj est actif.
  const alerteMaj = screen.querySelector('#alerteMaj');
  const verifierMaj = (e) => {
    if (!e || typeof e.getModifierState !== 'function') return;
    alerteMaj.hidden = !e.getModifierState('CapsLock');
  };
  ['keydown', 'keyup', 'mousedown'].forEach((t) => passInput.addEventListener(t, verifierMaj));
  passInput.addEventListener('blur', () => { alerteMaj.hidden = true; });

  const oeil = screen.querySelector('#voirMdp');
  oeil.onclick = () => {
    const visible = passInput.type === 'text';
    passInput.type = visible ? 'password' : 'text';
    oeil.innerHTML = visible ? ICONES.oeilBarre : ICONES.oeil;
    oeil.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
    passInput.focus();
  };

  /* ---- mot de passe oublié ---- */
  screen.querySelector('#mdpOublie').onclick = () => {
    infoDialog({
      title: 'Mot de passe oublié',
      html:
        '<div class="modalMsg">Les mots de passe sont chiffrés sur ce poste et ne peuvent pas être retrouvés, ' +
        'même par l’application.\n\n' +
        '<b>Vous avez un administrateur :</b> demandez-lui de réinitialiser votre mot de passe dans ' +
        'Réglages → Comptes et accès. Vous en choisirez un nouveau à la connexion suivante.\n\n' +
        '<b>Vous êtes le seul administrateur :</b> la seule issue est de restaurer une sauvegarde ' +
        'antérieure à l’oubli — d’où l’intérêt d’en exporter régulièrement.</div>'
    });
  };

  if (firstRun) {
    infoDialog({
      title: 'Première utilisation',
      html:
        '<div class="modalMsg">Un compte administrateur a été créé automatiquement :\n\n' +
        '<b>Identifiant : admin</b>\n<b>Mot de passe : admin</b>\n\n' +
        'Vous devrez choisir un nouveau mot de passe dès la première connexion.</div>'
    });
    userInput.value = 'admin';
  }
  if (migrated) {
    toast('Données de la version précédente récupérées.', 'ok', 4500);
  }

  const attempt = async () => {
    const u = userInput.value.trim();
    const p = passInput.value;
    if (!u || !p) {
      errBox.textContent = 'Veuillez renseigner l’identifiant et le mot de passe.';
      return;
    }
    loginBtn.disabled = true;
    loginBtn.querySelector('span').textContent = 'CONNEXION…';
    errBox.textContent = '';

    const res = await login(u, p);

    loginBtn.disabled = false;
    loginBtn.querySelector('span').textContent = 'SE CONNECTER';

    if (!res.ok) {
      errBox.textContent = res.error;
      passInput.value = '';
      passInput.focus();
      return;
    }

    retenirIdentifiant(seSouvenir.checked ? u : null);

    if (res.mustChange) {
      // tant que le mot de passe n'est pas changé, on reste sur cet écran
      errBox.textContent = 'Choisissez un nouveau mot de passe pour continuer.';
      openChangeOwnPassword(() => onSuccess());
      return;
    }
    onSuccess();
  };

  loginBtn.onclick = attempt;
  // Le fond de la page se choisit avant meme de se connecter : il est
  // propre a l'appareil, et s'applique aussitot.
  const poserFond = (id) => {
    if (id) screen.dataset.decor = id; else delete screen.dataset.decor;
    if (decorPleinePage(id)) screen.dataset.plein = ''; else delete screen.dataset.plein;
  };
  // Un clic : apercu sur la page ; double clic : valide.
  screen.querySelector('#apparenceBtn').onclick = () => ouvrirApparence({
    titre: '🎨 Fond de la page de connexion', style: false, taille: false,
    surApercu: poserFond,
    surDecor: poserFond
  });
  screen.querySelector('#inscrireBtn').onclick = () => ouvrirInscription((identifiant) => {
    userInput.value = identifiant;
    passInput.value = '';
  });
  [userInput, passInput].forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  });

  // preventScroll : sans cela, donner le focus au champ ferait defiler la
  // page et masquerait l'en-tete des l'ouverture sur une fenetre courte.
  setTimeout(() => (memorise || firstRun ? passInput : userInput).focus({ preventScroll: true }), 120);
}

/* ---------------------------- Inscription --------------------------- */

/**
 * Demande d'inscription. Le compte attend ensuite qu'un administrateur le
 * valide (REGLAGES → Comptes et accès) et lui donne son role.
 */
function ouvrirInscription(apres) {
  openForm({
    title: 'Demande d’inscription',
    intro: 'Votre compte servira dès qu’un administrateur l’aura validé et vous aura attribué vos accès.',
    fields: [
      { key: 'nom', label: 'Nom et prénoms', required: true, full: true,
        hint: 'Tels qu’ils figurent dans la liste des agents du PDU' },
      { key: 'login', label: 'Identifiant souhaité', required: true, full: true,
        hint: 'Celui que vous taperez pour vous connecter' },
      { key: 'password', label: 'Mot de passe', type: 'password', required: true, full: true,
        hint: '6 caractères minimum, avec au moins une lettre et un chiffre' },
      { key: 'password2', label: 'Confirmer le mot de passe', type: 'password', required: true, full: true }
    ],
    okLabel: 'Envoyer ma demande',
    onSubmit: async (v) => {
      if (v.password !== v.password2) return 'Les deux mots de passe ne correspondent pas.';
      const res = await inscrire({ login: v.login, nom: v.nom, password: v.password });
      if (!res.ok) return res.error;
      if (apres) apres(String(v.login).trim());
      setTimeout(() => infoDialog({
        title: 'Demande envoyée',
        message: 'Votre demande d’inscription est enregistrée. Vous pourrez vous connecter dès qu’un ' +
          'administrateur l’aura validée.\n\nSur un téléphone, la demande parvient au PC à la prochaine synchronisation.'
      }), 80);
      return null;
    }
  });
}

/* ------------------------------------------------------------------ */

function lireIdentifiantRetenu() {
  try {
    return localStorage.getItem(CLE_MEMOIRE) || '';
  } catch (e) {
    return '';
  }
}

/**
 * « Se souvenir de moi » ne retient que l'identifiant. Conserver le mot de
 * passe ferait de l'ecran de connexion une simple formalite pour quiconque
 * ouvre la session Windows du poste.
 */
function retenirIdentifiant(identifiant) {
  try {
    if (identifiant) localStorage.setItem(CLE_MEMOIRE, identifiant);
    else localStorage.removeItem(CLE_MEMOIRE);
  } catch (e) { /* stockage indisponible : sans consequence */ }
}
