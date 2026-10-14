/* ===================================================================
   RECHERCHE GLOBALE — balaye toutes les rubriques d un coup.
   =================================================================== */

import { DB, allVehicles, immatOf } from '../../core/db.js';
import { esc, escLignes, el, fmt, norm, dateFR } from '../../core/utils.js';
import { toolbar, emptyState, COLORS } from '../components.js';
import { state, navigate, openVehicleSheet } from '../shell.js';
// Chaque compte ne trouve que ce que ses niveaux d'acces lui montrent.
import { filtrer, voitTout } from '../../core/acces.js';

export function renderGlobalSearch(page) {
  page.appendChild(
    toolbar([{ label: '← Retour au tableau de bord', color: COLORS.blue, onClick: () => navigate('TABLEAU DE BORD') }])
  );

  const q = norm(state.query).trim();
  if (q.length < 2) {
    page.appendChild(emptyState('Tapez au moins 2 caractères dans la barre de recherche pour lancer la recherche globale.'));
    return;
  }

  const results = [];

  filtrer('VEHICULES', allVehicles()).forEach((v) => {
    if (norm(`${v.marque} ${v.modele} ${v.immatNouvelle} ${v.immatAncienne} ${v.numeroChassis || ''} ${v.statut} ${v.section} ${v.utilisateur} ${v.groupe}`).includes(q)) {
      results.push({
        type: 'VÉHICULE',
        color: COLORS.green,
        title: `${v.marque || ''} ${v.modele || ''}`.trim() || immatOf(v),
        sub: `${immatOf(v) || 'sans immatriculation'} · ${String(v._cat).toUpperCase()} · ${v.statut || ''}`,
        action: () => openVehicleSheet(immatOf(v))
      });
    }
  });

  filtrer('UTILISATEURS', DB.users).forEach((u) => {
    if (norm(`${u.nom} ${u.prenoms} ${u.fonction} ${u.section} ${u.telephone || ''}`).includes(q)) {
      results.push({
        type: 'UTILISATEUR',
        color: COLORS.blue,
        title: `${u.nom} ${u.prenoms}`.trim(),
        sub: `${u.fonction || '—'}${u.section ? ` · ${u.section}` : ''} · ${u.statut || ''}`,
        action: () => navigate('UTILISATEURS')
      });
    }
  });

  filtrer('DOTATION', DB.dotationPool).forEach((d) => {
    if (norm(`${d.immat} ${d.marqueModele} ${d.station}`).includes(q)) {
      results.push({
        type: 'DOTATION POOL',
        color: COLORS.orange,
        title: `${d.immat} — ${fmt(d.montant)} F`,
        sub: `${dateFR(d.date)} · ${d.station || '—'} · ${fmt(d.quantite)} L`,
        action: () => { state.sub.DOTATION = 'pool'; navigate('DOTATION'); }
      });
    }
  });

  filtrer('MISSION', DB.missions).forEach((m) => {
    if (norm(`${m.ref} ${m.conducteur} ${m.destination} ${m.vehicule}`).includes(q)) {
      results.push({
        type: 'MISSION',
        color: COLORS.purple,
        title: `${m.ref} — ${m.conducteur}`,
        sub: `${m.destination || '—'} · ${dateFR(m.dateDepart)} → ${dateFR(m.dateRetour) || '…'} · ${m.paye ? 'payée' : 'non payée'}`,
        action: () => navigate('MISSION')
      });
    }
  });

  filtrer('ENTRETIEN', DB.maintenance).forEach((m) => {
    if (norm(`${m.marque} ${m.modele} ${m.immat} ${m.motif} ${m.signalePar || ''}`).includes(q)) {
      results.push({
        type: 'ENTRETIEN',
        color: COLORS.red,
        title: `${m.marque || ''} ${m.modele || ''} — ${m.immat}`.trim(),
        sub: `${m.motif || '—'} · ${m.dateRetour ? `sorti le ${dateFR(m.dateRetour)}` : 'au garage'}`,
        action: () => openVehicleSheet(m.immat)
      });
    }
  });

  filtrer('UTILISATEURS', DB.users).forEach((u) => {
    (u.historique || []).forEach((h) => {
      if (norm(`${h.nature} ${h.circonstances} ${h.vehicule} ${h.responsabilite || ''}`).includes(q)) {
        results.push({
          type: 'INCIDENT',
          color: COLORS.red,
          title: `${h.nature || 'Incident'} — ${u.nom} ${u.prenoms}`,
          sub: `${dateFR(h.date)}${h.vehicule ? ` · ${h.vehicule}` : ''}`,
          action: () => navigate('UTILISATEURS')
        });
      }
    });
  });

  filtrer('DECHARGE', DB.decharges).forEach((d) => {
    if (norm(`${d.ref} ${d.numeroCourrier} ${d.objet} ${d.destinataire} ${d.recuperePar} ${d.conducteur} ${d.immat}`).includes(q)) {
      results.push({
        type: 'DÉCHARGE',
        color: '#8D6E63',
        title: `${d.ref || 'Décharge'} — ${d.destinataire || '—'}`,
        sub: `${dateFR(d.date)}${d.numeroCourrier ? ` · courrier ${d.numeroCourrier}` : ''}\n${d.objet || ''}`,
        action: () => { state.sub.DECHARGE = 'decharges'; navigate('DECHARGE'); }
      });
    }
  });

  (voitTout('DECHARGE') ? DB.destinataires : []).forEach((d) => {
    if (norm(`${d.nom} ${d.contacts} ${d.localisation}`).includes(q)) {
      results.push({
        type: 'DESTINATAIRE',
        color: '#4E342E',
        title: d.nom || 'Destinataire',
        sub: [d.contacts, d.localisation].filter(Boolean).join('\n') || '—',
        action: () => { state.sub.DECHARGE = 'destinataires'; navigate('DECHARGE'); }
      });
    }
  });

  if (!results.length) {
    page.appendChild(emptyState(`Aucun résultat pour « ${state.query} » dans l'application.`));
    return;
  }

  page.appendChild(el(`<div class="groupHeader"><span>${results.length} résultat(s)</span></div>`));

  results.forEach((r) => {
    const e = el('<div class="entry"></div>');
    e.style.borderLeftColor = r.color;
    e.innerHTML =
      `<div class="row1"><h4>${esc(r.title)}</h4><span class="badge" style="background:${r.color}">${esc(r.type)}</span></div>` +
      // Un motif d'entretien tient sur plusieurs lignes : le resume les garde.
      (r.sub ? `<div class="meta">${escLignes(r.sub)}</div>` : '') +
      `<div class="actions"><button class="miniBtn" style="background:${COLORS.blue}" data-open>Ouvrir →</button></div>`;
    e.querySelector('[data-open]').onclick = r.action;
    page.appendChild(e);
  });
}
