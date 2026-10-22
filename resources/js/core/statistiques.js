/* ===================================================================
   STATISTIQUES — les chiffres de chaque rubrique.

   Chaque rubrique rend la meme forme, que la page STATISTIQUES dessine et
   que les exports reprennent :

     { tuiles: [{ titre, valeur, detail }],
       blocs:  [{ titre, entetes, lignes, graphique? }] }

   graphique = { type: 'doughnut' | 'bar', libelles, series: [{ nom, valeurs }] }

   Le filtre d'annee porte sur la date propre a chaque rubrique (prise de
   carburant, depart en mission, entree au garage…). Les vehicules et les
   agents, qui ne sont pas dates, se comptent tels qu'ils sont aujourd'hui.
   =================================================================== */

import {
  DB, allVehicles, immatOf, immatActuelle, kmCourant, etatVidange, missionsAvecCarburant, ravMontant,
  destinationsDe, parcoursMission, dureeIndisponibilite, indisponibilitesEnCours, nomComplet,
  vehiculesDeLAgent
} from './db.js';
import { fmt, num, norm, sum, daysBetween, todayISO } from './utils.js';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* ----------------------------- Outils ------------------------------ */

const pct = (n, total) => (total ? `${Math.round((n / total) * 100)} %` : '—');
const F = (n) => `${fmt(n)} F`;

/** Les annees presentes dans une liste, de la plus recente a la plus ancienne. */
export function anneesDe(list, dateFn) {
  return [...new Set(list.map(dateFn).filter(Boolean).map((d) => String(d).slice(0, 4)))]
    .filter((a) => /^\d{4}$/.test(a))
    .sort()
    .reverse();
}

/** Toutes les annees qui ont des donnees, toutes rubriques confondues. */
export function anneesDisponibles(db = DB) {
  const a = new Set([
    ...anneesDe(db.dotationPool, (d) => d.date),
    ...anneesDe(db.missions, (m) => m.dateDepart),
    ...anneesDe(db.maintenance, (m) => m.dateEntree),
    ...anneesDe(db.decharges || [], (d) => d.date),
    ...anneesDe(db.simulations || [], (s) => s.dateDepart),
    ...anneesDe(db.indisponibilites || [], (i) => i.dateDepart),
    ...db.users.flatMap((u) => anneesDe(u.historique || [], (h) => h.date)),
    todayISO().slice(0, 4)
  ]);
  return [...a].sort().reverse();
}

/** Ne garde que l'annee demandee ('' : toutes). */
export function deLAnnee(list, dateFn, annee) {
  if (!annee) return list.slice();
  return list.filter((x) => String(dateFn(x) || '').startsWith(annee));
}

/**
 * Repartition d'une liste selon une cle : [libelle, nombre, part], la plus
 * grande d'abord. Une cle vide se range sous « non renseigné ».
 */
