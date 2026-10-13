/* ===================================================================
   RÉGLAGES — SYNCHRONISATION PC ↔ TÉLÉPHONE.

   Sur le PC : « Afficher le code QR » ouvre le serveur local et montre le
   code, puis suit l'avancement jusqu'au compte rendu.
   Sur le telephone : « Scanner le code QR du PC » ouvre la camera, lit le
   code et conduit toute la synchronisation.
   =================================================================== */

import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { appareilSynchro, appareilsSynchronises } from '../../core/db.js';
import { isDesktop } from '../../core/storage.js';
import { contenuQR, lireQR, synchroniserAvecPC } from '../../core/synchroClient.js';
import { LIBELLES_COLLECTIONS } from '../../core/synchro.js';
import { el, esc, fmt } from '../../core/utils.js';
import { card, toolbar, sectionLabel, openModal, toast, COLORS } from '../components.js';
import { rerender } from '../shell.js';

const COULEUR = '#00838F';

const quand = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function renderSynchroSection(page) {
  page.appendChild(sectionLabel('SYNCHRONISATION PC ↔ TÉLÉPHONE', COULEUR));
  const moi = appareilSynchro();
  const autres = appareilsSynchronises();
  page.appendChild(
    card(
      isDesktop ? 'CE PC' : 'CE TÉLÉPHONE',
      (isDesktop
        ? 'Affichez le code QR, puis scannez-le depuis l’application Android (RÉGLAGES → Scanner le code QR du PC). '
        : 'Affichez le code QR sur le PC (RÉGLAGES → Afficher le code QR), puis scannez-le ici. ') +
      'Les deux appareils doivent être sur le même Wi-Fi. Chacun reçoit ce que l’autre a de nouveau, photos comprises ; ' +
      'pour une même fiche modifiée des deux côtés, la modification la plus récente est gardée.\n\n' +
      `Nom de cet appareil : ${moi.nom}\n` +
      (autres.length
        ? `Dernières synchronisations :\n${autres.map((a) => `  • ${a.nom} — ${quand(a.derniere)}`).join('\n')}`
        : 'Aucune synchronisation pour l’instant.'),
      COULEUR
    )
  );
  page.appendChild(
    toolbar([
      isDesktop
        ? { label: '📱 Afficher le code QR', cls: 'addBtn', color: COULEUR, onClick: afficherQR }
        : { label: '📷 Scanner le code QR du PC', cls: 'addBtn', color: COULEUR, onClick: scanner }
    ])
  );
}

/* ================================ PC ================================ */

