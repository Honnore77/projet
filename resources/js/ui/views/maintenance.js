/* ===================================================================
   ENTRETIEN — passages au garage, interventions et retours.
   =================================================================== */

import {
  DB, insert, update, remove, touch, knownImmats, knownDrivers, vehicleByImmat,
  openMaintenance, valeursVehicules, MARQUES, MODELES
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, escLignes, el, fmt, num, norm, dateFR, todayISO, daysBetween, sum, groupBy, francSup } from '../../core/utils.js';
import {
  card, toolbar, filterBar, emptyState, openForm, confirmDialog, toast,
  statTile, groupHeader, sectionLabel, subEmpty, dataTable, COLORS
} from '../components.js';
import { state, rerender } from '../shell.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsMaintenance, dsInterventions } from '../../export/datasets.js';

function ficheFields(m = {}) {
  return [
    { key: 'immat', label: 'Immatriculation', required: true, value: m.immat, list: knownImmats() },
    // Memes listes que la fiche vehicule : c'est le meme parc.
    { key: 'marque', label: 'Marque', type: 'selectAdd', value: m.marque,
      options: valeursVehicules('marque', MARQUES), emptyLabel: '— choisir —', addLabel: 'Autre marque' },
    { key: 'modele', label: 'Modèle', type: 'selectAdd', value: m.modele,
      options: valeursVehicules('modele', MODELES), emptyLabel: '— choisir —', addLabel: 'Autre modèle' },
    { key: 'dateEntree', label: 'Date entrée', type: 'date', required: true, value: m.dateEntree || todayISO() },
    { key: 'kmEntree', label: 'Km entrée', type: 'number', value: m.kmEntree },
    { key: 'conducteurEntree', label: 'Conducteur à l’entrée', value: m.conducteurEntree, list: knownDrivers() },
    // Un passage au garage cumule souvent plusieurs problemes : chacun sur sa
    // ligne, ouverte par un tiret. Entree pose le tiret suivant.
    { key: 'motif', label: 'Motif / problème', type: 'textarea', full: true, required: true,
      lignesTiret: true, value: m.motif,
      hint: 'Une ligne par problème — Entrée ouvre la suivante avec un tiret' },
    { key: 'signalePar', label: 'Signalé par', value: m.signalePar, list: knownDrivers() }
  ];
}

function interventionFields(iv = {}) {
  return [
    { key: 'garage', label: 'Nom du garage', required: true, value: iv.garage, list: [...new Set(DB.maintenance.flatMap((m) => (m.interventions || []).map((x) => x.garage)).filter(Boolean))] },
    { key: 'date', label: 'Date de l’intervention', type: 'date', value: iv.date || todayISO() },
    { key: 'observation', label: 'Observation / diagnostic', type: 'textarea', full: true, value: iv.observation },
    { key: 'travaux', label: 'Travaux effectués', type: 'textarea', full: true, value: iv.travaux },
    { key: 'pieces', label: 'Pièces remplacées', type: 'textarea', full: true, value: iv.pieces },
    { key: 'cout', label: 'Coût (F)', type: 'number', value: iv.cout }
  ];
}

function retourFields(m = {}) {
  return [
    { key: 'dateRetour', label: 'Date de sortie', type: 'date', required: true, value: m.dateRetour || todayISO() },
    { key: 'kmRetour', label: 'Km sortie', type: 'number', value: m.kmRetour },
    { key: 'conducteurRetour', label: 'Conducteur du retour', value: m.conducteurRetour, list: knownDrivers() },
    { key: 'observationRetour', label: 'Observation du conducteur', type: 'textarea', full: true,
      lignesTiret: true, value: m.observationRetour,
      hint: 'Une ligne par observation — Entrée ouvre la suivante avec un tiret' }
  ];
}

