/* ===================================================================
   FICHE UTILISATEUR — presentee comme une carte d'identite, a l'image de
   la fiche vehicule : la photo de l'agent a gauche, ses informations a
   droite, puis son activite et ses historiques.

   Les informations sont decrites une fois (infosAgent, dossierAgent) :
   l'ecran, le PDF et le classeur les reprennent dans le meme ordre.
   =================================================================== */

import { jsPDF } from 'jspdf';
import autoTableModule from 'jspdf-autotable';
import {
  DB, nomComplet, vehiculesDeLAgent, dureeIndisponibilite, etatIndisponibilite, lignesTelephone
} from '../core/db.js';
import { dateFR, fmt, sum, norm, todayISO, mentionLieuDate } from '../core/utils.js';
import { previewAndSave } from './preview.js';
import { toWinAnsi as clean } from './winansi.js';

const VERT = [0, 138, 59];
const BLEU = [25, 118, 210];         // couleur de la rubrique UTILISATEURS
const ENCRE = [23, 49, 59];
const GRIS = [91, 113, 120];
const FOND = [244, 247, 248];

/**
 * Tout ce que l'application sait d'un agent, rassemble depuis les autres
 * rubriques : vehicules attribues, missions, incidents, conges et absences,
 * interims assures.
 */
export function dossierAgent(u, jour = todayISO()) {
  const nom = nomComplet(u);
  const cle = norm(nom);
  const absences = (DB.indisponibilites || []).filter((i) => norm(i.conducteur || '') === cle);
  return {
    nom,
    vehicules: vehiculesDeLAgent(nom),
    missions: DB.missions.filter((m) => norm(m.conducteur || '') === cle),
    incidents: u.historique || [],
    absences,
    interims: (DB.indisponibilites || []).filter((i) => norm(i.interimaire || '') === cle),
    absenceEnCours: absences.find((i) => etatIndisponibilite(i, jour) === 'en cours') || null
  };
}

/** Les numeros renseignes, une ligne chacun (« FLOTTE PDU : 07 … »). */
function telephones(u) {
  return lignesTelephone(u.telephone)
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter((l) => l && !/:\s*$/.test(l));
}

/** Le numero de poste se lit en rouge sur la fiche, a l'ecran comme en PDF. */
export const estLigneNumeroPoste = (ligne) => /^\s*-?\s*N°\s*de\s*poste/i.test(String(ligne || ''));

/** L'agent, ligne par ligne, a droite de la photo. */
export function infosAgent(u, d) {
  const tel = telephones(u);
  return [
    { libelle: 'Fonction au PDU', valeur: u.fonction || '—' },
    { libelle: 'Section', valeur: u.section || '—' },
    { libelle: 'Statut', valeur: u.statut || '—' },
    { libelle: 'Conducteur du pool', valeur: u.poolConducteur === 'Oui' ? 'Oui' : 'Non' },
    { libelle: 'Téléphone', valeur: tel.length ? tel.join('\n') : '—' },
    { libelle: 'Adresse email', valeur: u.email || '—' },
    { libelle: 'N° de permis', valeur: u.permis || '—' },
    {
      libelle: 'Véhicule(s) attribué(s)',
      valeur: d.vehicules.length
        ? d.vehicules.map((v) => `${v.immatNouvelle || v.immatAncienne || '?'} (${v._cat})`).join(', ')
        : '—'
    },
    {
      libelle: 'Disponibilité',
      valeur: d.absenceEnCours
        ? `${d.absenceEnCours.motif || 'Absent'} — reprise le ${dateFR(d.absenceEnCours.dateReprise) || '…'}`
        : 'Disponible'
    }
  ];
}

/** Les trois compteurs : missions, incidents, conges et absences. */
export function activiteAgent(d) {
  const joursAbsence = sum(d.absences, (i) => dureeIndisponibilite(i.dateDepart, i.dateReprise) || 0);
  return [
    { titre: 'Missions', valeur: fmt(d.missions.length), detail: `${fmt(sum(d.missions, (m) => m.jours))} jour(s) cumulés` },
    { titre: 'Incidents', valeur: fmt(d.incidents.length), detail: 'dans l’historique' },
    { titre: 'Congés et absences', valeur: fmt(d.absences.length), detail: `${fmt(joursAbsence)} jour(s) d’absence` }
  ];
}

