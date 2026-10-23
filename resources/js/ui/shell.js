/* ===================================================================
   Coquille de l application : en-tete, recherche, onglets, routeur.
   =================================================================== */

import { el, debounce, norm, fmt } from '../core/utils.js';
import { currentUser, canAdmin, logout, roleLabel } from '../core/auth.js';
import { DB, onChange, voyantsVidange, vehiculesImmobilises, vehicleByImmat, allVehicles, immatOf, STATUT_NON_ATTRIBUE } from '../core/db.js';
import {
  voit, voitTout, seulementSiennes, peutSaisir, peutSupprimer, estAMoi, definirRubrique
} from '../core/acces.js';
// le logo vit dans public/ : Vite le copie tel quel a la racine du build
const logoUrl = './logo-pdu.png';

import { renderDashboard } from './views/dashboard.js';
import { renderVehicles, suivreRechercheVehicules } from './views/vehicles.js';
import { renderUsers } from './views/users.js';
import { renderDotation } from './views/dotation.js';
import { renderMissions } from './views/missions.js';
import { renderMaintenance } from './views/maintenance.js';
import { renderDecharges } from './views/decharges.js';
import { renderNotes, renderComptes } from './views/notes.js';
import { notesNonLues } from '../core/notes.js';
import { demarrerNotesFlottantes, annoncerNotes, fermer as fermerNotesFlottantes } from './notesFlottante.js';
import { etatPoste, suivrePoste, surReceptionPoste } from '../core/reseauBureau.js';
import { renderSimulation } from './views/simulation.js';
import { renderReports } from './views/reports.js';
import { renderSettings, openChangeOwnPassword } from './views/settings.js';
import { ouvrirApparence } from './apparence.js';
import { annulerApercuTheme } from './theme.js';
import { renderVehicleSheet } from './views/vehicleSheet.js';
import { renderUserSheet } from './views/userSheet.js';
import { renderGlobalSearch } from './views/globalSearch.js';
import { destroyCharts } from './charts.js';
import { ouvrirExportRecherche, tailleDuResultat } from './exportRecherche.js';

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
  // Messagerie interne : chaque compte y ecrit et y lit ses notes.
  { key: 'NOTES', label: 'NOTES', color: '#558B2F', pourTous: true },
  // Ouverte a tous les comptes : style et taille de l'affichage.
  // Tous les comptes, le point de leurs notes et le voyant des comptes en utilisation.
  { key: 'COMPTE', label: 'COMPTE', color: '#00695C', pourTous: true },
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
  NOTES: 'NOTES',
  COMPTE: 'COMPTE',
  REGLAGES: 'RÉGLAGES',
  FICHE_VEHICULE: 'FICHE VÉHICULE',
  FICHE_UTILISATEUR: 'FICHE UTILISATEUR',
  RECHERCHE_GLOBALE: 'RECHERCHE GLOBALE'
};

