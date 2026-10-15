/* ===================================================================
   FICHE DE SIMULATION — une seule description, trois rendus.

   La fiche est decrite une fois (modeleFicheSimulation) : des sections,
   chacune faite de lignes « libelle — detail — valeur ». L'ecran, le PDF
   et le classeur Excel la dessinent tels quels, de sorte que le document
   exporte se presente exactement comme la fiche a l'ecran.
   =================================================================== */

import { jsPDF } from 'jspdf';
import * as sheetjs from 'xlsx-js-style';
import { DB, parcoursDe, vehicleByImmat } from '../core/db.js';
import { dateFR, todayISO, mentionLieuDate } from '../core/utils.js';
import { previewAndSave } from './preview.js';
import { toWinAnsi as clean } from './winansi.js';

const XLSX = sheetjs && sheetjs.utils ? sheetjs : sheetjs.default;

const VERT = [0, 138, 59];
const INDIGO = [57, 73, 171];        // couleur de la rubrique SIMULATION
const FOND_SECTION = [244, 247, 248];
const GRIS_TITRE = [91, 113, 120];
const GRIS_DETAIL = [120, 134, 140];
const ENCRE = [23, 49, 59];

const f = (n) => Number(n || 0).toLocaleString('fr-FR');
const virgule = (n) => String(n === undefined || n === null ? 0 : n).replace('.', ',');

/** Marque, modele et energie : ceux de VÉHICULES si le vehicule y figure. */
function vehicule(s) {
  const v = vehicleByImmat(s.vehicule);
  if (!v) return { marqueModele: s.marqueModele || '', energie: s.energie || '' };
  return {
    marqueModele: `${v.marque || ''} ${v.modele || ''}`.trim() || s.marqueModele || '',
    energie: v.energie || s.energie || ''
  };
}

/**
 * Etapes d'une simulation : celles enregistrees avec elle, sinon (simulation
 * d'avant cet enregistrement) recalculees sur les distances actuelles.
 */
export function etapesSimulation(s) {
  if (Array.isArray(s.etapes) && s.etapes.length) return s.etapes;
  const p = parcoursDe(s.destinations || []);
  return [...p.etapes, ...(p.retour ? [Object.assign({ retour: true }, p.retour)] : [])];
}

/**
 * La fiche, section par section.
 * Une ligne : { libelle, detail?, valeur, sousTotal?, total? }.
 */
export function modeleFicheSimulation(s) {
  const v = vehicule(s);
  // Une simulation enregistree avant le calcul par destination n'a pas de
  // nombre de destinations : elle comptait un seul frais OM par participant.
  const nbDest = s.nbDestinations || 1;
  const unitaire = s.fraisOmUnitaire || (s.participants ? s.fraisOm / s.participants / nbDest : 0);
  const etapes = etapesSimulation(s);
  const km = (e) => (e.km === null || e.km === undefined ? '? km' : `${f(e.km)} km`);
  const noteEtape = (e) => (e.km === null || e.km === undefined ? 'distance inconnue' : e.estimee ? 'distance estimée' : '');

  return {
    titre: 'Fiche de simulation de mission',
    sousTitre: (s.destinations || []).join(', ') || 'Simulation de mission',
    sections: [
      {
        titre: 'Mission simulée',
        lignes: [
          { libelle: 'Période', detail: s.jours ? `${s.jours} jour(s)` : '', valeur: `${dateFR(s.dateDepart) || '…'} - ${dateFR(s.dateRetour) || '…'}` },
          { libelle: 'Destinations', valeur: (s.destinations || []).join(', ') || '—' },
          { libelle: 'Parcours aller-retour', detail: s.parcoursComplet === false ? 'une distance d’étape manquait' : '', valeur: `${f(s.parcoursKm)} km` },
          { libelle: 'Parcours en interne', valeur: `${f(s.interneKm)} km` },
          { libelle: 'Distance totale', valeur: `${f(s.distanceTotale)} km` },
          { libelle: 'Véhicule utilisé', detail: [v.marqueModele, v.energie].filter(Boolean).join(' - '), valeur: s.vehicule || '—' },
          { libelle: 'Consommation', valeur: `${virgule(s.consommation)} L/100 km` },
          { libelle: 'Prix du litre', valeur: `${f(s.prixL)} F` },
          { libelle: 'Total participants', valeur: f(s.participants) }
        ]
      },
      {
        titre: 'Parcours',
        lignes: [
          ...etapes.map((e, i) => ({
            libelle: e.retour ? `Retour : ${e.de} - ${e.vers}` : `${i + 1}. ${e.de} - ${e.vers}`,
            detail: noteEtape(e),
            valeur: km(e)
          })),
          { libelle: 'Total aller-retour', valeur: `${f(s.parcoursKm)} km`, sousTotal: true }
        ]
      },
      {
        titre: 'Parcours en interne',
        lignes: [
          ...(s.interne || []).map((x) => ({
            libelle: x.nom || '',
            detail: x.jours === '' || x.jours === undefined ? '' : `${virgule(x.jours)} jour(s) sur place`,
            valeur: `${f(x.km)} km`
          })),
          { libelle: 'Total en interne', valeur: `${f(s.interneKm)} km`, sousTotal: true }
        ]
      },
      {
        titre: 'Estimation des frais de mission',
        lignes: [
          { libelle: 'Frais OM =', detail: `${f(s.participants)} participant(s) x ${f(nbDest)} destination(s) x ${f(unitaire)} F`, valeur: `${f(s.fraisOm)} F` },
          { libelle: 'Frais de péage =', detail: 'montant saisi', valeur: `${f(s.fraisPeage)} F` },
          { libelle: 'Carburant =', detail: `${virgule(s.litres)} L x ${f(s.prixL)} F pour ${f(s.distanceTotale)} km`, valeur: `${f(s.montantCarburant)} F` },
          { libelle: 'TOTAL', detail: 'Frais OM + frais de péage + carburant', valeur: `${f(s.estimation)} F`, total: true }
        ]
      }
    ]
  };
}

