/* ===================================================================
   Coquille de l application : en-tete, recherche, onglets, routeur.
   =================================================================== */

import { el, debounce, norm, fmt } from '../core/utils.js';
import { currentUser, canAdmin, logout, roleLabel } from '../core/auth.js';
import { DB, onChange, voyantsVidange, vehiculesImmobilises, vehicleByImmat } from '../core/db.js';
import {
  voit, voitTout, seulementSiennes, peutSaisir, peutSupprimer, estAMoi, definirRubrique
} from '../core/acces.js';
// le logo vit dans public/ : Vite le copie tel quel a la racine du build
const logoUrl = './logo-pdu.png';

import { renderDashboard } from './views/dashboard.js';
import { renderVehicles } from './views/vehicles.js';
import { renderUsers } from './views/users.js';
import { renderDotation } from './views/dotation.js';
import { renderMissions } from './views/missions.js';
import { renderMaintenance } from './views/maintenance.js';
import { renderDecharges } from './views/decharges.js';
import { renderSimulation } from './views/simulation.js';
import { renderReports } from './views/reports.js';
import { renderSettings, openChangeOwnPassword } from './views/settings.js';
import { renderPredefinis } from './views/predefinis.js';
import { ouvrirApparence } from './apparence.js';
import { renderVehicleSheet } from './views/vehicleSheet.js';
import { renderUserSheet } from './views/userSheet.js';
import { renderGlobalSearch } from './views/globalSearch.js';
import { destroyCharts } from './charts.js';

/**
 * Chaque rubrique porte sa couleur : teinte legere au repos, aplat plein
 * quand elle est ouverte. Dix teintes bien distinctes, pour qu'on repere la
 * rubrique a la couleur avant meme d'avoir lu le libelle.
 */
export const MODULES = [
  { key: 'TABLEAU DE BORD', label: 'TABLEAU DE BORD', color: '#008A3B' },
  { key: 'VEHICULES', label: 'VÉHICULES', color: '#1976D2' },
  { key: 'UTILISATEURS', label: 'UTILISATEURS', color: '#6A3CB4' },
  { key: 'DOTATION', label: 'DOTATION', color: '#F47B20' },
  { key: 'MISSION', label: 'MISSION', color: '#C2185B' },
  { key: 'ENTRETIEN', label: 'ENTRETIEN', color: '#D32F2F' },
  { key: 'DECHARGE', label: 'DÉCHARGE', color: '#8D6E63' },
  { key: 'SIMULATION', label: 'SIMULATION', color: '#3949AB' },
  { key: 'RAPPORTS', label: 'RAPPORTS', color: '#00838F' },
  // Ouverte a tous les comptes : style et taille de l'affichage.
  { key: 'PREDEFINIS', label: 'RÉGLAGES PRÉDÉFINIS', color: '#00897B', pourTous: true },
  { key: 'REGLAGES', label: 'RÉGLAGES', color: '#5b7178', adminOnly: true }
];

/** Couleur d'une rubrique, pour les vues qui veulent s'y accorder. */
export function moduleColor(key) {
  const m = MODULES.find((x) => x.key === key);
  return m ? m.color : '#5b7178';
}

const TITLES = {
  'TABLEAU DE BORD': 'TABLEAU DE BORD',
  VEHICULES: 'VÉHICULES',
  UTILISATEURS: 'UTILISATEURS',
  DOTATION: 'DOTATION',
  MISSION: 'MISSION',
  ENTRETIEN: 'ENTRETIEN',
  DECHARGE: 'DÉCHARGE',
  SIMULATION: 'SIMULATION',
  RAPPORTS: 'RAPPORTS ET EXPORTS',
  PREDEFINIS: 'RÉGLAGES PRÉDÉFINIS',
  REGLAGES: 'RÉGLAGES',
  FICHE_VEHICULE: 'FICHE VÉHICULE',
  FICHE_UTILISATEUR: 'FICHE UTILISATEUR',
  RECHERCHE_GLOBALE: 'RECHERCHE GLOBALE'
};

