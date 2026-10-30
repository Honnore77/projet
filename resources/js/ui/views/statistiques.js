/* ===================================================================
   Sous-rubrique STATISTIQUES — la meme page pour chaque rubrique :
   filtre d'annee, chiffres cles, graphiques, tableaux, exports.

   Les chiffres viennent de core/statistiques.js ; cette page ne fait que
   les dessiner, et les exports reprennent exactement les memes tableaux.
   =================================================================== */

import { STATISTIQUES, anneesDisponibles } from '../../core/statistiques.js';
import { el, esc, fmt } from '../../core/utils.js';
import { card, toolbar, filterBar, statTile, dataTable, sectionLabel, emptyState, toast, COLORS } from '../components.js';
import { state, rerender, moduleColor } from '../shell.js';
import { chartCardTypes, destroyCharts, colorsFor, dessinerGraphique, imageDuGraphique } from '../charts.js';
import { allVehicles } from '../../core/db.js';
import {
  dsVehicles, dsUsers, dsIncidents, dsIndisponibilites, dsDotationPool, dsRavitaillementsMissions,
  dsMissions, dsCarburantMissions, dsMaintenance, dsInterventions, dsDecharges, dsDestinataires, dsSimulations
} from '../../export/datasets.js';
import { analyserColonnes, mesuresPossibles, libelleMesure, regrouper, lignesDeLAnnee } from '../../core/graphiqueLibre.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { exportWord } from '../../export/word.js';
import { voitTout, rubriqueCourante } from '../../core/acces.js';

/** La cle de sous-rubrique commune a toutes les rubriques. */
export const SOUS_RUBRIQUE_STATS = { key: 'stats', label: 'STATISTIQUES' };

const COULEURS_TUILES = [COLORS.green, COLORS.blue, COLORS.orange, COLORS.purple, COLORS.red, COLORS.grey];

/**
 * Dessine les statistiques d'une rubrique.
 * @param {HTMLElement} page
 * @param {string} cle  cle de la rubrique dans le menu (VEHICULES, MISSION…)
 */
export function renderStatistiques(page, cle) {
  destroyCharts();
  if (!voitTout(rubriqueCourante())) {
    page.appendChild(el('<div class="card"><h3>STATISTIQUES</h3><p>Les statistiques portent sur toute la rubrique : elles ne sont pas ouvertes à votre compte.</p></div>'));
    return;
  }
  const def = STATISTIQUES[cle];
  const couleur = moduleColor(cle);
  const f = state.filters.statistiques;
  // L'annee en cours par defaut : c'est elle qu'on regarde le plus souvent.
  if (f.annee === undefined) f.annee = new Date().getFullYear().toString();
  const annee = def.datee ? f.annee : '';
  const stats = def.calcul(annee);

  page.appendChild(
    card(
      `STATISTIQUES — ${def.titre.toUpperCase()}`,
      def.intro ? def.intro(annee)
        : def.datee
        ? `Les chiffres de la rubrique ${annee ? `pour l’année ${annee}` : 'toutes années confondues'}. Choisissez une autre année ci-dessous ; les exports reprennent ce qui est affiché.`
        : 'L’état du parc aujourd’hui : les véhicules ne sont pas datés, ces chiffres ne dépendent pas de l’année.',
      couleur
    )
  );

  if (def.datee) {
    page.appendChild(
      filterBar([
        {
          type: 'select',
          value: f.annee,
          options: [{ value: '', label: 'Toutes les années' }, ...anneesDisponibles().map((a) => ({ value: a, label: a }))],
          onChange: (v) => { f.annee = v; rerender(); }
        }
      ])
    );
  }

  page.appendChild(
    toolbar([
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => exporter('excel', def, avecLibre(stats, cle), annee) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => exporter('pdf', def, avecLibre(stats, cle), annee) },
      { label: '⬇ Word', color: '#2B579A', onClick: () => exporter('word', def, avecLibre(stats, cle), annee) }
    ])
  );

  const grid = el('<div class="statGrid"></div>');
  stats.tuiles.forEach((t, i) => grid.appendChild(statTile(t.titre, t.valeur, t.detail, COULEURS_TUILES[i % COULEURS_TUILES.length])));
  page.appendChild(grid);

  const vides = stats.blocs.filter((b) => !b.lignes.length);
  const pleins = stats.blocs.filter((b) => b.lignes.length);
  if (!pleins.length) {
    page.appendChild(emptyState('Pas encore de données à analyser pour cette période.'));
    return;
  }

  // Les graphiques au choix (jusqu'a quatre), composes a partir des colonnes
  // des tableaux de la rubrique.
  sectionGraphiquesAuChoix(page, cle, annee, couleur, def);

  // Les graphiques d'abord, deux par ligne sur un grand ecran. Chacun a sa
  // liste de formes ; le choix est retenu, graphique par graphique.
  const graphiques = el('<div class="chartGrid"></div>');
  pleins.filter((b) => b.graphique).forEach((b) => {
    const g = b.graphique;
    const cleForme = `${cle}|${b.titre}`;
    const formes = formesPossibles(g);
    graphiques.appendChild(chartCardTypes(
      esc(b.titre),
      (forme) => configGraphique(g, forme),
      formes,
      formesRetenues()[cleForme] || g.type,
      (forme) => retenirForme(cleForme, forme)
    ));
  });
  if (graphiques.children.length) page.appendChild(graphiques);

  // Puis le detail chiffre de chaque bloc.
  pleins.forEach((b) => {
    page.appendChild(sectionLabel(b.titre.toUpperCase(), couleur));
    // Les chiffres, et leur en-tete, au centre de leur colonne.
    const centre = (x) => `<span style="display:block;text-align:center">${x}</span>`;
    page.appendChild(dataTable(b.entetes.map((h, i) => (i === 0 ? esc(h) : centre(esc(h)))), b.lignes.map((l) => l.map((c, i) =>
      (i === 0 ? `<b>${esc(c)}</b>` : centre(esc(c))))), null, { fiche: false }));
  });

  if (vides.length) {
    page.appendChild(el(`<p style="color:#8aa0a6;margin:10px 4px"><small>Sans données pour cette période : ${vides.map((b) => esc(b.titre)).join(' · ')}.</small></p>`));
  }
}

