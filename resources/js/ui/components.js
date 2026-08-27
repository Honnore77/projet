/* ===================================================================
   Briques d interface reutilisables : modale, formulaire declaratif,
   confirmation, notifications, cartes, tableaux.
   =================================================================== */

import { esc, el } from '../core/utils.js';

export const COLORS = {
  green: '#008A3B',
  orange: '#F47B20',
  blue: '#1976D2',
  red: '#D32F2F',
  purple: '#6A3CB4',
  grey: '#5b7178'
};

/* ------------------------------ Toasts ----------------------------- */

let toastWrap = null;
export function toast(message, kind = 'ok', ms = 2600) {
  if (!toastWrap) {
    toastWrap = el('<div class="toastWrap"></div>');
    document.body.appendChild(toastWrap);
  }
  const t = el(`<div class="toast ${kind}">${esc(message)}</div>`);
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ------------------------------ Modale ----------------------------- */

/**
 * Ouvre une modale generique.
 * @returns {{close:Function, body:HTMLElement, root:HTMLElement}}
 */
export function openModal({ title, bodyHtml = '', bodyNode = null, buttons = [], onClose, wide = false }) {
  const back = el('<div class="modalBack"></div>');
  const modal = el(`
    <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <header><h3>${esc(title)}</h3><button type="button" aria-label="Fermer">&times;</button></header>
      <div class="body"></div>
      <div class="foot"></div>
    </div>`);
  const body = modal.querySelector('.body');
  if (bodyNode) body.appendChild(bodyNode);
  else body.innerHTML = bodyHtml;

  const foot = modal.querySelector('.foot');
  const close = () => {
    document.removeEventListener('keydown', onKey);
    back.remove();
    if (onClose) onClose();
  };

  buttons.forEach((b) => {
    const btn = el(`<button type="button" class="${b.cls || 'ok'}">${esc(b.label)}</button>`);
    btn.onclick = () => b.onClick(close, body);
    foot.appendChild(btn);
  });
  if (!buttons.length) foot.remove();

  modal.querySelector('header button').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  back.appendChild(modal);
  document.body.appendChild(back);
  const firstInput = body.querySelector('input,select,textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);

  return { close, body, root: back };
}

/** Boite de confirmation. @returns {Promise<boolean>} */
export function confirmDialog({ title = 'Confirmation', message, okLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      bodyHtml: `<div class="modalMsg">${esc(message)}</div>`,
      buttons: [
        { label: 'Annuler', cls: 'cancel', onClick: (close) => { answered = true; close(); resolve(false); } },
        { label: okLabel, cls: danger ? 'danger' : 'ok', onClick: (close) => { answered = true; close(); resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

/** Message d information simple. */
export function infoDialog({ title = 'Information', message, html }) {
  return openModal({
    title,
    bodyHtml: html || `<div class="modalMsg">${esc(message)}</div>`,
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }]
  });
}

/* ------------------------- Formulaire declaratif ------------------- */

/**
 * Construit le HTML d un champ.
 * field = { key, label, type, options, list, value, required, full, hint, readonly, placeholder, step }
 */
function fieldHtml(f) {
  const id = `f_${f.key}`;
  const req = f.required ? ' required' : '';
  const ro = f.readonly ? ' readonly' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const val = f.value === undefined || f.value === null ? '' : String(f.value);
  let input;

  switch (f.type) {
    case 'select':
      input =
        `<select id="${id}" data-key="${esc(f.key)}"${req}>` +
        (f.allowEmpty ? `<option value="">${esc(f.emptyLabel || '—')}</option>` : '') +
        (f.options || [])
          .map((o) => {
            const v = typeof o === 'string' ? o : o.value;
            const l = typeof o === 'string' ? o : o.label;
            return `<option value="${esc(v)}"${String(v) === val ? ' selected' : ''}>${esc(l)}</option>`;
          })
          .join('') +
        '</select>';
      break;
    case 'textarea':
      input = `<textarea id="${id}" data-key="${esc(f.key)}"${req}${ro}${ph}>${esc(val)}</textarea>`;
      break;
    case 'number':
      input = `<input id="${id}" data-key="${esc(f.key)}" type="number" inputmode="decimal" step="${f.step || 'any'}" value="${esc(val)}"${req}${ro}${ph}>`;
      break;
    case 'date':
      input = `<input id="${id}" data-key="${esc(f.key)}" type="date" value="${esc(val)}"${req}${ro}>`;
      break;
    case 'password':
      input = `<input id="${id}" data-key="${esc(f.key)}" type="password" autocomplete="new-password" value="${esc(val)}"${req}${ph}>`;
      break;
    case 'static':
      input = `<input id="${id}" data-key="${esc(f.key)}" value="${esc(val)}" readonly>`;
      break;
    default: {
      const listAttr = f.list && f.list.length ? ` list="${id}_list"` : '';
      const datalist =
        f.list && f.list.length
          ? `<datalist id="${id}_list">${f.list.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>`
          : '';
      input = `<input id="${id}" data-key="${esc(f.key)}" type="text" value="${esc(val)}"${req}${ro}${ph}${listAttr}>${datalist}`;
    }
  }

  return (
    `<div class="fRow${f.full ? ' full' : ''}${f.readonly || f.type === 'static' ? ' readonly' : ''}">` +
    `<label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}` +
    (f.hint ? `<span class="hint">${esc(f.hint)}</span>` : '') +
    '</div>'
  );
}

/** Assemble une grille de champs (utilisable hors modale). */
export function buildFieldsNode(fields) {
  const grid = el('<div class="fGrid"></div>');
  grid.innerHTML = fields.map(fieldHtml).join('');
  return grid;
}

/** Lit les valeurs d une grille de champs. */
export function readFields(scope, fields) {
  const out = {};
  fields.forEach((f) => {
    const node = scope.querySelector(`[data-key="${CSS.escape(f.key)}"]`);
    if (!node) return;
    let v = node.value;
    if (f.type === 'number') v = v === '' ? '' : Number(v);
    else if (typeof v === 'string') v = v.trim();
    out[f.key] = v;
  });
  return out;
}

/**
 * Ouvre un formulaire en modale.
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {Array}  cfg.fields
 * @param {string} [cfg.okLabel]
 * @param {string} [cfg.intro] texte d aide affiche au-dessus
 * @param {Function} cfg.onSubmit  (values, helpers) => string|null|Promise — renvoyer un message d erreur bloque la fermeture
 * @param {Function} [cfg.onInput] (values, scope) => void — recalculs en direct
 * @param {Function} [cfg.extra]   (scope) => void — pour greffer des blocs personnalises
 */
export function openForm(cfg) {
  const wrap = el('<div></div>');
  if (cfg.intro) wrap.appendChild(el(`<p class="modalMsg" style="margin:0 0 12px">${esc(cfg.intro)}</p>`));
  const grid = buildFieldsNode(cfg.fields);
  wrap.appendChild(grid);
  const errBox = el('<div class="err" style="text-align:left;margin-top:10px"></div>');
  wrap.appendChild(errBox);

  const modal = openModal({
    title: cfg.title,
    bodyNode: wrap,
    buttons: [
      { label: 'Annuler', cls: 'cancel', onClick: (close) => close() },
      {
        label: cfg.okLabel || 'Enregistrer',
        cls: 'ok',
        onClick: async (close) => {
          const values = readFields(wrap, cfg.fields);
          const missing = cfg.fields.find((f) => f.required && (values[f.key] === '' || values[f.key] === undefined));
          if (missing) {
            errBox.textContent = `« ${missing.label} » est obligatoire.`;
            return;
          }
          errBox.textContent = '';
          let res;
          try {
            res = await cfg.onSubmit(values, { close, scope: wrap });
          } catch (e) {
            console.error(e);
            res = 'Une erreur est survenue.';
          }
          if (typeof res === 'string' && res) {
            errBox.textContent = res;
            return;
          }
          if (res !== false) close();
        }
      }
    ]
  });

  if (cfg.extra) cfg.extra(wrap, modal);
  if (cfg.onInput) {
    const handler = () => cfg.onInput(readFields(wrap, cfg.fields), wrap);
    wrap.addEventListener('input', handler);
    wrap.addEventListener('change', handler);
    handler();
  }
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      modal.root.querySelector('.foot .ok').click();
    }
  });
  return modal;
}

/* --------------------------- Blocs de page ------------------------- */

export function card(heading, body, color = COLORS.green) {
  return el(
    `<div class="card" data-search="${esc(String(heading) + ' ' + String(body)).toLowerCase()}">` +
      `<h3 style="color:${color}">${esc(heading)}</h3><p>${esc(body)}</p></div>`
  );
}

export function statTile(k, v, s, color = COLORS.green) {
  return el(
    `<div class="stat" style="border-left-color:${color}">` +
      `<div class="k">${esc(k)}</div><div class="v" style="color:${color}">${esc(v)}</div>` +
      `<div class="s">${esc(s || '')}</div></div>`
  );
}

export function emptyState(text) {
  return el(`<div class="empty">${esc(text)}</div>`);
}

export function groupHeader(left, rightBadge, badgeColor = COLORS.green) {
  return el(
    `<div class="groupHeader" data-search="${esc(String(left)).toLowerCase()}"><span>${esc(left)}</span>` +
      (rightBadge ? `<span class="badge" style="background:${badgeColor}">${esc(rightBadge)}</span>` : '') +
      '</div>'
  );
}

export function sectionLabel(text, color = COLORS.green) {
  return el(`<div class="groupHeader" style="background:#eef2f2;color:${color}"><span>${esc(text)}</span></div>`);
}

/** Barre de boutons (ajout, exports, retour...). */
export function toolbar(buttons) {
  const bar = el('<div class="toolbar"></div>');
  buttons.forEach((b) => {
    if (!b) return;
    const btn = el(
      `<button type="button" class="${b.cls || ''}" style="background:${b.color || COLORS.blue}"${b.write ? ' data-write' : ''}>${esc(b.label)}</button>`
    );
    btn.onclick = b.onClick;
    bar.appendChild(btn);
  });
  return bar;
}

/** Barre de filtres : liste de champs (input/select) rendus a plat. */
export function filterBar(controls) {
  const bar = el('<div class="filterBar"></div>');
  controls.forEach((c) => {
    let node;
    if (c.type === 'select') {
      node = el(
        `<select>${(c.options || [])
          .map((o) => {
            const v = typeof o === 'string' ? o : o.value;
            const l = typeof o === 'string' ? o : o.label;
            return `<option value="${esc(v)}"${String(v) === String(c.value || '') ? ' selected' : ''}>${esc(l)}</option>`;
          })
          .join('')}</select>`
      );
      node.onchange = (e) => c.onChange(e.target.value);
    } else {
      node = el(
        `<input type="${c.type || 'text'}" placeholder="${esc(c.placeholder || '')}" title="${esc(c.title || c.placeholder || '')}" value="${esc(c.value || '')}">`
      );
      if (c.type === 'date') node.onchange = (e) => c.onChange(e.target.value);
      else node.oninput = (e) => c.onChange(e.target.value);
    }
    bar.appendChild(node);
  });
  return bar;
}

/** Onglets secondaires. */
export function subtabs(items, activeKey, onClick, colorMap = {}) {
  const bar = el('<div class="subtabs"></div>');
  items.forEach((it) => {
    const active = it.key === activeKey;
    const b = el(`<button type="button" class="subtab">${esc(it.label)}</button>`);
    b.style.background = active ? colorMap[it.key] || COLORS.green : '#e4ecee';
    b.style.color = active ? '#fff' : '#17313B';
    b.onclick = () => onClick(it.key);
    bar.appendChild(b);
  });
  return bar;
}

/**
 * Tableau de donnees.
 * @param {string[]} headers
 * @param {Array<Array<string>>} rows  cellules en HTML deja echappe
 * @param {Function} [decorate] (tr, index) => void
 */
export function dataTable(headers, rows, decorate) {
  const wrap = el('<div class="tableWrap"></div>');
  const table = el('<table class="dataTable"><thead></thead><tbody></tbody></table>');
  table.querySelector('thead').appendChild(
    el(`<tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>`)
  );
  const tbody = table.querySelector('tbody');
  rows.forEach((cells, i) => {
    const tr = el(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
    if (decorate) decorate(tr, i);
    tbody.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}

/** Ligne cle/valeur dans un sous-bloc. */
export function subRow(left, right = '') {
  return `<div class="subEntryRow"><span>${left}</span>${right ? `<b>${right}</b>` : ''}</div>`;
}

/** Bloc "aucune donnee" dans un sous-bloc. */
export const subEmpty = (t) => `<div class="subEntryRow"><span style="color:#8aa0a6">${esc(t)}</span></div>`;