/** Etat de navigation et de filtrage, partage par les vues. */
export const state = {
  module: 'TABLEAU DE BORD',
  sub: { VEHICULES: 'pool', DOTATION: 'pool', MISSION: 'suivi', DECHARGE: 'decharges', SIMULATION: 'simulation', UTILISATEURS: 'liste', ENTRETIEN: 'liste', NOTES: 'recues' },
  vehicleSheetImmat: null,
  userSheetId: null,
  visite: 0,
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
let exportBtn = null;
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
        <span id="voyantReseau" class="voyantReseau" hidden></span>
        <button id="apparenceBtn" type="button" title="Apparence : style, taille, fond">🎨</button>
        <button id="logoutBtn" type="button">Quitter</button>
      </header>
      <div class="shellBody">
        <nav class="tabs"><div class="tabsScroll" id="tabsScroll"></div></nav>
        <div class="shellMain">
          <div class="searchWrap">
            <div class="inner">
              <input id="search" type="text" placeholder="Rechercher dans l'application…" autocomplete="off">
              <div class="searchActions">
                <button id="globalSearchBtn" class="globalBtn" type="button">🔍 Voir dans toutes les rubriques →</button>
                <button id="exportSearchBtn" class="globalBtn exportBtn" type="button" aria-haspopup="true">⬇ Exporter le résultat ▾</button>
              </div>
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
  exportBtn = dash.querySelector('#exportSearchBtn');
  alertBarEl = dash.querySelector('#alertBar');

  // Le bandeau vit hors du contenu : il ne se redessine pas avec la rubrique.
  // On le raccroche donc aux changements de la base. Se deconnecter puis se
  // reconnecter remonte la coquille : sans ce desabonnement, un second
  // abonnement ecrirait dans un bandeau qui n'est plus a l'ecran.
  if (stopAlertWatch) stopAlertWatch();
  stopAlertWatch = onChange(() => { renderAlertBar(); majBadgeNotes(); annoncer(); });
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
    fermerNotesFlottantes();
    logout();
    if (onLogoutCb) onLogoutCb();
  };

  buildTabs();
  if (!notesBadgeBound) {
    document.addEventListener('notes-lues', majBadgeNotes);
    notesBadgeBound = true;
  }

  searchInput.addEventListener(
    'input',
    debounce(() => {
      state.query = searchInput.value;
      if (state.module === 'RECHERCHE_GLOBALE') return rerender();
      globalBtn.style.display = state.query.trim().length >= 2 ? 'block' : 'none';
      // VEHICULES cherche aussi dans ses autres sous-rubriques.
      if (state.module === 'VEHICULES' && suivreRechercheVehicules(state.query)) return rerender();
      applyLocalFilter();
    }, 130)
  );
  globalBtn.onclick = () => navigate('RECHERCHE_GLOBALE');
  exportBtn.onclick = (ev) => {
    ev.stopPropagation();
    ouvrirExportRecherche(exportBtn, contentEl, titleEl.textContent, state.query);
  };

  brancherReseau(dash.querySelector('#voyantReseau'));

  // A l'arrivee, la fenetre flottante annonce les notes qui attendent.
  demarrerNotesFlottantes(u ? u.id : null);
  navigate(premiereRubrique());
}

/* ------------------------- Réseau du bureau ------------------------- */

let reseauBranche = false;
let rafraichirEnAttente = false;

/**
 * Des donnees arrivent d'un autre PC : la page se redessine — mais jamais
 * sous les doigts de quelqu'un. Formulaire ouvert ou saisie en cours, on
 * attend : la page se redessinera a la prochaine occasion.
 */
function rafraichirSiLibre() {
  if (!contentEl) return;
  const actif = document.activeElement;
  const occupe = document.querySelector('.modalBack') ||
    (actif && contentEl.contains(actif) && /^(INPUT|TEXTAREA|SELECT)$/.test(actif.tagName));
  if (occupe) { rafraichirEnAttente = true; return; }
  rafraichirEnAttente = false;
  rerender();
}

/** Voyant de l'en-tete et redessin a l'arrivee de donnees (poste ou serveur). */
let voyantReseauEl = null;

function brancherReseau(voyantNeuf) {
  voyantReseauEl = voyantNeuf;
  const dessinerPoste = (e) => {
    const voyant = voyantReseauEl;
    if (!voyant) return;
    if (!e.actif) { voyant.hidden = true; return; }
    voyant.hidden = false;
    voyant.className = `voyantReseau ${e.connecte ? 'ok' : 'hs'}`;
    voyant.textContent = e.connecte ? '🖧 Bureau' : '🖧 Hors ligne';
    voyant.title = e.connecte
      ? `Relié au serveur du bureau (${e.serveur})${e.derniere ? ` — dernière mise à jour ${new Date(e.derniere).toLocaleTimeString('fr-FR')}` : ''}`
      : e.erreur || 'Serveur du bureau injoignable';
  };
  dessinerPoste(etatPoste());
  rafraichirVoyantServeur();
  if (reseauBranche) return;
  reseauBranche = true;
  suivrePoste((e) => {
    dessinerPoste(e);
    if (rafraichirEnAttente) rafraichirSiLibre();
  });
  surReceptionPoste(rafraichirSiLibre);
  // Sur le PC serveur : un poste vient d'envoyer du nouveau.
  if (window.pduDesktop && window.pduDesktop.surEtatReseau) {
    window.pduDesktop.surEtatReseau((e) => {
      if (e && e.etape === 'poste' && e.rapport && (e.rapport.recues || e.rapport.supprimees)) rafraichirSiLibre();
    });
  }
}

