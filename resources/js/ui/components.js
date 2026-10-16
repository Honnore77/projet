/* ===================================================================
   Briques d interface reutilisables : modale, formulaire declaratif,
   confirmation, notifications, cartes, tableaux.
   =================================================================== */

import { esc, el } from '../core/utils.js';
import { ajouterImage, urlImage, libererUrl, supprimerImage } from '../core/images.js';
import { voitTout, rubriqueCourante } from '../core/acces.js';
import { isAndroid } from '../core/storage.js';
import { ouvrirFicheLigne, texteEntete } from './ficheLigne.js';
import { envoiDisponible, exporterPourEnvoi, exporterNormalement, messagesExportTus } from '../export/envoi.js';

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
  // Un export parti dans une note n'a ete ni enregistre ni annule (voir envoi.js).
  if (kind !== 'err' && messagesExportTus() && /^(Export|Rapport)/.test(String(message))) return;
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

  buttons.filter((b) => b && !(estPdf(b) && !pdfDisponible())).forEach((b) => {
    const btn = el(`<button type="button" class="${b.cls || 'ok'}">${esc(b.label)}${b.menu ? ' ▾' : ''}</button>`);
    btn.onclick = b.menu
      ? (ev) => { ev.stopPropagation(); ouvrirMenuChoix(btn, b.menu); }
      : () => b.onClick(close, body);
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
 * field = { key, label, type, options, list, value, required, full, hint, readonly, placeholder, step, lignesTiret }
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
    // Liste deroulante dont la derniere entree bascule le champ en saisie
    // libre : on choisit dans la liste, ou on ajoute ce qui manque, sans
    // avoir a deviner qu'un champ texte cachait des suggestions.
    case 'selectAdd': {
      // Une option est une valeur, ou { value, label } quand le libelle
      // affiche doit en dire plus que la valeur enregistree.
      const options = (f.options || []).map((o) =>
        (o && typeof o === 'object' ? { value: String(o.value), label: String(o.label) } : { value: String(o), label: String(o) }));
      const inconnu = val && !options.some((o) => o.value === val);
      input =
        `<select id="${id}" data-key="${esc(f.key)}" data-add-label="${esc(f.addLabel || 'Ajouter…')}"${req}>` +
        `<option value="">${esc(f.emptyLabel || '—')}</option>` +
        options.concat(inconnu ? [{ value: val, label: val }] : [])
          .map((o) => `<option value="${esc(o.value)}"${o.value === val ? ' selected' : ''}>${esc(o.label)}</option>`)
          .join('') +
        `<option value="__ajout__">+ ${esc(f.addLabel || 'Ajouter…')}</option>` +
        '</select>';
      break;
    }
    case 'textarea':
      input =
        `<textarea id="${id}" data-key="${esc(f.key)}"${f.lignesTiret ? ' data-tiret' : ''}` +
        `${f.rows ? ` rows="${Number(f.rows)}"` : ''}${req}${ro}${ph}>${esc(val)}</textarea>`;
      break;
    case 'number':
      input = `<input id="${id}" data-key="${esc(f.key)}" type="number" inputmode="decimal" step="${f.step || 'any'}" value="${esc(val)}"${req}${ro}${ph}>`;
      break;
    case 'date':
      input = `<input id="${id}" data-key="${esc(f.key)}" type="date" value="${esc(val)}"${req}${ro}>`;
      break;
    case 'time':
      input = `<input id="${id}" data-key="${esc(f.key)}" type="time" value="${esc(val)}"${req}${ro}>`;
      break;
    case 'password':
      input = `<input id="${id}" data-key="${esc(f.key)}" type="password" autocomplete="new-password" value="${esc(val)}"${req}${ph}>`;
      break;
    case 'static':
      input = `<input id="${id}" data-key="${esc(f.key)}" value="${esc(val)}" readonly>`;
      break;
    // Les images ne sont pas une valeur de formulaire ordinaire : le champ
    // tient sa propre liste, que `readFields` relit sur l'objet du champ.
    case 'images':
      input =
        `<div class="imgChamp" data-images="${esc(f.key)}">` +
        '<div class="imgGalerie" data-galerie></div>' +
        '<div class="imgBarre">' +
        `<label class="smallBtn" for="${id}">+ Ajouter une image</label>` +
        `<input id="${id}" type="file" accept="image/jpeg,image/png" multiple hidden>` +
        '<span class="imgCompte" data-compte></span>' +
        '</div></div>';
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
  grid.querySelectorAll('select[data-add-label]').forEach(cablerAjout);
  grid.querySelectorAll('textarea[data-tiret]').forEach(cablerTirets);
  fields.filter((f) => f.type === 'images').forEach((f) => {
    const zone = grid.querySelector(`[data-images="${f.key}"]`);
    if (zone) cablerImages(zone, f);
  });
  return grid;
}

/* --------------------------- Champ images -------------------------- */

/**
 * Champ « images » : vignettes, ajout, agrandissement, suppression.
 *
 * La liste vit dans `field.value` — un tableau de fiches d'image — et c'est
 * elle que `readFields` rend. Les octets, eux, ne passent jamais par ici :
 * ils sont ranges par `images.js` a cote de la base, et la fiche ne retient
 * qu'un identifiant.
 *
 * Une image ajoutee est ecrite tout de suite, avant meme que le formulaire
 * soit valide. Annuler laisse donc des octets orphelins : c'est le prix a
 * payer pour afficher la vignette immediatement, et le menage se fait au
 * chargement (voir `imagesOrphelines`). Perdre quelques kilo-octets vaut
 * mieux que perdre la photo qu'on vient de prendre.
 */
function cablerImages(zone, field) {
  const liste = Array.isArray(field.value) ? field.value.slice() : [];
  field.value = liste;

  const galerie = zone.querySelector('[data-galerie]');
  const entree = zone.querySelector('input[type="file"]');
  const compte = zone.querySelector('[data-compte]');
  const urls = [];

  const dessiner = async () => {
    urls.splice(0).forEach(libererUrl);
    galerie.innerHTML = liste.length
      ? ''
      : '<span class="imgVide">Aucune image — les formats JPEG et PNG sont acceptés.</span>';
    compte.textContent = liste.length ? `${liste.length} image(s)` : '';

    for (const img of liste) {
      const url = await urlImage(img.id);
      const vignette = el(
        `<figure class="imgVignette">${
          url ? `<img src="${url}" alt="${esc(img.nom || '')}">` : '<span class="imgAbsente">image introuvable</span>'
        }<figcaption>${esc(img.nom || '')}</figcaption>` +
        '<button type="button" class="imgSuppr" title="Retirer cette image">✕</button></figure>'
      );
      if (url) urls.push(url);

      const vue = vignette.querySelector('img');
      if (vue) vue.onclick = () => agrandirImage(img);

      vignette.querySelector('.imgSuppr').onclick = async () => {
        if (!(await confirmDialog({
          title: 'Retirer l’image',
          message: `Retirer « ${img.nom || 'cette image'} » de la fiche ? Le fichier sera effacé.`,
          okLabel: 'Retirer', danger: true
        }))) return;
        const i = liste.indexOf(img);
        if (i >= 0) liste.splice(i, 1);
        await supprimerImage(img.id);
        dessiner();
      };
      galerie.appendChild(vignette);
    }
  };

  entree.onchange = async () => {
    const fichiers = [...entree.files];
    entree.value = '';
    for (const f of fichiers) {
      try {
        liste.push(await ajouterImage(f));
      } catch (e) {
        toast((e && e.message) || 'Image refusée.', 'err');
      }
    }
    dessiner();
  };

  dessiner();
}

/** Ouvre une image en grand, dans une fenetre par-dessus le formulaire. */
async function agrandirImage(img) {
  const url = await urlImage(img.id);
  if (!url) return toast('Image introuvable.', 'err');
  const corps = el(
    `<div style="text-align:center"><img src="${url}" alt="${esc(img.nom || '')}" ` +
    'style="max-width:100%;max-height:70vh;border-radius:10px"></div>'
  );
  openModal({
    title: img.nom || 'Image',
    bodyNode: corps,
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }],
    onClose: () => libererUrl(url)
  });
}

