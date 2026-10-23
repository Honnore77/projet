/* ===================================================================
   Graphiques (Chart.js). Les instances sont detruites a chaque
   redessin de page pour eviter les fuites memoire.
   =================================================================== */

import Chart from 'chart.js/auto';
import { el } from '../core/utils.js';

const PALETTE = ['#008A3B', '#F47B20', '#1976D2', '#6A3CB4', '#D32F2F', '#00A0A0', '#8BC34A', '#FF9800'];

let instances = [];

/** Detruit tous les graphiques de la page precedente. */
export function destroyCharts() {
  instances.forEach((c) => {
    try { c.destroy(); } catch (e) { /* ignore */ }
  });
  instances = [];
}

Chart.defaults.font.family =
  '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = '#5b7178';

/**
 * Cree une carte contenant un graphique.
 * @param {string} title
 * @param {object} config configuration Chart.js
 * @returns {HTMLElement}
 */
export function chartCard(title, config) {
  const card = el(`<div class="chartCard"><h3>${title}</h3><div class="chartBox"><canvas></canvas></div></div>`);
  const canvas = card.querySelector('canvas');
  // Chart.js a besoin que le canvas soit dans le document pour se dimensionner
  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;
    const c = new Chart(canvas, withDefaults(config));
    instances.push(c);
  });
  return card;
}

function withDefaults(config) {
  const base = {
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 12, padding: 10 } } },
      scales: undefined
    }
  };
  const merged = Object.assign({}, config);
  merged.options = Object.assign({}, base.options, config.options || {});
  merged.options.plugins = Object.assign({}, base.options.plugins, (config.options || {}).plugins || {});
  return merged;
}

/**
 * Dessine (ou redessine) un graphique sur un canvas deja dans la page.
 * @param {HTMLCanvasElement} canvas
 * @param {object} config  configuration Chart.js
 * @param {Chart|null} [ancien]  le graphique a remplacer
 * @returns {Chart|null}
 */
export function dessinerGraphique(canvas, config, ancien = null) {
  if (ancien) {
    try { ancien.destroy(); } catch (e) { /* ignore */ }
    instances = instances.filter((c) => c !== ancien);
  }
  if (!canvas.isConnected) return null;
  const c = new Chart(canvas, withDefaults(config));
  instances.push(c);
  return c;
}

/**
 * Image PNG d'un graphique, sur fond blanc (le canvas est transparent),
 * pour les exports.
 * @param {Chart|null} chart
 * @returns {{dataUrl:string, png:Uint8Array, largeur:number, hauteur:number}|null}
 */
export function imageDuGraphique(chart) {
  if (!chart || !chart.canvas || !chart.canvas.width) return null;
  // L'image se lit sur une page entiere : on redessine le graphique en
  // haute definition le temps de le copier, puis on revient a l'ecran.
  const ratioEcran = chart.options.devicePixelRatio;
  chart.options.devicePixelRatio = 3;
  chart.resize();
  chart.draw();
  const src = chart.canvas;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  chart.options.devicePixelRatio = ratioEcran;
  chart.resize();
  chart.draw();
  const dataUrl = c.toDataURL('image/png');
  const bin = atob(dataUrl.split(',')[1]);
  const png = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) png[i] = bin.charCodeAt(i);
  return { dataUrl, png, largeur: c.width, hauteur: c.height };
}

export function colorAt(i) {
  return PALETTE[i % PALETTE.length];
}

export function colorsFor(n) {
  return Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length]);
}

/**
 * Carte de graphique dont on choisit la forme : une liste au-dessus du
 * graphique le redessine dans la forme choisie.
 *
 * @param {string} title                titre (deja echappe)
 * @param {Function} buildConfig        (type) => configuration Chart.js
 * @param {{value:string,label:string}[]} types  formes proposees
 * @param {string} initial              forme de depart
 * @param {Function} [onChange]         (type) => void, pour retenir le choix
 */
export function chartCardTypes(title, buildConfig, types, initial, onChange) {
  const card = el(
    '<div class="chartCard">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">' +
        `<h3 style="margin:0">${title}</h3>` +
        '<select title="Forme du graphique" style="width:auto;padding:3px 6px;font-size:12px"></select>' +
      '</div>' +
      '<div class="chartBox"><canvas></canvas></div>' +
    '</div>'
  );
  const select = card.querySelector('select');
  types.forEach((t) => {
    const o = el(`<option value="${t.value}">${t.label}</option>`);
    select.appendChild(o);
  });
  select.value = types.some((t) => t.value === initial) ? initial : types[0].value;

  const canvas = card.querySelector('canvas');
  let chart = null;
  const dessiner = () => {
    if (!canvas.isConnected) return;
    if (chart) {
      try { chart.destroy(); } catch (e) { /* ignore */ }
      instances = instances.filter((c) => c !== chart);
    }
    chart = new Chart(canvas, withDefaults(buildConfig(select.value)));
    instances.push(chart);
  };
  select.onchange = () => {
    dessiner();
    if (onChange) onChange(select.value);
  };
  requestAnimationFrame(dessiner);
  return card;
}
