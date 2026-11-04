/* ===================================================================
   Propositions de mots pendant la saisie.

   Des qu'on tape les premieres lettres d'un mot dans un champ de texte,
   une petite liste propose, sous le champ, les mots deja saisis ailleurs
   dans l'application qui commencent ainsi : noms d'agents, stations,
   garages, destinations, observations... Le vocabulaire est celui du parc,
   il s'enrichit de lui-meme a chaque saisie. Les mots que l'on tape le plus
   souvent sur ce poste sont retenus (localStorage) et passent en tete ; un
   dictionnaire francais complete la liste (core/dictionnaire.js).

     Tab ou Entree   prend le mot surligne
     ↑ / ↓           change de mot
     Echap           ferme la liste (le formulaire reste ouvert)

   Laisses de cote : les champs qui ont deja leur propre liste (datalist),
   les montants, et ceux que la majuscule automatique laisse tels quels
   (identifiant, mot de passe, email, recherche...).
   =================================================================== */

import { DB, onChange } from '../core/db.js';
import { norm } from '../core/utils.js';
import { concerne } from './majuscule.js';
import { chargerDictionnaire, motsDuDictionnaire } from '../core/dictionnaire.js';

/** Un mot proposable : au moins quatre lettres, tirets et apostrophes compris. */
const MOT = /[\p{L}][\p{L}\p{M}'’-]{3,}/gu;
/** Ce qu'il faut avoir tape avant qu'une liste s'ouvre. */
const LETTRES_MIN = 2;
const PROPOSITIONS_MAX = 6;

/** Champs de la base qui ne sont pas du texte saisi : rien a y apprendre. */
const CLES_IGNOREES = new Set(['id', 'maj', 'majPar', 'images', 'createdAt', 'hash', 'salt', 'password', 'motDePasse', 'appareil', 'synchro']);

/**
 * Vocabulaire d'une base : chaque mot, avec sa forme la plus frequente et
 * le nombre de fois qu'il apparait.
 * @returns {Map<string, {mot:string, n:number}>} cle sans accent ni casse → mot
 */
export function vocabulaire(base) {
  const formes = new Map();
  const voir = (texte) => {
    if (texte.length > 4000 || texte.startsWith('data:')) return;
    for (const m of texte.matchAll(MOT)) {
      const mot = m[0].replace(/['’-]+$/, '');
      if (mot.length < 4) continue;
      const cle = norm(mot);
      const f = formes.get(cle) || new Map();
      f.set(mot, (f.get(mot) || 0) + 1);
      formes.set(cle, f);
    }
  };
  const parcourir = (x, profondeur) => {
    if (profondeur > 6 || x === null || x === undefined) return;
    if (typeof x === 'string') return voir(x);
    if (Array.isArray(x)) return x.forEach((y) => parcourir(y, profondeur + 1));
    if (typeof x === 'object') {
      Object.keys(x).forEach((k) => { if (!CLES_IGNOREES.has(k)) parcourir(x[k], profondeur + 1); });
    }
  };
  Object.keys(base || {}).forEach((k) => {
    // Les comptes (mots de passe), les reglages et la synchro n'ont pas de vocabulaire.
    if (!['accounts', 'settings', 'synchro', 'meta', 'suiviComptes'].includes(k)) parcourir(base[k], 0);
  });

  const voc = new Map();
  formes.forEach((f, cle) => {
    let mot = '';
    let n = 0;
    let total = 0;
    f.forEach((c, forme) => { total += c; if (c > n) { n = c; mot = forme; } });
    voc.set(cle, { mot, n: total });
  });
  return voc;
}

/**
 * Mots qui commencent par `debut`, les plus utilises d'abord. Le mot deja
 * tape en entier n'est pas repropose.
 *
 * `usage` compte les mots que l'on a soi-meme saisis sur ce poste : ils
 * pesent plus lourd que ceux simplement presents dans la base, et passent
 * donc en tete (voir retenirMots).
 */
export function proposer(voc, debut, max = PROPOSITIONS_MAX, usage = {}, dico = []) {
  const cle = norm(debut);
  if (cle.length < LETTRES_MIN) return [];
  const score = new Map();
  const ajouter = (k, mot, n, sienne) => {
    if (k.length <= cle.length || !k.startsWith(cle)) return;
    const s = score.get(k) || { mot, n: 0 };
    s.n += n;
    // L'ecriture qu'on utilise soi-meme l'emporte sur celle de la base.
    if (sienne) s.mot = mot;
    score.set(k, s);
  };
  voc.forEach((v, k) => ajouter(k, v.mot, v.n, false));
  Object.keys(usage).forEach((k) => ajouter(k, usage[k].mot, USAGE_POIDS * usage[k].n, true));
  const out = [...score.values()]
    .sort((a, b) => b.n - a.n || a.mot.localeCompare(b.mot, 'fr'))
    .slice(0, max)
    .map((v) => v.mot);
  // Le dictionnaire complete, apres les mots du parc et ceux qu'on utilise.
  const vus = new Set(out.map((m) => norm(m)));
  for (const m of dico) {
    if (out.length >= max) break;
    const k = norm(m);
    if (k.length > cle.length && k.startsWith(cle) && !vus.has(k)) { out.push(m); vus.add(k); }
  }
  return out;
}

/** Un mot saisi soi-meme compte comme s'il apparaissait trois fois dans la base. */
const USAGE_POIDS = 3;
/** Au-dela, les mots les moins utilises sont oublies. */
const USAGE_MAX = 3000;

/**
 * Ajoute au compte d'usage les mots d'un texte que l'on vient de saisir.
 * @returns {object} le compte, mis a jour sur place
 */
export function retenirMots(usage, texte) {
  for (const m of String(texte || '').matchAll(MOT)) {
    const mot = m[0].replace(/['’-]+$/, '');
    if (mot.length < 4) continue;
    const cle = norm(mot);
    const u = usage[cle] || { mot, n: 0 };
    u.n += 1;
    u.mot = mot;
    usage[cle] = u;
  }
  const cles = Object.keys(usage);
  if (cles.length > USAGE_MAX) {
    cles.sort((a, b) => usage[a].n - usage[b].n).slice(0, cles.length - USAGE_MAX).forEach((k) => delete usage[k]);
  }
  return usage;
}

/**
 * Le mot propose, ecrit comme on a commence a le taper : « SHE » donne
 * « SHELL », « yam » donne « yamoussoukro », « Yam » donne « Yamoussoukro ».
 */
export function accorder(tape, mot) {
  const lettres = tape.replace(/[^\p{L}]/gu, '');
  if (lettres.length >= 2 && lettres === lettres.toLocaleUpperCase('fr') && lettres !== lettres.toLocaleLowerCase('fr')) {
    return mot.toLocaleUpperCase('fr');
  }
  const premiere = tape.charAt(0);
  const reste = mot.slice(1);
  if (premiere === premiere.toLocaleUpperCase('fr') && premiere !== premiere.toLocaleLowerCase('fr')) {
    return mot.charAt(0).toLocaleUpperCase('fr') + reste;
  }
  return mot.toLocaleLowerCase('fr');
}

/** Le debut de mot juste avant le curseur, et ou il commence. */
export function motEnCours(texte, pos) {
  let debut = pos;
  while (debut > 0 && /[\p{L}\p{M}'’-]/u.test(texte.charAt(debut - 1))) debut -= 1;
  return { debut, mot: texte.slice(debut, pos) };
}

/* ------------------------------ A l'ecran ----------------------------- */

let voc = null;
let liste = null;
let champ = null;
let choix = [];
let actif = 0;
let mot = null;

/** Le vocabulaire se refait a la demande, apres un changement de la base. */
function vocActuel() {
  if (!voc) voc = vocabulaire(DB);
  return voc;
}

/**
 * Mots que l'on utilise le plus, retenus sur ce poste d'une session a
 * l'autre. Sans stockage (navigation privee), la liste vit le temps de la
 * session.
 */
const CLE_USAGE = 'pdu_mots_frequents';
let usage = null;
function usageActuel() {
  if (!usage) {
    try { usage = JSON.parse(localStorage.getItem(CLE_USAGE) || '{}') || {}; } catch (e) { usage = {}; }
  }
  return usage;
}

/** Valeur du champ a l'entree : seuls les mots ajoutes depuis comptent. */
let valeurAvant = '';
function surEntree(e) {
  if (!concerneSuggestions(e.target)) return;
  valeurAvant = e.target.value;
  // Le dictionnaire se charge a la premiere saisie, sans attendre :
  // d'ici la, seuls les mots du parc sont proposes.
  chargerDictionnaire();
}
function surSortie(e) {
  const c = e.target;
  if (c === champ) fermer();
  if (!concerneSuggestions(c) || c.value === valeurAvant) return;
  const deja = new Set([...valeurAvant.matchAll(MOT)].map((m) => norm(m[0])));
  const nouveaux = [...c.value.matchAll(MOT)].map((m) => m[0]).filter((m) => !deja.has(norm(m)));
  valeurAvant = '';
  if (!nouveaux.length) return;
  retenirMots(usageActuel(), nouveaux.join(' '));
  try { localStorage.setItem(CLE_USAGE, JSON.stringify(usage)); } catch (err) { /* stockage indisponible */ }
}

function concerneSuggestions(c) {
  if (!concerne(c)) return false;
  if (c.hasAttribute('list') || c.hasAttribute('data-montant') || c.hasAttribute('data-sans-suggestion')) return false;
  if (c.inputMode === 'numeric' || c.inputMode === 'decimal') return false;
  return true;
}

function fermer() {
  if (liste) liste.remove();
  liste = null;
  choix = [];
  mot = null;
}

function dessiner() {
  if (!liste) {
    liste = document.createElement('div');
    liste.className = 'suggestions';
    liste.setAttribute('role', 'listbox');
    // Un clic dans la liste ne doit pas faire perdre le champ.
    liste.addEventListener('mousedown', (e) => e.preventDefault());
    liste.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) prendre(Number(b.dataset.i));
    });
    document.body.appendChild(liste);
  }
  liste.innerHTML = '';
  choix.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.dataset.i = String(i);
    b.className = i === actif ? 'actif' : '';
    b.textContent = m;
    liste.appendChild(b);
  });
  const aide = document.createElement('small');
  aide.textContent = 'Tab ou Entrée pour choisir · Échap pour fermer';
  liste.appendChild(aide);
  placer();
}

/** Sous le champ, ou au-dessus s'il touche le bas de la fenetre. */
function placer() {
  if (!liste || !champ) return;
  const r = champ.getBoundingClientRect();
  liste.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - liste.offsetWidth - 8))}px`;
  liste.style.minWidth = `${Math.min(r.width, 320)}px`;
  const dessous = r.bottom + 4;
  liste.style.top = dessous + liste.offsetHeight > window.innerHeight - 8
    ? `${Math.max(8, r.top - liste.offsetHeight - 4)}px`
    : `${dessous}px`;
}

function prendre(i) {
  if (!champ || !mot || !choix[i]) return fermer();
  const v = champ.value;
  const neuf = accorder(mot.mot, choix[i]);
  const fin = mot.debut + mot.mot.length;
  champ.value = v.slice(0, mot.debut) + neuf + v.slice(fin);
  const pos = mot.debut + neuf.length;
  champ.setSelectionRange(pos, pos);
  fermer();
  // Les calculs en direct et la majuscule automatique suivent ; la liste,
  // elle, ne se rouvre pas sur le mot qu'on vient de prendre.
  champ.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
}

function surSaisie(e) {
  const c = e.target;
  if (!concerneSuggestions(c)) return fermer();
  if (!e.inputType || !e.inputType.startsWith('insert') || e.inputType === 'insertReplacementText' ||
      e.inputType === 'insertLineBreak') return fermer();
  champ = c;
  const pos = c.selectionStart;
  // Au milieu d'un mot, on ne propose rien : on corrige, on n'ecrit pas.
  if (pos === null || /[\p{L}]/u.test(c.value.charAt(pos))) return fermer();
  mot = motEnCours(c.value, pos);
  choix = proposer(vocActuel(), mot.mot, PROPOSITIONS_MAX, usageActuel(),
    motsDuDictionnaire(mot.mot, PROPOSITIONS_MAX * 2));
  if (!choix.length) return fermer();
  actif = 0;
  dessiner();
}

function surTouche(e) {
  if (!liste || e.target !== champ) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    actif = (actif + (e.key === 'ArrowDown' ? 1 : choix.length - 1)) % choix.length;
    dessiner();
  } else if (e.key === 'Tab' || e.key === 'Enter') {
    if (e.shiftKey) return fermer();
    prendre(actif);
  } else if (e.key === 'Escape') {
    fermer();
  } else {
    return;
  }
  // La touche est pour la liste : ni champ suivant, ni enregistrement du
  // formulaire, ni fermeture de la fenetre.
  e.preventDefault();
  e.stopPropagation();
}

export function installerSuggestions(racine = document) {
  onChange(() => { voc = null; });
  racine.addEventListener('input', surSaisie, true);
  racine.addEventListener('keydown', surTouche, true);
  racine.addEventListener('focusin', surEntree, true);
  racine.addEventListener('focusout', surSortie, true);
  window.addEventListener('resize', fermer);
  racine.addEventListener('scroll', placer, true);
}