/**
 * Champ a lignes tiretees : chaque motif, chaque observation tient sur sa
 * ligne, ouverte par un tiret.
 *
 * Entree passe a la ligne suivante en posant le tiret : on enumere sans avoir
 * a le retaper, et les fiches se lisent toutes de la meme facon plutot qu'en
 * un paragraphe ou tout se suit. La touche reste libre — une ligne effacee le
 * reste, et coller un texte deja redige ne le decoupe pas.
 */
function cablerTirets(zone) {
  const TIRET = '- ';

  zone.addEventListener('focus', () => {
    if (!zone.value.trim()) zone.value = TIRET;
  });

  zone.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const { selectionStart: debut, selectionEnd: fin, value } = zone;
    zone.value = `${value.slice(0, debut)}\n${TIRET}${value.slice(fin)}`;
    zone.selectionStart = zone.selectionEnd = debut + 1 + TIRET.length;
    zone.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // A la sortie du champ, les lignes saisies sans tiret en recoivent un : le
  // texte colle depuis ailleurs prend la meme forme que le texte tape ici.
  zone.addEventListener('blur', () => {
    zone.value = normaliserLignesTiret(zone.value);
  });
}

/**
 * Met un texte en lignes tiretees et jette les lignes vides de la fin.
 *
 * Un champ ou l'on est entre sans rien ecrire ne porte que le tiret pose par
 * le formulaire : « - » n'est pas une saisie, c'est un champ vide. La regle
 * vaut aussi a la lecture du formulaire, et pas seulement a la sortie du
 * champ — un enregistrement qui ne passe pas par la sortie du champ y
 * echapperait, et un motif obligatoire se retrouverait rempli d'un tiret.
 */
