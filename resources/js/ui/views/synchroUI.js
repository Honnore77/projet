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
import { card, toolbar, sectionLabel, openModal, toast, confirmDialog, COLORS } from '../components.js';
import { rerender, rafraichirVoyantServeur } from '../shell.js';
import { etatPoste, demarrerPoste, arreterPoste, synchroniserPoste, testerServeur } from '../../core/reseauBureau.js';

const COULEUR = '#00838F';

const quand = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function renderSynchroSection(page) {
  page.appendChild(sectionLabel(isDesktop ? 'SYNCHRONISATION À LA DEMANDE (TÉLÉPHONE OU AUTRE PC)' : 'SYNCHRONISATION PC ↔ TÉLÉPHONE', COULEUR));
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
        : { label: '📷 Scanner le code QR du PC', cls: 'addBtn', color: COULEUR, onClick: scanner },
      // Entre deux PC, sans camera : l'un affiche son code, l'autre le recopie.
      isDesktop && { label: '🔄 Synchroniser avec un autre PC', color: '#1976D2', onClick: synchroAutrePC }
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
      '<p style="margin:6px 0 4px"><b>Sur un autre PC :</b> RÉGLAGES → <b>Synchroniser avec un autre PC</b>, puis recopiez :</p>' +
      `<p style="margin:0 0 6px;font-size:16px">Adresse <b style="font-family:monospace">${esc(info.adresses[0])}:${info.port}</b>` +
        ` · Code <b style="font-family:monospace;letter-spacing:1px">${esc(info.jeton)}</b></p>` +
      `<p style="margin:0;color:#5b7178"><small>Même réseau obligatoire · code valable <b data-reste></b></small></p>` +
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
    if (etat.etape === 'connecte') zoneEtat.textContent = '🔗 Appareil connecté…';
    if (etat.etape === 'fusion') zoneEtat.textContent = '🔄 Fusion des données…';
    if (etat.etape === 'fusionne') {
      zoneEtat.textContent = '🖼️ Échange des photos…';
      zoneRapport.innerHTML = rapportHtml(etat.rapport, etat.autre && etat.autre.nom, 'l’autre appareil');
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
    title: 'Synchroniser avec un téléphone ou un autre PC',
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

/* ===================== Avec un autre PC (a la demande) ===================== */

/**
 * Synchroniser ce PC avec un autre PC, une fois : l'autre affiche son code
 * (« Afficher le code QR »), on recopie ici son adresse et son code. C'est
 * l'echange du telephone, sans camera.
 */
function synchroAutrePC() {
  const corps = el(
    '<div>' +
      '<p class="modalMsg" style="margin:0 0 10px">Sur l’autre PC : RÉGLAGES → <b>Afficher le code QR</b>. ' +
      'Recopiez ici l’adresse et le code affichés sous le code QR.</p>' +
      '<div class="fGrid">' +
        '<div class="fRow"><label>Adresse de l’autre PC</label><input data-adresse placeholder="Ex. 192.168.1.20:52814" autocapitalize="none"></div>' +
        '<div class="fRow"><label>Code</label><input data-code placeholder="Ex. K7P2-9QXM" autocapitalize="none"></div>' +
      '</div>' +
      '<div data-etat style="margin-top:12px;font-weight:600"></div>' +
      '<div data-rapport></div>' +
    '</div>'
  );
  const zoneEtat = corps.querySelector('[data-etat]');
  const zoneRapport = corps.querySelector('[data-rapport]');
  let enCours = false;
  openModal({
    title: 'Synchroniser avec un autre PC',
    bodyNode: corps,
    buttons: [
      { label: 'Fermer', cls: 'cancel', onClick: (close) => { close(); rerender(); } },
      {
        label: '🔄 Synchroniser',
        cls: 'ok',
        onClick: async () => {
          if (enCours) return;
          const saisie = corps.querySelector('[data-adresse]').value.trim().replace(/^https?:\/\//i, '');
          const code = corps.querySelector('[data-code]').value.trim().toUpperCase();
          const m = /^([^:\s/]+):(\d+)$/.exec(saisie);
          if (!m || !code) {
            zoneEtat.textContent = '⚠ Recopiez l’adresse complète (avec les chiffres après « : ») et le code.';
            return;
          }
          enCours = true;
          zoneRapport.innerHTML = '';
          try {
            const res = await synchroniserAvecPC(
              { adresses: [m[1]], port: Number(m[2]), jeton: code, nom: 'Autre PC' },
              (etape) => { zoneEtat.textContent = etape.replace('au PC', 'à l’autre PC'); }
            );
            zoneEtat.textContent = `✅ Synchronisation terminée.${res.images.recues || res.images.envoyees
              ? ` Photos : ${fmt(res.images.recues)} reçue(s), ${fmt(res.images.envoyees)} envoyée(s).` : ''}`;
            zoneRapport.innerHTML = rapportHtml(res.rapport, res.pc && res.pc.nom, 'l’autre PC');
          } catch (e) {
            zoneEtat.textContent = `⚠ ${String((e && e.message) || e).replace(/le téléphone et le PC/g, 'les deux PC').replace(/Wi-Fi/g, 'réseau')}`;
          } finally {
            enCours = false;
          }
        }
      }
    ]
  });
}

/* ============================ Réseau du bureau ============================ */

/**
 * RÉGLAGES → RÉSEAU DU BUREAU (PC seulement) : un PC serveur, des postes
 * relies en continu. Voir core/reseauBureau.js et electron/main.cjs.
 */
export function renderReseauSection(page) {
  if (!isDesktop || !window.pduDesktop.reseauLire) return;
  page.appendChild(sectionLabel('RÉSEAU DU BUREAU — PLUSIEURS PC, UNE SEULE BASE', COULEUR_RESEAU));
  const zone = el('<div></div>');
  page.appendChild(zone);
  window.pduDesktop.reseauLire().then((r) => dessinerReseau(zone, r));
}

const COULEUR_RESEAU = '#1565C0';

const MODES_RESEAU = [
  { k: 'seul', t: 'Ce PC travaille seul', d: 'Sa base reste sur ce PC (synchronisation à la demande possible plus bas).' },
  { k: 'serveur', t: 'Ce PC est le serveur du bureau', d: 'Sa base est la base de référence. Il reste allumé, l’application ouverte, pendant que les postes travaillent.' },
  { k: 'poste', t: 'Ce PC est un poste du bureau', d: 'Il se tient à jour avec le PC serveur, toutes les quelques secondes, sur le réseau local.' }
];

function dessinerReseau(zone, r) {
  zone.innerHTML = '';
  const carte = el(
    `<div class="card" style="border-left:4px solid ${COULEUR_RESEAU}">` +
      `<h3 style="color:${COULEUR_RESEAU}">RÉSEAU DU BUREAU</h3>` +
      '<p>Sans Internet ni cloud : tout passe par le réseau local du bureau (Wi-Fi ou câble). ' +
      'Un PC est le serveur, les autres sont des postes. Chaque poste garde une copie de la base : ' +
      'si le serveur est éteint, il continue de travailler et se remet à jour dès que le serveur revient.</p>' +
      `<div class="reseauModes">${MODES_RESEAU.map((m) =>
        `<label class="reseauMode${r.mode === m.k ? ' choisi' : ''}"><input type="radio" name="modeReseau" value="${m.k}"${r.mode === m.k ? ' checked' : ''}>` +
        `<b>${esc(m.t)}</b><small>${esc(m.d)}</small></label>`).join('')}</div>` +
      '<div data-detail></div>' +
    '</div>'
  );
  zone.appendChild(carte);
  const detail = carte.querySelector('[data-detail]');
  if (r.mode === 'serveur') detailServeur(detail, zone, r);
  else if (r.mode === 'poste') detailPoste(detail, zone, r);

  carte.querySelectorAll('input[name="modeReseau"]').forEach((radio) => {
    radio.onchange = async () => {
      const mode = radio.value;
      if (mode === 'poste') {
        // Le poste se relie une fois l'adresse et le code saisis.
        dessinerReseau(zone, Object.assign({}, r, {
          mode: 'poste', serveur: r.mode === 'poste' ? r.serveur : '', code: r.mode === 'poste' ? r.code : ''
        }));
        return;
      }
      if (mode === 'serveur' && !(await confirmDialog({
        title: 'Ce PC devient le serveur du bureau',
        message: 'Sa base deviendra la base de référence du bureau. Les postes s’y relieront avec l’adresse et le code affichés. Continuer ?',
        okLabel: 'Devenir le serveur'
      }))) { dessinerReseau(zone, r); return; }
      await enregistrerReseau(zone, { mode });
    };
  });
}

async function enregistrerReseau(zone, choix) {
  const suite = await window.pduDesktop.reseauEnregistrer(choix);
  if (suite.mode === 'poste') {
    await demarrerPoste(suite);
    const ok = etatPoste().connecte;
    toast(ok ? 'Poste relié au serveur du bureau.' : 'Réglage enregistré, mais le serveur ne répond pas encore.', ok ? 'ok' : 'info', 4500);
  } else {
    arreterPoste();
    if (suite.mode === 'serveur') {
      toast(suite.actif ? 'Ce PC est maintenant le serveur du bureau.' : `Serveur non démarré : ${suite.erreur}`, suite.actif ? 'ok' : 'err', 5000);
    } else toast('Ce PC travaille seul.', 'ok');
  }
  rafraichirVoyantServeur();
  dessinerReseau(zone, suite);
}

function detailServeur(detail, zone, r) {
  detail.innerHTML =
    `<div class="subBlock" style="margin-top:10px"><h5>${r.actif ? '🟢 Serveur ouvert' : '🔴 Serveur arrêté'}</h5>` +
      (r.actif ? '' : `<div class="subEntryRow"><span style="color:#C62828">${esc(r.erreur || 'Le serveur n’a pas pu démarrer.')}</span></div>`) +
      '<div class="subEntryRow"><span>Sur chaque poste, saisissez :</span></div>' +
      `<div class="subEntryRow"><span>Adresse du serveur</span><b style="font-family:monospace;font-size:16px">${esc(r.adresses[0] || '—')}</b></div>` +
      (r.adresses.length > 1
        ? `<div class="subEntryRow"><span><small>Autres adresses de ce PC</small></span><small>${esc(r.adresses.slice(1).join(', '))}</small></div>`
        : '') +
      `<div class="subEntryRow"><span>Code du bureau</span><b style="font-family:monospace;font-size:16px;letter-spacing:1px">${esc(r.code)}</b></div>` +
      `<div class="subEntryRow"><span><small>Port ${esc(String(r.port))} · ${esc(r.nomPC)}</small></span></div>` +
      '<p class="hint" style="margin-top:8px">Au premier démarrage, Windows peut demander d’autoriser PDU Parc Auto dans le pare-feu : ' +
      'cochez « Réseaux privés » et acceptez. Pour que l’adresse ne change pas, donnez à ce PC une adresse fixe (réglage de la box ou du réseau).</p>' +
      '<button type="button" class="miniBtn" data-code style="background:#5b7178;margin-top:6px">🔑 Changer le code du bureau</button>' +
    '</div>';
  detail.querySelector('[data-code]').onclick = async () => {
    if (!(await confirmDialog({
      title: 'Changer le code du bureau',
      message: 'Les postes ne pourront plus se mettre à jour tant que le nouveau code n’y aura pas été saisi. Continuer ?',
      okLabel: 'Changer le code'
    }))) return;
    const suite = await window.pduDesktop.reseauNouveauCode();
    toast('Nouveau code : saisissez-le sur chaque poste.', 'info', 4500);
    dessinerReseau(zone, suite);
  };
}

function detailPoste(detail, zone, r) {
  const poste = etatPoste();
  detail.innerHTML =
    '<div class="subBlock" style="margin-top:10px">' +
      `<h5>${poste.connecte ? '🟢 Relié au serveur du bureau' : poste.actif ? '🔴 Serveur injoignable' : 'Serveur du bureau'}</h5>` +
      (poste.actif && !poste.connecte && poste.erreur ? `<div class="subEntryRow"><span style="color:#C62828">${esc(poste.erreur)}</span></div>` : '') +
      (poste.derniere ? `<div class="subEntryRow"><span>Dernière mise à jour</span><b>${esc(quand(poste.derniere))}</b></div>` : '') +
      '<div class="fGrid" style="margin-top:8px">' +
        `<div class="fRow"><label>Adresse du PC serveur</label><input data-serveur value="${esc(r.serveur || '')}" placeholder="Ex. 192.168.1.20" autocapitalize="none"></div>` +
        `<div class="fRow"><label>Code du bureau</label><input data-codep value="${esc(r.code || '')}" placeholder="Ex. K7P2-9QXM" autocapitalize="none"></div>` +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
        '<button type="button" class="miniBtn" data-tester style="background:#1976D2">Tester la connexion</button>' +
        '<button type="button" class="miniBtn" data-relier style="background:#008A3B">💾 Enregistrer et relier ce poste</button>' +
        (poste.actif ? '<button type="button" class="miniBtn" data-maintenant style="background:#5b7178">↻ Mettre à jour maintenant</button>' : '') +
      '</div>' +
      '<div data-test style="margin-top:8px;font-weight:600"></div>' +
      '<p class="hint" style="margin-top:8px">Au premier relais, la base de ce poste et celle du serveur sont fusionnées : ' +
      'rien n’est perdu, et ce poste reçoit tout ce que le serveur connaît.</p>' +
    '</div>';
  const lire = () => ({
    serveur: detail.querySelector('[data-serveur]').value.trim(),
    code: detail.querySelector('[data-codep]').value.trim().toUpperCase()
  });
  const test = detail.querySelector('[data-test]');
  detail.querySelector('[data-tester]').onclick = async () => {
    const v = lire();
    test.textContent = 'Connexion…';
    try { test.textContent = `✅ Serveur trouvé : ${await testerServeur(v.serveur, v.code, r.port)}`; } catch (e) { test.textContent = `⚠ ${e.message}`; }
  };
  detail.querySelector('[data-relier]').onclick = async () => {
    const v = lire();
    if (!v.serveur || !v.code) { test.textContent = '⚠ Indiquez l’adresse du serveur et le code du bureau.'; return; }
    test.textContent = 'Connexion…';
    try {
      await testerServeur(v.serveur, v.code, r.port);
    } catch (e) {
      test.textContent = `⚠ ${e.message}`;
      return;
    }
    await enregistrerReseau(zone, { mode: 'poste', serveur: v.serveur, code: v.code });
  };
  const maintenant = detail.querySelector('[data-maintenant]');
  if (maintenant) {
    maintenant.onclick = async () => {
      test.textContent = 'Mise à jour…';
      await synchroniserPoste({ force: true });
      test.textContent = etatPoste().connecte ? '✅ À jour.' : `⚠ ${etatPoste().erreur}`;
    };
  }
}