/* -------------------------- Graphique au choix -------------------------- */

/**
 * Les tableaux de chaque rubrique (les memes que ses exports) et la colonne
 * qui porte leur date, pour le filtre d'annee. Sans date, le tableau se lit
 * tel qu'il est aujourd'hui.
 */
const TABLEAUX = {
  VEHICULES: [{ titre: 'Véhicules', ds: () => dsVehicles(allVehicles()) }],
  UTILISATEURS: [
    { titre: 'Utilisateurs', ds: () => dsUsers() },
    { titre: 'Incidents', ds: () => dsIncidents(), date: 'date' },
    { titre: 'Congés et absences', ds: () => dsIndisponibilites(), date: 'dateDepart' }
  ],
  DOTATION: [
    { titre: 'Dotation pool', ds: () => dsDotationPool(), date: 'date' },
    { titre: 'Ravitaillements des missions', ds: () => dsRavitaillementsMissions(), date: 'date' }
  ],
  MISSION: [
    { titre: 'Missions', ds: () => dsMissions(), date: 'dateDepart' },
    { titre: 'Carburant des missions', ds: () => dsCarburantMissions(), date: 'dateDepart' },
    { titre: 'Ravitaillements', ds: () => dsRavitaillementsMissions(), date: 'date' }
  ],
  ENTRETIEN: [
    { titre: 'Passages au garage', ds: () => dsMaintenance(), date: 'dateEntree' },
    { titre: 'Interventions garage', ds: () => dsInterventions(), date: 'dateEntree' }
  ],
  DECHARGE: [
    { titre: 'Courses', ds: () => dsDecharges(), date: 'date' },
    { titre: 'Destinataires', ds: () => dsDestinataires() }
  ],
  SIMULATION: [{ titre: 'Simulations', ds: () => dsSimulations(), date: 'periode' }]
};

/** Au plus quatre graphiques au choix par rubrique. */
const MAX_LIBRES = 4;

/**
 * Les choix des graphiques au choix, retenus sur ce poste, rubrique par
 * rubrique : une liste, un element par graphique. L'ancien format (un seul
 * graphique, un objet) se lit comme une liste d'un element.
 */