/** Etat de navigation et de filtrage, partage par les vues. */
export const state = {
  module: 'TABLEAU DE BORD',
  sub: { VEHICULES: 'pool', DOTATION: 'pool', MISSION: 'suivi', DECHARGE: 'decharges', SIMULATION: 'simulation', UTILISATEURS: 'liste', ENTRETIEN: 'liste' },
  vehicleSheetImmat: null,
  userSheetId: null,
  query: '',
  filters: {
    vehicules: { statut: '', section: '' },
    users: { statut: '', section: '' },
    missions: { conducteur: '', dateFrom: '', dateTo: '', paiement: '' },
    maintenance: { etat: '', immat: '' },
    dotationPool: { dateFrom: '', dateTo: '', immat: '' },
    dotationMission: { dateFrom: '', dateTo: '', conducteur: '' },
    decharges: { dateFrom: '', dateTo: '', destinataire: '' },
    indisponibilites: { etat: '', motif: '', conducteur: '' },
    // annee affichee par les sous-rubriques STATISTIQUES (l'annee en cours d'abord)
    statistiques: {}
  }
};

let root = null;
let contentEl = null;
let titleEl = null;
let tabsEl = null;
let searchInput = null;
let globalBtn = null;
let alertBarEl = null;
let stopAlertWatch = null;
let alertResizeBound = false;
let onLogoutCb = null;
/** Construit la coquille et l affiche dans #app. */
export function mountShell(appRoot, { onLogout }) {
  root = appRoot;
  onLogoutCb = onLogout;
  const u = currentUser();

  root.innerHTML = '';
  const dash = el(`
    <div id="dashboard">
      <header class="top">
        <img src="${logoUrl}" alt="PDU">
        <h2 id="pageTitle">TABLEAU DE BORD</h2>
        <div class="alertBar" id="alertBar"></div>
        <div class="userChip">
          <b>${u ? escapeText(u.nom) : ''}</b>
          <span class="role-${u ? u.role : 'visiteur'}">${u ? escapeText(roleLabel(u.role).toUpperCase()) : ''}</span>
        </div>
        <button id="apparenceBtn" type="button" title="Apparence : style, taille, fond">🎨</button>
        <button id="logoutBtn" type="button">Quitter</button>
      </header>
      <div class="shellBody">
        <nav class="tabs"><div class="tabsScroll" id="tabsScroll"></div></nav>
        <div class="shellMain">
          <div class="searchWrap">
            <div class="inner">
              <input id="search" type="text" placeholder="Rechercher dans l'application…" autocomplete="off">
              <button id="globalSearchBtn" class="globalBtn" type="button">🔍 Voir dans toutes les rubriques →</button>
            </div>
          </div>
          <div id="content"></div>
        </div>
      </div>
    </div>`);
  root.appendChild(dash);

  contentEl = dash.querySelector('#content');
  titleEl = dash.querySelector('#pageTitle');
  tabsEl = dash.querySelector('#tabsScroll');
  searchInput = dash.querySelector('#search');
  globalBtn = dash.querySelector('#globalSearchBtn');
  alertBarEl = dash.querySelector('#alertBar');

  // Le bandeau vit hors du contenu : il ne se redessine pas avec la rubrique.
  // On le raccroche donc aux changements de la base. Se deconnecter puis se
  // reconnecter remonte la coquille : sans ce desabonnement, un second
  // abonnement ecrirait dans un bandeau qui n'est plus a l'ecran.
  if (stopAlertWatch) stopAlertWatch();
  stopAlertWatch = onChange(renderAlertBar);
  // Le bandeau change de forme selon la largeur : detaille sur un ecran
  // large, reduit a des comptes sur un telephone. Il doit donc se redessiner
  // quand la fenetre change de taille, pas seulement quand la base bouge.
  if (!alertResizeBound) {
    window.addEventListener('resize', debounce(renderAlertBar, 150));
    alertResizeBound = true;
  }
  renderAlertBar();

  // Chacun change son mot de passe d'un clic sur son nom : seul
  // l'administrateur a acces aux REGLAGES.
  const puce = dash.querySelector('.userChip');
  puce.title = 'Changer mon mot de passe';
  puce.onclick = () => openChangeOwnPassword();

  // Chacun choisit son style, sa taille d'affichage et son fond.
  dash.querySelector('#apparenceBtn').onclick = () => ouvrirApparence({ surChoix: rerender });

  dash.querySelector('#logoutBtn').onclick = () => {
    logout();
    if (onLogoutCb) onLogoutCb();
  };

  buildTabs();

  searchInput.addEventListener(
    'input',
    debounce(() => {
      state.query = searchInput.value;
      if (state.module === 'RECHERCHE_GLOBALE') return rerender();
      globalBtn.style.display = state.query.trim().length >= 2 ? 'block' : 'none';
      applyLocalFilter();
    }, 130)
  );
  globalBtn.onclick = () => navigate('RECHERCHE_GLOBALE');

  navigate(premiereRubrique());
}

