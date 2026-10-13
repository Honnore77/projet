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
import { chartCard, destroyCharts, colorsFor } from '../charts.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';

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

  // Les graphiques d'abord, deux par ligne sur un grand ecran.
  const graphiques = el('<div class="chartGrid"></div>');
  pleins.filter((b) => b.graphique).forEach((b) => graphiques.appendChild(chartCard(esc(b.titre), configGraphique(b.graphique))));
  if (graphiques.children.length) page.appendChild(graphiques);

  // Puis le detail chiffre de chaque bloc.
  pleins.forEach((b) => {
    page.appendChild(sectionLabel(b.titre.toUpperCase(), couleur));
    page.appendChild(dataTable(b.entetes.map(esc), b.lignes.map((l) => l.map((c, i) =>
      (i === 0 ? `<b>${esc(c)}</b>` : `<span style="display:block;text-align:right">${esc(c)}</span>`)))));
  });

  if (vides.length) {
    page.appendChild(el(`<p style="color:#8aa0a6;margin:10px 4px"><small>Sans données pour cette période : ${vides.map((b) => esc(b.titre)).join(' · ')}.</small></p>`));
  }
}

/** Configuration Chart.js d'un graphique de bloc. */
function configGraphique(g) {
  if (g.type === 'doughnut') {
    return {
      type: 'doughnut',
      data: { labels: g.libelles, datasets: [{ data: g.series[0].valeurs, backgroundColor: colorsFor(g.libelles.length) }] },
      options: { plugins: { legend: { position: 'right' } } }
    };
  }
  const couleurs = colorsFor(g.series.length);
  return {
    type: 'bar',
    data: {
      labels: g.libelles,
      datasets: g.series.map((s, i) => ({ label: s.nom, data: s.valeurs, backgroundColor: couleurs[i] }))
    },
    options: {
      plugins: { legend: { display: g.series.length > 1 } },
      // Des comptages (missions, passages) ne se lisent pas en demi-unites.
      scales: {
        y: {
          beginAtZero: true,
          ticks: g.series.every((s) => s.valeurs.every((v) => Number.isInteger(v))) ? { precision: 0 } : {}
        }
      }
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
