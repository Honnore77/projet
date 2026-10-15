/* ===================================================================
   FICHE VÉHICULE — tout ce que l application sait d une immatriculation.
   =================================================================== */

import { DB, vehicleByImmat, vehiculeReformeParImmat, kmCourant, ravMontant } from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { el, esc, fmt, num, dateFR, sum, daysBetween } from '../../core/utils.js';
import { urlImage, octetsImage } from '../../core/images.js';
import { card, toolbar, statTile, sectionLabel, emptyState, toast, openModal, COLORS } from '../components.js';
import { state, navigate } from '../shell.js';
import { statutColor, openVehicleForm } from './vehicles.js';
import { openReformeForm } from './vehiculesReformes.js';
import { renderMaintenanceEntries, openFicheForm } from './maintenance.js';
import { exportExcel } from '../../export/excel.js';
import { infosVehicule, activiteVehicule, exportFicheVehiculePdf } from '../../export/ficheVehicule.js';

export function renderVehicleSheet(page) {
  const immat = state.vehicleSheetImmat;
  // Un vehicule reforme n'est plus dans le parc, mais sa fiche reste lisible.
  const vehicle = vehicleByImmat(immat) || vehiculeReformeParImmat(immat);
  const cat = vehicle ? vehicle._cat : null;

  const dots = DB.dotationPool.filter((d) => same(d.immat, immat));
  // Le carburant des missions est porte par la mission elle-meme (rapport).
  const missionsCarburant = DB.missions.filter((m) => same(m.vehicule, immat) && (m.ravitaillements || []).length);
  const missions = DB.missions.filter((m) => same(m.vehicule, immat));
  const maint = DB.maintenance.filter((m) => same(m.immat, immat));

  page.appendChild(
    toolbar([
      { label: '← Retour aux véhicules', color: COLORS.blue, onClick: () => navigate('VEHICULES') },
      canWrite() && vehicle && { label: '✎ Modifier le véhicule', color: COLORS.green, write: true, onClick: () => (cat === 'reforme' ? openReformeForm(stripCat(vehicle), 'reforme') : openVehicleForm(stripCat(vehicle), cat)) },
      canWrite() && cat !== 'reforme' && { label: '+ Fiche d’entretien', color: COLORS.orange, write: true, onClick: () => openFicheForm(null, immat) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', { immat, vehicle, cat, dots, missionsCarburant, missions, maint }) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', { immat, vehicle, cat, dots, missionsCarburant, missions, maint }) }
    ])
  );

  page.appendChild(carteIdentite(vehicle, cat, immat));

  // La fiche ne chiffre plus le carburant ni l'entretien : elle compte les
  // litres, les passages au garage et les missions. Les montants se lisent
  // dans le rapport « Coûts par véhicule », qui n'existe que pour cela.
  const couleurs = [COLORS.orange, COLORS.red, COLORS.purple];
  const grid = el('<div class="statGrid"></div>');
  activiteVehicule({ dots, missionsCarburant, missions, maint })
    .forEach((a, i) => grid.appendChild(statTile(a.titre, a.valeur, a.detail, couleurs[i])));
  page.appendChild(grid);

  /* ---------------------------- Dotations ---------------------------- */
  if (dots.length) {
    page.appendChild(sectionLabel(`DOTATIONS POOL (${dots.length})`, COLORS.orange));
    dots
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .forEach((d) => {
        page.appendChild(
          card(
            `${dateFR(d.date)} — ${fmt(d.montant)} F`,
            `${fmt(d.quantite)} L à ${fmt(d.prixL)} F/L · ${d.station || 'station non précisée'}\nKm : ${fmt(d.km)} · Vidange : ${d.vidange || '—'}`,
            COLORS.orange
          )
        );
      });
  }

  if (missionsCarburant.length) {
    page.appendChild(sectionLabel(`CARBURANT DES MISSIONS (${missionsCarburant.length})`, COLORS.orange));
    missionsCarburant.forEach((m) => {
      const rav = m.ravitaillements || [];
      const litres = sum(rav, (r) => r.quantite);
      const montant = sum(rav, ravMontant);
      page.appendChild(
        card(
          `${m.ref ? `${m.ref} — ` : ''}${m.conducteur} — ${fmt(montant)} F`,
          `${m.destination || '—'} · ${dateFR(m.dateDepart)} → ${dateFR(m.dateRetour) || '…'}\n` +
            `${fmt(litres)} L · ${rav.length} ravitaillement(s) · ` +
            `${rav.map((r) => r.station).filter(Boolean).join(', ') || 'stations non précisées'}`,
          COLORS.orange
        )
      );
    });
  }

  /* ----------------------------- Missions ---------------------------- */
  if (missions.length) {
    page.appendChild(sectionLabel(`MISSIONS (${missions.length})`, COLORS.purple));
    missions
      .slice()
      .sort((a, b) => String(b.dateDepart).localeCompare(String(a.dateDepart)))
      .forEach((m) => {
        page.appendChild(
          card(
            `${m.ref} — ${m.conducteur}`,
            `${m.destination || '—'} · ${dateFR(m.dateDepart)} → ${dateFR(m.dateRetour) || '…'} (${m.jours || 0} j)\n` +
              `${m.paye ? `🟢 Payée${m.datePaiement ? ` le ${m.datePaiement}` : ''}` : '🔴 En attente de paiement'}`,
            COLORS.purple
          )
        );
      });
  }

  /* ------------------------ Photos et documents ---------------------- */
  // Toutes les images qui parlent de ce vehicule, d'ou qu'elles viennent :
  // la fiche vehicule, ses passages au garage, ses prises de carburant. On
  // ne consulte pas un parc en ouvrant chaque formulaire.
  const galerie = [
    ...((vehicle && vehicle.images) || []).map((i) => ({ img: i, origine: 'fiche véhicule' })),
    ...maint.flatMap((m) => (m.images || []).map((i) => ({ img: i, origine: `garage du ${dateFR(m.dateEntree)}` }))),
    ...dots.flatMap((d) => (d.images || []).map((i) => ({ img: i, origine: `dotation du ${dateFR(d.date)}` })))
  ];
  if (galerie.length) {
    page.appendChild(sectionLabel(`PHOTOS ET DOCUMENTS (${galerie.length})`, COLORS.blue));
    page.appendChild(galerieNode(galerie));
  }

  /* ---------------------------- Entretien ---------------------------- */
  if (maint.length) {
    page.appendChild(sectionLabel(`HISTORIQUE ENTRETIEN (${maint.length})`, COLORS.green));
    const enCours = maint.filter((m) => !m.dateRetour);
    if (enCours.length) {
      const d = daysBetween(enCours[0].dateEntree, new Date().toISOString().slice(0, 10));
      page.appendChild(
        card('VÉHICULE ACTUELLEMENT AU GARAGE', `Entré le ${dateFR(enCours[0].dateEntree)}${d !== null ? ` — immobilisé depuis ${d} jour(s)` : ''}\nMotif : ${enCours[0].motif || '—'}`, COLORS.orange)
      );
    }
    renderMaintenanceEntries(page, maint);
  }

  if (!vehicle && !dots.length && !missionsCarburant.length && !missions.length && !maint.length) {
    page.appendChild(emptyState('Aucune donnée trouvée pour cette immatriculation.'));
  }
}

