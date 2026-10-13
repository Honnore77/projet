/* ===================================================================
   FICHE UTILISATEUR — la carte d'identite d'un agent, a l'image de la
   fiche vehicule : sa photo, ses informations, son activite et tout ce
   que les autres rubriques savent de lui.
   =================================================================== */

import { DB } from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { el, esc } from '../../core/utils.js';
import { urlImage, octetsImage } from '../../core/images.js';
import { card, toolbar, statTile, sectionLabel, dataTable, toast, openModal, COLORS } from '../components.js';
import { state, navigate } from '../shell.js';
import { openUserForm } from './users.js';
import { exportExcel } from '../../export/excel.js';
import {
  dossierAgent, infosAgent, activiteAgent, historiquesAgent, exportFicheAgentPdf, datasetsFicheAgent
} from '../../export/ficheUtilisateur.js';

export function renderUserSheet(page) {
  const u = DB.users.find((x) => x.id === state.userSheetId);

  page.appendChild(
    toolbar([
      { label: '← Retour aux utilisateurs', color: COLORS.blue, onClick: () => { state.sub.UTILISATEURS = 'liste'; navigate('UTILISATEURS'); } },
      canWrite() && u && { label: '✎ Modifier l’utilisateur', color: COLORS.green, write: true, onClick: () => openUserForm(u) },
      u && { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', u) },
      u && { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', u) }
    ])
  );

  if (!u) {
    page.appendChild(card('Utilisateur introuvable', 'Cette fiche a peut-être été supprimée.', COLORS.orange));
    return;
  }

  const d = dossierAgent(u);
  page.appendChild(carteIdentite(u, d));

  const couleurs = [COLORS.purple, COLORS.orange, COLORS.red];
  const grid = el('<div class="statGrid"></div>');
  activiteAgent(d).forEach((a, i) => grid.appendChild(statTile(a.titre, a.valeur, a.detail, couleurs[i])));
  page.appendChild(grid);

  historiquesAgent(d).forEach((h) => {
    page.appendChild(sectionLabel(`${h.titre.toUpperCase()} (${h.lignes.length})`, COLORS.blue));
    page.appendChild(dataTable(h.entetes, h.lignes.map((l) => l.map((c) => esc(c === undefined || c === null ? '' : String(c))))));
  });

  // Les autres photos et documents de l'agent (permis…), apres la premiere.
  const autres = (u.images || []).slice(1);
  if (autres.length) {
    page.appendChild(sectionLabel(`PHOTOS ET DOCUMENTS (${autres.length})`, COLORS.blue));
    const zone = el('<div class="imgChamp"><div class="imgGalerie"></div></div>');
    autres.forEach((img) => {
      const fig = el(`<figure class="imgVignette"><span class="imgAbsente">chargement…</span><figcaption>${esc(img.nom || '')}</figcaption></figure>`);
      zone.firstChild.appendChild(fig);
      urlImage(img.id).then((url) => {
        if (!url) { fig.querySelector('.imgAbsente').textContent = 'introuvable'; return; }
        const vue = el(`<img src="${url}" alt="${esc(img.nom || '')}">`);
        vue.onclick = () => agrandir(img, url);
        fig.replaceChild(vue, fig.querySelector('.imgAbsente'));
      });
    });
    page.appendChild(zone);
  }
}

/**
 * Photo de l'agent a gauche, ses informations a droite ; sur un ecran
 * etroit, la photo passe au-dessus. La photo est la premiere de sa fiche.
 */
function carteIdentite(u, d) {
  const actif = u.statut === 'Actif';
  const couleur = actif ? COLORS.green : COLORS.red;
  const photos = u.images || [];
  // Fonction, statut et pool sont deja dans le titre et les badges.
  const lignes = infosAgent(u, d).filter((l) => !['Fonction au PDU', 'Statut', 'Conducteur du pool'].includes(l.libelle));
  const carte = el(
    `<div class="card" style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;border-left:5px solid ${couleur}">` +
      '<div style="flex:0 0 170px;max-width:100%">' +
        '<div data-photo style="width:170px;max-width:100%;aspect-ratio:4/5;border-radius:10px;overflow:hidden;' +
          'background:#eef2f3;display:flex;align-items:center;justify-content:center;color:#8aa0a6;text-align:center;font-size:13px">' +
          (photos.length ? 'chargement…' : '👤<br>Aucune photo<br><small>« Modifier l’utilisateur » pour en ajouter</small>') +
        '</div>' +
      '</div>' +
      '<div style="flex:1 1 280px;min-width:0">' +
        `<h3 style="margin:0;color:${COLORS.blue}">${esc(u.fonction || 'Agent du PDU')}</h3>` +
        `<div style="font-size:1.6em;font-weight:800;margin:2px 0 6px">${esc(d.nom)}</div>` +
        '<div style="margin-bottom:8px">' +
          `<span class="badge" style="background:${couleur}">${esc(u.statut || '')}</span> ` +
          (u.poolConducteur === 'Oui' ? `<span class="badge" style="background:${COLORS.purple}">🔁 Conducteur du pool</span> ` : '') +
          (d.absenceEnCours
            ? `<span class="badge" style="background:${COLORS.red}">⛔ ${esc(d.absenceEnCours.motif || 'Absent')}</span>`
            : '') +
        '</div>' +
        '<div style="display:grid;grid-template-columns:minmax(130px,auto) 1fr;gap:3px 14px;font-size:13.5px">' +
          lignes.map((l) => `<span style="color:#5b7178">${esc(l.libelle)}</span>` +
            `<b style="overflow-wrap:anywhere;white-space:pre-line">${esc(l.valeur)}</b>`).join('') +
        '</div>' +
        (u.observations ? `<p style="margin:10px 0 0"><span style="color:#5b7178">Observations : </span>${esc(u.observations)}</p>` : '') +
      '</div>' +
    '</div>'
  );
  if (photos.length) {
    const cadre = carte.querySelector('[data-photo]');
    urlImage(photos[0].id).then((url) => {
      if (!url) { cadre.textContent = 'photo introuvable'; return; }
      const img = el(`<img src="${url}" alt="${esc(photos[0].nom || '')}" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in">`);
      img.onclick = () => agrandir(photos[0], url);
      cadre.innerHTML = '';
      cadre.appendChild(img);
    });
  }
  return carte;
}

function agrandir(img, url) {
  openModal({
    title: img.nom || 'Image',
    bodyNode: el(`<div style="text-align:center"><img src="${url}" alt="${esc(img.nom || '')}" style="max-width:100%;max-height:70vh;border-radius:10px"></div>`),
    buttons: [{ label: 'Fermer', cls: 'ok', onClick: (close) => close() }]
  });
}

async function doExport(kind, u) {
  try {
    const nom = `PDU_fiche_${`${u.nom || ''}_${u.prenoms || ''}`
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+$/, '') || 'utilisateur'}`;
    let res;
    if (kind === 'pdf') {
      const premiere = (u.images || [])[0];
      const photo = premiere ? await octetsImage(premiere.id) : null;
      res = await exportFicheAgentPdf(u, photo, nom);
    } else {
      res = await exportExcel(datasetsFicheAgent(u), nom);
    }
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