const CLE_LIBRE = 'pdu_graphique_au_choix';
function reglagesLibres(cle) {
  try {
    const r = (JSON.parse(localStorage.getItem(CLE_LIBRE) || '{}') || {})[cle];
    if (Array.isArray(r) && r.length) return r.slice(0, MAX_LIBRES).map((x) => x || {});
    return [r && typeof r === 'object' ? r : {}];
  } catch (e) { return [{}]; }
}
function retenirLibres(cle, liste) {
  try {
    const tout = JSON.parse(localStorage.getItem(CLE_LIBRE) || '{}') || {};
    tout[cle] = liste;
    localStorage.setItem(CLE_LIBRE, JSON.stringify(tout));
  } catch (e) { /* stockage indisponible : les choix valent pour cette page */ }
}

/**
 * Les graphiques au choix de la page, par rubrique : leurs choix, le bloc
 * chiffre et le graphique dessine. Les exports les reprennent, image comprise.
 */
const libresParRubrique = {};

/** Les blocs des graphiques au choix, chacun avec l'image de son graphique. */
function blocsLibres(cle) {
  return (libresParRubrique[cle] || [])
    .filter((e) => e.bloc)
    .map((e) => Object.assign({}, e.bloc, { image: imageDuGraphique(e.chart) }));
}

/** Les blocs de la page, les graphiques au choix en tete. */
function avecLibre(stats, cle) {
  const libres = blocsLibres(cle);
  return libres.length ? Object.assign({}, stats, { blocs: [...libres, ...stats.blocs] }) : stats;
}

/**
 * Les graphiques au choix : un bandeau (ajouter, exporter), puis jusqu'a
 * quatre cartes, deux par ligne sur un grand ecran.
 */
function sectionGraphiquesAuChoix(page, cle, annee, couleur, def) {
  if (!TABLEAUX[cle]) return;
  const reglages = reglagesLibres(cle);
  const etats = reglages.map((choix) => ({ choix, bloc: null, chart: null }));
  libresParRubrique[cle] = etats;
  const enregistrer = () => retenirLibres(cle, etats.map((e) => e.choix));
  const periode = annee || 'toutes années';
  const titreExport = `Graphiques au choix — ${def.titre.toLowerCase()} — ${periode}`;

  page.appendChild(sectionLabel(`GRAPHIQUES AU CHOIX (${etats.length} sur ${MAX_LIBRES})`, couleur));
  page.appendChild(toolbar([
    etats.length < MAX_LIBRES && {
      label: '+ Ajouter un graphique',
      color: couleur,
      onClick: () => {
        enregistrer();
        retenirLibres(cle, [...etats.map((e) => e.choix), {}]);
        rerender();
      }
    },
    { label: '⬇ Excel', color: COLORS.blue, onClick: () => exporterLibres('excel', cle, def, annee, titreExport) },
    { label: '⬇ PDF', color: COLORS.red, onClick: () => exporterLibres('pdf', cle, def, annee, titreExport) },
    { label: '⬇ Word', color: '#2B579A', onClick: () => exporterLibres('word', cle, def, annee, titreExport) }
  ]));

  const grille = el('<div class="chartGrid graphiquesAuChoix"></div>');
  etats.forEach((etat, i) => {
    grille.appendChild(carteGraphiqueLibre(cle, annee, etat, {
      numero: i + 1,
      surChoix: enregistrer,
      // Le dernier graphique reste : on le change, on ne le retire pas.
      retirer: etats.length > 1
        ? () => { retenirLibres(cle, etats.filter((e) => e !== etat).map((e) => e.choix)); rerender(); }
        : null
    }));
  });
  page.appendChild(grille);
}