async function afficherQR() {
  let info;
  try {
    info = await window.pduDesktop.synchroDemarrer();
  } catch (e) {
    toast(`Impossible d’ouvrir la synchronisation : ${e.message || e}`, 'err');
    return;
  }
  if (!info.adresses.length) {
    window.pduDesktop.synchroArreter();
    toast('Ce PC n’est connecté à aucun réseau : connectez-le au Wi-Fi.', 'err');
    return;
  }
  const qr = qrcode(0, 'M');
  qr.addData(contenuQR(info));
  qr.make();

  const corps = el(
    '<div style="text-align:center">' +
      `<div style="background:#fff;display:inline-block;padding:10px;border-radius:12px">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>` +
      '<p style="margin:10px 0 4px"><b>Sur le téléphone :</b> PDU Parc Auto → RÉGLAGES → <b>Scanner le code QR du PC</b></p>' +
      `<p style="margin:0;color:#5b7178"><small>Même Wi-Fi obligatoire · adresse ${esc(info.adresses[0])}:${info.port} · code valable <b data-reste></b></small></p>` +
      '<div data-etat style="margin-top:12px;font-weight:600">En attente du téléphone…</div>' +
      '<div data-rapport style="text-align:left"></div>' +
    '</div>'
  );
  const svg = corps.querySelector('svg');
  if (svg) { svg.style.width = '260px'; svg.style.height = '260px'; svg.style.maxWidth = '70vw'; }
  const zoneEtat = corps.querySelector('[data-etat]');
  const zoneRapport = corps.querySelector('[data-rapport]');
  const reste = corps.querySelector('[data-reste]');
  const compte = () => {
    const s = Math.max(0, Math.round((info.expire - Date.now()) / 1000));
    reste.textContent = s ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : 'expiré';
  };
  compte();
  const horloge = setInterval(compte, 1000);
  let fini = false;

  const desabonner = window.pduDesktop.surEtatSynchro((etat) => {
    if (etat.etape === 'connecte') zoneEtat.textContent = '📱 Téléphone connecté…';
    if (etat.etape === 'fusion') zoneEtat.textContent = '🔄 Fusion des données…';
    if (etat.etape === 'fusionne') {
      zoneEtat.textContent = '🖼️ Échange des photos…';
      zoneRapport.innerHTML = rapportHtml(etat.rapport, etat.autre && etat.autre.nom, 'le téléphone');
    }
    if (etat.etape === 'termine') {
      fini = true;
      const im = etat.images || {};
      zoneEtat.innerHTML = `✅ Synchronisation terminée.${im.recues || im.envoyees ? ` Photos : ${fmt(im.recues || 0)} reçue(s), ${fmt(im.envoyees || 0)} envoyée(s).` : ''}`;
      corps.querySelector('svg') && (corps.querySelector('svg').parentNode.style.display = 'none');
    }
    if (etat.etape === 'erreur') zoneEtat.textContent = `⚠ ${etat.message}`;
    if (etat.etape === 'arrete' && !fini) zoneEtat.textContent = 'Code expiré : fermez et affichez-en un nouveau.';
  });

  openModal({
    title: 'Synchroniser avec le téléphone',
    bodyNode: corps,
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }],
    onClose: () => {
      clearInterval(horloge);
      desabonner();
      window.pduDesktop.synchroArreter();
      rerender();
    }
  });
}

/* ============================ Telephone ============================ */

async function scanner() {
  const corps = el(
    '<div style="text-align:center">' +
      '<div data-camera style="position:relative;max-width:420px;margin:0 auto">' +
        '<video playsinline muted style="width:100%;border-radius:12px;background:#000"></video>' +
        '<div style="position:absolute;inset:18%;border:3px solid rgba(255,255,255,.85);border-radius:14px"></div>' +
      '</div>' +
      '<div data-etat style="margin-top:10px;font-weight:600">Visez le code QR affiché sur le PC.</div>' +
      '<div data-rapport style="text-align:left"></div>' +
      '<details style="margin-top:10px;text-align:left"><summary><small>La caméra ne fonctionne pas ? Saisir le code à la main</small></summary>' +
        '<textarea data-manuel rows="3" style="width:100%;margin-top:6px" placeholder="Collez ici le texte du code (PDU-SYNC:…)"></textarea>' +
        `<button type="button" class="miniBtn" data-valider style="background:${COULEUR};margin-top:4px">Synchroniser</button>` +
      '</details>' +
    '</div>'
  );
  const video = corps.querySelector('video');
  const zoneEtat = corps.querySelector('[data-etat]');
  const zoneRapport = corps.querySelector('[data-rapport]');
  const toile = document.createElement('canvas');
  const ctx = toile.getContext('2d', { willReadFrequently: true });
  let flux = null;
  let boucle = null;
  let enCours = false;

  const arreterCamera = () => {
    if (boucle) cancelAnimationFrame(boucle);
    boucle = null;
    if (flux) flux.getTracks().forEach((t) => t.stop());
    flux = null;
  };

  const lancer = async (texte) => {
    if (enCours) return;
    const qr = lireQR(texte);
    if (!qr) { zoneEtat.textContent = 'Ce code n’est pas un code de synchronisation PDU Parc Auto.'; return; }
    enCours = true;
    arreterCamera();
    corps.querySelector('[data-camera]').style.display = 'none';
    try {
      const r = await synchroniserAvecPC(qr, (etape) => { zoneEtat.textContent = etape; });
      zoneEtat.innerHTML = `✅ Synchronisation terminée avec ${esc(r.pc.nom || qr.nom)}.` +
        `${r.images.recues || r.images.envoyees ? ` Photos : ${fmt(r.images.recues)} reçue(s), ${fmt(r.images.envoyees)} envoyée(s).` : ''}`;
      zoneRapport.innerHTML = rapportHtml(r.rapport, r.pc.nom || qr.nom, 'le PC');
    } catch (e) {
      zoneEtat.textContent = `⚠ ${e.message || e}`;
      enCours = false;
    }
  };

  corps.querySelector('[data-valider]').onclick = () => lancer(corps.querySelector('[data-manuel]').value);

  openModal({
    title: 'Scanner le code QR du PC',
    bodyNode: corps,
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }],
    onClose: () => { arreterCamera(); rerender(); }
  });

  // La camera arriere ; le navigateur (ou Android) demande l'autorisation.
  try {
    flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = flux;
    await video.play();
    const lire = () => {
      if (!flux) return;
      if (video.readyState >= 2 && video.videoWidth) {
        toile.width = video.videoWidth;
        toile.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const image = ctx.getImageData(0, 0, toile.width, toile.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) { lancer(code.data); return; }
      }
      boucle = requestAnimationFrame(lire);
    };
    lire();
  } catch (e) {
    corps.querySelector('[data-camera]').style.display = 'none';
    zoneEtat.textContent = 'Caméra indisponible : autorisez-la pour PDU Parc Auto, ou saisissez le code à la main ci-dessous.';
    corps.querySelector('details').open = true;
  }
}