/** Les historiques, en tableaux : titre, en-tetes, lignes. */
export function historiquesAgent(d) {
  const parDate = (cle) => (a, b) => String(b[cle] || '').localeCompare(String(a[cle] || ''));
  return [
    {
      titre: 'Véhicules attribués',
      entetes: ['Immatriculation', 'Marque / modèle', 'Catégorie', 'Statut'],
      lignes: d.vehicules.map((v) => [v.immatNouvelle || v.immatAncienne || '', `${v.marque || ''} ${v.modele || ''}`.trim(), String(v._cat || '').toUpperCase(), v.statut || ''])
    },
    {
      titre: 'Missions',
      entetes: ['Réf.', 'Destination', 'Véhicule', 'Départ', 'Retour', 'Jours', 'Paiement'],
      lignes: d.missions.slice().sort(parDate('dateDepart')).map((m) => [m.ref || '', m.destination || '', m.vehicule || '',
        dateFR(m.dateDepart), dateFR(m.dateRetour), m.jours || '', m.paye ? 'payée' : 'en attente'])
    },
    {
      titre: 'Incidents',
      entetes: ['Date', 'Nature', 'Véhicule', 'Responsabilité', 'Suite donnée'],
      lignes: d.incidents.slice().sort(parDate('date')).map((h) => [dateFR(h.date), h.nature || '', h.vehicule || '', h.responsabilite || '', h.suite || ''])
    },
    {
      titre: 'Congés et absences',
      entetes: ['Motif', 'Départ', 'Reprise', 'Durée', 'Intérimaire', 'État'],
      lignes: d.absences.slice().sort(parDate('dateDepart')).map((i) => {
        const n = dureeIndisponibilite(i.dateDepart, i.dateReprise);
        return [i.motif || '', dateFR(i.dateDepart), dateFR(i.dateReprise), n === null ? '' : `${n} j`, i.interimaire || '', etatIndisponibilite(i)];
      })
    },
    {
      titre: 'Intérims assurés',
      entetes: ['Conducteur remplacé', 'Motif', 'Départ', 'Reprise'],
      lignes: d.interims.slice().sort(parDate('dateDepart')).map((i) => [i.conducteur || '', i.motif || '', dateFR(i.dateDepart), dateFR(i.dateReprise)])
    }
  ].filter((h) => h.lignes.length);
}

function tableau(doc, options) {
  const fn = typeof autoTableModule === 'function' ? autoTableModule
    : autoTableModule && typeof autoTableModule.default === 'function' ? autoTableModule.default : null;
  if (fn) return fn(doc, options);
  return doc.autoTable(options);
}

/**
 * La fiche en PDF, A4 portrait : carte d'identite (photo comprise),
 * compteurs, historiques.
 * @param {object} u       l'agent
 * @param {Uint8Array|null} photo  octets JPEG de sa photo
 */
