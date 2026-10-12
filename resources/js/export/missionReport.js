/* ===================================================================
   RAPPORT DE MISSION — reproduction du formulaire papier du PDU.

   Une seule description de la mise en page (LAYOUT) alimente les deux
   sorties, PDF et impression : le formulaire ne peut pas diverger d'un
   support a l'autre.
   =================================================================== */

import { jsPDF } from 'jspdf';
import { previewAndSave } from './preview.js';
import { DB, ravMontant, destinationsDe, texteDestinations, parcoursMission, libelleParcours } from '../core/db.js';
import { dateFR, fmt, num, sum, esc, mentionLieuDate } from '../core/utils.js';
import { toWinAnsi as nettoyer } from './winansi.js';

const GREEN = [0, 138, 59];
const BLEU_ENTETE = [197, 214, 240];  // bandeaux de titre du formulaire
const CREME = [253, 238, 210];        // colonne « MONTANT » et ligne « TOTAL »
const NOIR = [0, 0, 0];

/** Nombre de lignes vides laissees dans le tableau de ravitaillement. */
const LIGNES_MINIMUM = 8;

/**
 * Extrait du dossier de mission tout ce que le formulaire affiche.
 * @param {object} m mission
 */
/**
 * Ligne DESTINATION du document : « Bouaké (350 km d'Abidjan) », ou pour un
 * parcours « Yamoussoukro, Bouaké, Korhogo (parcours : 635 km) ».
 */
function destinationAvecDistance(d) {
  if (!d.destination) return '';
  if (!d.distanceParcours) return d.destination;
  return d.etapes.length > 1
    ? `${d.destination} (parcours : ${d.distanceParcours})`
    : `${d.destination} (${d.distanceParcours} d'Abidjan)`;
}

export function reportData(m) {
  const rav = (m.ravitaillements || []).map((r) => ({
    date: dateFR(r.date),
    station: r.station || '',
    prixL: num(r.prixL),
    quantite: num(r.quantite),
    // Le meme calcul que partout ailleurs, arrondi au franc superieur : le
    // rapport imprime ne doit pas annoncer un franc de moins que la rubrique
    // DOTATION pour le meme ravitaillement.
    montant: ravMontant(r)
  }));

  const periode = m.dateDepart || m.dateRetour
    ? `du ${dateFR(m.dateDepart) || '…'} au ${dateFR(m.dateRetour) || '…'}` +
      (m.jours !== '' && m.jours !== undefined ? ` (${m.jours} jour(s))` : '')
    : '';

  return {
    organisation: (DB.settings && DB.settings.organisation) || 'PDU',
    periode,
    destination: texteDestinations(destinationsDe(m)),
    // Le parcours etape par etape, calcule comme dans le tableau de suivi :
    // le rapport imprime annonce les memes chiffres.
    etapes: parcoursMission(m).etapes,
    distanceParcours: libelleParcours(parcoursMission(m)),
    chauffeur: m.conducteur || '',
    vehicule: m.vehicule || '',
    reference: m.ref || '',
    participants: (m.participants || []).filter(Boolean),
    dotation: m.dotationCarburant ? `${fmt(m.dotationCarburant)} F` : '',
    ravitaillements: rav,
    totalQuantite: sum(rav, (r) => r.quantite),
    totalMontant: sum(rav, (r) => r.montant),
    kmDepart: m.kmDepart === '' || m.kmDepart === undefined ? '' : fmt(m.kmDepart),
    kmArrivee: m.kmArrivee === '' || m.kmArrivee === undefined ? '' : fmt(m.kmArrivee),
    distance: m.kmDepart !== '' && m.kmArrivee !== '' && m.kmArrivee !== undefined
      ? num(m.kmArrivee) - num(m.kmDepart)
      : null,
    observations: m.observations || ''
  };
}

/* ============================== PDF ================================ */

/**
 * Construit le rapport en PDF, A4 portrait, a l'image du formulaire papier.
 * @returns {{bytes:Uint8Array, filename:string}}
 */