/**
 * Une rubrique du menu est-elle ouverte au compte connecte ? UTILISATEURS
 * l'est aussi pour qui ne voit que CONGES ET ABSENCES.
 */
function rubriqueOuverte(m) {
  if (m.pourTous) return true;
  if (m.adminOnly) return canAdmin();
  if (m.key === 'UTILISATEURS') return voit('UTILISATEURS') || voit('CONGES');
  return voit(m.key);
}

/** La premiere rubrique ouverte : la page d'arrivee du compte. */
function premiereRubrique() {
  const m = MODULES.find(rubriqueOuverte);
  return m ? m.key : 'TABLEAU DE BORD';
}

function buildTabs() {
  tabsEl.innerHTML = '';
  MODULES.filter(rubriqueOuverte).forEach((m) => {
    const b = el(`<button type="button" class="tab">${m.label}</button>`);
    b.dataset.mod = m.key;
    b.style.setProperty('--tabColor', m.color);
    b.onclick = () => navigate(m.key);
    tabsEl.appendChild(b);
  });
}

/** Change de rubrique. */
export function navigate(moduleKey, params = {}) {
  state.module = moduleKey;
  if (params.immat !== undefined) state.vehicleSheetImmat = params.immat;
  if (params.userId !== undefined) state.userSheetId = params.userId;
  if (moduleKey !== 'RECHERCHE_GLOBALE') {
    state.query = '';
    if (searchInput) searchInput.value = '';
    if (globalBtn) globalBtn.style.display = 'none';
  }
  titleEl.textContent = TITLES[moduleKey] || moduleKey;
  const onglet = moduleKey === 'FICHE_UTILISATEUR' ? 'UTILISATEURS' : moduleKey === 'FICHE_VEHICULE' ? 'VEHICULES' : moduleKey;
  // La couleur de la rubrique ouverte, pour les styles qui s'y accordent.
  document.documentElement.style.setProperty('--couleur-rubrique', moduleColor(onglet));
  [...tabsEl.children].forEach((b) => b.classList.toggle('active', b.dataset.mod === onglet));
  rerender();
  contentEl.scrollTop = 0;
}

/**
 * Nombre de voyants affiches avant de replier le reste derriere « +N ».
 *
 * Le bandeau partage sa ligne avec le logo, le titre et le compte connecte :
 * au-dela, il chasse le titre au lieu de prevenir. Les plus urgents passent
 * en premier, le compte final dit ce qui n'a pas tenu.
 */
const MAX_VOYANTS = 5;

/** En dessous de cette largeur, le bandeau ne donne plus que des comptes. */
const LARGEUR_COMPACTE = 560;

/**
 * Bandeau d'alerte de l'en-tete : vidanges qui approchent et vehicules
 * immobilises, sur la meme ligne que le logo.
 *
 * Il est volontairement muet quand tout va bien : un bandeau qui affiche
 * quelque chose en permanence finit par ne plus rien vouloir dire.
 */