/* ============================== Ecran ============================== */

const echapper = (t) => String(t === undefined || t === null ? '' : t)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** La fiche en HTML, avec les blocs de l'application. */
export function ficheHtml(modele, couleur = '#3949AB') {
  return modele.sections.map((sec) =>
    `<div class="subBlock"><h5>${echapper(sec.titre)}</h5>` +
    sec.lignes.map((l) => {
      const style = l.total
        ? ' style="border-top:2px solid currentColor;border-bottom:none"'
        : l.sousTotal ? ' style="border-top:1px solid #b7c4c8"' : '';
      const valeur = l.total
        ? `<b style="color:${couleur};font-size:1.15em;white-space:nowrap">${echapper(l.valeur)}</b>`
        : `<b style="white-space:nowrap">${echapper(l.valeur)}</b>`;
      return `<div class="subEntryRow"${style}><span>${l.total || l.sousTotal ? `<b>${echapper(l.libelle)}</b>` : echapper(l.libelle)}` +
        `${l.detail ? `<br><small>${echapper(l.detail)}</small>` : ''}</span>${valeur}</div>`;
    }).join('') +
    '</div>'
  ).join('');
}

/* =============================== PDF =============================== */

/** La fiche en PDF, page A4 portrait, dessinee comme a l'ecran. */
export function buildFichePdf(modele) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const org = (DB.settings && DB.settings.organisation) || 'PDU';
  const M = 14;                    // marge
  const G = M + 5;                 // texte a gauche, dans le bloc
  const D = W - M - 5;             // valeurs a droite, dans le bloc
  const largeurLibelle = 110;

  const entete = () => {
    doc.setFillColor(...VERT);
    doc.rect(0, 0, W, 20, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(clean(`${org} - ${modele.titre}`), M, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(clean(modele.sousTitre), M, 15);
  };
  const pied = () => {
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
  };

  /** Hauteur d'une ligne : libelle (sur une ou plusieurs lignes) et detail. */
  const mesurer = (l) => {
    doc.setFontSize(l.total ? 10 : 9);
    const lib = doc.splitTextToSize(clean(l.libelle), largeurLibelle);
    doc.setFontSize(7.5);
    const det = l.detail ? doc.splitTextToSize(clean(l.detail), largeurLibelle) : [];
    return { lib, det, h: 2 + lib.length * 3.6 + det.length * 2.9 + (l.total ? 2.2 : 0.8) };
  };

  entete();
  let y = 26;
  modele.sections.forEach((sec) => {
    const mesures = sec.lignes.map(mesurer);
    const hauteur = 8 + mesures.reduce((t, m) => t + m.h, 0) + 2;
    if (y + hauteur > H - 12 && y > 30) { doc.addPage(); entete(); y = 26; }

    // Le bloc gris clair de la section, comme a l'ecran.
    doc.setFillColor(...FOND_SECTION);
    doc.roundedRect(M, y, W - 2 * M, hauteur, 2, 2, 'F');
    doc.setTextColor(...GRIS_TITRE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(clean(sec.titre.toUpperCase()), G, y + 6);
    let yy = y + 8;

    sec.lignes.forEach((l, i) => {
      const m = mesures[i];
      if (l.total || l.sousTotal) {
        doc.setDrawColor(...(l.total ? ENCRE : [183, 196, 200]));
        doc.setLineWidth(l.total ? 0.6 : 0.3);
        doc.line(G, yy, D, yy);
      } else if (i > 0) {
        doc.setDrawColor(226, 232, 234);
        doc.setLineWidth(0.2);
        doc.line(G, yy, D, yy);
      }
      let ly = yy + 3.8;
      doc.setTextColor(...ENCRE);
      doc.setFont('helvetica', l.total || l.sousTotal ? 'bold' : 'normal');
      doc.setFontSize(l.total ? 10 : 9);
      m.lib.forEach((t) => { doc.text(t, G, ly); ly += 3.6; });
      if (m.det.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...GRIS_DETAIL);
        m.det.forEach((t) => { doc.text(t, G, ly - 0.8); ly += 2.9; });
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(l.total ? 12 : 9);
      doc.setTextColor(...(l.total ? INDIGO : ENCRE));
      doc.text(clean(l.valeur), D, yy + 4.1, { align: 'right' });
      yy += m.h;
    });
    y += hauteur + 4;
  });

  pied();
  return new Uint8Array(doc.output('arraybuffer'));
}

/* ============================== Excel ============================== */

/**
 * La fiche en classeur, presentee comme a l'ecran : titre, sections en
 * bandeau, libelle a gauche et son detail en dessous, valeur a droite, total
 * mis en avant.
 */
export function buildFicheExcel(modele) {
  const org = (DB.settings && DB.settings.organisation) || 'PDU';
  const lignes = [];      // [texte A, texte B]
  const styles = [];      // style par ligne : { a, b }
  const fusions = [];
  const bord = { style: 'thin', color: { rgb: 'FFE2E8EA' } };

  const ajouter = (a, b, sa, sb, fusion) => {
    if (fusion) fusions.push({ s: { r: lignes.length, c: 0 }, e: { r: lignes.length, c: 1 } });
    lignes.push([a, b]);
    styles.push({ a: sa, b: sb });
  };

  ajouter(`${org} - ${modele.titre}`, '', {
    font: { bold: true, sz: 14, color: { rgb: 'FFFFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FF008A3B' } }
  }, { fill: { patternType: 'solid', fgColor: { rgb: 'FF008A3B' } } }, true);
  ajouter(modele.sousTitre, '', { font: { italic: true, color: { rgb: 'FF5B7178' } } }, {}, true);

  modele.sections.forEach((sec) => {
    ajouter('', '', {}, {});
    const fond = { patternType: 'solid', fgColor: { rgb: 'FFF4F7F8' } };
    ajouter(sec.titre.toUpperCase(), '', { font: { bold: true, sz: 9, color: { rgb: 'FF5B7178' } }, fill: fond }, { fill: fond }, true);
    sec.lignes.forEach((l) => {
      const haut = l.total ? { top: { style: 'medium', color: { rgb: 'FF17313B' } } }
        : l.sousTotal ? { top: { style: 'thin', color: { rgb: 'FFB7C4C8' } } } : { top: bord };
      ajouter(l.libelle, l.valeur,
        { font: { bold: !!(l.total || l.sousTotal), sz: l.total ? 11 : 10 }, fill: fond, border: haut },
        {
          font: { bold: true, sz: l.total ? 12 : 10, color: { rgb: l.total ? 'FF3949AB' : 'FF17313B' } },
          alignment: { horizontal: 'right' }, fill: fond, border: haut
        });
      if (l.detail) {
        ajouter(l.detail, '', { font: { italic: true, sz: 8, color: { rgb: 'FF78868C' } }, fill: fond }, { fill: fond });
      }
    });
  });
  ajouter('', '', {}, {});
  ajouter('', mentionLieuDate(DB.settings && DB.settings.ville), {}, {
    font: { italic: true, color: { rgb: 'FF5B7178' } }, alignment: { horizontal: 'right' }
  });

  const ws = XLSX.utils.aoa_to_sheet(lignes);
  styles.forEach((st, r) => {
    ['a', 'b'].forEach((k, c) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      if (st[k]) ws[ref].s = st[k];
    });
  });
  ws['!merges'] = fusions;
  ws['!cols'] = [{ wch: 62 }, { wch: 26 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Fiche');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

/* ============================= Exports ============================= */

export function exportFichePdf(modele, baseName) {
  return previewAndSave({
    kind: 'pdf',
    bytes: buildFichePdf(modele),
    filename: `${baseName}_${todayISO()}.pdf`,
    mime: 'application/pdf',
    title: 'Aperçu avant export PDF'
  });
}

export function exportFicheExcel(modele, baseName) {
  // L'apercu du classeur reprend les lignes de la fiche, section par section.
  const apercu = modele.sections.map((sec) => ({
    title: sec.titre,
    columns: [{ key: 'libelle', label: 'Libellé' }, { key: 'detail', label: 'Détail' }, { key: 'valeur', label: 'Valeur' }],
    rows: sec.lignes.map((l) => ({ libelle: l.libelle, detail: l.detail || '', valeur: l.valeur }))
  }));
  return previewAndSave({
    kind: 'excel',
    bytes: buildFicheExcel(modele),
    filename: `${baseName}_${todayISO()}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    datasets: apercu,
    title: 'Aperçu avant export Excel'
  });
}