/** Sur le PC serveur, le voyant dit si le serveur du bureau est ouvert. */
export function rafraichirVoyantServeur() {
  if (!window.pduDesktop || !window.pduDesktop.reseauLire) return;
  window.pduDesktop.reseauLire().then((r) => {
    const voyant = voyantReseauEl;
    if (!voyant || etatPoste().actif) return;
    if (r.mode !== 'serveur') { voyant.hidden = true; return; }
    voyant.hidden = false;
    voyant.className = `voyantReseau ${r.actif ? 'ok' : 'hs'}`;
    voyant.textContent = r.actif ? '🖧 Serveur' : '🖧 Serveur arrêté';
    voyant.title = r.actif ? `Serveur du bureau ouvert : ${r.adresses.join(', ')} (port ${r.port})` : r.erreur || 'Serveur du bureau arrêté';
  }).catch(() => {});
}

/** Fenetre flottante : expediteur et objet des notes non lues. */
function annoncer() {
  annoncerNotes({ ouvrirNotes: (sub) => { if (sub) state.sub.NOTES = sub; navigate('NOTES'); }, surNotes: state.module === 'NOTES' });
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
    if (m.key === 'NOTES') b.appendChild(el('<span class="tabBadge" hidden></span>'));
    tabsEl.appendChild(b);
  });
  majBadgeNotes();
}

let notesBadgeBound = false;

/** Nombre de notes non lues, sur l'onglet NOTES. */
function majBadgeNotes() {
  const u = currentUser();
  const badge = tabsEl && tabsEl.querySelector('.tabBadge');
  if (!badge || !u) return;
  const n = notesNonLues(u.id).length;
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.title = `${n} note(s) non lue(s)`;
}

/** Change de rubrique. */
export function navigate(moduleKey, params = {}) {
  // Un style seulement apercu ne survit pas a la page.
  annulerApercuTheme();
  state.module = moduleKey;
  // Chaque ouverture de rubrique est une nouvelle visite (NOTES s'en sert
  // pour garder ses notes « Nouvelle » tant qu'on reste sur la page).
  state.visite += 1;
  if (params.immat !== undefined) state.vehicleSheetImmat = params.immat;
  if (params.userId !== undefined) state.userSheetId = params.userId;
  if (moduleKey !== 'RECHERCHE_GLOBALE') {
    state.query = '';
    if (searchInput) searchInput.value = '';
    if (globalBtn) globalBtn.style.display = 'none';
    if (exportBtn) exportBtn.style.display = 'none';
  }
  titleEl.textContent = TITLES[moduleKey] || moduleKey;
  const onglet = moduleKey === 'FICHE_UTILISATEUR' ? 'UTILISATEURS' : moduleKey === 'FICHE_VEHICULE' ? 'VEHICULES' : moduleKey;
  // La couleur de la rubrique ouverte, pour les styles qui s'y accordent.
  document.documentElement.style.setProperty('--couleur-rubrique', moduleColor(onglet));
  [...tabsEl.children].forEach((b) => b.classList.toggle('active', b.dataset.mod === onglet));
  rerender();
  contentEl.scrollTop = 0;
  annoncer();
}

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
  const nonAttribues = allVehicles().filter((v) => v.statut === STATUT_NON_ATTRIBUE);

  // Les vidanges d'abord : elles se comptent en kilometres qui defilent, alors
  // qu'un vehicule au garage y reste tant qu'on n'a rien fait.
  const voyants = [
    ...vidanges.map((x) => ({
      classe: x.niveau,
      clignote: true,
      icone: '🛢️',
      immat: x.immat || '(sans immat.)',
      // Le moins dit que l'echeance est passee : -1 033 km = 1 033 km de retard.
      texte: x.etat.restant < 0
        ? `-${fmt(-x.etat.restant)} km`
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
    })),
    // Un vehicule qui n'est confie a personne n'est pas une panne : il a sa
    // propre couleur, le bleu, et ne clignote pas.
    ...nonAttribues.map((v) => ({
      classe: 'libre',
      clignote: false,
      icone: '🚗',
      immat: immatOf(v) || '(sans immat.)',
      texte: `${String(v._cat).toUpperCase()}${v.modele ? ` · ${v.modele}` : ''}`,
      titre: 'Véhicule non attribué',
      go: immatOf(v)
    }))
  ];

  // Sur telephone, le titre cede la place aux voyants — mais seulement quand
  // il y en a. La rubrique ouverte se lit de toute facon sur son onglet.
  if (entete) entete.classList.toggle('hasAlerts', voyants.length > 0);
  if (!voyants.length) return;

  rendreGroupes(voyants);
}

