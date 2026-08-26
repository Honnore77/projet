/* ===================================================================
   Construction des jeux de donnees exportables (Excel et PDF partagent
   exactement les memes colonnes).
   =================================================================== */

import { DB, allVehicles, immatOf, maintenanceCost, fuelCost, openMaintenance } from '../core/db.js';
import { dateFR, daysBetween, num, sum, groupBy } from '../core/utils.js';

const C = (key, label, width) => ({ key, label, width });

/* ------------------------------ VEHICULES -------------------------- */

export function dsVehicles(list = allVehicles()) {
  return {
    title: 'Véhicules',
    columns: [
      C('categorie', 'Catégorie', 12),
      C('marque', 'Marque', 14),
      C('modele', 'Modèle', 16),
      C('immatNouvelle', 'Immat. nouvelle', 16),
      C('immatAncienne', 'Immat. ancienne', 16),
      C('couleur', 'Couleur', 12),
      C('energie', 'Énergie', 11),
      C('groupe', 'Groupe', 12),
      C('section', 'Section', 18),
      C('utilisateur', 'Utilisateur', 20),
      C('statut', 'Statut', 13),
      C('km', 'Kilométrage', 13),
      C('coutEntretien', 'Coût entretien', 15),
      C('coutCarburant', 'Coût carburant', 15)
    ],
    rows: list.map((v) => ({
      categorie: (v._cat || '').toUpperCase(),
      marque: v.marque || '',
      modele: v.modele || '',
      immatNouvelle: v.immatNouvelle || '',
      immatAncienne: v.immatAncienne || '',
      couleur: v.couleur || '',
      energie: v.energie || '',
      groupe: v.groupe || '',
      section: v.section || '',
      utilisateur: v.utilisateur || '',
      statut: v.statut || '',
      km: num(v.km),
      coutEntretien: maintenanceCost(immatOf(v)),
      coutCarburant: fuelCost(immatOf(v))
    }))
  };
}

/* ----------------------------- UTILISATEURS ------------------------ */

export function dsUsers(list = DB.users) {
  return {
    title: 'Utilisateurs',
    columns: [
      C('nom', 'Nom', 16),
      C('prenoms', 'Prénoms', 20),
      C('fonction', 'Fonction au PDU', 24),
      C('section', 'Section', 20),
      C('statut', 'Statut', 12),
      C('nbIncidents', 'Nb incidents', 12),
      C('dernierIncident', 'Dernier incident', 18)
    ],
    rows: list.map((u) => {
      const h = u.historique || [];
      const last = h.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      return {
        nom: u.nom || '',
        prenoms: u.prenoms || '',
        fonction: u.fonction || '',
        section: u.section || '',
        statut: u.statut || '',
        nbIncidents: h.length,
        dernierIncident: last ? `${dateFR(last.date)} — ${last.nature || ''}` : ''
      };
    })
  };
}

export function dsIncidents(list = DB.users) {
  const rows = [];
  list.forEach((u) => {
    (u.historique || []).forEach((h) => {
      rows.push({
        agent: `${u.nom || ''} ${u.prenoms || ''}`.trim(),
        section: u.section || '',
        date: dateFR(h.date),
        nature: h.nature || '',
        vehicule: h.vehicule || '',
        circonstances: h.circonstances || '',
        responsabilite: h.responsabilite || '',
        observations: h.observations || ''
      });
    });
  });
  return {
    title: 'Incidents',
    columns: [
      C('agent', 'Agent', 22),
      C('section', 'Section', 18),
      C('date', 'Date', 12),
      C('nature', 'Nature', 18),
      C('vehicule', 'Véhicule', 14),
      C('circonstances', 'Circonstances', 34),
      C('responsabilite', 'Responsabilité', 18),
      C('observations', 'Observations', 30)
    ],
    rows
  };
}

/* ------------------------------ DOTATION --------------------------- */

export function dsDotationPool(list = DB.dotationPool) {
  return {
    title: 'Dotation pool',
    columns: [
      C('date', 'Date', 12),
      C('immat', 'Immatriculation', 16),
      C('marqueModele', 'Marque / Modèle', 22),
      C('energie', 'Énergie', 11),
      C('km', 'Kilométrage', 13),
      C('quantite', 'Quantité (L)', 12),
      C('prixL', 'Prix / L', 11),
      C('montant', 'Montant', 13),
      C('station', 'Station-service', 22),
      C('vidange', 'État vidange', 13)
    ],
    rows: list.map((d) => ({
      date: dateFR(d.date),
      immat: d.immat || '',
      marqueModele: d.marqueModele || '',
      energie: d.energie || '',
      km: num(d.km),
      quantite: num(d.quantite),
      prixL: num(d.prixL),
      montant: num(d.montant),
      station: d.station || '',
      vidange: d.vidange || ''
    })),
    note: `Total : ${sum(list, (d) => d.quantite)} L — ${sum(list, (d) => d.montant)} F`
  };
}

