/* ===================================================================
   PASTILLE D'ALERTES — sur le raccourci du bureau et la barre des taches.

   Windows n'affiche pas de compteur sur un raccourci : son icone est un
   fichier. On redessine donc l'icone — le logo et, s'il y a des alertes,
   une pastille rouge portant leur nombre — et le PC l'applique au
   raccourci « PDU Parc Auto » du bureau (electron/main.cjs). Sans alerte,
   le raccourci reprend son icone d'origine.

   Le nombre est celui de la case ALERTES du tableau de bord. Il se
   recalcule a chaque changement de la base, et toutes les heures : une
   alerte peut naitre du seul passage du temps (immobilisation trop
   longue, mission impayee depuis trop longtemps).
   =================================================================== */

import { computeAlerts, onChange } from '../core/db.js';
import { debounce } from '../core/utils.js';

/** Le nombre d'alertes du tableau de bord (« RAS » vaut zero). */
export function nombreAlertes() {
  return computeAlerts().filter((a) => a.level !== 'ok').length;
}

const TAILLES = [256, 64, 48, 32, 24, 16];
const ROUGE = '#D32F2F';

function chargerLogo() {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = ko;
    img.src = './icons/icon-512.png';
  });
}

/** Pastille rouge cerclee de blanc, le nombre au centre. */
function dessinerPastille(g, cx, cy, r, n) {
  const texte = n > 99 ? '99+' : String(n);
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.beginPath();
  g.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
  g.fillStyle = ROUGE;
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const corps = r * (texte.length > 2 ? 0.8 : texte.length > 1 ? 1.0 : 1.25);
  g.font = `bold ${Math.round(corps)}px Arial, sans-serif`;
  g.fillText(texte, cx, cy + r * 0.06);
}

function versPng(toile) {
  return new Promise((ok) => toile.toBlob(async (b) => ok(new Uint8Array(await b.arrayBuffer())), 'image/png'));
}

/** Le logo a une taille donnee, avec sa pastille en haut a droite. */
async function imageAvecPastille(logo, taille, n) {
  const t = document.createElement('canvas');
  t.width = taille;
  t.height = taille;
  const g = t.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(logo, 0, 0, taille, taille);
  // Assez grosse pour se lire sur une petite icone du bureau.
  const r = taille * 0.27;
  dessinerPastille(g, taille - r, r, r, n);
  return versPng(t);
}

/**
 * Fichier .ico fait d'images PNG (admis depuis Windows Vista) : une
 * entete, un repertoire, puis les images bout a bout.
 */
export function assemblerIco(images) {
  const entete = 6 + 16 * images.length;
  const total = entete + images.reduce((s, i) => s + i.png.length, 0);
  const ico = new Uint8Array(total);
  const v = new DataView(ico.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);
  let pos = entete;
  images.forEach((img, k) => {
    const e = 6 + 16 * k;
    ico[e] = img.taille >= 256 ? 0 : img.taille;
    ico[e + 1] = img.taille >= 256 ? 0 : img.taille;
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, img.png.length, true);
    v.setUint32(e + 12, pos, true);
    ico.set(img.png, pos);
    pos += img.png.length;
  });
  return ico;
}

async function icones(n) {
  const logo = await chargerLogo();
  const images = [];
  for (const taille of TAILLES) images.push({ taille, png: await imageAvecPastille(logo, taille, n) });
  // La barre des taches pose une petite image par-dessus le bouton de la
  // fenetre : la pastille seule.
  const t = document.createElement('canvas');
  t.width = 32;
  t.height = 32;
  dessinerPastille(t.getContext('2d'), 16, 16, 16, n);
  return { ico: assemblerIco(images), seule: await versPng(t) };
}

let dernier = null;

/** Met la pastille a jour maintenant, puis a chaque changement. */
export function suivrePastille() {
  const api = typeof window !== 'undefined' && window.pduDesktop;
  if (!api || !api.pastilleAlertes) return;
  const maj = async () => {
    const n = nombreAlertes();
    if (n === dernier) return;
    dernier = n;
    try {
      const { ico, seule } = n ? await icones(n) : { ico: null, seule: null };
      await api.pastilleAlertes(n, ico, seule);
    } catch (e) {
      console.error('Pastille d’alertes', e);
      dernier = null;
    }
  };
  maj();
  onChange(debounce(maj, 800));
  setInterval(maj, 3600 * 1000);
}
