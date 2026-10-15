/* ===================================================================
   Premiere lettre en majuscule, dans tous les champs de saisie.

   Une seule ecoute pour toute l'application : chaque champ de texte, a
   la saisie, voit sa premiere lettre passer en majuscule. Restent tels
   quels les champs ou une majuscule changerait le sens : identifiant,
   mot de passe, adresse email, liens et localisations, recherche, et tout
   champ marque autocapitalize="none".
   =================================================================== */

/** Cles (data-key, id ou name) des champs laisses tels quels. */
const EXCLUS = /^(login|user|identifiant|email|e-?mail|localisation|lien|url|pass(word)?\d*|search|recherche)$/i;

function concerne(champ) {
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
  const i = v.search(/\S/);
  if (i < 0) return;
  // Un lien colle reste intact.
  if (/^(https?:|www\.)/i.test(v.slice(i))) return;
  const c = v.charAt(i);
  const C = c.toLocaleUpperCase('fr');
  if (c === C) return;
  const debut = champ.selectionStart;
  const fin = champ.selectionEnd;
  champ.value = v.slice(0, i) + C + v.slice(i + 1);
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
