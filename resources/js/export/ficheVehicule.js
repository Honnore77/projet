/* ===================================================================
   FICHE VEHICULE — presentee comme une carte d'identite : la photo du
   vehicule a gauche, ses informations a droite, puis son activite et ses
   historiques.

   Les informations sont decrites une fois (infosVehicule) : l'ecran et le
   PDF les affichent dans le meme ordre, avec les memes libelles.

   Comme a l'ecran, la fiche ne chiffre ni le carburant ni l'entretien :
   les montants se lisent dans le rapport « Couts par vehicule ».
   =================================================================== */

import { jsPDF } from 'jspdf';
import autoTableModule from 'jspdf-autotable';
import { DB, kmCourant, etatVidange } from '../core/db.js';
import { dateFR, fmt, sum, todayISO, mentionLieuDate } from '../core/utils.js';
import { previewAndSave } from './preview.js';
import { toWinAnsi as clean } from './winansi.js';

const VERT = [0, 138, 59];
const ENCRE = [23, 49, 59];
const GRIS = [91, 113, 120];
const FOND = [244, 247, 248];

const LIBELLE_VIDANGE = { inconnu: 'non suivie', ok: 'à jour', proche: 'à prévoir', depassee: 'dépassée' };

/** Le vehicule, ligne par ligne, a droite de la photo. */
export function infosVehicule(v, cat) {
  const vid = etatVidange(v);
  const conso = v.consommation !== '' && v.consommation !== undefined
    ? `${String(v.consommation).replace('.', ',')} L/100 km` : '—';
  return [
    { libelle: 'N° de châssis', valeur: v.numeroChassis || '—' },
    { libelle: 'Ancienne immatriculation', valeur: v.immatAncienne || '—' },
    { libelle: 'Catégorie', valeur: String(cat || '').toUpperCase() || '—' },
    { libelle: 'Statut', valeur: v.statut || '—' },
    { libelle: 'Énergie', valeur: v.energie || '—' },
    { libelle: 'Consommation', valeur: conso },
    { libelle: 'Couleur', valeur: v.couleur || '—' },
    ...(v.section ? [{ libelle: 'Section', valeur: v.section }] : []),
    ...(v.utilisateur ? [{ libelle: 'Utilisateur', valeur: v.utilisateur }] : []),
    ...(v.groupe ? [{ libelle: 'Groupe', valeur: v.groupe }] : []),
    { libelle: 'Kilométrage', valeur: `${fmt(kmCourant(v))} km` },
    {
      libelle: 'Prochaine vidange',
      valeur: vid.statut === 'inconnu'
        ? 'non suivie'
        : `${fmt(vid.cible)} km — ${LIBELLE_VIDANGE[vid.statut]}`
    }
  ];
}

/** Activite du vehicule : litres, passages au garage, missions. */
export function activiteVehicule({ dots, missionsCarburant, missions, maint }) {
  const litresMission = sum(missionsCarburant, (m) => sum(m.ravitaillements || [], (r) => r.quantite));
  return [
    { titre: 'Carburant', valeur: `${fmt(sum(dots, (d) => d.quantite) + litresMission)} L`, detail: `${dots.length + missionsCarburant.length} prise(s)` },
    { titre: 'Entretien', valeur: fmt(maint.length), detail: 'passage(s) au garage' },
    { titre: 'Missions', valeur: fmt(missions.length), detail: `${fmt(sum(missions, (m) => m.jours))} jour(s) cumulés` }
  ];
}

function tableau(doc, options) {
  const fn = typeof autoTableModule === 'function' ? autoTableModule
    : autoTableModule && typeof autoTableModule.default === 'function' ? autoTableModule.default : null;
  if (fn) return fn(doc, options);
  return doc.autoTable(options);
}

/**
 * La fiche en PDF, A4 portrait.
 * @param {object} f
 * @param {object} f.vehicle   fiche VÉHICULES (ou null si l'immatriculation n'y figure pas)
 * @param {string} f.cat
 * @param {string} f.immat
 * @param {Uint8Array|null} f.photo  octets JPEG de la photo
 */
