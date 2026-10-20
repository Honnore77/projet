/* Utilitaires partages (web + bureau) */

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Formatage numerique francais. */
export function fmt(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/** Montant en francs CFA. */
export function fmtF(n) {
  return fmt(n) + ' F';
}

export function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * Montant arrondi au franc superieur.
 *
 * Le franc CFA n'a pas de subdivision : un montant a virgule ne se paie pas.
 * L'arrondi se fait vers le haut, jamais au plus proche — c'est la regle du
 * PDU, et arrondir vers le bas ferait payer a la caisse un franc qu'elle n'a
 * pas encaisse.
 *
 * L'arrondi est pose la ou le montant naît (calcul ou saisie), et non a
 * l'affichage : une somme calculee sur des valeurs a virgule ne tomberait pas
 * sur la somme des lignes affichees, et le total afficherait un franc
 * d'ecart que rien dans le tableau n'expliquerait.
 *
 * Ne s'applique qu'aux montants : un volume (litres) ou un kilometrage garde
 * ses decimales.
 */
export function francSup(v) {
  return Math.ceil(num(v));
}

/**
 * Ecriture d'un montant en cours de saisie : les chiffres de la partie
 * entiere groupes par trois, separes d'une espace (3000000 → « 3 000 000 »).
 * Tout ce qui n'est ni chiffre, ni signe, ni virgule est ecarte.
 */
export function grouperMilliers(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[^\d.,-]/g, '');
  if (!s) return '';
  const signe = s.startsWith('-') ? '-' : '';
  const corps = s.replace(/-/g, '');
  const i = corps.search(/[.,]/);
  const entier = (i < 0 ? corps : corps.slice(0, i)).replace(/\D/g, '');
  const decimales = i < 0 ? null : corps.slice(i + 1).replace(/\D/g, '');
  return signe + entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (decimales === null ? '' : `,${decimales}`);
}

/** Valeur d'un montant saisi avec ses espaces : un nombre, ou '' si vide. */
export function lireMontant(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/\s/g, '').replace(',', '.');
  if (!s) return '';
  const n = Number(s);
  return isFinite(n) ? n : '';
}

/** Nombre de jours entre deux dates ISO (yyyy-mm-dd). null si incalculable. */
export function daysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  const a = new Date(d1), b = new Date(d2);
  const diff = Math.round((b - a) / 86400000);
  return isNaN(diff) ? null : diff;
}

/** yyyy-mm-dd -> jj/mm/aaaa (vide si absent). */
export function dateFR(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Cle mois "yyyy-mm" d une date ISO. */
export function monthKey(iso) {
  return iso && iso.length >= 7 ? iso.slice(0, 7) : '';
}

const MOIS = ['janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];
export function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return `${MOIS[Number(m) - 1] || m} ${String(y).slice(2)}`;
}

/** Echappement HTML. */
export function esc(s) {
  return (s === undefined || s === null ? '' : String(s))
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Echappement HTML d'un texte a plusieurs lignes, rendues telles quelles.
 *
 * Un telephone tient sur trois lignes, un motif d'entretien sur autant qu'il
 * en faut : ecrases sur une seule dans un tableau, ils ne se lisent plus.
 */
export function escLignes(s) {
  return esc(s).replace(/\r?\n/g, '<br>');
}

/** Normalisation pour recherche : minuscules, sans accents. */
export function norm(s) {
  return (s === undefined || s === null ? '' : String(s))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Construit un element DOM a partir d une chaine HTML. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Tri stable par cle decroissante (dates ISO ou nombres). */
export function sortDesc(arr, keyFn) {
  return arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const ka = keyFn(a[0]) || '', kb = keyFn(b[0]) || '';
      if (ka === kb) return b[1] - a[1];
      return ka < kb ? 1 : -1;
    })
    .map((x) => x[0]);
}

export function sum(arr, fn) {
  return arr.reduce((s, x) => s + num(fn(x)), 0);
}

/** Regroupe un tableau par cle. */
export function groupBy(arr, keyFn) {
  const out = {};
  arr.forEach((x) => {
    const k = keyFn(x);
    (out[k] = out[k] || []).push(x);
  });
  return out;
}

/**
 * Mention de lieu et de date portee en pied de tous les documents exportes.
 *
 * Un document sorti de l'application circule ensuite seul : la date a laquelle
 * il a ete edite doit y figurer, sans quoi on ne sait plus a quel etat du parc
 * il correspond. La ville vient des reglages, la date est celle du jour.
 *
 * @param {string} ville
 * @returns {string} par exemple « Fait à Abidjan le 28/08/2026 »
 */
export function mentionLieuDate(ville) {
  return `Fait à ${ville || 'Abidjan'} le ${dateFR(todayISO())}`;
}