/**
 * La carte d'identite du vehicule : sa photo a gauche, ses informations a
 * droite — comme une carte grise. Sur un ecran etroit, la photo passe
 * au-dessus. La photo est la premiere de la fiche vehicule.
 */
function carteIdentite(vehicle, cat, immat) {
  if (!vehicle) {
    return card(
      immat || 'Véhicule inconnu',
      "Aucune fiche véhicule n'est enregistrée pour cette immatriculation dans la rubrique VÉHICULES. Les informations ci-dessous proviennent des autres rubriques.",
      COLORS.orange
    );
  }
  const couleur = statutColor(vehicle.statut);
  const photos = vehicle.images || [];
  const lignes = infosVehicule(vehicle, cat);
  const carte = el(
    `<div class="card" style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;border-left:5px solid ${couleur}">` +
      '<div style="flex:0 0 240px;max-width:100%">' +
        '<div data-photo style="width:240px;max-width:100%;aspect-ratio:4/3;border-radius:10px;overflow:hidden;' +
          'background:#eef2f3;display:flex;align-items:center;justify-content:center;color:#8aa0a6;text-align:center;font-size:13px">' +
          (photos.length ? 'chargement…' : '🚗<br>Aucune photo<br><small>« Modifier le véhicule » pour en ajouter</small>') +
        '</div>' +
        (photos.length > 1 ? `<small style="color:#8aa0a6">${photos.length} photos — les autres sont plus bas</small>` : '') +
      '</div>' +
      '<div style="flex:1 1 280px;min-width:0">' +
        `<h3 style="margin:0;color:${COLORS.green}">${esc(`${vehicle.marque || ''} ${vehicle.modele || ''}`.trim() || 'Véhicule')}</h3>` +
        `<div style="font-size:1.7em;font-weight:800;letter-spacing:1px;margin:2px 0 6px">${esc(vehicle.immatNouvelle || vehicle.immatAncienne || '—')}</div>` +
        '<div style="margin-bottom:8px">' +
          `<span class="badge" style="background:${COLORS.blue}">${esc(cat === 'reforme' ? `VÉHICULE RÉFORMÉ${vehicle.origine ? ` · ex-${String(vehicle.origine).toUpperCase()}` : ''}` : String(cat || '').toUpperCase())}</span> ` +
          `<span class="badge" style="background:${couleur}">${esc(vehicle.statut || '')}</span>` +
        '</div>' +
        '<div style="display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:3px 14px;font-size:13.5px">' +
          lignes
            .filter((l) => !['Catégorie', 'Statut'].includes(l.libelle))
            .map((l) => `<span style="color:#5b7178">${esc(l.libelle)}</span><b style="overflow-wrap:anywhere">${esc(l.valeur)}</b>`)
            .join('') +
        '</div>' +
        (vehicle.observations ? `<p style="margin:10px 0 0"><span style="color:#5b7178">Observations : </span>${esc(vehicle.observations)}</p>` : '') +
      '</div>' +
    '</div>'
  );
  if (photos.length) {
    const cadre = carte.querySelector('[data-photo]');
    urlImage(photos[0].id).then((url) => {
      if (!url) { cadre.textContent = 'photo introuvable'; return; }
      const img = el(`<img src="${url}" alt="${esc(photos[0].nom || '')}" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in">`);
      img.onclick = () => ouvrirGrand(photos[0], url);
      cadre.innerHTML = '';
      cadre.appendChild(img);
    });
  }
  return carte;
}