export function dsDotationMission(list = DB.dotationMission) {
  return {
    title: 'Dotation mission',
    columns: [
      C('conducteur', 'Conducteur', 22),
      C('destination', 'Destination', 22),
      C('dateDepart', 'Départ', 12),
      C('dateRetour', 'Retour', 12),
      C('kmDepart', 'Km départ', 12),
      C('kmRetour', 'Km retour', 12),
      C('diff', 'Distance', 11),
      C('nbRav', 'Nb ravit.', 10),
      C('stations', 'Stations', 26),
      C('totalLitres', 'Total litres', 12),
      C('totalMontant', 'Total montant', 14)
    ],
    rows: list.map((d) => ({
      conducteur: d.conducteur || '',
      destination: d.destination || '',
      dateDepart: dateFR(d.dateDepart),
      dateRetour: dateFR(d.dateRetour),
      kmDepart: num(d.kmDepart),
      kmRetour: num(d.kmRetour),
      diff: num(d.diff),
      nbRav: (d.ravitaillements || []).length,
      stations: (d.ravitaillements || []).map((r) => r.station).filter(Boolean).join(', '),
      totalLitres: num(d.totalLitres),
      totalMontant: num(d.totalMontant)
    })),
    note: `Total : ${sum(list, (d) => d.totalLitres)} L — ${sum(list, (d) => d.totalMontant)} F`
  };
}

export function dsRavitaillements(list = DB.dotationMission) {
  const rows = [];
  list.forEach((d) => {
    (d.ravitaillements || []).forEach((r) => {
      rows.push({
        conducteur: d.conducteur || '',
        destination: d.destination || '',
        dateDepart: dateFR(d.dateDepart),
        station: r.station || '',
        quantite: num(r.quantite),
        prix: num(r.prix),
        montant: num(r.quantite) * num(r.prix)
      });
    });
  });
  return {
    title: 'Ravitaillements',
    columns: [
      C('conducteur', 'Conducteur', 22),
      C('destination', 'Destination', 20),
      C('dateDepart', 'Départ', 12),
      C('station', 'Station-service', 22),
      C('quantite', 'Quantité (L)', 12),
      C('prix', 'Prix / L', 11),
      C('montant', 'Montant', 13)
    ],
    rows
  };
}

/* ------------------------------ MISSIONS --------------------------- */

export function dsMissions(list = DB.missions) {
  const byDriver = groupBy(list, (m) => m.conducteur || '—');
  return {
    title: 'Missions',
    columns: [
      C('ref', 'Référence', 12),
      C('conducteur', 'Conducteur', 22),
      C('nbMissions', 'Nb missions', 11),
      C('vehicule', 'Véhicule', 14),
      C('destination', 'Destination', 22),
      C('dateDepart', 'Départ', 12),
      C('dateRetour', 'Retour', 12),
      C('jours', 'Jours', 8),
      C('totalJours', 'Total jours', 11),
      C('paiement', 'Paiement', 12),
      C('datePaiement', 'Date paiement', 14)
    ],
    rows: list.map((m) => {
      const g = byDriver[m.conducteur || '—'] || [];
      return {
        ref: m.ref || '',
        conducteur: m.conducteur || '',
        nbMissions: g.length,
        vehicule: m.vehicule || '',
        destination: m.destination || '',
        dateDepart: dateFR(m.dateDepart),
        dateRetour: dateFR(m.dateRetour),
        jours: m.jours === '' || m.jours === undefined ? '' : num(m.jours),
        totalJours: sum(g, (x) => x.jours),
        paiement: m.paye ? 'Payée' : 'Non payée',
        datePaiement: m.datePaiement || ''
      };
    }),
    note: `${list.filter((m) => !m.paye).length} mission(s) en attente de paiement sur ${list.length}.`
  };
}

/** Recapitulatif par conducteur. */
export function dsMissionsParConducteur(list = DB.missions) {
  const g = groupBy(list, (m) => m.conducteur || '—');
  return {
    title: 'Missions par conducteur',
    columns: [
      C('conducteur', 'Conducteur', 24),
      C('nbMissions', 'Nb missions', 12),
      C('totalJours', 'Total jours', 12),
      C('payees', 'Payées', 10),
      C('impayees', 'Non payées', 12),
      C('destinations', 'Destinations', 40)
    ],
    rows: Object.keys(g)
      .sort()
      .map((k) => ({
        conducteur: k,
        nbMissions: g[k].length,
        totalJours: sum(g[k], (m) => m.jours),
        payees: g[k].filter((m) => m.paye).length,
        impayees: g[k].filter((m) => !m.paye).length,
        destinations: [...new Set(g[k].map((m) => m.destination).filter(Boolean))].join(', ')
      }))
  };
}