/** Les types d'alerte, du plus grave au moins grave. */
const GROUPES_ALERTE = [
  { classe: 'rouge', libelle: 'Vidange urgente', court: 'Urgent' },
  { classe: 'orange', libelle: 'Vidange proche', court: 'Proche' },
  { classe: 'jaune', libelle: 'Vidange à prévoir', court: 'À prévoir' },
  { classe: 'garage', libelle: 'Au garage', court: 'Garage' },
  { classe: 'libre', libelle: 'Non attribué', court: 'Libre' }
];

/** Les trois couleurs de la vidange. */
const VIDANGE = new Set(['rouge', 'orange', 'jaune']);

/**
 * Une pastille par type d'alerte, et non plus par vehicule : la couleur et
 * le libelle disent la nature de l'alerte, la bulle au-dessus le nombre de
 * vehicules concernes. Un clic deroule la liste ; un clic sur un vehicule
 * ouvre sa fiche. Sur un ecran etroit, la pastille ne garde que son icone.
 */
function rendreGroupes(voyants) {
  const etroit = window.innerWidth <= LARGEUR_COMPACTE;
  GROUPES_ALERTE.forEach((g) => {
    const lot = voyants.filter((v) => v.classe === g.classe);
    if (!lot.length) return;
    // Vidange : un seul vehicule dans la couleur, son immatriculation se lit
    // directement sur la pastille ; la liste ne sert qu'a partir de deux.
    if (lot.length === 1 && VIDANGE.has(g.classe)) {
      const v = lot[0];
      const seul = el(
        `<button type="button" class="voyant voyantGroupe ${g.classe}${v.clignote ? ' clignote' : ''}" ` +
          `data-court="${escapeText(v.immat)}" title="${escapeText(`${g.libelle} — ${v.immat} : ${v.texte}. ${v.titre}`)}">` +
          `<span aria-hidden="true">${v.icone}</span>` +
          (etroit ? '' : `<b>${escapeText(v.immat)}</b><span class="voyantKm">${escapeText(v.texte)}</span>`) +
        '</button>'
      );
      seul.onclick = (ev) => { ev.stopPropagation(); fermerListe(); openVehicleSheet(v.go); };
      alertBarEl.appendChild(seul);
      return;
    }
    const b = el(
      `<button type="button" class="voyant voyantGroupe ${g.classe}${lot[0].clignote ? ' clignote' : ''}" ` +
        `data-court="${escapeText(g.court)}" aria-haspopup="true" aria-expanded="false" title="${escapeText(`${g.libelle} : ${lot.length} véhicule(s)`)}">` +
        `<span aria-hidden="true">${lot[0].icone}</span>` +
        (etroit ? '' : `<b>${escapeText(g.libelle)}</b>`) +
        '<span class="voyantFleche" aria-hidden="true">▾</span>' +
        `<span class="voyantNombre">${lot.length}</span>` +
      '</button>'
    );
    b.onclick = (ev) => { ev.stopPropagation(); basculerListe(b, g, lot); };
    alertBarEl.appendChild(b);
  });
  // Plus de groupes que de place : on raccourcit les libelles, puis on ne
  // garde que les icones.
  const deborde = () => alertBarEl.scrollWidth > alertBarEl.clientWidth + 1;
  if (!etroit && deborde()) {
    alertBarEl.querySelectorAll('.voyantKm').forEach((x) => x.remove());
    alertBarEl.querySelectorAll('.voyantGroupe').forEach((btn) => { const x = btn.querySelector('b'); if (x) x.textContent = btn.dataset.court; });
    if (deborde()) alertBarEl.querySelectorAll('.voyantGroupe b').forEach((x) => x.remove());
  }
}

