/* ===================================================================
   Premiere lettre en majuscule, dans tous les champs de saisie.

   Une seule ecoute pour toute l'application : chaque champ de texte, a
   la saisie, voit sa premiere lettre — et celle de chacune de ses lignes —
   passer en majuscule ; les formulaires l'appliquent encore a
   l'enregistrement (texte colle, valeur choisie dans une liste). Restent tels
   quels les champs ou une majuscule changerait le sens : identifiant,
   mot de passe, adresse email, liens et localisations, recherche, et tout
   champ marque autocapitalize="none".

   Maj + F3 change la casse du texte selectionne (ou du mot sous le
   curseur), comme dans Word : minuscules, Majuscule À Chaque Mot,
   MAJUSCULES.
   =================================================================== */

/**
 * Cles (data-key, id ou name) des champs laisses tels quels. Les contacts
 * aussi : une adresse email y commence souvent une ligne.
 */
const EXCLUS = /^(login|user|identifiant|email|e-?mail|localisation|lien|url|pass(word)?\d*|search|recherche|contacts?|contactPointFocal|telephone)$/i;

/**
 * La premiere lettre du texte et celle de chaque ligne passent en
 * majuscule — apres le tiret ou la puce qui ouvre la ligne : « - pneu
 * usé » devient « - Pneu usé ». Un lien ou une adresse email en debut de
 * ligne restent tels quels. La longueur ne change pas.
 */
export function majusculesInitiales(texte) {
  return String(texte).replace(/(^|\n)([ \t\-–—•*]*)(\S+)/g, (tout, debut, marque, mot) => {
    if (/^(https?:|www\.)/i.test(mot) || mot.includes('@')) return tout;
    const c = mot.charAt(0);
    const C = c.toLocaleUpperCase('fr');
    return c === C ? tout : debut + marque + C + mot.slice(1);
  });
}

export function concerne(champ) {
  if (champ instanceof HTMLTextAreaElement) {
    // rien de plus a verifier
  } else if (champ instanceof HTMLInputElement) {
    // Mot de passe, email, nombre, date... : seulement le texte libre.
    if (champ.type !== 'text') return false;
  } else {
    return false;
  }
  if (champ.readOnly || champ.disabled) return false;
  if ((champ.getAttribute('autocapitalize') || '').toLowerCase() === 'none') return false;
  if (champ.hasAttribute('data-sans-majuscule')) return false;
  const cle = champ.dataset.key || champ.id || champ.name || '';
  return !EXCLUS.test(cle);
}

function majusculeInitiale(e) {
  const champ = e.target;
  if (!concerne(champ)) return;
  // Effacer ne doit pas remettre la majuscule qu'on vient d'oter.
  if (e.inputType && e.inputType.startsWith('delete')) return;
  // Maj + F3 vient de choisir la casse : on ne la reprend pas.
  if (e.inputType === 'insertReplacementText') return;
  const v = champ.value;
  const neuf = majusculesInitiales(v);
  if (neuf === v) return;
  const debut = champ.selectionStart;
  const fin = champ.selectionEnd;
  champ.value = neuf;
  try { champ.setSelectionRange(debut, fin); } catch (err) { /* champ sans curseur */ }
}

/** Le clavier du telephone propose lui-meme la majuscule. */
function clavierMajuscule(e) {
  const champ = e.target;
  if (concerne(champ) && !champ.hasAttribute('autocapitalize')) champ.setAttribute('autocapitalize', 'sentences');
}

/* ------------------------- Maj + F3, comme Word ------------------------ */

/**
 * Casse suivante, dans l'ordre de Word : minuscules → Majuscule À Chaque
 * Mot → MAJUSCULES → minuscules. Un texte melange passe en MAJUSCULES.
 * La longueur ne change pas.
 */
export function changerCasse(texte) {
  const t = String(texte);
  const haut = t.toLocaleUpperCase('fr');
  const bas = t.toLocaleLowerCase('fr');
  if (haut === bas) return t;
  if (t === haut) return bas;
  if (t === bas) {
    // Apres une espace, un tiret, une barre ou une parenthese ; pas apres
    // l'apostrophe : « l'école » donne « L'école », comme dans Word.
    return t.replace(/(^|[\s\-–—/(])(\p{L})/gu, (tout, avant, l) => avant + l.toLocaleUpperCase('fr'));
  }
  return haut;
}

/** Bornes du mot sous le curseur, quand rien n'est selectionne. */
export function motAutour(texte, pos) {
  const lettre = /[\p{L}\p{N}'’-]/u;
  let debut = pos;
  let fin = pos;
  while (debut > 0 && lettre.test(texte.charAt(debut - 1))) debut -= 1;
  while (fin < texte.length && lettre.test(texte.charAt(fin))) fin += 1;
  return [debut, fin];
}

/** Un champ ou l'on tape du texte : tous, sauf mot de passe, nombre, date… */
function champTexte(champ) {
  if (champ.readOnly || champ.disabled) return false;
  if (champ instanceof HTMLTextAreaElement) return true;
  return champ instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', ''].includes(champ.type);
}

function majF3(e) {
  if (e.key !== 'F3' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const champ = e.target;
  if (!champTexte(champ)) return;
  e.preventDefault();

  let debut = champ.selectionStart;
  let fin = champ.selectionEnd;
  const v = champ.value;
  // Rien de selectionne : le mot sous le curseur, comme Word.
  if (debut === fin) [debut, fin] = motAutour(v, debut);
  if (debut === fin) return;

  const neuf = changerCasse(v.slice(debut, fin));
  champ.value = v.slice(0, debut) + neuf + v.slice(fin);
  // La selection reste posee : un second Maj + F3 passe a la casse suivante.
  champ.setSelectionRange(debut, fin);
  // Les calculs et filtres en direct suivent, sans que la majuscule
  // automatique ne vienne reprendre ce qu'on vient de choisir.
  champ.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
}

export function installerMajuscule(racine = document) {
  racine.addEventListener('input', majusculeInitiale, true);
  racine.addEventListener('focusin', clavierMajuscule, true);
  racine.addEventListener('keydown', majF3, true);
}
