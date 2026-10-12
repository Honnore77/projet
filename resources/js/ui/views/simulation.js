/* ===================================================================
   SIMULATION — estimer les frais d'une mission avant le depart.

     SIMULATION DE MISSION  formulaire de simulation, et la liste des
                            simulations enregistrees

   Le parcours se saisit et se calcule exactement comme dans le formulaire
   de mission (meme bloc, memes distances d'etape, retour a Abidjan
   compris) : une simulation et la mission qui la suit annoncent les memes
   kilometres.
   =================================================================== */

import {
  DB, insert, update, remove, knownImmats, vehicleByImmat, joursMission, ENERGIES,
  prixLitreOptions, nomsDestinationsMission, parcoursDe,
  calculerSimulation, peagesConnus, derniereConsommation, FRAIS_OM_PAR_PARTICIPANT,
  destinationsDe, texteDestinations
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  card, toolbar, subtabs, emptyState, openForm, confirmDialog, toast, statTile, dataTable, COLORS
} from '../components.js';
import { state, rerender, moduleColor } from '../shell.js';
import { cablerParcours, enregistrerParcours } from './missions.js';
import { exportExcel } from '../../export/excel.js';
import { exportPdf } from '../../export/pdf.js';
import { dsSimulations } from '../../export/datasets.js';

const SUBS = [{ key: 'simulation', label: 'SIMULATION DE MISSION' }];

const COULEUR = () => moduleColor('SIMULATION');

export function renderSimulation(page) {
  const sub = state.sub.SIMULATION || 'simulation';
  page.appendChild(subtabs(SUBS, sub, (k) => { state.sub.SIMULATION = k; rerender(); }, { simulation: COULEUR() }));
  renderListe(page);
}

/* ============================== Liste ============================== */