export function renderMaintenance(page) {
  const f = state.filters.maintenance;

  page.appendChild(
    card('ENTRETIEN', 'Suivi de tous les véhicules du PDU : entrée au garage, interventions réalisées, retour et durée d’immobilisation.', COLORS.green)
  );

  page.appendChild(
    filterBar([
      {
        type: 'select',
        value: f.etat,
        options: [
          { value: '', label: 'Tous les véhicules' },
          { value: 'garage', label: 'Actuellement au garage' },
          { value: 'sorti', label: 'Sortis (historique clos)' }
        ],
        onChange: (v) => { f.etat = v; rerender(); }
      },
      { type: 'text', placeholder: 'Immatriculation', value: f.immat, onChange: (v) => { f.immat = v; rerender(); } }
    ])
  );

  const totalCout = DB.maintenance.reduce((s, m) => s + sum(m.interventions || [], (iv) => iv.cout), 0);
  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Passages', fmt(DB.maintenance.length), 'fiches enregistrées', COLORS.green));
  grid.appendChild(statTile('Au garage', fmt(openMaintenance().length), 'immobilisations en cours', COLORS.orange));
  grid.appendChild(statTile('Coût total', `${fmt(totalCout)} F`, 'toutes interventions', COLORS.red));
  page.appendChild(grid);

  // Le filtre commande tout ce qui suit : le recapitulatif, le detail et les
  // exports partent de la meme liste. Un tableau qui compterait autre chose
  // que ce qu'on lit dessous, ou un fichier qui contiendrait autre chose que
  // ce qu'on voit a l'ecran, ne serait pas un recapitulatif.
  const retenus = fichesFiltrees(f);

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouvelle fiche d’entretien', cls: 'addBtn', color: COLORS.green, write: true, onClick: () => openFicheForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', retenus) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', retenus) }
    ])
  );

  if (!DB.maintenance.length) {
    page.appendChild(emptyState('Aucun véhicule enregistré au garage.'));
    return;
  }
  if (!retenus.length) {
    page.appendChild(emptyState('Aucun véhicule ne correspond au filtre choisi.'));
    return;
  }

  renderRecapitulatif(page, retenus);

  page.appendChild(sectionLabel('DÉTAIL PAR VÉHICULE', COLORS.green));

  const groups = groupBy(retenus, (m) => m.immat || '(sans immatriculation)');
  Object.keys(groups)
    .sort((a, b) => derniereEntree(groups[b]) - derniereEntree(groups[a]))
    .forEach((immat) => {
      const group = groups[immat];
      const enGarage = group.filter((x) => !x.dateRetour).length;
      const g0 = group[0];
      page.appendChild(
        groupHeader(
          `🚗 ${immat} — ${g0.marque || ''} ${g0.modele || ''}`.trim(),
          `${group.length} passage(s)${enGarage ? ' · au garage' : ''}`,
          enGarage ? COLORS.orange : COLORS.green
        )
      );
      renderMaintenanceEntries(page, group);
    });
}

/** Date d'entree la plus recente d'un groupe de fiches. */
function derniereEntree(group) {
  return Math.max(...group.map((x) => new Date(x.dateEntree || 0).getTime() || 0));
}

/**
 * Fiches retenues par les filtres de la rubrique.
 *
 * Le tri se fait par vehicule et non fiche par fiche : demander « ceux qui
 * sont au garage » veut dire « l'historique des vehicules qui y sont », pas
 * « les seules fiches encore ouvertes ». On verrait sinon une immobilisation
 * sans rien de ce qui l'a precedee.
 */
function fichesFiltrees(f) {
  const groups = groupBy(DB.maintenance, (m) => m.immat || '(sans immatriculation)');
  return Object.keys(groups)
    .filter((immat) => {
      const enGarage = groups[immat].filter((x) => !x.dateRetour).length;
      if (f.etat === 'garage' && enGarage === 0) return false;
      if (f.etat === 'sorti' && enGarage > 0) return false;
      if (f.immat && !norm(immat).includes(norm(f.immat))) return false;
      return true;
    })
    .flatMap((immat) => groups[immat]);
}

