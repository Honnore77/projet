/* ===================================================================
   RECHERCHE GLOBALE — balaye toutes les rubriques d un coup.
   =================================================================== */

import { DB, allVehicles, immatOf, texteDestinations } from '../../core/db.js';
import { esc, escLignes, el, fmt, norm, dateFR } from '../../core/utils.js';
import { toolbar, emptyState, COLORS } from '../components.js';
import { state, navigate, openVehicleSheet, openUserSheet, moduleColor } from '../shell.js';
// Chaque compte ne trouve que ce que ses niveaux d'acces lui montrent.
import { filtrer, voitTout, voit } from '../../core/acces.js';

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
        type: 'AGENT',
        color: moduleColor('UTILISATEURS'),
        title: `${u.nom} ${u.prenoms}`.trim(),
        sub: `${u.fonction || '—'}${u.section ? ` · ${u.section}` : ''} · ${u.statut || ''}`,
        action: () => openUserSheet(u.id)
      });
    }
  });

  filtrer('DOTATION', DB.dotationPool).forEach((d) => {
    if (norm(`${d.immat} ${d.marqueModele} ${d.station}`).includes(q)) {
      results.push({
        type: 'DOTATION',
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
    if (norm(`${d.ref} ${d.numeroCourrier} ${d.objet} ${d.destinataire} ${d.recuperePar} ${d.conducteur} ${d.conducteur2 || ''} ${d.immat}`).includes(q)) {
      results.push({
        type: 'COURSE',
        color: '#8D6E63',
        title: `${d.ref || 'Course'} — ${d.destinataire || '—'}`,
        sub: `${dateFR(d.date)}${d.numeroCourrier ? ` · courrier ${d.numeroCourrier}` : ''}\n${d.objet || ''}`,
        action: () => { state.sub.DECHARGE = 'decharges'; navigate('DECHARGE'); }
      });
    }
  });

  filtrer('MISSION', DB.sortiesAbidjan || []).forEach((x) => {
    if (norm(`${x.ref} ${x.conducteur} ${x.vehicule} ${x.destination} ${(x.participants || []).join(' ')} ${x.observations || ''}`).includes(q)) {
      results.push({
        type: 'SORTIE D’ABIDJAN',
        color: '#8D6E63',
        title: `${x.ref || 'Sortie'} — ${x.conducteur || '—'}`,
        sub: `${x.destination || '—'} · ${dateFR(x.date)}${x.vehicule ? ` · ${x.vehicule}` : ''}`,
        action: () => { state.sub.MISSION = 'sorties'; navigate('MISSION'); }
      });
    }
  });

  filtrer('MISSION', DB.programmes || []).forEach((p) => {
    if (norm(`${p.ref} ${p.conducteur} ${p.vehicule} ${(p.destinations || []).join(' ')} ${p.objet || ''} ${(p.participants || []).join(' ')} ${p.observations || ''}`).includes(q)) {
      results.push({
        type: 'MISSION PROGRAMMÉE',
        color: '#C2185B',
        title: `${p.ref || 'Programme'} — ${(p.destinations || []).join(', ') || '—'}`,
        sub: `Départ le ${dateFR(p.dateDepart) || '…'}${p.conducteur ? ` · ${p.conducteur}` : ''}${p.objet ? `\n${p.objet}` : ''}`,
        action: () => { state.sub.MISSION = 'programmes'; navigate('MISSION'); }
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

  // Vehicules sortis du parc : leur fiche reste lisible.
  (voitTout('VEHICULES') ? DB.vehicles.reforme || [] : []).forEach((v) => {
    if (norm(`${v.marque} ${v.modele} ${v.immatNouvelle} ${v.immatAncienne} ${v.numeroChassis || ''} ${v.motifReforme || ''}`).includes(q)) {
      results.push({
        type: 'VÉHICULE RÉFORMÉ', color: moduleColor('VEHICULES'),
        title: `${v.marque || ''} ${v.modele || ''}`.trim() || immatOf(v),
        sub: `${immatOf(v) || 'sans immatriculation'}${v.dateReforme ? ` · réformé le ${dateFR(v.dateReforme)}` : ''}`,
        action: () => openVehicleSheet(immatOf(v))
      });
    }
  });

  (voitTout('VEHICULES') ? DB.etatsVehicules || [] : []).forEach((x) => {
    if (norm(`${x.immat} ${x.probleme} ${x.signalePar} ${x.signaleA || ''} ${x.origineLibelle || ''}`).includes(q)) {
      results.push({
        type: 'ÉTAT DU VÉHICULE', color: moduleColor('VEHICULES'),
        title: `${x.immat || '—'} — ${String(x.probleme || '').split('\n')[0]}`,
        sub: `${dateFR(x.dateSignalement)}${x.resolu === 'Oui' ? ' · résolu' : ' · en cours'}${x.origineLibelle ? ` · via ${x.origineLibelle}` : ''}`,
        action: () => { state.sub.VEHICULES = 'etat'; navigate('VEHICULES'); }
      });
    }
  });

  filtrer('CONGES', DB.indisponibilites || []).forEach((i) => {
    if (norm(`${i.conducteur} ${i.motif} ${i.interimaire || ''} ${i.observations || ''}`).includes(q)) {
      results.push({
        type: 'CONGÉ / ABSENCE', color: moduleColor('UTILISATEURS'),
        title: `${i.conducteur || '—'} — ${i.motif || 'absence'}`,
        sub: `${dateFR(i.dateDepart)} → ${dateFR(i.dateReprise) || '…'}${i.interimaire ? ` · intérim : ${i.interimaire}` : ''}`,
        action: () => { state.sub.UTILISATEURS = 'indisponibilites'; navigate('UTILISATEURS'); }
      });
    }
  });

  (voit('SIMULATION') && voitTout('SIMULATION') ? DB.simulations || [] : []).forEach((x) => {
    if (norm(`${texteDestinations(x.destinations)} ${x.vehicule || ''} ${x.marqueModele || ''}`).includes(q)) {
      results.push({
        type: 'SIMULATION', color: moduleColor('MISSION'),
        title: texteDestinations(x.destinations) || 'Simulation',
        sub: `${dateFR(x.dateDepart) || '…'}${x.vehicule ? ` · ${x.vehicule}` : ''} · estimation ${fmt(x.estimation)} F`,
        action: () => { state.sub.MISSION = 'simulations'; navigate('MISSION'); }
      });
    }
  });

  (voitTout('MISSION') ? DB.destinationsMission || [] : []).forEach((d) => {
    if (norm(`${d.nom} ${d.localisation || ''}`).includes(q)) {
      results.push({
        type: 'DESTINATION', color: moduleColor('MISSION'),
        title: d.nom,
        sub: d.distanceKm === '' || d.distanceKm === undefined ? 'distance à renseigner' : `${fmt(d.distanceKm)} km`,
        action: () => { state.sub.MISSION = 'destinations'; navigate('MISSION'); }
      });
    }
  });

  (voitTout('ENTRETIEN') ? DB.vidanges || [] : []).forEach((x) => {
    if (norm(`${x.immat} ${x.structure || ''} ${x.conducteur || ''} ${x.observation || ''} ${(x.travaux || []).join(' ')}`).includes(q)) {
      results.push({
        type: 'VIDANGE', color: moduleColor('ENTRETIEN'),
        title: `${x.immat || '—'} — vidange du ${dateFR(x.date)}`,
        sub: `${x.structure || '—'}${x.kmActuel !== '' && x.kmActuel !== undefined ? ` · ${fmt(x.kmActuel)} km` : ''}`,
        action: () => { state.sub.ENTRETIEN = 'vidanges'; navigate('ENTRETIEN'); }
      });
    }
  });

  (voitTout('ENTRETIEN') ? DB.garages || [] : []).forEach((g) => {
    if (norm(`${g.nom} ${g.contacts || ''} ${g.pointFocal || ''} ${g.localisation || ''}`).includes(q)) {
      results.push({
        type: 'GARAGE', color: moduleColor('ENTRETIEN'),
        title: g.nom || 'Garage',
        sub: [g.contacts, g.localisation].filter(Boolean).join(' · ') || '—',
        action: () => { state.sub.ENTRETIEN = 'garages'; navigate('ENTRETIEN'); }
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
    // Repere pour « Exporter le résultat » (ui/exportRecherche.js).
    e.dataset.resultat = '';
    e.innerHTML =
      `<div class="row1"><h4>${esc(r.title)}</h4><span class="badge" style="background:${r.color}">${esc(r.type)}</span></div>` +
      // Un motif d'entretien tient sur plusieurs lignes : le resume les garde.
      (r.sub ? `<div class="meta">${escLignes(r.sub)}</div>` : '') +
      `<div class="actions"><button class="miniBtn" style="background:${COLORS.blue}" data-open>Ouvrir →</button></div>`;
    e.querySelector('[data-open]').onclick = r.action;
    page.appendChild(e);
  });
}
