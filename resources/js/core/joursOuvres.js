/* ===================================================================
   Jours ouvres : ceux que comptent les conges et les absences.

   Ne comptent ni les samedis, ni les dimanches, ni les jours feries de
   Cote d'Ivoire :
     fixes      1er janvier, 1er mai, 7 août (independance), 15 août
                (Assomption), 1er novembre (Toussaint), 15 novembre
                (Journee nationale de la paix), 25 decembre (Noël) ;
     Pâques     lundi de Pâques, Ascension, lundi de Pentecôte, calcules
                chaque annee ;
     autres     les fetes musulmanes (Korité, Tabaski, Maouloud...) et
                les jours accordes par decret changent d'une annee a
                l'autre : on les saisit dans RÉGLAGES → PARAMÈTRES
                (settings.joursFeries, dates AAAA-MM-JJ).

   Le module ne connait pas la base : la liste des jours saisis lui est
   passee, il se teste donc tel quel.
   =================================================================== */

/** Jours feries a date fixe : « MM-JJ ». */
const FIXES = ['01-01', '05-01', '08-07', '08-15', '11-01', '11-15', '12-25'];

const iso = (d) => d.toISOString().slice(0, 10);

/** Dimanche de Pâques (calendrier gregorien, methode de Meeus). */
export function paques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(annee, mois - 1, jour));
}

/** Les jours feries calcules d'une annee (fixes et lies a Pâques), en dates ISO. */
export function feriesCalcules(annee) {
  const p = paques(annee).getTime();
  const decale = (n) => iso(new Date(p + n * 86400000));
  return FIXES.map((md) => `${annee}-${md}`).concat([decale(1), decale(39), decale(50)]);
}

/** Les dates saisies a la main, ramenees a AAAA-MM-JJ (JJ/MM/AAAA accepte). */
export function lireJoursFeries(texte) {
  return String(texte || '')
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .map((x) => {
      const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(x);
      if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
      return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '';
    })
    .filter(Boolean);
}

/** Le jour compte-t-il ? Ni samedi, ni dimanche, ni ferie. */
export function estOuvre(jour, autres = []) {
  const d = new Date(`${jour}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const j = d.getUTCDay();
  if (j === 0 || j === 6) return false;
  const annee = d.getUTCFullYear();
  return !feriesCalcules(annee).includes(jour) && !autres.includes(jour);
}

/**
 * Nombre de jours ouvres de `debut` (compris) a `fin` (non comprise) :
 * partir le vendredi et reprendre le lundi fait un jour. null tant qu'une
 * date manque ; 0 si la fin ne vient pas apres le debut.
 */
export function joursOuvres(debut, fin, autres = []) {
  if (!debut || !fin) return null;
  const a = new Date(`${debut}T00:00:00Z`);
  const b = new Date(`${fin}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  let n = 0;
  for (let t = a.getTime(); t < b.getTime(); t += 86400000) {
    if (estOuvre(iso(new Date(t)), autres)) n += 1;
  }
  return n;
}