/**
 * Tableau recapitulatif de l'entretien, en tete de rubrique.
 *
 * Il reprend exactement les colonnes du fichier exporte : ce qu'on lit a
 * l'ecran est ce qu'on retrouvera dans le classeur ou le PDF, sans avoir a
 * exporter pour savoir ce que l'export dira. Le detail par vehicule, avec ses
 * interventions et ses boutons, reste dessous.
 */
function renderRecapitulatif(page, list) {
  const ds = dsMaintenance(list);
  page.appendChild(sectionLabel(`RÉCAPITULATIF DE L’ENTRETIEN (${ds.rows.length})`, COLORS.green));

  // Les lignes suivent l'ordre des entrees, la plus recente en tete.
  const lignes = ds.rows
    .map((r, i) => ({ r, m: list[i] }))
    .sort((a, b) => String(b.m.dateEntree).localeCompare(String(a.m.dateEntree)));

  const aDroite = new Set(['kmEntree', 'kmRetour', 'cout', 'duree']);

  page.appendChild(
    dataTable(
      ds.columns.map((c) => esc(c.label)),
      lignes.map(({ r }) =>
        ds.columns.map((c) => {
          const v = r[c.key];
          if (c.key === 'etat') {
            return `<span class="badge" style="background:${v === 'Au garage' ? COLORS.orange : COLORS.green}">${esc(v)}</span>`;
          }
          if (c.key === 'cout') return `<span style="display:block;text-align:right"><b>${fmt(v)} F</b></span>`;
          if (aDroite.has(c.key)) return `<span style="display:block;text-align:right">${v === '' ? '—' : fmt(v)}</span>`;
          return escLignes(v === undefined || v === null ? '' : v);
        })
      ),
      (tr, i) => {
        tr.dataset.search = norm(Object.values(lignes[i].r).join(' '));
      }
    )
  );
  if (ds.note) page.appendChild(el(`<div class="empty" style="text-align:right">${esc(ds.note)}</div>`));
}