/* ============================ Compte rendu ============================ */

/**
 * Ce qu'on a recu et envoye, collection par collection, et les conflits.
 * @param {object} r        compte rendu vu de cet appareil
 * @param {string} nomAutre nom de l'autre appareil
 */
function rapportHtml(r, nomAutre, lAutre) {
  if (!r) return '';
  const lignes = Object.entries(r.parCollection || {})
    .filter(([, v]) => v.recues || v.envoyees || v.supprimees)
    .map(([c, v]) => `<div class="subEntryRow"><span>${esc(LIBELLES_COLLECTIONS[c] || c)}</span>` +
      `<span><b>${fmt(v.recues)}</b> reçue(s) · <b>${fmt(v.envoyees)}</b> envoyée(s)${v.supprimees ? ` · ${fmt(v.supprimees)} supprimée(s)` : ''}</span></div>`)
    .join('');
  const conflits = (r.conflits || []).map((x) =>
    `<div class="subEntryRow"><span>${esc(LIBELLES_COLLECTIONS[x.collection] || x.collection)} — ${esc(x.libelle || '')}</span>` +
    `<span><small>gardée : version ${x.gardee === 'ici' ? 'de cet appareil' : `de ${esc(lAutre)}`} (plus récente)</small></span></div>`).join('');
  return '<div class="subBlock" style="margin-top:12px">' +
    `<h5>Compte rendu — avec ${esc(nomAutre || lAutre)}</h5>` +
    `<div class="subEntryRow"><span><b>Total</b></span><span><b>${fmt(r.recues)}</b> fiche(s) reçue(s) · <b>${fmt(r.envoyees)}</b> envoyée(s)${r.supprimees ? ` · ${fmt(r.supprimees)} supprimée(s)` : ''}</span></div>` +
    (lignes || '<div class="subEntryRow"><span><small>Les deux appareils étaient déjà à jour.</small></span></div>') +
    (conflits ? `<h5 style="margin-top:10px">Modifiées des deux côtés (${(r.conflits || []).length})</h5>${conflits}` : '') +
    '</div>';
}