export function buildFicheVehiculePdf(f) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const org = (DB.settings && DB.settings.organisation) || 'PDU';
  const v = f.vehicle || {};
  const titre = `${v.marque || ''} ${v.modele || ''}`.trim() || f.immat || 'Véhicule';

  // En-tete
  doc.setFillColor(...VERT);
  doc.rect(0, 0, W, 18, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(clean(`${org} - Fiche véhicule`), M, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(clean(`${titre} - ${f.immat || ''}`), M, 14);

  // Carte d'identite : photo a gauche, informations a droite.
  const infos = f.vehicle ? infosVehicule(v, f.cat) : [];
  const yCarte = 24;
  const largeurPhoto = 62;
  const hauteurPhoto = 47;
  const xInfos = M + 4 + largeurPhoto + 6;
  const hauteurCarte = Math.max(hauteurPhoto + 8, 26 + infos.length * 5.2);
  doc.setFillColor(...FOND);
  doc.roundedRect(M, yCarte, W - 2 * M, hauteurCarte, 2.5, 2.5, 'F');

  const xPhoto = M + 4;
  const yPhoto = yCarte + 4;
  if (f.photo) {
    try {
      // La photo garde ses proportions, centree dans son cadre.
      const p = doc.getImageProperties(f.photo);
      const k = Math.min(largeurPhoto / p.width, hauteurPhoto / p.height);
      const w = p.width * k;
      const h = p.height * k;
      doc.addImage(f.photo, 'JPEG', xPhoto + (largeurPhoto - w) / 2, yPhoto + (hauteurPhoto - h) / 2, w, h);
    } catch (e) {
      f.photo = null;
    }
  }
  if (!f.photo) {
    doc.setDrawColor(183, 196, 200);
    doc.setLineWidth(0.3);
    doc.roundedRect(xPhoto, yPhoto, largeurPhoto, hauteurPhoto, 2, 2, 'S');
    doc.setTextColor(...GRIS);
    doc.setFontSize(8);
    doc.text('Aucune photo', xPhoto + largeurPhoto / 2, yPhoto + hauteurPhoto / 2, { align: 'center' });
  }

  doc.setTextColor(...VERT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(clean(titre), xInfos, yCarte + 9);
  doc.setTextColor(...ENCRE);
  doc.setFontSize(17);
  doc.text(clean(f.immat || '—'), xInfos, yCarte + 17);

  let y = yCarte + 24;
  const xValeur = xInfos + 46;
  infos.forEach((l) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(clean(l.libelle), xInfos, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ENCRE);
    doc.text(doc.splitTextToSize(clean(l.valeur), W - M - 4 - xValeur)[0], xValeur, y);
    y += 5.2;
  });
  if (!f.vehicle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(clean('Aucune fiche dans VÉHICULES pour cette immatriculation.'), xInfos, y);
  }

  // Activite : trois cases, comme les compteurs de l'ecran.
  let yy = yCarte + hauteurCarte + 5;
  const activite = activiteVehicule(f);
  const largeurCase = (W - 2 * M - 8) / 3;
  activite.forEach((a, i) => {
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

  // Observations
  if (v.observations) {
    doc.setTextColor(...GRIS);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('OBSERVATIONS', M, yy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...ENCRE);
    doc.setFontSize(8.5);
    const lignes = doc.splitTextToSize(clean(v.observations), W - 2 * M);
    doc.text(lignes, M, yy + 4.5);
    yy += 6 + lignes.length * 3.8;
  }

  // Historiques, sans montants (voir l'en-tete du module).
  const section = (titreSection, entetes, lignes) => {
    if (!lignes.length) return;
    if (yy > H - 40) { doc.addPage(); yy = 16; }
    doc.setTextColor(...VERT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(clean(`${titreSection} (${lignes.length})`), M, yy);
    tableau(doc, {
      startY: yy + 2,
      head: [entetes.map(clean)],
      body: lignes.map((l) => l.map((c) => clean(c === undefined || c === null ? '' : String(c)))),
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: ENCRE, overflow: 'linebreak' },
      headStyles: { fillColor: VERT, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 250, 250] },
      margin: { left: M, right: M, bottom: 14 }
    });
    yy = doc.lastAutoTable.finalY + 7;
  };
  const parDate = (cle) => (a, b) => String(b[cle] || '').localeCompare(String(a[cle] || ''));

  section('Dotations pool', ['Date', 'Kilométrage', 'Quantité (L)', 'Station-service', 'État vidange'],
    f.dots.slice().sort(parDate('date')).map((d) => [dateFR(d.date), fmt(d.km), fmt(d.quantite), d.station || '', d.vidange || '']));
  section('Carburant des missions', ['Mission', 'Conducteur', 'Départ', 'Litres', 'Points de ravitaillement'],
    f.missionsCarburant.map((m) => [m.ref || '', m.conducteur || '', dateFR(m.dateDepart),
      fmt(sum(m.ravitaillements || [], (r) => r.quantite)),
      (m.ravitaillements || []).map((r) => r.station).filter(Boolean).join(', ')]));
  section('Missions', ['Réf.', 'Conducteur', 'Destination', 'Départ', 'Retour', 'Jours', 'Paiement'],
    f.missions.slice().sort(parDate('dateDepart')).map((m) => [m.ref || '', m.conducteur || '', m.destination || '',
      dateFR(m.dateDepart), dateFR(m.dateRetour), m.jours || '', m.paye ? 'payée' : 'en attente']));
  section('Historique entretien', ['Entrée', 'Motif', 'Garage(s)', 'Sortie', 'État'],
    f.maint.slice().sort(parDate('dateEntree')).map((m) => [dateFR(m.dateEntree), m.motif || '',
      [...new Set((m.interventions || []).map((i) => i.garage).filter(Boolean))].join(', '),
      dateFR(m.dateRetour), m.dateRetour ? 'sorti' : 'au garage']));

  // Pied de page
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

export function exportFicheVehiculePdf(f, baseName) {
  return previewAndSave({
    kind: 'pdf',
    bytes: buildFicheVehiculePdf(f),
    filename: `${baseName}_${todayISO()}.pdf`,
    mime: 'application/pdf',
    title: 'Aperçu avant export PDF'
  });
}
