/* ===================================================================
   Premiere lettre en majuscule, dans tous les champs de saisie.

   Une seule ecoute pour toute l'application : chaque champ de texte, a
   la saisie, voit sa premiere lettre — et celle de chacune de ses lignes —
   passer en majuscule ; les formulaires l'appliquent encore a
   l'enregistrement (texte colle, valeur choisie dans une liste). Restent tels
   quels les champs ou une majuscule changerait le sens : identifiant,
   mot de passe, adresse email, liens et localisations, recherche, et tout
   champ marque autocapitalize="none".
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

export function installerMajuscule(racine = document) {
  racine.addEventListener('input', majusculeInitiale, true);
  racine.addEventListener('focusin', clavierMajuscule, true);
}