export function repartition(list, cleFn, { valeur = () => 1, limite = 0 } = {}) {
  const groupes = new Map();
  list.forEach((x) => {
    const brut = String(cleFn(x) || '').trim();
    const k = brut || 'non renseigné';
    groupes.set(k, (groupes.get(k) || 0) + num(valeur(x)));
  });
  const total = [...groupes.values()].reduce((t, n) => t + n, 0);
  let lignes = [...groupes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
  if (limite && lignes.length > limite) {
    const autres = lignes.slice(limite).reduce((t, [, n]) => t + n, 0);
    lignes = [...lignes.slice(0, limite), ['autres', autres]];
  }
  return { total, lignes: lignes.map(([k, n]) => ({ libelle: k, nombre: n, part: pct(n, total) })) };
}

/**
 * Valeurs par mois. Une annee donnee : ses douze mois. Toutes les annees :
 * chaque mois present, dans l'ordre.
 */
export function parMois(list, dateFn, annee, valeurs) {
  const cles = annee
    ? MOIS.map((_, i) => `${annee}-${String(i + 1).padStart(2, '0')}`)
    : [...new Set(list.map((x) => String(dateFn(x) || '').slice(0, 7)).filter((k) => /^\d{4}-\d{2}$/.test(k)))].sort();
  const libelles = cles.map((k) => (annee ? MOIS[Number(k.slice(5)) - 1] : `${MOIS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`));
  const series = Object.entries(valeurs).map(([nom, fn]) => ({
    nom,
    valeurs: cles.map((k) => sum(list.filter((x) => String(dateFn(x) || '').startsWith(k)), fn))
  }));
  return { cles, libelles, series };
}

/** Un bloc « repartition » : tableau libelle / nombre / part, et son graphique. */
function blocRepartition(titre, rep, { type = 'doughnut', entete = 'Nombre', format = fmt } = {}) {
  return {
    titre,
    entetes: ['', entete, 'Part'],
    lignes: rep.lignes.map((l) => [l.libelle, format(l.nombre), l.part]),
    graphique: rep.lignes.length
      ? { type, libelles: rep.lignes.map((l) => l.libelle), series: [{ nom: entete, valeurs: rep.lignes.map((l) => l.nombre) }] }
      : null
  };
}

/** Un bloc « par mois » : un tableau mois / series, et son histogramme. */
function blocMensuel(titre, m, formats = {}) {
  return {
    titre,
    entetes: ['Mois', ...m.series.map((s) => s.nom)],
    lignes: m.libelles.map((lib, i) => [lib, ...m.series.map((s) => (formats[s.nom] || fmt)(s.valeurs[i]))]),
    graphique: m.libelles.length ? { type: 'bar', libelles: m.libelles, series: m.series } : null
  };
}

/** Un classement : les premiers d'une liste, avec plusieurs colonnes. */
function blocClassement(titre, entetes, lignes, limite = 10) {
  return { titre, entetes, lignes: lignes.slice(0, limite), graphique: null };
}

/**
 * Frequence de sortie : un histogramme du nombre de sorties par conducteur
 * ou par vehicule, le plus frequent d'abord.
 */
function blocFrequence(titre, rep, entete = 'Sorties') {
  return blocRepartition(titre, rep, { type: 'bar', entete });
}

/* ============================ VÉHICULES ============================ */

export function statsVehicules(annee = '') {
  const tous = allVehicles();
  // Une sortie du pool, c'est une decharge : un conducteur part avec un
  // vehicule deposer un courrier. Seules ces sorties dependent de l'annee.
  const sorties = deLAnnee(DB.decharges || [], (d) => d.date, annee);
  const vid = tous.map((v) => etatVidange(v).statut);
  const LIB = { ok: 'à jour', proche: 'à prévoir', depassee: 'dépassée', inconnu: 'non suivie' };
  const avecConso = tous.filter((v) => num(v.consommation) > 0);
  const kms = tous.map(kmCourant).filter((k) => k > 0);
  return {
    tuiles: [
      { titre: 'Véhicules', valeur: fmt(tous.length), detail: 'dans le parc' },
      { titre: 'Disponibles', valeur: fmt(tous.filter((v) => v.statut === 'Disponible').length), detail: pct(tous.filter((v) => v.statut === 'Disponible').length, tous.length) },
      { titre: 'Au garage ou immobilisés', valeur: fmt(tous.filter((v) => v.statut && ['En entretien', 'Immobilisé'].includes(v.statut)).length), detail: 'en entretien ou immobilisés' },
      { titre: 'Vidanges à surveiller', valeur: fmt(vid.filter((s) => s === 'proche' || s === 'depassee').length), detail: `${fmt(vid.filter((s) => s === 'depassee').length)} dépassée(s)` },
      { titre: 'Kilométrage moyen', valeur: `${fmt(kms.length ? Math.round(sum(kms, (k) => k) / kms.length) : 0)} km`, detail: `${kms.length} véhicule(s) relevé(s)` },
      { titre: 'Consommation moyenne', valeur: avecConso.length ? `${(sum(avecConso, (v) => v.consommation) / avecConso.length).toFixed(1).replace('.', ',')} L/100` : '—', detail: `${avecConso.length} véhicule(s) renseigné(s)` },
      { titre: 'Sorties du pool', valeur: fmt(sorties.length), detail: `décharges ${annee ? `en ${annee}` : 'toutes années'}` }
    ],
    blocs: [
      blocFrequence('Fréquence de sortie des conducteurs du pool (décharges)', repartition(sorties, (d) => d.conducteur, { limite: 15 })),
      blocFrequence('Fréquence de sortie des véhicules du pool (décharges)',
        // Ancienne et nouvelle immatriculation : un seul vehicule.
        repartition(sorties, (d) => immatActuelle(d.immat), { limite: 15 })),
      blocMensuel('Sorties du pool par mois', parMois(sorties, (d) => d.date, annee, { Sorties: () => 1 })),
      blocRepartition('Véhicules par catégorie', repartition(tous, (v) => String(v._cat || '').toUpperCase())),
      blocRepartition('Véhicules par statut', repartition(tous, (v) => v.statut)),
      blocRepartition('Véhicules par énergie', repartition(tous, (v) => v.energie)),
      blocRepartition('Véhicules par marque', repartition(tous, (v) => v.marque, { limite: 8 }), { type: 'bar' }),
      blocRepartition('Véhicules par section', repartition(tous.filter((v) => v._cat !== 'mission'), (v) => v.section), { type: 'bar' }),
      blocRepartition('Suivi de la vidange', repartition(vid, (s) => LIB[s])),
      blocClassement('Informations à compléter', ['Information manquante', 'Véhicules'], [
        ['Immatriculation', fmt(tous.filter((v) => !immatOf(v).trim() || /^D45( 50)?\s*$/.test(immatOf(v).trim())).length)],
        ['N° de châssis', fmt(tous.filter((v) => !v.numeroChassis).length)],
        ['Consommation', fmt(tous.filter((v) => !num(v.consommation)).length)],
        ['Kilométrage de vidange', fmt(tous.filter((v) => !num(v.kmVidange)).length)]
      ])
    ]
  };
}

/* =========================== UTILISATEURS ========================== */

export function statsUtilisateurs(annee) {
  const agents = DB.users;
  const incidents = deLAnnee(agents.flatMap((u) => (u.historique || []).map((h) => Object.assign({ agent: nomComplet(u) }, h))), (h) => h.date, annee);
  const absences = deLAnnee(DB.indisponibilites || [], (i) => i.dateDepart, annee);
  const jours = (i) => dureeIndisponibilite(i.dateDepart, i.dateReprise) || 0;
  return {
    tuiles: [
      { titre: 'Agents', valeur: fmt(agents.length), detail: `${fmt(agents.filter((u) => u.statut === 'Actif').length)} actif(s)` },
      { titre: 'Conducteurs du pool', valeur: fmt(agents.filter((u) => u.poolConducteur === 'Oui').length), detail: 'au tour de rôle' },
      { titre: 'Absents aujourd’hui', valeur: fmt(indisponibilitesEnCours().length), detail: indisponibilitesEnCours().map((i) => i.conducteur).join(', ') || 'aucun' },
      { titre: 'Agents avec véhicule', valeur: fmt(agents.filter((u) => vehiculesDeLAgent(nomComplet(u)).length).length), detail: 'pool ou service' },
      { titre: 'Incidents', valeur: fmt(incidents.length), detail: annee ? `en ${annee}` : 'toutes années' },
      { titre: 'Jours d’absence', valeur: fmt(sum(absences, jours)), detail: `${fmt(absences.length)} congé(s) ou absence(s)` }
    ],
    blocs: [
      blocRepartition('Agents par statut', repartition(agents, (u) => u.statut)),
      blocRepartition('Agents par section', repartition(agents, (u) => u.section), { type: 'bar' }),
      blocRepartition('Incidents par nature', repartition(incidents, (h) => h.nature), { type: 'bar' }),
      blocClassement('Incidents par agent', ['Agent', 'Incidents'],
        repartition(incidents, (h) => h.agent).lignes.map((l) => [l.libelle, fmt(l.nombre)])),
      blocRepartition('Congés et absences par motif (jours)', repartition(absences, (i) => i.motif, { valeur: jours }), { entete: 'Jours' }),
      blocClassement('Jours d’absence par conducteur', ['Conducteur', 'Absences', 'Jours'],
        repartition(absences, (i) => i.conducteur, { valeur: jours }).lignes.map((l) => [
          l.libelle, fmt(absences.filter((i) => norm(i.conducteur || '') === norm(l.libelle)).length), fmt(l.nombre)
        ])),
      blocMensuel('Jours d’absence par mois (selon le départ)', parMois(absences, (i) => i.dateDepart, annee, { Jours: jours }))
    ]
  };
}

/* ============================= DOTATION ============================ */

export function statsDotation(annee) {
  const pool = deLAnnee(DB.dotationPool, (d) => d.date, annee);
  const ravs = deLAnnee(
    missionsAvecCarburant().flatMap((m) => (m.ravitaillements || []).map((r) => Object.assign({ conducteur: m.conducteur, vehicule: m.vehicule, jour: r.date || m.dateDepart }, r))),
    (r) => r.jour, annee
  );
  const litresPool = sum(pool, (d) => d.quantite);
  const montantPool = sum(pool, (d) => d.montant);
  const litresMission = sum(ravs, (r) => r.quantite);
  const montantMission = sum(ravs, ravMontant);
  const mensuel = (() => {
    const p = parMois(pool, (d) => d.date, annee, { 'Pool (L)': (d) => d.quantite });
    const m = parMois(ravs, (r) => r.jour, annee, { 'Missions (L)': (r) => r.quantite });
    // Les deux series sur les memes mois.
    const cles = [...new Set([...p.cles, ...m.cles])].sort();
    const val = (src, k) => { const i = src.cles.indexOf(k); return i < 0 ? 0 : src.series[0].valeurs[i]; };
    return {
      cles,
      libelles: cles.map((k) => (annee ? MOIS[Number(k.slice(5)) - 1] : `${MOIS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`)),
      series: [{ nom: 'Pool (L)', valeurs: cles.map((k) => val(p, k)) }, { nom: 'Missions (L)', valeurs: cles.map((k) => val(m, k)) }]
    };
  })();
  const mensuelMontant = parMois([...pool.map((d) => ({ j: d.date, v: d.montant })), ...ravs.map((r) => ({ j: r.jour, v: ravMontant(r) }))], (x) => x.j, annee, { 'Montant (F)': (x) => x.v });
  return {
    tuiles: [
      { titre: 'Litres — pool', valeur: `${fmt(litresPool)} L`, detail: `${fmt(pool.length)} prise(s)` },
      { titre: 'Montant — pool', valeur: F(montantPool), detail: litresPool ? `${fmt(Math.round(montantPool / litresPool))} F le litre en moyenne` : '' },
      { titre: 'Litres — missions', valeur: `${fmt(litresMission)} L`, detail: `${fmt(ravs.length)} ravitaillement(s)` },
      { titre: 'Montant — missions', valeur: F(montantMission), detail: '' },
      { titre: 'Total carburant', valeur: F(montantPool + montantMission), detail: `${fmt(litresPool + litresMission)} L` },
      { titre: 'Prise moyenne (pool)', valeur: `${fmt(pool.length ? Math.round(litresPool / pool.length) : 0)} L`, detail: 'par dotation' }
    ],
    blocs: [
      blocMensuel('Litres par mois', mensuel),
      blocMensuel('Montant du carburant par mois (pool et missions)', mensuelMontant, { 'Montant (F)': F }),
      blocClassement('Carburant pool par véhicule', ['Véhicule', 'Prises', 'Litres', 'Montant'],
        // Un vehicule, une ligne : les prises sous l'ancienne immatriculation
        // se comptent avec celles sous la nouvelle.
        repartition(pool, (d) => immatActuelle(d.immat), { valeur: (d) => d.quantite }).lignes.map((l) => {
          const lot = pool.filter((d) => immatActuelle(d.immat) === l.libelle || (!d.immat && l.libelle === 'non renseigné'));
          return [l.libelle, fmt(lot.length), `${fmt(l.nombre)} L`, F(sum(lot, (d) => d.montant))];
        }), 15),
      blocRepartition('Litres pool par station-service', repartition(pool, (d) => d.station, { valeur: (d) => d.quantite, limite: 8 }), { type: 'bar', entete: 'Litres' }),
      blocRepartition('Litres pool par énergie', repartition(pool, (d) => d.energie, { valeur: (d) => d.quantite }), { entete: 'Litres' }),
      blocClassement('Carburant des missions par conducteur', ['Conducteur', 'Ravitaillements', 'Litres', 'Montant'],
        repartition(ravs, (r) => r.conducteur, { valeur: (r) => r.quantite }).lignes.map((l) => {
          const lot = ravs.filter((r) => norm(r.conducteur || '') === norm(l.libelle));
          return [l.libelle, fmt(lot.length), `${fmt(l.nombre)} L`, F(sum(lot, ravMontant))];
        }))
    ]
  };
}

/* ============================== MISSION ============================ */

export function statsMissions(annee) {
  const ms = deLAnnee(DB.missions, (m) => m.dateDepart, annee);
  const compteur = (m) => (m.kmDepart !== '' && m.kmArrivee !== '' && m.kmArrivee !== undefined && m.kmDepart !== undefined
    ? Math.max(0, num(m.kmArrivee) - num(m.kmDepart)) : 0);
  const parcours = (m) => { const p = parcoursMission(m); return p.complet ? p.total : 0; };
  const nonPayees = ms.filter((m) => !m.paye);
  return {
    tuiles: [
      { titre: 'Missions', valeur: fmt(ms.length), detail: annee ? `parties en ${annee}` : 'toutes années' },
      { titre: 'Jours de mission', valeur: fmt(sum(ms, (m) => m.jours)), detail: ms.length ? `${(sum(ms, (m) => m.jours) / ms.length).toFixed(1).replace('.', ',')} j par mission` : '' },
      { titre: 'Km au compteur', valeur: `${fmt(sum(ms, compteur))} km`, detail: `${fmt(ms.filter((m) => compteur(m)).length)} rapport(s) renseigné(s)` },
      { titre: 'Km de parcours calculés', valeur: `${fmt(sum(ms, parcours))} km`, detail: 'aller-retour, étape par étape' },
      { titre: 'Frais de mission', valeur: F(sum(ms, (m) => m.montant)), detail: `${fmt(ms.filter((m) => m.paye).length)} payée(s)` },
      { titre: 'Non payées', valeur: fmt(nonPayees.length), detail: F(sum(nonPayees, (m) => m.montant)) }
    ],
    blocs: [
      blocFrequence('Fréquence de sortie des conducteurs en mission', repartition(ms, (m) => m.conducteur, { limite: 15 }), 'Missions'),
      blocFrequence('Fréquence de sortie des véhicules en mission', repartition(ms, (m) => immatActuelle(m.vehicule), { limite: 15 }), 'Missions'),
      blocMensuel('Missions et jours par mois', parMois(ms, (m) => m.dateDepart, annee, { Missions: () => 1, Jours: (m) => m.jours })),
      blocClassement('Missions par conducteur', ['Conducteur', 'Missions', 'Jours', 'Km au compteur'],
        repartition(ms, (m) => m.conducteur).lignes.map((l) => {
          const lot = ms.filter((m) => norm(m.conducteur || '') === norm(l.libelle));
          return [l.libelle, fmt(l.nombre), fmt(sum(lot, (m) => m.jours)), `${fmt(sum(lot, compteur))} km`];
        }), 15),
      blocRepartition('Destinations les plus fréquentes',
        repartition(ms.flatMap((m) => destinationsDe(m)), (d) => d, { limite: 10 }), { type: 'bar', entete: 'Visites' }),
      blocClassement('Missions par véhicule', ['Véhicule', 'Missions', 'Jours', 'Km au compteur'],
        repartition(ms, (m) => m.vehicule).lignes.map((l) => {
          const lot = ms.filter((m) => String(m.vehicule || '').trim() === l.libelle || (!m.vehicule && l.libelle === 'non renseigné'));
          return [l.libelle, fmt(l.nombre), fmt(sum(lot, (m) => m.jours)), `${fmt(sum(lot, compteur))} km`];
        }), 15),
      blocRepartition('Paiement des missions', repartition(ms, (m) => (m.paye ? 'payée' : 'non payée'))),
      blocRepartition('Missions par nombre de destinations',
        repartition(ms, (m) => { const n = destinationsDe(m).length; return n ? `${n} destination${n > 1 ? 's' : ''}` : 'sans destination'; }))
    ]
  };
}

/* ============================= ENTRETIEN =========================== */

export function statsEntretien(annee) {
  const ms = deLAnnee(DB.maintenance, (m) => m.dateEntree, annee);
  const cout = (m) => sum(m.interventions || [], (i) => i.cout);
  const duree = (m) => { const d = daysBetween(m.dateEntree, m.dateRetour || todayISO()); return d === null ? 0 : Math.max(0, d); };
  const sortis = ms.filter((m) => m.dateRetour);
  const ivs = ms.flatMap((m) => m.interventions || []);
  return {
    tuiles: [
      { titre: 'Passages au garage', valeur: fmt(ms.length), detail: annee ? `entrés en ${annee}` : 'toutes années' },
      { titre: 'Actuellement au garage', valeur: fmt(DB.maintenance.filter((m) => !m.dateRetour).length), detail: 'tous passages confondus' },
      { titre: 'Durée moyenne', valeur: `${sortis.length ? (sum(sortis, duree) / sortis.length).toFixed(1).replace('.', ',') : 0} j`, detail: 'd’immobilisation (sortis)' },
      { titre: 'Jours d’immobilisation', valeur: fmt(sum(ms, duree)), detail: 'cumulés' },
      { titre: 'Coût total', valeur: F(sum(ms, cout)), detail: `${fmt(ivs.length)} intervention(s)` },
      { titre: 'Coût moyen', valeur: F(ms.length ? Math.round(sum(ms, cout) / ms.length) : 0), detail: 'par passage' }
    ],
    blocs: [
      blocMensuel('Passages et coût par mois', parMois(ms, (m) => m.dateEntree, annee, { Passages: () => 1, 'Coût (F)': cout }), { 'Coût (F)': F }),
      blocClassement('Entretien par véhicule', ['Véhicule', 'Passages', 'Jours immobilisé', 'Coût'],
        repartition(ms, (m) => m.immat).lignes.map((l) => {
          const lot = ms.filter((m) => String(m.immat || '').trim() === l.libelle);
          return [l.libelle, fmt(l.nombre), fmt(sum(lot, duree)), F(sum(lot, cout))];
        }), 15),
      blocRepartition('Interventions par garage', repartition(ivs, (i) => i.garage, { limite: 8 }), { type: 'bar', entete: 'Interventions' }),
      blocRepartition('Coût par garage', repartition(ivs, (i) => i.garage, { valeur: (i) => i.cout, limite: 8 }), { entete: 'Coût', format: F }),
      blocRepartition('Durée d’immobilisation', repartition(ms, (m) => {
        const d = duree(m);
        return d <= 1 ? '1 jour ou moins' : d <= 3 ? '2 à 3 jours' : d <= 7 ? '4 à 7 jours' : d <= 30 ? '8 à 30 jours' : 'plus de 30 jours';
      }), { type: 'bar', entete: 'Passages' })
    ]
  };
}

/* ============================= DÉCHARGE ============================ */

export function statsDecharges(annee) {
  const ds = deLAnnee(DB.decharges || [], (d) => d.date, annee);
  const signees = ds.filter((d) => (d.images || []).length);
  return {
    tuiles: [
      { titre: 'Décharges', valeur: fmt(ds.length), detail: annee ? `en ${annee}` : 'toutes années' },
      { titre: 'Destinataires', valeur: fmt(new Set(ds.map((d) => norm(d.destinataire || '')).filter(Boolean)).size), detail: `${fmt((DB.destinataires || []).length)} dans la liste` },
      { titre: 'Décharges signées jointes', valeur: fmt(signees.length), detail: pct(signees.length, ds.length) },
      { titre: 'Photo à joindre', valeur: fmt(ds.length - signees.length), detail: 'décharge signée manquante' }
    ],
    blocs: [
      blocMensuel('Décharges par mois', parMois(ds, (d) => d.date, annee, { Décharges: () => 1 })),
      blocRepartition('Décharges par destinataire', repartition(ds, (d) => d.destinataire, { limite: 10 }), { type: 'bar' }),
      blocRepartition('Décharge signée', repartition(ds, (d) => ((d.images || []).length ? 'jointe' : 'à joindre'))),
      blocRepartition('Décharges par conducteur', repartition(ds, (d) => d.conducteur, { limite: 10 }), { type: 'bar' }),
      blocRepartition('Décharges récupérées par', repartition(ds, (d) => d.recuperePar, { limite: 10 }), { type: 'bar' })
    ]
  };
}

/* ============================ SIMULATION =========================== */

export function statsSimulations(annee) {
  const ss = deLAnnee(DB.simulations || [], (s) => s.dateDepart, annee);
  const total = sum(ss, (s) => s.estimation);
  return {
    tuiles: [
      { titre: 'Simulations', valeur: fmt(ss.length), detail: annee ? `départs en ${annee}` : 'toutes années' },
      { titre: 'Estimations cumulées', valeur: F(total), detail: '' },
      { titre: 'Estimation moyenne', valeur: F(ss.length ? Math.round(total / ss.length) : 0), detail: 'par simulation' },
      { titre: 'Distance moyenne', valeur: `${fmt(ss.length ? Math.round(sum(ss, (s) => s.distanceTotale) / ss.length) : 0)} km`, detail: 'parcours et interne' },
      { titre: 'Missions créées', valeur: fmt(ss.filter((s) => s.missionId && DB.missions.some((m) => m.id === s.missionId)).length), detail: 'depuis une simulation' }
    ],
    blocs: [
      blocRepartition('Composition des frais estimés', {
        total,
        lignes: [['Frais OM', sum(ss, (s) => s.fraisOm)], ['Frais de péage', sum(ss, (s) => s.fraisPeage)], ['Carburant', sum(ss, (s) => s.montantCarburant)]]
          .map(([libelle, nombre]) => ({ libelle, nombre, part: pct(nombre, total) }))
      }, { entete: 'Montant', format: F }),
      blocMensuel('Simulations et estimations par mois', parMois(ss, (s) => s.dateDepart, annee, { Simulations: () => 1, 'Estimation (F)': (s) => s.estimation }), { 'Estimation (F)': F }),
      blocRepartition('Destinations simulées', repartition(ss.flatMap((s) => s.destinations || []), (d) => d, { limite: 10 }), { type: 'bar', entete: 'Fois' }),
      blocClassement('Simulations par véhicule', ['Véhicule', 'Simulations', 'Estimations'],
        repartition(ss, (s) => s.vehicule).lignes.map((l) => [l.libelle, fmt(l.nombre),
          F(sum(ss.filter((s) => String(s.vehicule || '').trim() === l.libelle || (!s.vehicule && l.libelle === 'non renseigné')), (s) => s.estimation))]))
    ]
  };
}

/** Les statistiques d'une rubrique, par sa cle dans le menu. */
export const STATISTIQUES = {
  // Le parc se compte tel qu'il est aujourd'hui ; l'annee ne porte que sur
  // les sorties du pool.
  VEHICULES: { titre: 'Véhicules', calcul: statsVehicules, datee: true,
    intro: (annee) => `L’état du parc aujourd’hui, et les sorties du pool (décharges) ${annee ? `de l’année ${annee}` : 'de toutes les années'}. L’année choisie ci-dessous ne porte que sur les sorties ; les exports reprennent ce qui est affiché.` },
  UTILISATEURS: { titre: 'Utilisateurs', calcul: statsUtilisateurs, datee: true },
  DOTATION: { titre: 'Dotation en carburant', calcul: statsDotation, datee: true },
  MISSION: { titre: 'Missions', calcul: statsMissions, datee: true },
  ENTRETIEN: { titre: 'Entretien', calcul: statsEntretien, datee: true },
  DECHARGE: { titre: 'Décharges', calcul: statsDecharges, datee: true },
  SIMULATION: { titre: 'Simulations', calcul: statsSimulations, datee: true }
};
