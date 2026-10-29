/* ===================================================================
   IMPORTER — bouton de la colonne des rubriques.

   Une liste deroulante donne tous les formulaires qui ont un champ
   « + Ajouter une image ». Un choix ouvre la rubrique et le formulaire,
   puis amene la page sur ce champ, mis en evidence.

   Les formulaires qui portent sur une fiche existante (rapport de mission,
   intervention, incident) demandent d'abord laquelle.
   =================================================================== */

import { DB } from '../core/db.js';
import { el, dateFR } from '../core/utils.js';
import { peutSaisir, seulementSiennes, agentConnecte } from '../core/acces.js';
import { openForm, ouvrirMenuChoix, toast } from './components.js';
import { state, navigate, rerender } from './shell.js';
import { openVehicleForm } from './views/vehicles.js';
import { openUserForm, openIncidentForm, openIndisponibiliteForm, openDemandeForm } from './views/users.js';
import { openPoolForm } from './views/dotation.js';
import { choisirMission, openRapportForm } from './views/missions.js';
import { openFicheForm, openInterventionForm } from './views/maintenance.js';
import { openDechargeForm } from './views/decharges.js';

const peutDeposer = () => peutSaisir('CONGES') || (seulementSiennes('CONGES') && !!agentConnecte());

/** Les formulaires a image, dans l'ordre des rubriques. */
const FORMULAIRES = [
  { label: 'Nouveau véhicule — Pool', detail: 'VÉHICULES', rub: 'VEHICULES', page: ['VEHICULES', 'pool'], ouvrir: () => openVehicleForm(null, 'pool') },
  { label: 'Nouveau véhicule — Mission', detail: 'VÉHICULES', rub: 'VEHICULES', page: ['VEHICULES', 'mission'], ouvrir: () => openVehicleForm(null, 'mission') },
  { label: 'Nouveau véhicule — Service', detail: 'VÉHICULES', rub: 'VEHICULES', page: ['VEHICULES', 'service'], ouvrir: () => openVehicleForm(null, 'service') },
  { label: 'Nouvel utilisateur', detail: 'UTILISATEURS', rub: 'UTILISATEURS', page: ['UTILISATEURS', 'liste'], ouvrir: () => openUserForm(null) },
  { label: 'Incident d’un agent', detail: 'UTILISATEURS · choisir l’agent', rub: 'UTILISATEURS', page: ['UTILISATEURS', 'liste'], ouvrir: () => choisirAgent((u) => openIncidentForm(u, null, rerender)) },
  { label: 'Indisponibilité au pool', detail: 'UTILISATEURS · CONGÉS ET ABSENCES', rub: 'CONGES', page: ['UTILISATEURS', 'indisponibilites'], ouvrir: () => openIndisponibiliteForm(null) },
  { label: 'Demande de congé', detail: 'UTILISATEURS · CONGÉS ET ABSENCES', droit: peutDeposer, page: ['UTILISATEURS', 'indisponibilites'], ouvrir: () => openDemandeForm('conge', null) },
  { label: 'Demande d’absence', detail: 'UTILISATEURS · CONGÉS ET ABSENCES', droit: peutDeposer, page: ['UTILISATEURS', 'indisponibilites'], ouvrir: () => openDemandeForm('absence', null) },
  { label: 'Dotation en carburant pool', detail: 'DOTATION', rub: 'DOTATION', page: ['DOTATION', 'pool'], ouvrir: () => openPoolForm(null) },
  { label: 'Rapport de mission', detail: 'MISSION · choisir la mission', droit: () => peutSaisir('MISSION') || seulementSiennes('MISSION'), page: ['MISSION', 'rapport'], ouvrir: () => choisirMission((m) => openRapportForm(m)) },
  { label: 'Fiche d’entretien', detail: 'ENTRETIEN', rub: 'ENTRETIEN', page: ['ENTRETIEN', 'liste'], ouvrir: () => openFicheForm(null) },
  { label: 'Intervention d’entretien', detail: 'ENTRETIEN · choisir la fiche', rub: 'ENTRETIEN', page: ['ENTRETIEN', 'liste'], ouvrir: () => choisirFiche((m) => openInterventionForm(m, null)) },
  { label: 'Course', detail: 'SORTIES · COURSES', rub: 'DECHARGE', page: ['DECHARGE', 'decharges'], ouvrir: () => openDechargeForm(null) }
];