/** @param {boolean} [simple]  la carte seule, sans les historiques */
export function buildFicheAgentPdf(u, photo, simple = false) {
  const d = dossierAgent(u);
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const org = (DB.settings && DB.settings.organisation) || 'PDU';

  doc.setFillColor(...VERT);
  doc.rect(0, 0, W, 18, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(clean(`${org} - Fiche utilisateur`), M, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(clean(`${d.nom}${u.fonction ? ` - ${u.fonction}` : ''}`), M, 14);

  // Carte d'identite : photo a gauche (format portrait), informations a
  // droite. La fonction est deja le titre de la carte.
  const infos = infosAgent(u, d).filter((l) => l.libelle !== 'Fonction au PDU');
  const largeurPhoto = 42;
  const hauteurPhoto = 52;
  const xPhoto = M + 4;
  const xInfos = xPhoto + largeurPhoto + 7;
  const xValeur = xInfos + 42;
  const largeurValeur = W - M - 4 - xValeur;
  doc.setFontSize(8.5);
  const valeurs = infos.map((l) => doc.splitTextToSize(clean(l.valeur), largeurValeur));
  const hauteurInfos = 24 + valeurs.reduce((t, v) => t + Math.max(1, v.length) * 4.2 + 1, 0);
  const yCarte = 24;
  const hauteurCarte = Math.max(hauteurPhoto + 8, hauteurInfos);
  doc.setFillColor(...FOND);
  doc.roundedRect(M, yCarte, W - 2 * M, hauteurCarte, 2.5, 2.5, 'F');

  const yPhoto = yCarte + 4;
  let photoPosee = false;
  if (photo) {
    try {
      const p = doc.getImageProperties(photo);
      const k = Math.min(largeurPhoto / p.width, hauteurPhoto / p.height);
      doc.addImage(photo, 'JPEG', xPhoto + (largeurPhoto - p.width * k) / 2, yPhoto + (hauteurPhoto - p.height * k) / 2, p.width * k, p.height * k);
      photoPosee = true;
    } catch (e) { /* photo illisible : cadre vide */ }
  }
  if (!photoPosee) {
    doc.setDrawColor(183, 196, 200);
    doc.setLineWidth(0.3);
    doc.roundedRect(xPhoto, yPhoto, largeurPhoto, hauteurPhoto, 2, 2, 'S');
    doc.setTextColor(...GRIS);
    doc.setFontSize(8);
    doc.text('Aucune photo', xPhoto + largeurPhoto / 2, yPhoto + hauteurPhoto / 2, { align: 'center' });
  }

  doc.setTextColor(...BLEU);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(clean(u.fonction || 'Agent du PDU'), xInfos, yCarte + 9);
  doc.setTextColor(...ENCRE);
  doc.setFontSize(16);
  doc.text(doc.splitTextToSize(clean(d.nom), W - M - 4 - xInfos)[0], xInfos, yCarte + 17);

  let y = yCarte + 24;
  infos.forEach((l, i) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(clean(l.libelle), xInfos, y);
    doc.setFont('helvetica', 'bold');
    // Ligne par ligne : le N° de Poste en rouge, le reste a l'encre.
    valeurs[i].forEach((ligne, k) => {
      doc.setTextColor(...(estLigneNumeroPoste(ligne) ? [198, 40, 40] : ENCRE));
      doc.text(ligne, xValeur, y + k * 4.2);
    });
    y += Math.max(1, valeurs[i].length) * 4.2 + 1;
  });

  let yy = yCarte + hauteurCarte + 5;
  const largeurCase = (W - 2 * M - 8) / 3;
  activiteAgent(d).forEach((a, i) => {
    const x = M + i * (largeurCase + 4);
    doc.setFillColor(...FOND);
    doc.roundedRect(x, yy, largeurCase, 17, 2, 2, 'F');
    doc.setTextColor(...GRIS);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(clean(a.titre.toUpperCase()), x + 4, yy + 5);
    doc.setTextColor(...ENCRE);
    doc.setFontSize(13);
    doc.text(clean(a.valeur), x + 4, yy + 11.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text(clean(a.detail), x + 4, yy + 15.3);
  });
  yy += 23;

  if (u.observations) {
    doc.setTextColor(...GRIS);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('OBSERVATIONS', M, yy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...ENCRE);
    doc.setFontSize(8.5);
    const lignes = doc.splitTextToSize(clean(u.observations), W - 2 * M);
    doc.text(lignes, M, yy + 4.5);
    yy += 6 + lignes.length * 3.8;
  }

  (simple ? [] : historiquesAgent(d)).forEach((h) => {
    if (yy > H - 40) { doc.addPage(); yy = 16; }
    doc.setTextColor(...VERT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(clean(`${h.titre} (${h.lignes.length})`), M, yy);
    tableau(doc, {
      startY: yy + 2,
      head: [h.entetes.map(clean)],
      body: h.lignes.map((l) => l.map((c) => clean(c === undefined || c === null ? '' : String(c)))),
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: ENCRE, overflow: 'linebreak' },
      headStyles: { fillColor: VERT, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 250, 250] },
      margin: { left: M, right: M, bottom: 14 }
    });
    yy = doc.lastAutoTable.finalY + 7;
  });

  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.setFont('helvetica', 'normal');
    doc.text(clean(`${org} - Application de gestion du parc automobile`), M, H - 7);
    doc.text(`Page ${i} / ${n}`, W / 2, H - 7, { align: 'center' });
    doc.text(clean(mentionLieuDate(DB.settings && DB.settings.ville)), W - M, H - 7, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

export function exportFicheAgentPdf(u, photo, baseName, simple = false) {
  return previewAndSave({
    kind: 'pdf',
    bytes: buildFicheAgentPdf(u, photo, simple),
    filename: `${baseName}_${todayISO()}.pdf`,
    mime: 'application/pdf',
    title: 'Aperçu avant export PDF'
  });
}

/** Le classeur : la carte en rubrique / valeur, puis un onglet par historique. */
export function datasetsFicheAgent(u) {
  const d = dossierAgent(u);
  return [
    {
      title: 'Fiche',
      columns: [{ key: 'libelle', label: 'Rubrique', width: 26 }, { key: 'valeur', label: 'Valeur', width: 48 }],
      rows: [
        { libelle: 'Nom et prénoms', valeur: d.nom },
        ...infosAgent(u, d),
        ...activiteAgent(d).map((a) => ({ libelle: a.titre, valeur: `${a.valeur} — ${a.detail}` })),
        ...(u.observations ? [{ libelle: 'Observations', valeur: u.observations }] : [])
      ]
    },
    ...historiquesAgent(d).map((h) => ({
      title: h.titre,
      columns: h.entetes.map((e, i) => ({ key: `c${i}`, label: e, width: Math.max(12, e.length + 4) })),
      rows: h.lignes.map((l) => Object.fromEntries(l.map((c, i) => [`c${i}`, c])))
    }))
  ];
}