/** Rend les fiches d un groupe (reutilise par la fiche vehicule). */
export function renderMaintenanceEntries(container, group) {
  group
    .slice()
    .sort((a, b) => String(b.dateEntree).localeCompare(String(a.dateEntree)))
    .forEach((m) => {
      const enCours = !m.dateRetour;
      const iv = m.interventions || [];
      const cout = sum(iv, (x) => x.cout);
      const duree = daysBetween(m.dateEntree, m.dateRetour || todayISO());
      const diffKm = m.kmRetour ? num(m.kmRetour) - num(m.kmEntree) : null;

      const e = el('<div class="entry"></div>');
      e.style.borderLeftColor = enCours ? COLORS.orange : COLORS.green;
      e.dataset.search = norm(`${m.marque} ${m.modele} ${m.immat} ${m.motif} ${m.signalePar || ''}`);

      const ivHtml = iv.length
        ? iv
            .map(
              (x, i) =>
                `<div class="subEntryRow"><span><b>${esc(x.garage || 'Garage')}</b>${x.date ? ` — ${esc(dateFR(x.date))}` : ''}` +
                `${x.travaux ? `<br><small>${esc(x.travaux)}</small>` : ''}${x.pieces ? `<br><small>Pièces : ${esc(x.pieces)}</small>` : ''}` +
                `${x.observation ? `<br><small>Diagnostic : ${esc(x.observation)}</small>` : ''}</span>` +
                `<span style="white-space:nowrap"><b>${fmt(x.cout)} F</b>` +
                (canWrite()
                  ? ` <button class="miniBtn" style="background:${COLORS.green};padding:4px 7px" data-ivedit="${i}" data-write>✎</button>` +
                    ` <button class="miniBtn" style="background:${COLORS.red};padding:4px 7px" data-ivdel="${i}" data-write>✕</button>`
                  : '') +
                '</span></div>'
            )
            .join('')
        : subEmpty('Aucune intervention enregistrée');

      e.innerHTML =
        `<div class="row1"><h4>${esc(m.marque || '')} ${esc(m.modele || '')} — ${esc(m.immat)}</h4>` +
        `<span class="badge" style="background:${enCours ? COLORS.orange : COLORS.green}">${enCours ? 'Au garage' : 'Sorti'}</span></div>` +
        `<div class="meta">Entrée : ${esc(dateFR(m.dateEntree) || '—')} · Km : ${fmt(m.kmEntree)}${m.conducteurEntree ? ` · ${esc(m.conducteurEntree)}` : ''}</div>` +
        `<div class="fields"><b>Motif :</b><br>${escLignes(m.motif || '—')}${m.signalePar ? `<br><b>Signalé par :</b> ${esc(m.signalePar)}` : ''}</div>` +
        `<div class="subBlock"><h5>Interventions du garage (${iv.length}) — total ${fmt(cout)} F</h5>${ivHtml}` +
        (canWrite() ? '<button class="smallBtn" data-addiv>+ Ajouter une intervention</button>' : '') +
        '</div>' +
        (enCours
          ? `<div class="fields" style="color:${COLORS.orange}"><b>Immobilisé depuis ${duree === null ? '—' : `${duree} jour(s)`}</b></div>` +
            (canWrite() ? `<div class="actions"><button class="miniBtn" style="background:${COLORS.blue}" data-retour data-write>↩ Enregistrer le retour du garage</button></div>` : '')
          : `<div class="fields"><b>Retour :</b> ${esc(dateFR(m.dateRetour))} · <b>Km sortie :</b> ${fmt(m.kmRetour)}` +
            `${diffKm !== null ? ` · <b>Δ km :</b> ${fmt(diffKm)}` : ''} · <b>Durée :</b> ${duree === null ? '—' : `${duree} j`}` +
            `${m.conducteurRetour ? `<br><b>Repris par :</b> ${esc(m.conducteurRetour)}` : ''}` +
            `${m.observationRetour ? `<br><b>Observation :</b><br>${escLignes(m.observationRetour)}` : ''}</div>`) +
        '<div class="actions">' +
        (canWrite() ? `<button class="miniBtn" style="background:${COLORS.green}" data-edit data-write>✎ Modifier la fiche</button>` : '') +
        (canWrite() ? `<button class="miniBtn" style="background:${COLORS.red}" data-del data-write>Supprimer</button>` : '') +
        '</div>';

      const addIv = e.querySelector('[data-addiv]');
      if (addIv) addIv.onclick = () => openInterventionForm(m, null);

      e.querySelectorAll('[data-ivedit]').forEach((b) => {
        b.onclick = () => openInterventionForm(m, iv[Number(b.dataset.ivedit)]);
      });
      e.querySelectorAll('[data-ivdel]').forEach((b) => {
        b.onclick = async () => {
          const target = iv[Number(b.dataset.ivdel)];
          if (!(await confirmDialog({ title: 'Supprimer l’intervention', message: `Supprimer l’intervention de ${target.garage || 'ce garage'} ?`, okLabel: 'Supprimer', danger: true }))) return;
          m.interventions = m.interventions.filter((x) => x !== target);
          touch('maintenance', m);
          toast('Intervention supprimée.', 'ok');
          rerender();
        };
      });

      const ret = e.querySelector('[data-retour]');
      if (ret) ret.onclick = () => openRetourForm(m);

      const ed = e.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openFicheForm(m);

      const del = e.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({ title: 'Supprimer la fiche', message: `Supprimer la fiche d’entretien du ${dateFR(m.dateEntree)} pour ${m.immat} ?`, okLabel: 'Supprimer', danger: true }))) return;
          remove('maintenance', m.id);
          toast('Fiche supprimée.', 'ok');
          rerender();
        };
      }

      container.appendChild(e);
    });
}