/** Exporte les seuls graphiques au choix : chacun son image, puis ses chiffres. */
async function exporterLibres(kind, cle, def, annee, titre) {
  const blocs = blocsLibres(cle);
  if (!blocs.length) { toast('Aucun graphique à exporter pour cette période.', 'info'); return; }
  try {
    const datasets = blocs.map(blocVersDataset);
    const nom = `PDU_graphiques_${nomFichier(def.titre)}_${annee || 'toutes'}`;
    const res = kind === 'excel'
      ? await exportExcel(datasets, nom)
      : kind === 'word'
        ? await exportWord(datasets, nom, { title: titre, orientation: 'p', enchaine: true })
        : await exportPdf(datasets, nom, { title: titre, orientation: 'p', enchaine: true });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}

/**
 * Une carte « Graphique au choix » : Tableau, Regrouper par, Valeur, Forme.
 * Chaque changement redessine la carte seule, pas la page.
 * @param {object} etat  { choix, bloc, chart } — tenu a jour par la carte
 * @param {{numero:number, surChoix:Function, retirer:Function|null}} opts
 */
function carteGraphiqueLibre(cle, annee, etat, { numero, surChoix, retirer }) {
  const tableaux = TABLEAUX[cle];
  const carte = el(
    '<div class="chartCard graphiqueLibre">' +
      '<div class="glTete">' +
        `<h3>Graphique ${numero}</h3>` +
        (retirer ? '<button type="button" class="miniBtn glRetirer" title="Retirer ce graphique">✕ Retirer</button>' : '') +
      '</div>' +
      '<div class="glChoix">' +
        '<label>Tableau<select data-gl="tableau"></select></label>' +
        '<label>Regrouper par<select data-gl="colonne"></select></label>' +
        '<label>Valeur<select data-gl="mesure"></select></label>' +
        '<label>Forme<select data-gl="forme"></select></label>' +
      '</div>' +
      '<div class="chartBox"><canvas></canvas></div>' +
      '<div class="glVide" hidden></div>' +
      '<div class="glTableau"></div>' +
    '</div>'
  );
  if (retirer) carte.querySelector('.glRetirer').onclick = retirer;
  const sel = (k) => carte.querySelector(`[data-gl="${k}"]`);
  const remplir = (select, options, voulu) => {
    select.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    select.value = options.some((o) => o.value === voulu) ? voulu : (options[0] || {}).value || '';
  };
  const canvas = carte.querySelector('canvas');
  const boite = carte.querySelector('.chartBox');
  const videEl = carte.querySelector('.glVide');
  const tableauEl = carte.querySelector('.glTableau');
  const retenu = etat.choix;

  remplir(sel('tableau'), tableaux.map((t, i) => ({ value: String(i), label: t.titre })), retenu.tableau);

  const dessiner = (depuis) => {
    const t = tableaux[Number(sel('tableau').value)] || tableaux[0];
    const ds = t.ds();
    const rows = lignesDeLAnnee(ds.rows, t.date, annee);
    const colonnes = analyserColonnes(ds, rows);
    // Un autre tableau : ses propres colonnes, en gardant le choix s'il y existe.
    if (depuis === 'debut' || depuis === 'tableau') {
      const regroupables = colonnes.filter((c) => c.regroupe);
      const voulue = depuis === 'debut' ? retenu.colonne : sel('colonne').value;
      // D'office, la premiere colonne de texte qui regroupe vraiment
      // plusieurs lignes (Conducteur, Immatriculation…).
      const parDefaut = (regroupables.find((c) => !c.unique && !c.chiffree && !c.date) ||
        regroupables.find((c) => !c.unique) || regroupables[0] || {}).key;
      remplir(sel('colonne'), regroupables.map((c) => ({ value: c.key, label: c.date ? `${c.label} (par mois)` : c.label })),
        regroupables.some((c) => c.key === voulue) ? voulue : parDefaut);
      remplir(sel('mesure'), mesuresPossibles(colonnes), depuis === 'debut' ? retenu.mesure : sel('mesure').value);
    }
    const colonne = colonnes.find((c) => c.key === sel('colonne').value);
    const mesure = sel('mesure').value || 'nombre';
    const r = colonne && rows.length ? regrouper(rows, colonne, mesure, { annee }) : { libelles: [], valeurs: [], total: 0 };
    const nomMesure = libelleMesure(mesure, colonnes);
    const g = {
      // Des categories : une couleur par barre ; des mois : une seule couleur.
      type: colonne && colonne.date ? 'bar' : 'doughnut',
      libelles: r.libelles,
      series: [{ nom: nomMesure, valeurs: r.valeurs }]
    };
    remplir(sel('forme'), formesPossibles(g), depuis === 'debut' ? retenu.forme : sel('forme').value);
    etat.choix = { tableau: sel('tableau').value, colonne: sel('colonne').value, mesure, forme: sel('forme').value };
    surChoix();

    if (!r.libelles.length) {
      boite.style.display = 'none';
      videEl.hidden = false;
      videEl.textContent = 'Pas de données dans ce tableau pour cette période.';
      tableauEl.innerHTML = '';
      etat.bloc = null;
      return;
    }
    boite.style.display = '';
    videEl.hidden = true;
    etat.chart = dessinerGraphique(canvas, configGraphique(g, sel('forme').value), etat.chart);

    // Le detail chiffre sous le graphique, et le meme bloc pour les exports.
    const avecPart = r.total !== null && r.total > 0;
    const entetes = [colonne.label, nomMesure, ...(avecPart ? ['Part'] : [])];
    const lignes = r.libelles.map((lib, i) => [
      lib, fmt(r.valeurs[i]), ...(avecPart ? [`${Math.round((r.valeurs[i] / r.total) * 100)} %`] : [])
    ]);
    etat.bloc = { titre: `Graphique ${numero} — ${t.titre} : ${nomMesure} par ${colonne.label.toLowerCase()}`, entetes, lignes };
    const centre = (x) => `<span style="display:block;text-align:center">${x}</span>`;
    tableauEl.innerHTML = '';
    tableauEl.appendChild(dataTable(entetes.map((h, i) => (i === 0 ? esc(h) : centre(esc(h)))),
      lignes.map((l) => l.map((c, i) => (i === 0 ? `<b>${esc(c)}</b>` : centre(esc(c))))), null, { fiche: false }));
  };

  sel('tableau').onchange = () => dessiner('tableau');
  sel('colonne').onchange = () => dessiner('colonne');
  sel('mesure').onchange = () => dessiner('mesure');
  sel('forme').onchange = () => dessiner('forme');
  // Chart.js a besoin du canvas dans la page pour se dimensionner.
  requestAnimationFrame(() => { if (carte.isConnected) dessiner('debut'); });
  return carte;
}

/* ------------------------- Formes de graphique ------------------------- */

const FORMES = {
  bar: 'Barres verticales',
  barH: 'Barres horizontales',
  stacked: 'Barres empilées',
  line: 'Courbe',
  area: 'Aires',
  pie: 'Camembert',
  doughnut: 'Anneau',
  polarArea: 'Polaire',
  radar: 'Radar'
};

/**
 * Formes qui ont un sens pour ce graphique : une serie se montre de toutes
 * les facons ; plusieurs series (litres pool et missions, missions et jours)
 * ne se mettent pas en camembert, mais peuvent s'empiler.
 */
function formesPossibles(g) {
  const cles = g.series.length > 1
    ? ['bar', 'stacked', 'barH', 'line', 'area', 'radar']
    : ['bar', 'barH', 'line', 'area', 'pie', 'doughnut', 'polarArea', 'radar'];
  // Un radar a moins de trois branches n'est qu'un trait.
  return cles.filter((k) => k !== 'radar' || g.libelles.length >= 3).map((k) => ({ value: k, label: FORMES[k] }));
}

/** Les formes choisies, retenues sur ce poste (simple confort d'affichage). */
const CLE_FORMES = 'pdu_formes_graphiques';
function formesRetenues() {
  try { return JSON.parse(localStorage.getItem(CLE_FORMES) || '{}') || {}; } catch (e) { return {}; }
}
function retenirForme(cle, forme) {
  try {
    const f = formesRetenues();
    f[cle] = forme;
    localStorage.setItem(CLE_FORMES, JSON.stringify(f));
  } catch (e) { /* stockage indisponible : le choix vaut pour cette page */ }
}

/** Couleur avec transparence, pour les aires et le radar. */
function voile(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Configuration Chart.js d'un graphique de bloc, dans la forme demandee. */
function configGraphique(g, forme = g.type) {
  const entiers = g.series.every((s) => s.valeurs.every((v) => Number.isInteger(v)));
  // Des comptages (missions, passages) ne se lisent pas en demi-unites.
  const ticks = entiers ? { precision: 0 } : {};

  if (forme === 'pie' || forme === 'doughnut' || forme === 'polarArea') {
    const couleurs = colorsFor(g.libelles.length);
    return {
      type: forme,
      data: {
        labels: g.libelles,
        datasets: [{
          data: g.series[0].valeurs,
          backgroundColor: forme === 'polarArea' ? couleurs.map((c) => voile(c, 0.7)) : couleurs
        }]
      },
      options: {
        plugins: { legend: { position: 'right' } },
        ...(forme === 'polarArea' ? { scales: { r: { beginAtZero: true, ticks } } } : {})
      }
    };
  }

  const couleurs = colorsFor(g.series.length);
  if (forme === 'radar') {
    return {
      type: 'radar',
      data: {
        labels: g.libelles,
        datasets: g.series.map((s, i) => ({
          label: s.nom, data: s.valeurs, borderColor: couleurs[i], backgroundColor: voile(couleurs[i], 0.25), pointRadius: 3
        }))
      },
      options: { plugins: { legend: { display: g.series.length > 1 } }, scales: { r: { beginAtZero: true, ticks } } }
    };
  }

  if (forme === 'line' || forme === 'area') {
    return {
      type: 'line',
      data: {
        labels: g.libelles,
        datasets: g.series.map((s, i) => ({
          label: s.nom, data: s.valeurs, borderColor: couleurs[i], backgroundColor: voile(couleurs[i], 0.2),
          fill: forme === 'area', tension: 0.3, pointRadius: 3
        }))
      },
      options: { plugins: { legend: { display: g.series.length > 1 } }, scales: { y: { beginAtZero: true, ticks } } }
    };
  }

  // Barres : verticales, horizontales ou empilees.
  const horizontal = forme === 'barH';
  const empile = forme === 'stacked';
  // Une seule serie de categories : une couleur par barre, comme le camembert.
  const uneSerie = g.series.length === 1;
  return {
    type: 'bar',
    data: {
      labels: g.libelles,
      datasets: g.series.map((s, i) => ({
        label: s.nom,
        data: s.valeurs,
        backgroundColor: uneSerie && g.type === 'doughnut' ? colorsFor(g.libelles.length) : couleurs[i]
      }))
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { display: g.series.length > 1 } },
      scales: horizontal
        ? { x: { beginAtZero: true, ticks } }
        : { x: { stacked: empile }, y: { beginAtZero: true, stacked: empile, ticks } }
    }
  };
}

/**
 * Un bloc de statistiques en jeu de donnees exportable. Un graphique au
 * choix y joint son image, que le PDF, le Word et le classeur placent avec
 * le tableau.
 */
function blocVersDataset(b) {
  return {
    title: b.titre,
    columns: b.entetes.map((e, i) => ({ key: `c${i}`, label: e || 'Catégorie', width: i === 0 ? 30 : 16 })),
    rows: b.lignes.map((l) => Object.fromEntries(l.map((c, i) => [`c${i}`, c]))),
    ...(b.image ? { image: b.image } : {})
  };
}

/** Un titre de rubrique dans un nom de fichier : sans accent ni espace. */
const nomFichier = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_');

/** Les memes tableaux qu'a l'ecran, chiffres cles compris. */
async function exporter(kind, def, stats, annee) {
  try {
    const periode = annee || 'toutes années';
    const datasets = [
      {
        title: 'Chiffres clés',
        columns: [{ key: 'a', label: 'Indicateur', width: 30 }, { key: 'b', label: 'Valeur', width: 22 }, { key: 'c', label: 'Détail', width: 40 }],
        rows: stats.tuiles.map((t) => ({ a: t.titre, b: t.valeur, c: t.detail }))
      },
      ...stats.blocs.filter((b) => b.lignes.length).map(blocVersDataset)
    ];
    const nom = `PDU_statistiques_${nomFichier(def.titre)}_${annee || 'toutes'}`;
    const res = kind === 'excel'
      ? await exportExcel(datasets, nom)
      : kind === 'word'
        ? await exportWord(datasets, nom, { title: `Statistiques ${def.titre.toLowerCase()} — ${periode}`, orientation: 'p', enchaine: true })
        : await exportPdf(datasets, nom, { title: `Statistiques ${def.titre.toLowerCase()} — ${periode}`, orientation: 'p', enchaine: true });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
