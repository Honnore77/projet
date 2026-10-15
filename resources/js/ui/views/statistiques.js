/* ===================================================================
   Sous-rubrique STATISTIQUES — la meme page pour chaque rubrique :
   filtre d'annee, chiffres cles, graphiques, tableaux, exports.

   Les chiffres viennent de core/statistiques.js ; cette page ne fait que
   les dessiner, et les exports reprennent exactement les memes tableaux.
   =================================================================== */

import { STATISTIQUES, anneesDisponibles } from '../../core/statistiques.js';
import { el, esc } from '../../core/utils.js';
import { card, toolbar, filterBar, statTile, dataTable, sectionLabel, emptyState, toast, COLORS } from '../components.js';
import { state, rerender, moduleColor } from '../shell.js';
import { chartCardTypes, destroyCharts, colorsFor } from '../charts.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
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
      def.datee
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
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => exporter('excel', def, stats, annee) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => exporter('pdf', def, stats, annee) }
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
      (i === 0 ? `<b>${esc(c)}</b>` : centre(esc(c)))))));
  });

  if (vides.length) {
    page.appendChild(el(`<p style="color:#8aa0a6;margin:10px 4px"><small>Sans données pour cette période : ${vides.map((b) => esc(b.titre)).join(' · ')}.</small></p>`));
  }
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
      ...stats.blocs.filter((b) => b.lignes.length).map((b) => ({
        title: b.titre,
        columns: b.entetes.map((e, i) => ({ key: `c${i}`, label: e || 'Catégorie', width: i === 0 ? 30 : 16 })),
        rows: b.lignes.map((l) => Object.fromEntries(l.map((c, i) => [`c${i}`, c])))
      }))
    ];
    const nom = `PDU_statistiques_${def.titre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}_${annee || 'toutes'}`;
    const res = kind === 'excel'
      ? await exportExcel(datasets, nom)
      : await exportPdf(datasets, nom, { title: `Statistiques ${def.titre.toLowerCase()} — ${periode}`, orientation: 'p', enchaine: true });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
