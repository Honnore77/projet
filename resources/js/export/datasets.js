/* ===================================================================
   Construction des jeux de donnees exportables (Excel et PDF partagent
   exactement les memes colonnes).
   =================================================================== */

import { DB, allVehicles, immatOf, vehiculesDuGarage, passagesDuGarage, maintenanceCost, fuelCost, openMaintenance, missionsAvecCarburant, ravMontant, etatVidange, kmCourant, parcoursMission, missionsVersDestination, distanceSurPlace, vehicleByImmat, vehiculesDeLAgent, nomComplet, dureeIndisponibilite, etatIndisponibilite, suiviDotationPool } from '../core/db.js';

import { dateFR, daysBetween, num, norm, sum, groupBy } from '../core/utils.js';
import { problemesEnCours } from '../core/etatsVehicules.js';

/**
 * Colonne exportable. `alerteSiVide` demande aux trois rendus — apercu,
 * classeur Excel et PDF — de peindre la cellule en rouge clair quand la
 * valeur manque, pour qu'un trou se voie dans le fichier transmis.
 */
const C = (key, label, width, opts) => Object.assign({ key, label, width }, opts);

/**
 * Nombre a exporter, ou cellule vide quand la valeur n'a pas ete relevee.
 *
 * `num()` rendrait zero, ce qui se lit comme un compteur a zero : un vehicule
 * encore au garage afficherait « Km sortie : 0 » au lieu de ne rien afficher.
 */
const nombreOuVide = (v) => (v === '' || v === undefined || v === null ? '' : num(v));

/** Libelles du suivi de vidange, tels qu'ils paraissent dans les exports. */
const LIBELLE_VIDANGE = {
  inconnu: 'non suivie',
  ok: 'à jour',
  proche: 'à prévoir',
  depassee: 'dépassée'
};

/* ------------------------------ VEHICULES -------------------------- */

/**
 * Etat du parc. Les couts carburant et entretien n'y figurent pas : ils font
 * l'objet du rapport « Couts par vehicule », qui les detaille au lieu de les
 * resumer en deux colonnes au bout d'une ligne deja longue.
 */