let listeOuverte = null;

function fermerListe() {
  if (!listeOuverte) return;
  listeOuverte.menu.remove();
  listeOuverte.bouton.setAttribute('aria-expanded', 'false');
  listeOuverte = null;
  document.removeEventListener('click', fermerListe);
  document.removeEventListener('keydown', echapListe);
  window.removeEventListener('resize', fermerListe);
}

function echapListe(e) {
  if (e.key === 'Escape') fermerListe();
}

/** Deroule (ou referme) la liste des vehicules d'une pastille. */
function basculerListe(bouton, groupe, lot) {
  const dejaOuverte = listeOuverte && listeOuverte.bouton === bouton;
  fermerListe();
  if (dejaOuverte) return;
  const menu = el(
    `<div class="voyantMenu" role="menu"><div class="voyantMenuTitre ${groupe.classe}">` +
      `${escapeText(groupe.libelle)} — ${lot.length} véhicule${lot.length > 1 ? 's' : ''}</div></div>`
  );
  lot.forEach((v) => {
    const ligne = el(
      `<button type="button" role="menuitem" class="voyantLigne" title="${escapeText(v.titre)}">` +
        `<b>${escapeText(v.immat)}</b><span>${escapeText(v.texte)}</span></button>`
    );
    ligne.onclick = () => { fermerListe(); openVehicleSheet(v.go); };
    menu.appendChild(ligne);
  });
  menu.onclick = (ev) => ev.stopPropagation();
  document.body.appendChild(menu);
  // Sous la pastille, sans deborder de l'ecran.
  const r = bouton.getBoundingClientRect();
  const largeur = menu.offsetWidth;
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - largeur - 8)))}px`;
  bouton.setAttribute('aria-expanded', 'true');
  listeOuverte = { bouton, menu };
  setTimeout(() => {
    document.addEventListener('click', fermerListe);
    document.addEventListener('keydown', echapListe);
    window.addEventListener('resize', fermerListe);
  }, 0);
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
  // NOTES et COMPTE ne sont jamais en lecture seule : chacun y ecrit ses
  // propres notes et y regle son propre compte.
  const reglagesPerso = rub === 'NOTES' || rub === 'COMPTE';
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
  if (m === 'NOTES' || m === 'COMPTE') return true;
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
  NOTES: renderNotes,
  COMPTE: renderComptes,
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
  majExportRecherche();
}

/**
 * Le bouton « Exporter le résultat » ne parait qu'avec une recherche en
 * cours, et dit combien de lignes il exportera.
 */
function majExportRecherche() {
  if (!exportBtn) return;
  const n = norm(state.query).trim().length >= 2 ? tailleDuResultat(contentEl) : 0;
  exportBtn.style.display = n ? 'block' : 'none';
  exportBtn.textContent = `⬇ Exporter le résultat (${n} ligne${n > 1 ? 's' : ''}) ▾`;
}

function escapeText(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

export function getContentEl() {
  return contentEl;
}
