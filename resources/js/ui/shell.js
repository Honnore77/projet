/* ===================================================================
   Coquille de l application : en-tete, recherche, onglets, routeur.
   =================================================================== */

import { el, debounce, norm } from '../core/utils.js';
import { currentUser, canAdmin, logout, roleLabel } from '../core/auth.js';
// le logo vit dans public/ : Vite le copie tel quel a la racine du build
const logoUrl = './logo-pdu.png';

import { renderDashboard } from './views/dashboard.js';
import { renderVehicles } from './views/vehicles.js';
import { renderUsers } from './views/users.js';
import { renderDotation } from './views/dotation.js';
import { renderMissions } from './views/missions.js';
import { renderMaintenance } from './views/maintenance.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { renderVehicleSheet } from './views/vehicleSheet.js';
import { renderGlobalSearch } from './views/globalSearch.js';

export const MODULES = [
  { key: 'TABLEAU DE BORD', label: 'TABLEAU DE BORD' },
  { key: 'VEHICULES', label: 'VÉHICULES' },
  { key: 'UTILISATEURS', label: 'UTILISATEURS' },
  { key: 'DOTATION', label: 'DOTATION' },
  { key: 'MISSION', label: 'MISSION' },
  { key: 'ENTRETIEN', label: 'ENTRETIEN' },
  { key: 'RAPPORTS', label: 'RAPPORTS' },
  { key: 'REGLAGES', label: 'RÉGLAGES', adminOnly: true }
];

const TITLES = {
  'TABLEAU DE BORD': 'TABLEAU DE BORD',
  VEHICULES: 'VÉHICULES',
  UTILISATEURS: 'UTILISATEURS',
  DOTATION: 'DOTATION',
  MISSION: 'MISSION',
  ENTRETIEN: 'ENTRETIEN',
  RAPPORTS: 'RAPPORTS ET EXPORTS',
  REGLAGES: 'RÉGLAGES',
  FICHE_VEHICULE: 'FICHE VÉHICULE',
  RECHERCHE_GLOBALE: 'RECHERCHE GLOBALE'
};

/** Etat de navigation et de filtrage, partage par les vues. */
export const state = {
  module: 'TABLEAU DE BORD',
  sub: { VEHICULES: 'pool', DOTATION: 'pool', MISSION: 'suivi' },
  vehicleSheetImmat: null,
  query: '',
  filters: {
    vehicules: { statut: '', section: '' },
    users: { statut: '', section: '' },
    missions: { conducteur: '', dateFrom: '', dateTo: '', paiement: '' },
    maintenance: { etat: '', immat: '' },
    dotationPool: { dateFrom: '', dateTo: '', immat: '' },
    dotationMission: { dateFrom: '', dateTo: '', conducteur: '' }
  }
};

let root = null;
let contentEl = null;
let titleEl = null;
let tabsEl = null;
let searchInput = null;
let globalBtn = null;
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
        <div class="userChip">
          <b>${u ? escapeText(u.nom) : ''}</b>
          <span class="role-${u ? u.role : 'visiteur'}">${u ? escapeText(roleLabel(u.role).toUpperCase()) : ''}</span>
        </div>
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

  navigate('TABLEAU DE BORD');
}

function buildTabs() {
  tabsEl.innerHTML = '';
  MODULES.filter((m) => !m.adminOnly || canAdmin()).forEach((m) => {
    const b = el(`<button type="button" class="tab">${m.label}</button>`);
    b.dataset.mod = m.key;
    b.onclick = () => navigate(m.key);
    tabsEl.appendChild(b);
  });
}

/** Change de rubrique. */
export function navigate(moduleKey, params = {}) {
  state.module = moduleKey;
  if (params.immat !== undefined) state.vehicleSheetImmat = params.immat;
  if (moduleKey !== 'RECHERCHE_GLOBALE') {
    state.query = '';
    if (searchInput) searchInput.value = '';
    if (globalBtn) globalBtn.style.display = 'none';
  }
  titleEl.textContent = TITLES[moduleKey] || moduleKey;
  [...tabsEl.children].forEach((b) => b.classList.toggle('active', b.dataset.mod === moduleKey));
  rerender();
  contentEl.scrollTop = 0;
}

/** Ouvre la fiche unifiee d un vehicule. */
export function openVehicleSheet(immat) {
  if (!immat) return;
  navigate('FICHE_VEHICULE', { immat });
}

/** Redessine la rubrique courante. */
export function rerender() {
  if (!contentEl) return;
  const page = el('<div class="page"></div>');
  const renderer = ROUTES[state.module] || renderDashboard;
  renderer(page);
  contentEl.innerHTML = '';
  contentEl.appendChild(page);
  applyLocalFilter();
}

const ROUTES = {
  'TABLEAU DE BORD': renderDashboard,
  VEHICULES: renderVehicles,
  UTILISATEURS: renderUsers,
  DOTATION: renderDotation,
  MISSION: renderMissions,
  ENTRETIEN: renderMaintenance,
  RAPPORTS: renderReports,
  REGLAGES: renderSettings,
  FICHE_VEHICULE: renderVehicleSheet,
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