/**
 * Pose une valeur dans un champ qui peut etre une liste deroulante.
 *
 * Un <select> refuse en silence une valeur absente de ses options : le champ
 * resterait vide sans qu'on sache pourquoi. On ajoute donc l'option au besoin
 * — le cas se presente pour un vehicule retire du parc depuis.
 */
function poser(node, valeur) {
  const v = String(valeur || '').trim();
  if (!v) return;
  if (node.tagName === 'SELECT' && ![...node.options].some((o) => o.value === v)) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    node.insertBefore(opt, node.options[node.options.length - 1] || null);
  }
  node.value = v;
}

export function openFicheForm(m, prefillImmat) {
  const isEdit = !!m;
  const base = m || (prefillImmat ? { immat: prefillImmat } : {});
  openForm({
    title: isEdit ? `Modifier la fiche — ${m.immat}` : 'Nouvelle fiche d’entretien — entrée au garage',
    fields: ficheFields(base),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la fiche',
    onInput: (values, scope) => {
      const mk = scope.querySelector('[data-key="marque"]');
      const md = scope.querySelector('[data-key="modele"]');
      if (mk && !mk.value && values.immat) {
        const v = vehicleByImmat(values.immat);
        if (v) {
          poser(mk, v.marque);
          if (md && !md.value) poser(md, v.modele);
        }
      }
    },
    onSubmit: (values) => {
      const payload = Object.assign({}, values, { immat: String(values.immat || '').trim().toUpperCase() });
      if (isEdit) {
        update('maintenance', m.id, payload);
        toast('Fiche mise à jour.', 'ok');
      } else {
        insert('maintenance', Object.assign({ interventions: [], kmRetour: '', dateRetour: '', conducteurRetour: '', observationRetour: '' }, payload));
        toast('Fiche enregistrée. Ajoutez les interventions puis le retour du garage.', 'ok');
      }
      rerender();
      return null;
    }
  });
}

function openInterventionForm(m, iv) {
  const isEdit = !!iv;
  openForm({
    title: isEdit ? 'Modifier l’intervention' : `Nouvelle intervention — ${m.immat}`,
    fields: interventionFields(iv || {}),
    okLabel: isEdit ? 'Enregistrer' : 'Ajouter l’intervention',
    onSubmit: (values) => {
      const payload = Object.assign({}, values, { cout: francSup(values.cout) });
      if (isEdit) Object.assign(iv, payload);
      else {
        m.interventions = m.interventions || [];
        m.interventions.push(payload);
      }
      touch('maintenance', m);
      toast(isEdit ? 'Intervention mise à jour.' : 'Intervention ajoutée.', 'ok');
      rerender();
      return null;
    }
  });
}

function openRetourForm(m) {
  openForm({
    title: `Retour du garage — ${m.immat}`,
    intro: `Entrée le ${dateFR(m.dateEntree)} · Km entrée ${fmt(m.kmEntree)}`,
    fields: retourFields(m),
    okLabel: 'Clôturer l’entretien',
    onSubmit: (values) => {
      if (values.dateRetour && m.dateEntree && values.dateRetour < m.dateEntree) {
        return 'La date de sortie est antérieure à la date d’entrée.';
      }
      if (values.kmRetour !== '' && num(values.kmRetour) < num(m.kmEntree)) {
        return 'Le kilométrage de sortie est inférieur à celui de l’entrée.';
      }
      update('maintenance', m.id, values);
      toast('Retour enregistré, le véhicule est sorti du garage.', 'ok');
      rerender();
      return null;
    }
  });
}

async function doExport(kind, list = DB.maintenance) {
  try {
    const datasets = [dsMaintenance(list), dsInterventions(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_entretien')
      : await exportPdf(datasets, 'PDU_entretien', { title: 'Entretien du parc' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