export function buildMissionReport(mission) {
  const d = reportData(mission);
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  // Tout texte ecrit dans ce document passe par l'assainisseur WinAnsi.
  // Le faire ici, et non a chaque appel, garantit qu'aucune valeur ne
  // puisse y echapper — un oubli produirait un document illisible sans
  // la moindre erreur.
  const ecrireBrut = doc.text.bind(doc);
  doc.text = (txt, x, y, opts) =>
    ecrireBrut(Array.isArray(txt) ? txt.map(nettoyer) : nettoyer(txt), x, y, opts);

  const pageW = doc.internal.pageSize.getWidth();
  const M = 14;                 // marge laterale
  const W = pageW - M * 2;      // largeur utile
  let y = 18;

  doc.setLineWidth(0.4);
  doc.setDrawColor(...NOIR);

  /* ---- titre encadre ---- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const titre = 'RAPPORT DE MISSION';
  const largeurTitre = doc.getTextWidth(titre) + 16;
  doc.roundedRect((pageW - largeurTitre) / 2, y - 6.5, largeurTitre, 11, 1.5, 1.5);
  doc.text(titre, pageW / 2, y, { align: 'center' });
  y += 14;

  /* ---- en-tete : libelle puis pointilles ---- */
  doc.setFontSize(9.5);
  const ligne = (label, valeur) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, M, y);
    const x = M + doc.getTextWidth(label) + 2;
    doc.setFont('helvetica', 'normal');
    doc.text(pointilles(doc, valeur, M + W - x), x, y);
    y += 7;
  };
  ligne('PERIODE :', d.periode);
  ligne('DESTINATION :', destinationAvecDistance(d));
  ligne('NOM DU CHAUFFEUR :', d.chauffeur);
  ligne('VEHICULE UTILISE :', d.vehicule);
  y += 3;

  /* ---- participants ---- */
  const hLigne = 7;
  doc.setFillColor(...BLEU_ENTETE);
  doc.rect(M, y, W, hLigne, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.text('PARTICIPANTS', pageW / 2, y + 4.8, { align: 'center' });
  y += hLigne;

  const nbParticipants = Math.max(3, d.participants.length);
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i < nbParticipants; i++) {
    doc.rect(M, y, W, hLigne);
    doc.setFont('helvetica', 'bold');
    doc.text(`${i + 1}.`, M + 2, y + 4.8);
    doc.setFont('helvetica', 'normal');
    doc.text(d.participants[i] || '', M + 10, y + 4.8);
    y += hLigne;
  }
  y += 8;

  /* ---- dotation en carburant ---- */
  doc.setFont('helvetica', 'bold');
  doc.text('DOTATION EN CARBURANT :', M, y);
  const xDot = M + doc.getTextWidth('DOTATION EN CARBURANT :') + 2;
  doc.line(M, y + 1, M + doc.getTextWidth('DOTATION EN CARBURANT :'), y + 1); // souligne
  doc.setFont('helvetica', 'normal');
  doc.text(pointilles(doc, d.dotation, M + W - xDot), xDot, y);
  y += 8;

  /* ---- tableau des ravitaillements ---- */
  const cols = [
    { titre: 'DATES', l: 24, align: 'center' },
    { titre: 'POINTS DE\nRAVITAILLEMENT', l: W - 24 - 26 - 26 - 30, align: 'left' },
    { titre: 'PRIX DU\nLITRE', l: 26, align: 'center' },
    { titre: 'QUANTITE\n(L)', l: 26, align: 'center' },
    { titre: 'MONTANT', l: 30, align: 'center' }
  ];
  const hEntete = 11;

  let x = M;
  cols.forEach((c) => {
    doc.setFillColor(...BLEU_ENTETE);
    doc.rect(x, y, c.l, hEntete, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    c.titre.split('\n').forEach((t, i) => {
      doc.text(t, x + c.l / 2, y + (c.titre.includes('\n') ? 4.5 : 6.8) + i * 3.6, { align: 'center' });
    });
    x += c.l;
  });
  y += hEntete;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const lignes = Math.max(LIGNES_MINIMUM, d.ravitaillements.length);
  for (let i = 0; i < lignes; i++) {
    const r = d.ravitaillements[i];
    x = M;
    cols.forEach((c, ci) => {
      // la colonne montant est teintee, comme sur le formulaire
      if (ci === 4) {
        doc.setFillColor(...CREME);
        doc.rect(x, y, c.l, hLigne, 'FD');
      } else {
        doc.rect(x, y, c.l, hLigne);
      }
      if (r) {
        const valeurs = [r.date, r.station, fmt(r.prixL), fmt(r.quantite), fmt(r.montant)];
        const v = valeurs[ci];
        if (c.align === 'center') doc.text(String(v), x + c.l / 2, y + 4.8, { align: 'center' });
        else doc.text(String(v), x + 2, y + 4.8, { maxWidth: c.l - 4 });
      }
      x += c.l;
    });
    y += hLigne;
  }

  /* ---- ligne de total ---- */
  x = M;
  doc.rect(x, y, cols[0].l, hLigne);
  x += cols[0].l;
  doc.setFillColor(...CREME);
  doc.rect(x, y, cols[1].l, hLigne, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL :', x + cols[1].l / 2, y + 4.8, { align: 'center' });
  x += cols[1].l;
  doc.rect(x, y, cols[2].l, hLigne);
  x += cols[2].l;
  doc.rect(x, y, cols[3].l, hLigne);
  doc.text(fmt(d.totalQuantite), x + cols[3].l / 2, y + 4.8, { align: 'center' });
  x += cols[3].l;
  doc.setFillColor(...CREME);
  doc.rect(x, y, cols[4].l, hLigne, 'FD');
  doc.text(fmt(d.totalMontant), x + cols[4].l / 2, y + 4.8, { align: 'center' });
  y += hLigne + 8;

  /* ---- kilometrage ---- */
  const demi = W / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.rect(M, y, demi, 9);
  doc.rect(M + demi, y, demi, 9);
  doc.text('KM DEPART :', M + 2, y + 5.8);
  doc.setFont('helvetica', 'normal');
  doc.text(pointilles(doc, d.kmDepart, demi - doc.getTextWidth('KM DEPART :') - 6), M + doc.getTextWidth('KM DEPART :') + 4, y + 5.8);
  doc.setFont('helvetica', 'bold');
  doc.text('KM ARRIVEE :', M + demi + 2, y + 5.8);
  doc.setFont('helvetica', 'normal');
  doc.text(pointilles(doc, d.kmArrivee, demi - doc.getTextWidth('KM ARRIVEE :') - 6), M + demi + doc.getTextWidth('KM ARRIVEE :') + 4, y + 5.8);
  y += 9;

  /* ---- observations ---- */
  doc.setFillColor(...BLEU_ENTETE);
  doc.rect(M, y, W, hLigne, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.text('OBSERVATIONS', pageW / 2, y + 4.8, { align: 'center' });
  y += hLigne;

  const hObs = 30;
  doc.rect(M, y, W, hObs);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (d.observations) {
    doc.text(doc.splitTextToSize(nettoyer(d.observations), W - 4), M + 2, y + 5.5);
  }
  y += hObs + 6;

  /* ---- pied de page ---- */
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  const basPage = doc.internal.pageSize.getHeight() - 8;
  doc.text(
    nettoyer(`${d.organisation} - Gestion du parc automobile${d.reference ? ` - mission ${d.reference}` : ''}`),
    M,
    basPage
  );
  doc.text(
    nettoyer(mentionLieuDate(DB.settings && DB.settings.ville)),
    doc.internal.pageSize.getWidth() - M,
    basPage,
    { align: 'right' }
  );

  const nom = `Rapport_mission_${(d.reference || d.chauffeur || 'sans-reference').replace(/[^A-Za-z0-9_-]+/g, '_')}`;
  return { bytes: new Uint8Array(doc.output('arraybuffer')), filename: `${nom}.pdf` };
}

/**
 * Montre le rapport dans une fenêtre d'aperçu, puis l'écrit si
 * l'utilisateur confirme.
 * @returns {Promise<string|null>} chemin écrit, ou null si annulé
 */
export async function exportMissionReport(mission) {
  const { bytes, filename } = buildMissionReport(mission);
  return previewAndSave({
    kind: 'pdf',
    bytes,
    filename,
    mime: 'application/pdf',
    title: 'Aperçu — rapport de mission'
  });
}

/**
 * Complete une valeur par des points de conduite jusqu'a la largeur voulue,
 * comme les lignes pointillees du formulaire papier.
 */
function pointilles(doc, valeur, largeur) {
  const texte = nettoyer(valeur || '');
  const espace = largeur - doc.getTextWidth(texte) - 2;
  if (espace <= 0) return texte;
  const largeurPoint = doc.getTextWidth('.');
  const n = Math.max(0, Math.floor(espace / largeurPoint));
  return texte + (texte ? ' ' : '') + '.'.repeat(n);
}

/* =========================== Impression ============================= */

/** Ouvre le rapport dans une fenetre prete a imprimer. */
export function printMissionReport(mission) {
  const d = reportData(mission);
  const lignes = Math.max(LIGNES_MINIMUM, d.ravitaillements.length);
  const participants = Math.max(3, d.participants.length);

  const corpsRav = Array.from({ length: lignes }, (_, i) => {
    const r = d.ravitaillements[i];
    return (
      '<tr>' +
      `<td class="c">${r ? esc(r.date) : ''}</td>` +
      `<td>${r ? esc(r.station) : ''}</td>` +
      `<td class="c">${r ? fmt(r.prixL) : ''}</td>` +
      `<td class="c">${r ? fmt(r.quantite) : ''}</td>` +
      `<td class="c montant">${r ? fmt(r.montant) : ''}</td>` +
      '</tr>'
    );
  }).join('');

  const html =
    `<html><head><meta charset="utf-8"><title>Rapport de mission${d.reference ? ` — ${esc(d.reference)}` : ''}</title><style>
      @page{size:A4 portrait;margin:14mm;}
      body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:11px;margin:0;}
      .titre{border:2px solid #000;border-radius:4px;display:inline-block;padding:6px 18px;
        font-size:19px;font-weight:bold;letter-spacing:.5px;}
      .titreWrap{text-align:center;margin-bottom:18px;}
      .champ{font-weight:bold;margin:6px 0;}
      .champ .val{font-weight:normal;}
      .pointille{border-bottom:1.5px dotted #000;display:inline-block;min-width:60%;}
      table{border-collapse:collapse;width:100%;margin-top:4px;}
      th,td{border:1px solid #000;padding:4px 5px;height:18px;}
      th{background:#c5d6f0;text-align:center;font-size:10px;}
      td.c{text-align:center;}
      td.montant,tr.total td.libelle{background:#fdeed2;}
      tr.total td{font-weight:bold;text-align:center;}
      .bandeau{background:#c5d6f0;border:1px solid #000;text-align:center;font-weight:bold;padding:4px;}
      .km{display:flex;margin-top:14px;}
      .km div{flex:1;border:1px solid #000;padding:5px 6px;font-weight:bold;}
      .obs{border:1px solid #000;border-top:none;min-height:70px;padding:6px;white-space:pre-line;font-weight:normal;}
      .souligne{text-decoration:underline;}
    </style></head><body>
      <div class="titreWrap"><span class="titre">RAPPORT DE MISSION</span></div>
      <div class="champ">PERIODE : <span class="val pointille">${esc(d.periode)}</span></div>
      <div class="champ">DESTINATION : <span class="val pointille">${esc(destinationAvecDistance(d))}</span></div>
      <div class="champ">NOM DU CHAUFFEUR : <span class="val pointille">${esc(d.chauffeur)}</span></div>
      <div class="champ">VEHICULE UTILISE : <span class="val pointille">${esc(d.vehicule)}</span></div>

      <div class="bandeau" style="margin-top:16px">PARTICIPANTS</div>
      <table>${Array.from({ length: participants }, (_, i) =>
        `<tr><td style="width:22px;font-weight:bold">${i + 1}.</td><td>${esc(d.participants[i] || '')}</td></tr>`
      ).join('')}</table>

      <div class="champ" style="margin-top:16px"><span class="souligne">DOTATION EN CARBURANT :</span>
        <span class="val pointille">${esc(d.dotation)}</span></div>

      <table>
        <thead><tr>
          <th style="width:60px">DATES</th><th>POINTS DE RAVITAILLEMENT</th>
          <th style="width:70px">PRIX DU LITRE</th><th style="width:70px">QUANTITE (L)</th>
          <th style="width:80px">MONTANT</th>
        </tr></thead>
        <tbody>${corpsRav}
          <tr class="total"><td></td><td class="libelle">TOTAL :</td><td></td>
            <td>${fmt(d.totalQuantite)}</td><td class="montant">${fmt(d.totalMontant)}</td></tr>
        </tbody>
      </table>

      <div class="km">
        <div>KM DEPART : <span style="font-weight:normal">${esc(d.kmDepart)}</span></div>
        <div>KM ARRIVEE : <span style="font-weight:normal">${esc(d.kmArrivee)}</span></div>
      </div>

      <div class="bandeau" style="margin-top:14px">OBSERVATIONS</div>
      <div class="obs">${esc(d.observations)}</div>
      <div class="mention">${esc(mentionLieuDate(DB.settings && DB.settings.ville))}</div>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}