export function normaliserLignesTiret(valeur) {
  const lignes = String(valeur === undefined || valeur === null ? '' : valeur)
    .split(/\r?\n/)
    .map((l) => l.trim());
  while (lignes.length && !lignes[lignes.length - 1].replace(/^-\s*/, '')) lignes.pop();
  return lignes.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n');
}

/**
 * Remplace la liste par un champ libre quand on choisit « + Ajouter… ».
 * Le champ garde le meme data-key, donc readFields le lit sans rien savoir de
 * la bascule. Le bouton « ↩ » revient a la liste, pour ne pas coincer
 * quelqu'un qui s'est trompe d'entree.
 */
function cablerAjout(select) {
  select.addEventListener('change', () => {
    if (select.value !== '__ajout__') return;
    const libelle = select.dataset.addLabel;
    const options = [...select.options]
      .map((o) => o.value)
      .filter((v) => v && v !== '__ajout__');

    const zone = el('<div class="addField"></div>');
    const saisie = el(`<input type="text" data-key="${select.dataset.key}" placeholder="${esc(libelle)}">`);
    const retour = el('<button type="button" class="miniBtn addBack" title="Revenir à la liste">↩</button>');
    zone.appendChild(saisie);
    zone.appendChild(retour);

    select.replaceWith(zone);
    saisie.focus();

    retour.onclick = () => {
      select.value = '';
      zone.replaceWith(select);
      cablerAjout(select);
      select.focus();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // La valeur saisie rejoint la liste des le champ quitte : on la retrouve
    // dans la liste deroulante si l'on repasse par « ↩ ».
    saisie.addEventListener('change', () => {
      const v = saisie.value.trim();
      if (v && !options.includes(v)) {
        select.appendChild(el(`<option value="${esc(v)}">${esc(v)}</option>`));
      }
    });
  });
}

/** Lit les valeurs d une grille de champs. */
export function readFields(scope, fields) {
  const out = {};
  fields.forEach((f) => {
    // Le champ images tient sa liste sur l'objet du champ, pas dans un
    // element de formulaire : il n'a aucune `value` a lire dans le DOM.
    if (f.type === 'images') {
      out[f.key] = Array.isArray(f.value) ? f.value : [];
      return;
    }
    const node = scope.querySelector(`[data-key="${CSS.escape(f.key)}"]`);
    if (!node) return;
    let v = node.value;
    // Une liste selectAdd laissee sur « + Ajouter… » ne designe aucune valeur.
    if (v === '__ajout__') v = '';
    if (f.type === 'number') v = v === '' ? '' : Number(v);
    else if (f.lignesTiret) v = normaliserLignesTiret(v);
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
    `<div class="stat" style="border-left-color:${color};--c:${color}">` +
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
/**
 * Sur le telephone, l'export PDF est retire : le PC le garde. Les boutons
 * dont le libelle parle de PDF ne sont simplement pas dessines.
 */
export const pdfDisponible = () => !isAndroid;
const estPdf = (b) => !!b && /\bPDF\b/.test(String(b.label || ''));

/**
 * Un bouton d'export (« ⬇ Excel », « ⬇ PDF », « ⬇ Word ») propose aussi
 * d'envoyer le fichier a des comptes, en piece jointe d'une note : chaque
 * choix de sa liste (simple, complet) recoit son « Envoyer à… », et un
 * bouton sans liste en recoit une — Télécharger ou Envoyer à….
 */
function avecEnvoi(b) {
  if (!b || !/^\s*⬇/.test(String(b.label || '')) || !envoiDisponible()) return b;
  const format = String(b.label).replace(/^\s*⬇\s*/, '');
  const choix = b.menu
    ? b.menu.filter(Boolean)
    : [{ label: `Télécharger (${format})`, detail: 'Aperçu, puis enregistrement du fichier', onClick: b.onClick }];
  return Object.assign({}, b, {
    menu: [
      ...choix.map((c) => Object.assign({}, c, { onClick: () => exporterNormalement(c.onClick) })),
      ...choix.map((c) => ({
        label: `📨 Envoyer à… ${b.menu ? `(${c.label.replace(new RegExp(`^${format}\\s*`, 'i'), '') || format})` : ''}`.trim(),
        detail: `${b.menu ? `${c.label} · ` : ''}en pièce jointe d’une note, à un ou plusieurs comptes`,
        envoi: true,
        onClick: () => exporterPourEnvoi(c.onClick)
      }))
    ]
  });
}

export function toolbar(buttons) {
  const bar = el('<div class="toolbar"></div>');
  buttons.map(avecEnvoi).forEach((b) => {
    if (!b || (estPdf(b) && !pdfDisponible())) return;
    const btn = el(
      `<button type="button" class="${b.cls || ''}" style="background:${b.color || COLORS.blue}"${b.write ? ' data-write' : ''}` +
      `${b.menu ? ' aria-haspopup="true" aria-expanded="false"' : ''}>${esc(b.label)}${b.menu ? ' ▾' : ''}</button>`
    );
    // Un bouton a plusieurs variantes (« Excel simple / complet ») ouvre une
    // liste deroulante au lieu d'agir tout de suite.
    btn.onclick = b.menu ? (ev) => { ev.stopPropagation(); ouvrirMenuChoix(btn, b.menu); } : b.onClick;
    bar.appendChild(btn);
  });
  return bar;
}

let menuOuvert = null;

function fermerMenuChoix() {
  if (!menuOuvert) return;
  menuOuvert.menu.remove();
  menuOuvert.bouton.setAttribute('aria-expanded', 'false');
  menuOuvert = null;
  document.removeEventListener('click', fermerMenuChoix);
  document.removeEventListener('keydown', echapMenuChoix);
  window.removeEventListener('resize', fermerMenuChoix);
}

function echapMenuChoix(e) {
  if (e.key === 'Escape') fermerMenuChoix();
}

/**
 * Liste deroulante sous un bouton.
 * @param {HTMLElement} bouton
 * @param {{label:string, detail?:string, onClick:Function}[]} choix
 */
export function ouvrirMenuChoix(bouton, choix) {
  const deja = menuOuvert && menuOuvert.bouton === bouton;
  fermerMenuChoix();
  if (deja) return;
  const menu = el('<div class="menuChoix" role="menu"></div>');
  choix.filter(Boolean).forEach((c) => {
    const ligne = el(
      `<button type="button" role="menuitem" class="menuChoixLigne${c.envoi ? ' envoi' : ''}"><b>${esc(c.label)}</b>` +
      `${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</button>`
    );
    ligne.onclick = () => { fermerMenuChoix(); c.onClick(); };
    menu.appendChild(ligne);
  });
  menu.onclick = (ev) => ev.stopPropagation();
  document.body.appendChild(menu);
  const r = bouton.getBoundingClientRect();
  const largeur = menu.offsetWidth;
  const hauteur = menu.offsetHeight;
  const enBas = r.bottom + 6 + hauteur < window.innerHeight;
  menu.style.top = `${Math.round(enBas ? r.bottom + 6 : Math.max(8, r.top - 6 - hauteur))}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - largeur - 8)))}px`;
  bouton.setAttribute('aria-expanded', 'true');
  menuOuvert = { bouton, menu };
  setTimeout(() => {
    document.addEventListener('click', fermerMenuChoix);
    document.addEventListener('keydown', echapMenuChoix);
    window.addEventListener('resize', fermerMenuChoix);
  }, 0);
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
  // Les statistiques portent sur toute la rubrique : qui n'en voit que ses
  // propres fiches n'y a pas acces.
  items.filter((it) => it.key !== 'stats' || voitTout(rubriqueCourante())).forEach((it) => {
    const active = it.key === activeKey;
    const b = el(`<button type="button" class="subtab">${esc(it.label)}</button>`);
    // La couleur passe par la feuille de style : chaque style d'interface
    // (REGLAGES → Apparence) dessine la sous-rubrique active a sa facon.
    b.classList.toggle('active', active);
    b.style.setProperty('--c', colorMap[it.key] || COLORS.green);
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
export function dataTable(headers, rows, decorate, opts = {}) {
  const wrap = el('<div class="tableWrap"></div>');
  const table = el('<table class="dataTable"><thead></thead><tbody></tbody></table>');
  // Chaque ligne s'ouvre en fiche. Les tableaux qui ont deja la leur
  // (vehicule, agent, demande...) la gardent ; les autres recoivent un
  // bouton « Fiche » dans la colonne d'actions, creee au besoin.
  const sansFiche = (cells) => !/data-sheet|data-fiche|>\s*Fiche\s*</.test(cells.join(''));
  const avecFiche = opts.fiche !== false && rows.some(sansFiche);
  const colonneActions = headers.length && /^\s*(actions?)?\s*$/i.test(headers[headers.length - 1]);
  const entetes = avecFiche && !colonneActions ? headers.concat(['']) : headers;
  table.querySelector('thead').appendChild(
    el(`<tr>${entetes.map((h) => `<th>${h}</th>`).join('')}</tr>`)
  );
  const textes = avecFiche ? entetes.map(texteEntete) : null;
  const tbody = table.querySelector('tbody');
  rows.forEach((cells, i) => {
    const tr = el(`<tr>${(entetes.length > cells.length ? cells.concat(['']) : cells).map((c) => `<td>${c}</td>`).join('')}</tr>`);
    if (decorate) decorate(tr, i);
    if (avecFiche && sansFiche(cells)) {
      const b = el(`<button type="button" class="miniBtn" data-fiche style="background:${COLORS.blue};padding:5px 8px">Fiche</button>`);
      b.onclick = (ev) => { ev.stopPropagation(); ouvrirFicheLigne(tr, textes); };
      const derniere = tr.lastElementChild;
      derniere.style.whiteSpace = 'nowrap';
      derniere.prepend(' ');
      derniere.prepend(b);
    }
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