/* ------------------------------ ENTRETIEN -------------------------- */

export function dsMaintenance(list = DB.maintenance) {
  return {
    title: 'Entretien',
    columns: [
      C('immat', 'Immatriculation', 16),
      C('marque', 'Marque', 14),
      C('modele', 'Modèle', 16),
      C('dateEntree', 'Entrée', 12),
      C('kmEntree', 'Km entrée', 12),
      C('conducteurEntree', 'Conducteur entrée', 20),
      C('motif', 'Motif', 28),
      C('signalePar', 'Signalé par', 18),
      C('garages', 'Garage(s)', 22),
      C('travaux', 'Travaux', 34),
      C('cout', 'Coût total', 12),
      C('dateRetour', 'Sortie', 12),
      C('kmRetour', 'Km sortie', 12),
      C('duree', 'Durée (j)', 10),
      C('etat', 'État', 12)
    ],
    rows: list.map((m) => {
      const iv = m.interventions || [];
      return {
        immat: m.immat || '',
        marque: m.marque || '',
        modele: m.modele || '',
        dateEntree: dateFR(m.dateEntree),
        kmEntree: num(m.kmEntree),
        conducteurEntree: m.conducteurEntree || '',
        motif: m.motif || '',
        signalePar: m.signalePar || '',
        garages: [...new Set(iv.map((x) => x.garage).filter(Boolean))].join(', '),
        travaux: iv.map((x) => x.travaux).filter(Boolean).join(' ; '),
        cout: sum(iv, (x) => x.cout),
        dateRetour: dateFR(m.dateRetour),
        kmRetour: num(m.kmRetour),
        duree: daysBetween(m.dateEntree, m.dateRetour) ?? '',
        etat: m.dateRetour ? 'Sorti' : 'Au garage'
      };
    }),
    note: `${openMaintenance().length} véhicule(s) actuellement au garage.`
  };
}

export function dsInterventions(list = DB.maintenance) {
  const rows = [];
  list.forEach((m) => {
    (m.interventions || []).forEach((iv) => {
      rows.push({
        immat: m.immat || '',
        dateEntree: dateFR(m.dateEntree),
        garage: iv.garage || '',
        observation: iv.observation || '',
        travaux: iv.travaux || '',
        pieces: iv.pieces || '',
        cout: num(iv.cout)
      });
    });
  });
  return {
    title: 'Interventions garage',
    columns: [
      C('immat', 'Immatriculation', 16),
      C('dateEntree', 'Entrée', 12),
      C('garage', 'Garage', 22),
      C('observation', 'Observation / diagnostic', 30),
      C('travaux', 'Travaux effectués', 32),
      C('pieces', 'Pièces remplacées', 26),
      C('cout', 'Coût', 12)
    ],
    rows,
    note: `Coût total des interventions : ${sum(rows, (r) => r.cout)} F`
  };
}

/* ------------------------------ SYNTHESE --------------------------- */

/** Cout de possession par vehicule (carburant + entretien). */
export function dsCoutParVehicule() {
  const rows = allVehicles().map((v) => {
    const im = immatOf(v);
    const ent = maintenanceCost(im);
    const carb = fuelCost(im);
    return {
      immat: im,
      marque: v.marque || '',
      modele: v.modele || '',
      categorie: (v._cat || '').toUpperCase(),
      km: num(v.km),
      carburant: carb,
      entretien: ent,
      total: carb + ent,
      passagesGarage: DB.maintenance.filter((m) => m.immat === im).length
    };
  });
  rows.sort((a, b) => b.total - a.total);
  return {
    title: 'Coûts par véhicule',
    columns: [
      C('immat', 'Immatriculation', 16),
      C('marque', 'Marque', 14),
      C('modele', 'Modèle', 16),
      C('categorie', 'Catégorie', 12),
      C('km', 'Kilométrage', 13),
      C('carburant', 'Coût carburant', 15),
      C('entretien', 'Coût entretien', 15),
      C('total', 'Coût total', 13),
      C('passagesGarage', 'Passages garage', 14)
    ],
    rows
  };
}

/** Tous les jeux de donnees, pour l export global. */
export function dsAll() {
  return [
    dsVehicles(),
    dsUsers(),
    dsIncidents(),
    dsDotationPool(),
    dsDotationMission(),
    dsRavitaillements(),
    dsMissions(),
    dsMissionsParConducteur(),
    dsMaintenance(),
    dsInterventions(),
    dsCoutParVehicule()
  ];
}