function renderListe(page) {
  page.appendChild(
    card(
      'SIMULATION DE MISSION',
      'Estimez les frais d’une mission avant le départ : frais OM (' + fmt(FRAIS_OM_PAR_PARTICIPANT) +
      ' F par participant) + frais de péage + carburant, calculé sur le parcours aller-retour et les déplacements à l’intérieur des destinations.',
      COULEUR()
    )
  );

  const list = DB.simulations.slice().sort((a, b) =>
    String(b.dateDepart || '').localeCompare(String(a.dateDepart || '')) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  page.appendChild(
    toolbar([
      canWrite() && { label: '+ Nouvelle simulation', cls: 'addBtn', color: COULEUR(), write: true, onClick: () => openSimulationForm(null) },
      { label: '⬇ Excel', color: COLORS.blue, onClick: () => doExport('excel', list) },
      { label: '⬇ PDF', color: COLORS.red, onClick: () => doExport('pdf', list) }
    ])
  );

  if (!list.length) {
    page.appendChild(emptyState('Aucune simulation enregistrée. « + Nouvelle simulation » ouvre le formulaire.'));
    return;
  }

  const grid = el('<div class="statGrid"></div>');
  grid.appendChild(statTile('Simulations', fmt(list.length), 'enregistrées', COULEUR()));
  grid.appendChild(statTile('Dernière estimation', `${fmt(list[0].estimation)} F`,
    texteDestinations(list[0].destinations) || '—', COLORS.green));
  page.appendChild(grid);

  const droite = (v) => `<span style="display:block;text-align:right">${v}</span>`;
  const headers = [
    'Période', 'Destinations', 'Distance', 'Véhicule', 'Carburant', 'Participants<br>/ Frais OM',
    'Péages', '<b>Estimation</b>', ''
  ];
  const rows = list.map((s) => [
    `${esc(dateFR(s.dateDepart) || '…')}<br>→ ${esc(dateFR(s.dateRetour) || '…')}` +
      (s.jours ? `<br><small>${s.jours} jour(s)</small>` : ''),
    esc(texteDestinations(s.destinations) || '—'),
    droite(`${fmt(s.parcoursKm)} km<br><small>+ ${fmt(s.interneKm)} km en interne</small><br><b>${fmt(s.distanceTotale)} km</b>`),
    `${esc(s.vehicule || '—')}<br><small>${esc(s.energie || '')}${s.consommation ? ` · ${fmt(s.consommation)} L/100 km` : ''}</small>`,
    droite(`${fmt(s.litres)} L<br><small>× ${fmt(s.prixL)} F</small><br><b>${fmt(s.montantCarburant)} F</b>`),
    droite(`${fmt(s.participants)}<br><b>${fmt(s.fraisOm)} F</b>`),
    droite(`<b>${fmt(s.fraisPeage)} F</b>${(s.peages || []).length ? `<br><small>${s.peages.length} péage(s)</small>` : ''}`),
    droite(`<b style="color:${COULEUR()};font-size:1.05em">${fmt(s.estimation)} F</b>`),
    canWrite()
      ? `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit data-write>✎</button> ` +
        `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del data-write>✕</button>`
      : ''
  ]);

  page.appendChild(
    dataTable(headers, rows, (tr, i) => {
      const s = list[i];
      tr.dataset.search = norm(`${texteDestinations(s.destinations)} ${s.vehicule} ${s.dateDepart}`);
      const ed = tr.querySelector('[data-edit]');
      if (ed) ed.onclick = () => openSimulationForm(s);
      const del = tr.querySelector('[data-del]');
      if (del) {
        del.onclick = async () => {
          if (!(await confirmDialog({
            title: 'Supprimer la simulation',
            message: `Supprimer la simulation ${texteDestinations(s.destinations) || ''} du ${dateFR(s.dateDepart) || '…'} ?`,
            okLabel: 'Supprimer', danger: true
          }))) return;
          remove('simulations', s.id);
          toast('Simulation supprimée.', 'ok');
          rerender();
        };
      }
    })
  );
}

/* ============================ Formulaire =========================== */

function simulationFields(s = {}) {
  return [
    { key: 'dateDepart', label: 'Période — date de départ', type: 'date', required: true, value: s.dateDepart || todayISO() },
    { key: 'dateRetour', label: 'Période — date de retour', type: 'date', required: true, value: s.dateRetour },
    { key: 'jours', label: 'Nombre de jours', type: 'static', value: '', hint: 'Jour de départ inclus' },
    // Meme bloc que dans le formulaire de mission : les etapes, leur
    // distance depuis la precedente et le retour a Abidjan.
    { key: 'destination', label: 'Destination — parcours aller et retour', type: 'selectAdd', full: true, value: '',
      options: nomsDestinationsMission(), emptyLabel: '— ajouter une destination —', addLabel: 'Nouvelle destination',
      hint: 'Ajoutez les destinations dans l’ordre du parcours ; le retour à Abidjan est compté' },
    { key: 'vehicule', label: 'Véhicule utilisé — immatriculation', value: s.vehicule, list: knownImmats() },
    { key: 'energie', label: 'Véhicule utilisé — énergie', type: 'select', options: ENERGIES, value: s.energie || 'Essence' },
    { key: 'consommation', label: 'Consommation (litres pour 100 km)', type: 'number', required: true, value: s.consommation,
      hint: 'Reprise de la dernière simulation du véhicule' },
    { key: 'prixL', label: 'Prix du litre (F)', type: 'selectAdd', required: true, value: s.prixL,
      options: prixLitreOptions(s.energie || 'Essence'), emptyLabel: '— choisir —', addLabel: 'Autre prix',
      hint: 'Réglé dans RÉGLAGES → Modifier les réglages' },
    { key: 'participants', label: 'Total participants', type: 'number', required: true, value: s.participants,
      hint: 'Nombre total de personnes qui prennent part à la mission' },
    { key: 'fraisOm', label: 'Frais OM', type: 'static', value: '',
      hint: `Participants × ${fmt(FRAIS_OM_PAR_PARTICIPANT)} F` },
    { key: 'fraisPeage', label: 'Frais de péage', type: 'static', full: true, value: '',
      hint: 'Somme des péages ci-dessous' },
    { key: 'carburant', label: 'Carburant', type: 'static', full: true, value: '',
      hint: '(Parcours + parcours en interne) × consommation ÷ 100 × prix du litre' },
    { key: 'estimation', label: 'ESTIMATION DES FRAIS DE MISSION', type: 'static', full: true, value: '',
      hint: 'Frais OM + frais de péage + carburant' }
  ];
}

function openSimulationForm(sim) {
  const isEdit = !!sim;
  const parcours = destinationsDe(sim || {}).map((nom) => ({ nom }));
  const saisies = new Map();
  // Distance parcourue a l'interieur de chaque destination, par nom.
  const interne = new Map((sim && sim.interne ? sim.interne : []).map((x) => [norm(x.nom), x.km]));
  const peages = ((sim && sim.peages) || []).map((p) => Object.assign({}, p));
  let parcoursCalcule = parcoursDe(parcours.map((e) => e.nom));
  let dernierVehicule = sim ? sim.vehicule : '';
  let derniereEnergie = sim ? sim.energie : 'Essence';
  let prixPropose = null;
  let scopeForm = null;

  const champ = (k) => scopeForm && scopeForm.querySelector(`[data-key="${k}"]`);
  const valeur = (k) => { const n = champ(k); return n ? n.value : ''; };

  /** Les totaux, recalcules a chaque changement — d'ou qu'il vienne. */
  const recalculer = () => {
    if (!scopeForm) return null;
    const r = calculerSimulation({
      parcoursKm: parcoursCalcule.total,
      interne: parcours.map((e) => ({ km: interne.get(norm(e.nom)) || 0 })),
      consommation: valeur('consommation'),
      prixL: valeur('prixL') === '__ajout__' ? '' : valeur('prixL'),
      participants: valeur('participants'),
      peages
    });
    const j = joursMission(valeur('dateDepart'), valeur('dateRetour'));
    champ('jours').value = j === null || j < 1 ? '—' : `${j} j`;
    champ('fraisOm').value = `${fmt(r.fraisOm)} F  (${fmt(r.participants)} × ${fmt(FRAIS_OM_PAR_PARTICIPANT)} F)`;
    champ('fraisPeage').value = `${fmt(r.fraisPeage)} F${peages.length ? `  (${peages.length} péage(s))` : ''}`;
    const incomplet = parcoursCalcule.etapes.length && !parcoursCalcule.complet;
    champ('carburant').value =
      `${fmt(r.montantCarburant)} F  —  ${fmt(r.litres)} L pour ${fmt(r.distanceTotale)} km ` +
      `(${fmt(r.parcoursKm)} km de parcours + ${fmt(r.interneKm)} km en interne)` +
      (incomplet ? '  ⚠ une distance d’étape manque' : '');
    const est = champ('estimation');
    est.value = `${fmt(r.estimation)} F`;
    est.style.fontWeight = '700';
    est.style.fontSize = '1.15em';
    est.style.color = COULEUR();
    return r;
  };

  /** Une ligne par destination du parcours : les km parcourus sur place. */
  const dessinerInterne = (bloc) => {
    bloc.innerHTML = '<h5>Parcours en interne — distance estimée à l’intérieur de chaque destination</h5>' +
      (parcours.length
        ? parcours.map((e, i) =>
            '<div class="subEntryRow" style="align-items:center;gap:6px">' +
              `<span>${i + 1}. ${esc(e.nom)}</span>` +
              '<span style="display:flex;gap:4px;align-items:center">' +
                `<input type="number" min="0" step="any" data-interne="${i}" value="${esc(interne.get(norm(e.nom)) ?? '')}" placeholder="0" style="width:80px">` +
                '<small>km</small></span>' +
            '</div>').join('') +
          `<div class="subEntryRow" style="border:none"><span><b>Total en interne</b></span><b data-interne-total></b></div>`
        : '<div class="subEntryRow"><span><small>Ajoutez d’abord les destinations.</small></span></div>');
    const total = () => {
      const t = bloc.querySelector('[data-interne-total]');
      if (t) t.textContent = `${fmt(parcours.reduce((s, e) => s + num(interne.get(norm(e.nom))), 0))} km`;
    };
    bloc.querySelectorAll('[data-interne]').forEach((n) => {
      n.oninput = () => {
        interne.set(norm(parcours[Number(n.dataset.interne)].nom), n.value === '' ? '' : Number(n.value));
        total();
        recalculer();
      };
    });
    total();
  };

  /** Les peages du trajet : libelle et prix, avec ceux deja connus proposes. */
  const cablerPeages = (scope) => {
    const ligne = scope.querySelector('[data-key="fraisPeage"]').closest('.fRow');
    const connus = peagesConnus();
    const bloc = el(
      '<div class="subBlock" style="margin-top:8px"><h5>Péages</h5>' +
        '<div data-peages></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">' +
          '<input data-peage-libelle placeholder="Péage (ex. Attinguié)" list="sim_peages" style="flex:1 1 160px">' +
          `<datalist id="sim_peages">${connus.map((p) => `<option value="${esc(p.libelle)}"></option>`).join('')}</datalist>` +
          '<input type="number" min="0" step="any" data-peage-prix placeholder="Prix (F)" style="width:110px">' +
          `<button type="button" class="miniBtn" style="background:${COULEUR()}" data-peage-ajout>+ Ajouter ce péage</button>` +
        '</div></div>'
    );
    ligne.appendChild(bloc);
    const liste = bloc.querySelector('[data-peages]');
    const libelle = bloc.querySelector('[data-peage-libelle]');
    const prix = bloc.querySelector('[data-peage-prix]');

    const dessiner = () => {
      liste.innerHTML = peages.length
        ? peages.map((p, i) =>
            `<div class="subEntryRow"><span>${esc(p.libelle || 'Péage')}</span>` +
            `<span style="display:flex;gap:6px;align-items:center"><b>${fmt(p.prix)} F</b>` +
            `<button type="button" class="miniBtn" style="background:${COLORS.red};padding:4px 8px" data-peage-retire="${i}">✕</button></span></div>`
          ).join('')
        : '<div class="subEntryRow"><span><small>Aucun péage.</small></span></div>';
      liste.querySelectorAll('[data-peage-retire]').forEach((b) => {
        b.onclick = () => { peages.splice(Number(b.dataset.peageRetire), 1); dessiner(); recalculer(); };
      });
    };

    // Un peage deja connu reprend son dernier prix.
    libelle.addEventListener('change', () => {
      const k = connus.find((p) => norm(p.libelle) === norm(libelle.value));
      if (k && prix.value === '') prix.value = k.prix;
    });
    const ajouter = () => {
      if (!libelle.value.trim() || prix.value === '' || num(prix.value) < 0) {
        return toast('Renseignez le nom du péage et son prix.', 'err');
      }
      peages.push({ libelle: libelle.value.trim(), prix: num(prix.value) });
      libelle.value = '';
      prix.value = '';
      dessiner();
      recalculer();
      libelle.focus();
    };
    bloc.querySelector('[data-peage-ajout]').onclick = ajouter;
    // Entree dans ces deux champs ajoute le peage au lieu d'enregistrer.
    [libelle, prix].forEach((n) => n.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ajouter(); }
    }));
    dessiner();
  };

  openForm({
    title: isEdit ? 'Modifier la simulation' : 'Nouvelle simulation de mission',
    fields: simulationFields(sim || {}),
    okLabel: isEdit ? 'Enregistrer les modifications' : 'Enregistrer la simulation',
    extra: (scope) => {
      scopeForm = scope;
      const ligneDest = scope.querySelector('[data-key="destination"]').closest('.fRow');
      const blocInterne = el('<div class="subBlock" style="margin-top:8px" data-bloc-interne></div>');
      const redessinerParcours = cablerParcours(scope, parcours, saisies, (p) => {
        parcoursCalcule = p;
        dessinerInterne(blocInterne);
        recalculer();
      });
      ligneDest.appendChild(blocInterne);
      dessinerInterne(blocInterne);
      cablerPeages(scope);
      scope._redessinerParcours = redessinerParcours;
      recalculer();
    },
    onInput: (values, scope) => {
      // Une destination choisie dans la liste rejoint aussitot le parcours.
      const liste = scope.querySelector('select[data-key="destination"]');
      if (liste && liste.value && liste.value !== '__ajout__') {
        const nom = liste.value;
        liste.value = '';
        if (!parcours.some((e) => norm(e.nom) === norm(nom))) parcours.push({ nom });
        if (scope._redessinerParcours) scope._redessinerParcours();
      }

      // Le vehicule apporte son energie et la consommation de sa derniere
      // simulation ; on ne remplace jamais une valeur deja saisie.
      if (values.vehicule !== dernierVehicule) {
        dernierVehicule = values.vehicule;
        const v = vehicleByImmat(values.vehicule);
        const en = scope.querySelector('[data-key="energie"]');
        if (v && v.energie && en && [...en.options].some((o) => o.value === v.energie)) en.value = v.energie;
        const conso = scope.querySelector('[data-key="consommation"]');
        if (conso && conso.value === '') {
          const c = derniereConsommation(values.vehicule);
          if (c) conso.value = c;
        }
      }

      // Le prix du litre suit l'energie, sauf s'il a ete choisi a la main.
      const energie = (scope.querySelector('[data-key="energie"]') || {}).value;
      const prix = scope.querySelector('select[data-key="prixL"]');
      if (prix && (energie !== derniereEnergie || !prix.value) && (!prix.value || prix.value === prixPropose)) {
        const propose = prixLitreOptions(energie)[0];
        if (propose) {
          if (![...prix.options].some((o) => o.value === propose)) {
            prix.insertBefore(el(`<option value="${esc(propose)}">${esc(propose)}</option>`), prix.lastElementChild);
          }
          prix.value = propose;
          prixPropose = propose;
        }
      }
      derniereEnergie = energie;

      recalculer();
    },
    onSubmit: (values) => {
      const jours = joursMission(values.dateDepart, values.dateRetour);
      if (jours !== null && jours < 1) return 'La date de retour est antérieure à la date de départ.';
      if (num(values.consommation) <= 0) return 'La consommation doit être supérieure à zéro.';
      if (num(values.participants) < 0) return 'Le nombre de participants ne peut pas être négatif.';
      if ([...interne.values()].some((km) => km !== '' && num(km) < 0)) return 'Une distance ne peut pas être négative.';

      const noms = enregistrerParcours(parcours, saisies, values.destination);
      if (!noms.length) return 'Ajoutez au moins une destination.';
      const p = parcoursDe(noms);
      // Les corrections de distance viennent d'etre enregistrees : le
      // parcours relu ici est celui que le formulaire affichait.
      const kmInterne = noms.map((nom) => ({ nom, km: num(interne.get(norm(nom))) }));
      const r = calculerSimulation({
        parcoursKm: p.total,
        interne: kmInterne,
        consommation: values.consommation,
        prixL: values.prixL,
        participants: values.participants,
        peages
      });

      const payload = Object.assign({
        dateDepart: values.dateDepart,
        dateRetour: values.dateRetour,
        jours: jours === null ? '' : jours,
        destinations: noms,
        parcoursComplet: p.complet,
        interne: kmInterne,
        vehicule: String(values.vehicule || '').trim().toUpperCase(),
        energie: values.energie,
        consommation: num(values.consommation),
        prixL: num(values.prixL),
        peages
      }, r);

      if (isEdit) update('simulations', sim.id, payload);
      else insert('simulations', Object.assign({ createdAt: new Date().toISOString() }, payload));
      toast(`Simulation enregistrée : ${fmt(r.estimation)} F${p.complet ? '' : ' (une distance d’étape manque)'}.`, 'ok');
      rerender();
      return null;
    }
  });
}

/* ============================== Exports ============================ */

async function doExport(kind, list) {
  try {
    const datasets = [dsSimulations(list)];
    const res = kind === 'excel'
      ? await exportExcel(datasets, 'PDU_simulations_mission')
      : await exportPdf(datasets, 'PDU_simulations_mission', { title: 'Simulations de mission' });
    toast(res ? 'Export terminé.' : 'Export annulé.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast("L'export a échoué.", 'err');
  }
}