function renderAlertBar() {
  if (!alertBarEl) return;
  alertBarEl.innerHTML = '';
  // Les voyants parlent de tout le parc : reserves a qui le voit en entier.
  if (!voitTout('VEHICULES')) return;
  const entete = alertBarEl.parentElement;

  const vidanges = voyantsVidange();
  const immobilises = vehiculesImmobilises();

  // Les vidanges d'abord : elles se comptent en kilometres qui defilent, alors
  // qu'un vehicule au garage y reste tant qu'on n'a rien fait.
  const voyants = [
    ...vidanges.map((x) => ({
      classe: x.niveau,
      clignote: true,
      icone: '🛢️',
      immat: x.immat || '(sans immat.)',
      texte: x.etat.restant <= 0
        ? `${fmt(-x.etat.restant)} km de retard`
        : `${fmt(x.etat.restant)} km`,
      titre: `Vidange due à ${fmt(x.etat.cible)} km`,
      go: x.immat
    })),
    ...immobilises.map((x) => ({
      classe: 'garage',
      clignote: false,
      icone: '🔧',
      immat: x.immat,
      texte: x.jours === null ? 'immobilisé' : `${x.jours} j`,
      titre: x.motif ? `Immobilisé — ${x.motif.split('\n')[0]}` : 'Véhicule immobilisé',
      go: x.immat
    }))
  ];

  // Sur telephone, le titre cede la place aux voyants — mais seulement quand
  // il y en a. La rubrique ouverte se lit de toute facon sur son onglet.
  if (entete) entete.classList.toggle('hasAlerts', voyants.length > 0);
  if (!voyants.length) return;

  if (window.innerWidth <= LARGEUR_COMPACTE) {
    rendreCompact(voyants);
    return;
  }
  // Autant de voyants detailles que la place le permet (le bandeau partage
  // sa ligne avec le logo, le titre, le compte et les boutons) : un voyant
  // coupe ne se lirait plus. Si meme un seul ne tient pas, les comptes.
  const deborde = () => alertBarEl.scrollWidth > alertBarEl.clientWidth + 1;
  for (let max = Math.min(MAX_VOYANTS, voyants.length); max >= 1; max -= 1) {
    alertBarEl.innerHTML = '';
    rendreDetaille(voyants, max);
    if (!deborde()) return;
  }
  alertBarEl.innerHTML = '';
  rendreCompact(voyants);
}

/** Un voyant par vehicule : immatriculation et kilometres restants. */
function rendreDetaille(voyants, max) {
  voyants.slice(0, max).forEach((v) => {
    const b = el(
      `<button type="button" class="voyant ${v.classe}${v.clignote ? ' clignote' : ''}" title="${escapeText(v.titre)}">` +
        `<span aria-hidden="true">${v.icone}</span><b>${escapeText(v.immat)}</b><span>${escapeText(v.texte)}</span>` +
        '</button>'
    );
    b.onclick = () => openVehicleSheet(v.go);
    alertBarEl.appendChild(b);
  });

  const reste = voyants.length - max;
  if (reste > 0) {
    const plus = el(`<button type="button" class="voyant autres" title="Voir tous les véhicules concernés">+${reste}</button>`);
    plus.onclick = () => navigate('VEHICULES');
    alertBarEl.appendChild(plus);
  }
}

/**
 * Sur un ecran etroit, un voyant par vehicule ne tient pas : les
 * immatriculations se retrouvaient coupees des deux cotes, et une alerte
 * tronquee vaut moins que pas d'alerte du tout.
 *
 * On donne alors le nombre par couleur. La couleur previent, le compte dit
 * l'ampleur, et le doigt fait le reste : on touche pour savoir lesquels.
 */
function rendreCompact(voyants) {
  const libelles = {
    rouge: 'à vidanger sans délai',
    orange: 'vidange proche',
    jaune: 'vidange à prévoir',
    garage: 'au garage'
  };
  ['rouge', 'orange', 'jaune', 'garage'].forEach((classe) => {
    const lot = voyants.filter((v) => v.classe === classe);
    if (!lot.length) return;
    const b = el(
      `<button type="button" class="voyant ${classe}${lot[0].clignote ? ' clignote' : ''}" ` +
        `title="${escapeText(`${lot.length} véhicule(s) ${libelles[classe]} : ${lot.map((v) => v.immat).join(', ')}`)}">` +
        `<span aria-hidden="true">${lot[0].icone}</span><b>${lot.length}</b></button>`
    );
    b.onclick = () => (classe === 'garage' ? navigate('ENTRETIEN') : navigate('VEHICULES'));
    alertBarEl.appendChild(b);
  });
}

/** Ouvre la fiche d'un agent (rubrique UTILISATEURS). */
export function openUserSheet(id) {
  if (!id) return;
  navigate('FICHE_UTILISATEUR', { userId: id });
}

/** Ouvre la fiche unifiee d un vehicule. */
export function openVehicleSheet(immat) {
  if (!immat) return;
  navigate('FICHE_VEHICULE', { immat });
}