/** Le bouton IMPORTER, a placer sous les rubriques. */
export function boutonImporter() {
  const b = el('<button type="button" class="tab tabImporter" aria-haspopup="menu">⬆ IMPORTER</button>');
  b.title = 'Ajouter une image dans un formulaire';
  b.onclick = (ev) => {
    ev.stopPropagation();
    const choix = FORMULAIRES.filter((f) => (f.droit ? f.droit() : peutSaisir(f.rub)));
    if (!choix.length) return toast('Votre compte ne peut ajouter d’image dans aucun formulaire.', 'info');
    ouvrirMenuChoix(b, choix.map((f) => ({ label: f.label, detail: f.detail, onClick: () => importerDans(f) })));
  };
  return b;
}

function importerDans(f) {
  const [rub, sub] = f.page;
  state.sub[rub] = sub;
  navigate(rub);
  allerAuChampImages();
  f.ouvrir();
}

/**
 * Attend que le formulaire (apres l'eventuel choix de la fiche) soit ouvert,
 * puis amene sa fenetre sur le champ des images et le met en evidence.
 */
function allerAuChampImages() {
  const deja = new Set(document.querySelectorAll('[data-images]'));
  const trouver = () => [...document.querySelectorAll('[data-images]')].find((n) => !deja.has(n));
  const arriver = (champ) => {
    obs.disconnect();
    clearTimeout(abandon);
    const bloc = champ.closest('.fRow') || champ;
    bloc.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bloc.classList.add('champImporter');
    setTimeout(() => bloc.classList.remove('champImporter'), 2600);
    const bouton = champ.querySelector('label.smallBtn');
    if (bouton) bouton.focus({ preventScroll: true });
  };
  const obs = new MutationObserver(() => { const c = trouver(); if (c) arriver(c); });
  obs.observe(document.body, { childList: true, subtree: true });
  // Le choix d'une fiche peut prendre du temps ; au-dela, on n'attend plus.
  const abandon = setTimeout(() => obs.disconnect(), 120000);
}

/** Liste des agents, pour un incident. */
function choisirAgent(onPick) {
  const agents = DB.users.slice().sort((a, b) => `${a.nom} ${a.prenoms}`.localeCompare(`${b.nom} ${b.prenoms}`, 'fr'));
  if (!agents.length) return toast('Créez d’abord un utilisateur.', 'info');
  choisir('Incident d’un agent', 'Choisissez l’agent concerné.', 'Agent',
    agents.map((u) => ({ value: u.id, label: `${u.nom} ${u.prenoms}`.trim() || '—' })),
    (id) => onPick(DB.users.find((u) => u.id === id)));
}

/** Liste des fiches d'entretien, pour une intervention. */
function choisirFiche(onPick) {
  const fiches = DB.maintenance.slice().sort((a, b) => String(b.dateEntree || '').localeCompare(String(a.dateEntree || '')));
  if (!fiches.length) return toast('Créez d’abord une fiche d’entretien.', 'info');
  choisir('Intervention d’entretien', 'Choisissez la fiche d’entretien concernée.', 'Fiche d’entretien',
    fiches.map((m) => ({ value: m.id, label: `${m.immat || '—'} — entrée le ${dateFR(m.dateEntree) || '…'}${m.motif ? ` — ${String(m.motif).split('\n')[0].slice(0, 50)}` : ''}` })),
    (id) => onPick(DB.maintenance.find((m) => m.id === id)));
}

function choisir(title, intro, label, options, onPick) {
  openForm({
    title,
    intro,
    fields: [{ key: 'id', label, type: 'select', options, required: true, full: true, value: options[0].value }],
    okLabel: 'Continuer',
    onSubmit: (v) => {
      setTimeout(() => onPick(v.id), 60);
      return null;
    }
  });
}