export function dsVehicles(list = allVehicles()) {
  return {
    title: 'Véhicules',
    columns: [
      C('categorie', 'Catégorie', 12),
      C('marque', 'Marque', 14),
      C('modele', 'Modèle', 16),
      C('immatNouvelle', 'Immat. nouvelle', 16, { alerteSiVide: true }),
      C('immatAncienne', 'Immat. ancienne', 16),
      C('numeroChassis', 'N° de châssis', 20),
      C('couleur', 'Couleur', 12),
      C('energie', 'Énergie', 11),
      C('consommation', 'Consommation (L/100 km)', 14),
      C('section', 'Section', 18),
      C('utilisateur', 'Utilisateur', 20),
      C('statut', 'Statut', 13),
      C('km', 'Kilométrage', 13),
      C('kmVidange', 'Prochaine vidange (km)', 18),
      C('vidangeRestant', 'Km avant vidange', 15),
      C('vidangeEtat', 'Suivi vidange', 14),
      // Problemes signales et pas encore resolus (ÉTAT DES VÉHICULES).
      C('etatVehicule', 'État actuel du véhicule', 30)
    ],
    rows: list.map((v) => ({
      categorie: (v._cat || '').toUpperCase(),
      marque: v.marque || '',
      modele: v.modele || '',
      immatNouvelle: v.immatNouvelle || '',
      immatAncienne: v.immatAncienne || '',
      numeroChassis: v.numeroChassis || '',
      couleur: v.couleur || '',
      energie: v.energie || '',
      consommation: v.consommation === '' || v.consommation === undefined ? '' : Number(v.consommation),
      section: v.section || '',
      utilisateur: v.utilisateur || '',
      statut: v.statut || '',
      km: kmCourant(v),
      kmVidange: v.kmVidange === '' || v.kmVidange === undefined ? '' : num(v.kmVidange),
      vidangeRestant: etatVidange(v).restant === null ? '' : etatVidange(v).restant,
      vidangeEtat: LIBELLE_VIDANGE[etatVidange(v).statut],
      etatVehicule: problemesEnCours(v)
        .map((s) => `${String(s.probleme || '').split('\n')[0]}${s.dateSignalement ? ` depuis le ${dateFR(s.dateSignalement)}` : ''}`)
        .join('\n') || 'RAS'
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
      C('poolConducteur', 'Conducteur du pool', 14),
      C('vehicules', 'Véhicule(s) attribué(s)', 22),
      C('telephone', 'Téléphone', 22),
      C('email', 'Adresse email', 24),
      C('permis', 'N° de permis', 14),
      C('nbIncidents', 'Nb incidents', 12),
      C('dernierIncident', 'Dernier incident', 18),
      C('observations', 'Observations', 28)
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
        poolConducteur: u.poolConducteur === 'Oui' ? 'Oui' : 'Non',
        // La meme colonne qu'a l'ecran : les vehicules de pool et de service
        // dont l'agent est l'utilisateur.
        vehicules: vehiculesDeLAgent(nomComplet(u))
          .map((v) => `${v.immatNouvelle || v.immatAncienne || '?'} (${v._cat})`)
          .join(', '),
        telephone: u.telephone || '',
        email: u.email || '',
        permis: u.permis || '',
        nbIncidents: h.length,
        dernierIncident: last ? `${dateFR(last.date)} — ${last.nature || ''}` : '',
        observations: u.observations || ''
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
  // Soldes et ecarts de jours se calculent sur toutes les prises, meme
  // quand on n'en exporte qu'une partie : la prise qui precede peut etre
  // hors du filtre.
  const suivi = suiviDotationPool();
  const solde = (v) => (v === '' || v === undefined ? '' : num(v));
  // Comme le tableau de l'application : la prise la plus recente en haut.
  const rang = new Map([...suivi.keys()].map((id, i) => [id, i]));
  list = list.slice().sort((a, b) => rang.get(b.id) - rang.get(a.id));
  return {
    title: 'Dotation pool',
    columns: [
      C('date', 'Date', 12),
      C('jours', 'Nombre de jours', 10),
      C('immat', 'Immatriculation', 16),
      C('marqueModele', 'Marque / Modèle', 22),
      C('carte', 'Carte carburant', 18),
      C('energie', 'Énergie', 11),
      C('km', 'Kilométrage', 13),
      C('quantite', 'Quantité (L)', 12),
      C('prixL', 'Prix / L', 11),
      C('montant', 'Montant', 13),
      C('rechargement', 'Rechargement', 14),
      C('soldeAvant', 'Solde avant prise', 16),
      C('soldeApres', 'Solde après prise', 16),
      C('ecart', 'Écart', 13),
      C('station', 'Station-service', 22),
      C('vidange', 'État vidange', 13),
      C('conducteur', 'Conducteur', 22)
    ],
    rows: list.map((d) => {
      const s = suivi.get(d.id) || {};
      return {
        date: dateFR(d.date),
        jours: s.jours === null || s.jours === undefined ? '' : s.jours,
        immat: d.immat || '',
        marqueModele: d.marqueModele || '',
        carte: d.carte || '',
        energie: d.energie || '',
        km: num(d.km),
        quantite: num(d.quantite),
        prixL: num(d.prixL),
        montant: num(d.montant),
        rechargement: num(d.rechargement) ? num(d.rechargement) : '',
        soldeAvant: solde(s.soldeAvant),
        soldeApres: solde(s.soldeApres),
        ecart: solde(s.ecart),
        station: d.station || '',
        vidange: d.vidange || '',
        conducteur: d.conducteur || ''
      };
    }),
    note: `Total : ${sum(list, (d) => d.quantite)} L — ${sum(list, (d) => d.montant)} F`
  };
}

export function dsCarburantMissions(list = missionsAvecCarburant()) {
  return {
    title: 'Carburant des missions',
    columns: [
      C('conducteur', 'Conducteur', 22),
      C('destination', 'Destination', 22),
      C('dateDepart', 'Départ', 12),
      C('dateRetour', 'Retour', 12),
      C('kmDepart', 'Km départ', 12),
      C('kmRetour', 'Km retour', 12),
      C('diff', 'Distance', 11),
      C('parcours', 'Parcours A/R (km)', 13),
      C('surPlace', 'Sur place (km)', 12),
      C('nbRav', 'Nb ravit.', 10),
      C('stations', 'Stations', 26),
      C('totalLitres', 'Total litres', 12),
      C('totalMontant', 'Total montant', 14)
    ],
    rows: list.map((m) => {
      const rav = m.ravitaillements || [];
      return {
        conducteur: m.conducteur || '',
        destination: m.destination || '',
        dateDepart: dateFR(m.dateDepart),
        dateRetour: dateFR(m.dateRetour),
        kmDepart: num(m.kmDepart),
        kmRetour: num(m.kmArrivee),
        diff: num(m.kmArrivee) - num(m.kmDepart),
        parcours: kmAbidjan(m),
        surPlace: (distanceSurPlace(m) || { surPlace: '' }).surPlace,
        nbRav: rav.length,
        stations: rav.map((r) => r.station).filter(Boolean).join(', '),
        totalLitres: sum(rav, (r) => r.quantite),
        totalMontant: sum(rav, ravMontant)
      };
    }),
    note:
      `Total : ${sum(list, (m) => sum(m.ravitaillements || [], (r) => r.quantite))} L — ` +
      `${sum(list, (m) => sum(m.ravitaillements || [], ravMontant))} F`
  };
}

/** Chaque point de ravitaillement, ligne a ligne, tel que sur le rapport. */
export function dsRavitaillementsMissions(list = DB.missions) {
  const rows = [];
  list.forEach((m) => {
    (m.ravitaillements || []).forEach((r) => {
      rows.push({
        ref: m.ref || '',
        conducteur: m.conducteur || '',
        destination: m.destination || '',
        date: dateFR(r.date) || dateFR(m.dateDepart),
        station: r.station || '',
        quantite: num(r.quantite),
        prix: num(r.prixL),
        montant: ravMontant(r)
      });
    });
  });
  return {
    title: 'Ravitaillements',
    columns: [
      C('ref', 'Mission', 12),
      C('conducteur', 'Conducteur', 22),
      C('destination', 'Destination', 20),
      C('date', 'Date', 12),
      C('station', 'Point de ravitaillement', 24),
      C('quantite', 'Quantité (L)', 12),
      C('prix', 'Prix / L', 11),
      C('montant', 'Montant', 13)
    ],
    rows,
    note: `Total : ${sum(rows, (r) => r.quantite)} L — ${sum(rows, (r) => r.montant)} F`
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
      C('distance', 'Parcours aller-retour (km)', 14),
      C('dateDepart', 'Départ', 12),
      C('dateRetour', 'Retour', 12),
      C('jours', 'Jours', 8),
      C('totalJours', 'Total jours', 11),
      C('frais', 'Frais (dotation de mission)', 14),
      C('paiement', 'Paiement (prime de mission)', 14),
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
        distance: kmAbidjan(m),
        dateDepart: dateFR(m.dateDepart),
        dateRetour: dateFR(m.dateRetour),
        jours: m.jours === '' || m.jours === undefined ? '' : num(m.jours),
        totalJours: sum(g, (x) => x.jours),
        frais: m.montant === '' || m.montant === undefined ? '' : num(m.montant),
        paiement: m.paye ? 'Payée' : 'Non payée',
        datePaiement: m.datePaiement || ''
      };
    }),
    note: `${list.filter((m) => !m.paye).length} mission(s) en attente de paiement sur ${list.length}.`
  };
}

/**
 * TABLEAU DE SUIVI DES MISSIONS — colonnes du document de suivi du PDU.
 *
 * Les deux dernieres colonnes portent sur le conducteur et non sur la ligne :
 * elles servent a verifier que les missions tournent bien entre conducteurs
 * du pool. Elles sont calculees sur l'ensemble des missions, pas seulement
 * sur celles retenues par les filtres, sinon le cumul ne voudrait rien dire.
 */
export function dsSuiviMissions(list = DB.missions) {
  const parConducteur = groupBy(DB.missions, (m) => norm(m.conducteur || '—'));
  const totalDe = (m) => parConducteur[norm(m.conducteur || '—')] || [];

  return {
    title: 'Suivi des missions',
    columns: [
      C('conducteur', 'Nom du conducteur', 24),
      C('nbMissions', 'Nb de missions du conducteur', 14),
      C('vehicule', 'Immatriculation du véhicule', 18),
      C('periode', 'Période (départ → retour)', 24),
      C('destination', 'Destination', 24),
      C('jours', 'Nb de jours effectués', 13),
      C('cumulJours', 'Cumul des jours du conducteur', 15)
    ],
    rows: list.map((m) => ({
      conducteur: m.conducteur || '',
      nbMissions: totalDe(m).length,
      vehicule: m.vehicule || '',
      periode: `${dateFR(m.dateDepart) || '…'} → ${dateFR(m.dateRetour) || '…'}`,
      destination: m.destination || '',
      jours: m.jours === '' || m.jours === undefined ? '' : num(m.jours),
      cumulJours: sum(totalDe(m), (x) => x.jours)
    }))
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
        kmEntree: nombreOuVide(m.kmEntree),
        conducteurEntree: m.conducteurEntree || '',
        motif: m.motif || '',
        signalePar: m.signalePar || '',
        // Le garage de la fiche, puis ceux des interventions.
        garages: [...new Set([m.garage, ...iv.map((x) => x.garage)].filter(Boolean))].join(', '),
        travaux: iv.map((x) => x.travaux).filter(Boolean).join(' ; '),
        cout: sum(iv, (x) => x.cout),
        dateRetour: dateFR(m.dateRetour),
        kmRetour: nombreOuVide(m.kmRetour),
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
      km: kmCourant(v),
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
    dsCarburantMissions(),
    dsRavitaillementsMissions(),
    dsMissions(),
    dsMissionsParConducteur(),
    dsMaintenance(),
    dsInterventions(),
    dsCoutParVehicule()
  ];
}

/** ENTRETIEN → GARAGES : memes colonnes que le tableau de la sous-rubrique. */
export function dsGarages(list = DB.garages || []) {
  return {
    title: 'Garages',
    columns: [
      C('nom', 'Nom', 26),
      C('contacts', 'Contacts', 26),
      C('pointFocal', 'Point focal et son contact', 28),
      C('localisation', 'Localisation', 32),
      C('interventions', 'Interventions (véhicules)', 30),
      C('passages', 'Passages', 10)
    ],
    rows: list.map((g) => ({
      nom: g.nom || '',
      contacts: g.contacts || '',
      pointFocal: [g.pointFocal, g.contactPointFocal].filter(Boolean).join('\n'),
      localisation: g.localisation || '',
      interventions: vehiculesDuGarage(g.nom).join(', '),
      passages: passagesDuGarage(g.nom).length
    }))
  };
}

/** Decharges : memes colonnes que le tableau de la rubrique. */
export function dsDecharges(list = DB.decharges) {
  return {
    title: 'Décharges',
    columns: [
      C('ref', 'Réf.', 10),
      C('numeroCourrier', 'N° courrier', 16),
      C('objet', 'Objet', 36),
      C('destinataire', 'Destinataire', 26),
      C('date', 'Date', 12),
      C('recuperePar', 'Décharge récupérée par', 22),
      C('conducteur', 'Conducteur', 22),
      C('immat', 'Véhicule', 16),
      C('signee', 'Décharge signée', 14)
    ],
    rows: list.map((d) => ({
      ref: d.ref || '',
      numeroCourrier: d.numeroCourrier || '',
      objet: d.objet || '',
      destinataire: d.destinataire || '',
      date: dateFR(d.date),
      recuperePar: d.recuperePar || '',
      conducteur: d.conducteur || '',
      immat: d.immat || '',
      signee: (d.images || []).length ? 'jointe' : 'à joindre'
    }))
  };
}

/** Destinataires des decharges, avec le nombre de courriers recus. */
export function dsDestinataires(list = DB.destinataires) {
  return {
    title: 'Destinataires',
    columns: [
      C('nom', 'Nom de la structure', 32),
      C('contacts', 'Contacts', 32),
      C('localisation', 'Localisation', 40),
      C('decharges', 'Décharges', 11)
    ],
    rows: list.map((d) => ({
      nom: d.nom || '',
      contacts: d.contacts || '',
      localisation: d.localisation || '',
      decharges: (DB.decharges || []).filter((x) => norm(x.destinataire || '') === norm(d.nom || '')).length
    }))
  };
}

/**
 * Distance du parcours a exporter : la somme des etapes depuis Abidjan,
 * retour compris.
 * Vide si une etape manque — un total partiel se lirait comme le total.
 */
function kmAbidjan(m) {
  const p = parcoursMission(m);
  return p.etapes.length && p.complet ? p.total : '';
}

/** Destinations des missions, avec leur distance et le nombre de missions. */
export function dsDestinationsMission(list = DB.destinationsMission) {
  return {
    title: 'Destinations des missions',
    columns: [
      C('nom', 'Destination', 26),
      C('distance', 'Distance depuis Abidjan (km)', 16),
      C('nature', 'Distance', 12),
      C('localisation', 'Localisation', 40),
      C('missions', 'Missions', 10)
    ],
    rows: list.map((d) => ({
      nom: d.nom || '',
      distance: d.distanceKm === '' || d.distanceKm === undefined ? '' : num(d.distanceKm),
      nature: d.distanceKm === '' || d.distanceKm === undefined ? '' : d.estimee ? 'estimée' : 'routière',
      localisation: d.localisation || (d.lat !== '' && d.lat !== undefined ? `${d.lat}, ${d.lng}` : ''),
      missions: missionsVersDestination(d.nom).length
    }))
  };
}

/** Vehicule d'une simulation, lu dans VÉHICULES s'il y figure (voir simulation.js). */
function vehiculeDeSimulation(s) {
  const v = vehicleByImmat(s.vehicule);
  if (!v) return { marqueModele: s.marqueModele || '', energie: s.energie || '' };
  return {
    marqueModele: `${v.marque || ''} ${v.modele || ''}`.trim() || s.marqueModele || '',
    energie: v.energie || s.energie || ''
  };
}

/** Simulations de mission : le detail du calcul, colonne par colonne. */
export function dsSimulations(list = DB.simulations) {
  return {
    title: 'Simulations de mission',
    columns: [
      C('periode', 'Période', 22),
      C('destinations', 'Destinations', 30),
      C('parcoursKm', 'Parcours A/R (km)', 13),
      C('interneKm', 'En interne (km)', 12),
      C('distanceTotale', 'Distance totale (km)', 13),
      C('vehicule', 'Immatriculation', 14),
      C('marqueModele', 'Véhicule utilisé', 18),
      C('energie', 'Énergie', 10),
      C('consommation', 'L/100 km', 9),
      C('litres', 'Litres', 9),
      C('prixL', 'Prix / L', 9),
      C('montantCarburant', 'Carburant (F)', 13),
      C('participants', 'Participants', 11),
      C('fraisOm', 'Frais OM (F)', 12),
      C('mission', 'Mission créée', 12),
      C('fraisPeage', 'Péages (F)', 11),
      C('estimation', 'Estimation (F)', 14)
    ],
    rows: list.map((s) => ({
      periode: `${dateFR(s.dateDepart) || '…'} - ${dateFR(s.dateRetour) || '…'}`,
      destinations: (s.destinations || []).join(', '),
      parcoursKm: num(s.parcoursKm),
      interneKm: num(s.interneKm),
      distanceTotale: num(s.distanceTotale),
      vehicule: s.vehicule || '',
      marqueModele: vehiculeDeSimulation(s).marqueModele,
      energie: vehiculeDeSimulation(s).energie,
      consommation: num(s.consommation),
      litres: num(s.litres),
      prixL: num(s.prixL),
      montantCarburant: num(s.montantCarburant),
      participants: num(s.participants),
      fraisOm: num(s.fraisOm),
      mission: ((DB.missions || []).find((m) => m.id === s.missionId) || {}).ref || '',
      fraisPeage: num(s.fraisPeage),
      estimation: num(s.estimation)
    }))
  };
}

/** Indisponibilites au pool : periode, duree, motif et interimaire. */
export function dsIndisponibilites(list = DB.indisponibilites) {
  return {
    title: 'Congés et absences au pool',
    columns: [
      C('conducteur', 'Conducteur', 24),
      C('motif', 'Motif', 16),
      C('dateDepart', 'Date de départ', 13),
      C('dateReprise', 'Date de reprise', 13),
      C('duree', 'Durée (jours)', 11),
      C('interimaire', 'Intérimaire', 24),
      C('etat', 'État', 11),
      C('justificatif', 'Justificatif', 12)
    ],
    rows: list.map((i) => {
      const d = dureeIndisponibilite(i.dateDepart, i.dateReprise);
      return {
        conducteur: i.conducteur || '',
        motif: i.motif || '',
        dateDepart: dateFR(i.dateDepart),
        dateReprise: dateFR(i.dateReprise),
        duree: d === null ? '' : d,
        interimaire: i.interimaire || '',
        etat: etatIndisponibilite(i),
        justificatif: (i.images || []).length ? 'joint' : ''
      };
    })
  };
}