function same(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

function stripCat(v) {
  const copy = Object.assign({}, v);
  delete copy._cat;
  return copy;
}

async function doExport(kind, f) {
  try {
    const safe = String(f.immat || 'vehicule').replace(/[^A-Za-z0-9_-]+/g, '_');
    if (kind === 'pdf') {
      // La premiere photo de la fiche, comme a l'ecran.
      const premiere = f.vehicle && (f.vehicle.images || [])[0];
      const photo = premiere ? await octetsImage(premiere.id) : null;
      const res = await exportFicheVehiculePdf(Object.assign({ photo }, f), `PDU_fiche_${safe}`);
      toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
      return;
    }
    // Le classeur : la carte d'identite en rubrique / valeur, puis un onglet
    // par historique — sans montants, comme la fiche.
    const datasets = [];
    if (f.vehicle) {
      datasets.push({
        title: `Fiche ${f.immat}`,
        columns: [{ key: 'libelle', label: 'Rubrique', width: 28 }, { key: 'valeur', label: 'Valeur', width: 40 }],
        rows: [
          { libelle: 'Véhicule', valeur: `${f.vehicle.marque || ''} ${f.vehicle.modele || ''}`.trim() },
          { libelle: 'Immatriculation', valeur: f.vehicle.immatNouvelle || f.vehicle.immatAncienne || '' },
          ...infosVehicule(f.vehicle, f.cat),
          ...activiteVehicule(f).map((a) => ({ libelle: a.titre, valeur: `${a.valeur} — ${a.detail}` })),
          ...(f.vehicle.observations ? [{ libelle: 'Observations', valeur: f.vehicle.observations }] : [])
        ]
      });
    }
    const col = (key, label, width) => ({ key, label, width });
    if (f.dots.length) {
      datasets.push({ title: 'Dotations pool',
        columns: [col('date', 'Date', 12), col('km', 'Kilométrage', 12), col('quantite', 'Quantité (L)', 12), col('station', 'Station-service', 24), col('vidange', 'État vidange', 13)],
        rows: f.dots.map((d) => ({ date: dateFR(d.date), km: num(d.km), quantite: num(d.quantite), station: d.station || '', vidange: d.vidange || '' })) });
    }
    if (f.missions.length) {
      datasets.push({ title: 'Missions',
        columns: [col('ref', 'Réf.', 10), col('conducteur', 'Conducteur', 22), col('destination', 'Destination', 26), col('depart', 'Départ', 12), col('retour', 'Retour', 12), col('jours', 'Jours', 8), col('paiement', 'Paiement', 12)],
        rows: f.missions.map((m) => ({ ref: m.ref || '', conducteur: m.conducteur || '', destination: m.destination || '', depart: dateFR(m.dateDepart), retour: dateFR(m.dateRetour), jours: m.jours || '', paiement: m.paye ? 'payée' : 'en attente' })) });
    }
    if (f.maint.length) {
      datasets.push({ title: 'Entretien',
        columns: [col('entree', 'Entrée', 12), col('motif', 'Motif', 30), col('garages', 'Garage(s)', 22), col('sortie', 'Sortie', 12), col('etat', 'État', 12)],
        rows: f.maint.map((m) => ({ entree: dateFR(m.dateEntree), motif: m.motif || '', garages: [...new Set((m.interventions || []).map((i) => i.garage).filter(Boolean))].join(', '), sortie: dateFR(m.dateRetour), etat: m.dateRetour ? 'sorti' : 'au garage' })) });
    }
    if (!datasets.length) {
      toast('Rien à exporter pour ce véhicule.', 'info');
      return;
    }
    const res = await exportExcel(datasets, `PDU_fiche_${safe}`);
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}


/**
 * Vignettes en consultation : on regarde, on agrandit, on ne modifie pas.
 * Chaque vignette dit d'ou elle vient — sans quoi une photo d'avarie et une
 * carte grise se ressembleraient dans la liste.
 */
function galerieNode(entrees) {
  const zone = el('<div class="imgChamp"><div class="imgGalerie"></div></div>');
  const galerie = zone.querySelector('.imgGalerie');

  entrees.forEach(({ img, origine }) => {
    const fig = el(
      '<figure class="imgVignette"><span class="imgAbsente">chargement…</span>' +
      `<figcaption>${esc(img.nom || '')}<br><small>${esc(origine)}</small></figcaption></figure>`
    );
    galerie.appendChild(fig);

    urlImage(img.id).then((url) => {
      if (!url) {
        fig.querySelector('.imgAbsente').textContent = 'introuvable';
        return;
      }
      const vue = el(`<img src="${url}" alt="${esc(img.nom || '')}">`);
      vue.onclick = () => ouvrirGrand(img, url);
      fig.replaceChild(vue, fig.querySelector('.imgAbsente'));
    });
  });

  return zone;
}

function ouvrirGrand(img, url) {
  openModal({
    title: img.nom || 'Image',
    bodyNode: el(
      `<div style="text-align:center"><img src="${url}" alt="${esc(img.nom || '')}" ` +
      'style="max-width:100%;max-height:70vh;border-radius:10px"></div>'
    ),
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }]
  });
}