/** Redessine la rubrique courante. */
export function rerender() {
  if (!contentEl) return;
  // Les graphiques de la page precedente (tableau de bord, statistiques)
  // ne survivent pas a son remplacement.
  destroyCharts();
  const page = el('<div class="page"></div>');
  // UTILISATEURS s'ouvre sur la sous-rubrique que le compte peut voir.
  if (state.module === 'UTILISATEURS') {
    if (state.sub.UTILISATEURS !== 'indisponibilites' && !voit('UTILISATEURS') && voit('CONGES')) state.sub.UTILISATEURS = 'indisponibilites';
    if (state.sub.UTILISATEURS === 'indisponibilites' && !voit('CONGES') && voit('UTILISATEURS')) state.sub.UTILISATEURS = 'liste';
  }
  const rub = rubriqueDeLaPage();
  definirRubrique(rub);
  // Boutons d'ajout et de modification, puis de suppression, selon le
  // niveau du compte dans la rubrique affichee. Un conducteur garde les
  // siens dans MISSION (rapport) et CONGES (ses demandes).
  const sesFiches = seulementSiennes(rub) && ['MISSION', 'CONGES'].includes(rub);
  // RÉGLAGES PRÉDÉFINIS ne touche pas aux donnees : jamais en lecture seule.
  const reglagesPerso = rub === 'PREDEFINIS';
  document.body.classList.toggle('readonly', !peutSaisir(rub) && !sesFiches && !reglagesPerso);
  document.body.classList.toggle('sansSuppression', !peutSupprimer(rub));
  if (pageAutorisee(rub)) {
    const renderer = ROUTES[state.module] || renderDashboard;
    renderer(page);
  } else {
    page.appendChild(el(
      '<div class="card" style="border-left-color:#D32F2F"><h3>ACCÈS RESTREINT</h3>' +
      '<p>Votre compte n’a pas accès à cette page. Si vous en avez besoin, demandez-le à un administrateur.</p></div>'
    ));
  }
  contentEl.innerHTML = '';
  contentEl.appendChild(page);
  applyLocalFilter();
}

/** La rubrique dont la page affichee depend, pour les droits. */
function rubriqueDeLaPage() {
  const m = state.module;
  if (m === 'FICHE_VEHICULE') return 'VEHICULES';
  if (m === 'FICHE_UTILISATEUR') return 'UTILISATEURS';
  if (m === 'UTILISATEURS') return state.sub.UTILISATEURS === 'indisponibilites' ? 'CONGES' : 'UTILISATEURS';
  return m;
}

/** Le compte connecte peut-il ouvrir cette page ? */
function pageAutorisee(rub) {
  const m = state.module;
  if (m === 'REGLAGES') return canAdmin();
  if (m === 'PREDEFINIS') return true;
  if (m === 'RECHERCHE_GLOBALE') return true;
  if (m === 'FICHE_VEHICULE') {
    return voitTout('VEHICULES') || (seulementSiennes('VEHICULES') && estAMoi('VEHICULES', vehicleByImmat(state.vehicleSheetImmat)));
  }
  if (m === 'FICHE_UTILISATEUR') {
    const u = DB.users.find((x) => x.id === state.userSheetId);
    return voitTout('UTILISATEURS') || (seulementSiennes('UTILISATEURS') && estAMoi('UTILISATEURS', u));
  }
  if (m === 'UTILISATEURS') return voit('UTILISATEURS') || voit('CONGES');
  return voit(rub);
}

const ROUTES = {
  'TABLEAU DE BORD': renderDashboard,
  VEHICULES: renderVehicles,
  UTILISATEURS: renderUsers,
  DOTATION: renderDotation,
  MISSION: renderMissions,
  ENTRETIEN: renderMaintenance,
  DECHARGE: renderDecharges,
  SIMULATION: renderSimulation,
  RAPPORTS: renderReports,
  PREDEFINIS: renderPredefinis,
  REGLAGES: renderSettings,
  FICHE_VEHICULE: renderVehicleSheet,
  FICHE_UTILISATEUR: renderUserSheet,
  RECHERCHE_GLOBALE: renderGlobalSearch
};

/** Filtre a la volee les blocs de la page courante selon la recherche. */
function applyLocalFilter() {
  if (!contentEl) return;
  const q = norm(state.query).trim();
  contentEl.querySelectorAll('[data-search]').forEach((node) => {
    const match = !q || norm(node.dataset.search).includes(q);
    node.style.display = match ? '' : 'none';
  });
}

function escapeText(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

export function getContentEl() {
  return contentEl;
}
