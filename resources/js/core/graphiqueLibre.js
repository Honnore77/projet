/* ===================================================================
   GRAPHIQUE AU CHOIX — les calculs, sans affichage.

   Chaque rubrique prete ses tableaux (les memes jeux de donnees que ses
   exports). On choisit un tableau, la colonne qui regroupe les lignes
   (Marque, Conducteur, Station… ou une date, regroupee par mois) et ce
   qu'on mesure : le nombre de lignes, ou la somme ou la moyenne d'une
   colonne chiffree (Montant, Quantité, Km…).
   =================================================================== */

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Une date telle que les exports l'ecrivent : 03/08/2026. */
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})/;

const vide = (v) => v === '' || v === undefined || v === null;

/** Au-dela, les plus petites categories se rangent sous « autres ». */
export const LIMITE_CATEGORIES = 15;

/**
 * L'annee d'une ligne : le premier groupe de quatre chiffres de sa colonne
 * de date (« 03/08/2026 » ou « 03/08/2026 - 05/08/2026 » → 2026).
 */
export function anneeDeLigne(row, colonneDate) {
  const m = /(\d{4})/.exec(String(row[colonneDate] || ''));
  return m ? m[1] : '';
}

/** Les lignes d'une annee ('' : toutes). Un tableau sans date les garde toutes. */
export function lignesDeLAnnee(rows, colonneDate, annee) {
  if (!annee || !colonneDate) return rows.slice();
  return rows.filter((r) => anneeDeLigne(r, colonneDate) === annee);
}

/**
 * Ce que chaque colonne permet : regrouper (texte, date par mois, petit
 * nombre de valeurs) et/ou mesurer (nombres).
 * @returns {{key:string,label:string,date:boolean,chiffree:boolean,regroupe:boolean}[]}
 */
export function analyserColonnes(ds, rows = ds.rows) {
  return ds.columns.map((c) => {
    const valeurs = rows.map((r) => r[c.key]).filter((v) => !vide(v));
    const date = valeurs.length > 0 && valeurs.every((v) => DATE.test(String(v)));
    const chiffree = valeurs.length > 0 && valeurs.every((v) => typeof v === 'number' && isFinite(v));
    // Un nombre ne regroupe que s'il prend peu de valeurs (jours, participants).
    const distinctes = new Set(valeurs.map(String)).size;
    const regroupe = date || !chiffree || distinctes <= LIMITE_CATEGORIES;
    // Une valeur par ligne (Référence, N° de châssis) : chaque groupe ne
    // compterait qu'une ligne. On la propose, mais pas d'office.
    const unique = valeurs.length > 1 && distinctes === valeurs.length;
    return { key: c.key, label: c.label, date, chiffree, regroupe, unique };
  });
}

/** Mesures proposees : le nombre de lignes, puis somme et moyenne de chaque colonne chiffree. */
export function mesuresPossibles(colonnes) {
  return [
    { value: 'nombre', label: 'Nombre de lignes' },
    ...colonnes.filter((c) => c.chiffree).flatMap((c) => [
      { value: `somme:${c.key}`, label: `Somme — ${c.label}` },
      { value: `moyenne:${c.key}`, label: `Moyenne — ${c.label}` }
    ])
  ];
}

/** Libelle d'une mesure, pour l'en-tete du tableau et la legende. */
export function libelleMesure(mesure, colonnes) {
  return (mesuresPossibles(colonnes).find((m) => m.value === mesure) || { label: 'Nombre de lignes' }).label;
}

/**
 * Regroupe les lignes et mesure chaque groupe.
 *
 * Une colonne de date se regroupe par mois, dans l'ordre du calendrier ;
 * les autres de la plus grande valeur a la plus petite, les dernieres sous
 * « autres » au-dela de LIMITE_CATEGORIES.
 *
 * @param {object[]} rows
 * @param {{key:string,date:boolean}} colonne  la colonne qui regroupe
 * @param {string} mesure  'nombre' | 'somme:<cle>' | 'moyenne:<cle>'
 * @param {{annee?:string}} [opts]  une annee choisie : les mois sans l'annee
 * @returns {{libelles:string[], valeurs:number[], total:number}}
 */
export function regrouper(rows, colonne, mesure, { annee = '' } = {}) {
  const [genre, cle] = mesure.split(':');
  const groupes = new Map();
  rows.forEach((r) => {
    const brut = r[colonne.key];
    let k;
    if (colonne.date) {
      const m = DATE.exec(String(brut || ''));
      k = m ? `${m[3]}-${m[2]}` : 'non renseigné';
    } else {
      k = vide(brut) ? 'non renseigné' : String(brut).trim() || 'non renseigné';
    }
    const g = groupes.get(k) || { n: 0, s: 0, m: 0 };
    g.n += 1;
    if (genre !== 'nombre') {
      const v = r[cle];
      if (typeof v === 'number' && isFinite(v)) { g.s += v; g.m += 1; }
    }
    groupes.set(k, g);
  });

  const mesurer = (g) => (genre === 'nombre' ? g.n : genre === 'somme' ? g.s : g.m ? g.s / g.m : 0);
  let entrees = [...groupes.entries()];

  if (colonne.date) {
    // Pas de trou dans le calendrier : une annee donnee a ses douze mois,
    // sinon chaque mois entre le premier et le dernier, meme vide.
    const mois = entrees.map(([k]) => k).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
    if (mois.length) {
      let [a, m] = (annee ? `${annee}-01` : mois[0]).split('-').map(Number);
      const fin = annee ? `${annee}-12` : mois[mois.length - 1];
      for (let k = ''; k !== fin; m += 1) {
        if (m > 12) { m = 1; a += 1; }
        k = `${a}-${String(m).padStart(2, '0')}`;
        if (!groupes.has(k)) entrees.push([k, { n: 0, s: 0, m: 0 }]);
      }
    }
    // Les mois dans l'ordre ; les lignes sans date a la fin.
    entrees.sort((a, b) => (a[0] === 'non renseigné') - (b[0] === 'non renseigné') || a[0].localeCompare(b[0]));
  } else {
    entrees.sort((a, b) => mesurer(b[1]) - mesurer(a[1]) || a[0].localeCompare(b[0], 'fr'));
    if (entrees.length > LIMITE_CATEGORIES) {
      const reste = entrees.slice(LIMITE_CATEGORIES - 1).reduce(
        (t, [, g]) => ({ n: t.n + g.n, s: t.s + g.s, m: t.m + g.m }), { n: 0, s: 0, m: 0 }
      );
      entrees = [...entrees.slice(0, LIMITE_CATEGORIES - 1), ['autres', reste]];
    }
  }

  const libelle = (k) => {
    if (!colonne.date || !/^\d{4}-\d{2}$/.test(k)) return k;
    const mois = MOIS[Number(k.slice(5)) - 1];
    return annee ? mois : `${mois} ${k.slice(0, 4)}`;
  };
  // Une moyenne se lit a deux decimales au plus.
  const valeurs = entrees.map(([, g]) => Math.round(mesurer(g) * 100) / 100);
  return {
    libelles: entrees.map(([k]) => libelle(k)),
    valeurs,
    total: genre === 'moyenne' ? null : valeurs.reduce((t, v) => t + v, 0)
  };
}
