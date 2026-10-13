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
  calculerSimulation, derniereConsommation, fraisOmParParticipant,
  kmInterneParJour, interneEstime,
  destinationsDe, texteDestinations
} from '../../core/db.js';
import { canWrite } from '../../core/auth.js';
import { esc, el, fmt, num, norm, dateFR, todayISO } from '../../core/utils.js';
import {
  card, toolbar, subtabs, emptyState, openForm, confirmDialog, toast, statTile, dataTable, COLORS
} from '../components.js';
import { state, rerender, moduleColor, navigate } from '../shell.js';
import { cablerParcours, enregistrerParcours, openMissionForm } from './missions.js';
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
      'Estimez les frais d’une mission avant le départ : frais OM (' + fmt(fraisOmParParticipant()) +
      ' F par participant, réglable dans RÉGLAGES) + frais de péage + carburant, calculé sur le parcours aller-retour et les déplacements à l’intérieur des destinations. « Créer la mission » reprend une simulation dans MISSION.',
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
    'Péages', '<b>Estimation</b>', 'Mission', ''
  ];
  const rows = list.map((s) => [
    `${esc(dateFR(s.dateDepart) || '…')}<br>→ ${esc(dateFR(s.dateRetour) || '…')}` +
      (s.jours ? `<br><small>${s.jours} jour(s)</small>` : ''),
    esc(texteDestinations(s.destinations) || '—'),
    droite(`${fmt(s.parcoursKm)} km<br><small>+ ${fmt(s.interneKm)} km en interne</small><br><b>${fmt(s.distanceTotale)} km</b>`),
    `${esc(s.vehicule || '—')}<br><small>${esc(s.energie || '')}${s.consommation ? ` · ${fmt(s.consommation)} L/100 km` : ''}</small>`,
    droite(`${fmt(s.litres)} L<br><small>× ${fmt(s.prixL)} F</small><br><b>${fmt(s.montantCarburant)} F</b>`),
    droite(`${fmt(s.participants)}<br><b>${fmt(s.fraisOm)} F</b>`),
    droite(`<b>${fmt(s.fraisPeage)} F</b>`),
    droite(`<b style="color:${COULEUR()};font-size:1.05em">${fmt(s.estimation)} F</b>`),
    celluleMission(s),
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

      const creer = tr.querySelector('[data-creer]');
      if (creer) creer.onclick = () => creerMission(s);
      const voir = tr.querySelector('[data-voir-mission]');
      if (voir) {
        voir.onclick = () => {
          const m = missionDe(s);
          state.sub.MISSION = 'suivi';
          state.filters.missions.conducteur = (m && m.conducteur) || '';
          navigate('MISSION');
        };
      }
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

/* ======================== Creer la mission ========================= */

/** La mission creee depuis cette simulation, si elle existe encore. */
function missionDe(s) {
  return s.missionId ? DB.missions.find((m) => m.id === s.missionId) || null : null;
}

function celluleMission(s) {
  const m = missionDe(s);
  if (m) {
    return `<button class="miniBtn" style="background:#C2185B;padding:5px 8px" data-voir-mission ` +
      `title="Ouvrir le tableau de suivi">→ ${esc(m.ref || 'mission')}</button>`;
  }
  return canWrite()
    ? `<button class="miniBtn" style="background:#C2185B;padding:5px 8px" data-creer data-write>Créer la mission</button>`
    : '—';
}

/**
 * Ouvre le formulaire de mission, prerempli avec la simulation : dates,
 * parcours et vehicule. Le conducteur reste a choisir — c'est le tour de
 * role qui le designe — et les frais de mission restent a saisir : ceux de
 * la mission ne sont pas l'estimation de la simulation.
 */
function creerMission(s) {
  openMissionForm(null, {
    titre: 'Nouvelle mission — depuis une simulation',
    preset: {
      dateDepart: s.dateDepart,
      dateRetour: s.dateRetour,
      destinations: (s.destinations || []).slice(),
      vehicule: s.vehicule
    },
    apresCreation: (m) => {
      update('simulations', s.id, { missionId: m.id });
      rerender();
    }
  });
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
      hint: `Participants × ${fmt(fraisOmParParticipant())} F — réglable dans RÉGLAGES` },
    // Saisis tels quels : le montant total des peages du trajet.
    { key: 'fraisPeage', label: 'Frais de péage (F)', type: 'number', value: s.fraisPeage,
      hint: 'Montant total des péages, aller et retour' },
    { key: 'carburant', label: 'Carburant', type: 'static', full: true, value: '',
      hint: '(Parcours + parcours en interne) × consommation ÷ 100 × prix du litre ; parcours en interne = jours sur place × km par jour (RÉGLAGES)' },
    { key: 'estimation', label: 'ESTIMATION DES FRAIS DE MISSION', type: 'static', full: true, value: '',
      hint: 'Frais OM + frais de péage + carburant' }
  ];
}

function openSimulationForm(sim) {
  const isEdit = !!sim;
  const parcours = destinationsDe(sim || {}).map((nom) => ({ nom }));
  const saisies = new Map();
  // Parcours a l'interieur de chaque destination, par nom : jours sur place,
  // et km — calcules (jours x km par jour de RÉGLAGES) tant qu'on ne les a
  // pas corriges a la main. Une simulation d'avant le reglage n'a que des
  // km : ils sont tenus pour saisis a la main.
  const interne = new Map((sim && sim.interne ? sim.interne : []).map((x) => [norm(x.nom), {
    jours: x.jours === undefined ? '' : x.jours,
    km: x.km,
    manuel: x.manuel !== undefined ? !!x.manuel : x.jours === undefined
  }]));
  const ligneInterne = (nom) => {
    if (!interne.has(norm(nom))) interne.set(norm(nom), { jours: '', km: '', manuel: false });
    return interne.get(norm(nom));
  };
  /** Km retenus pour une destination : la correction, sinon le calcul. */
  const kmInterne = (nom) => {
    const x = ligneInterne(nom);
    return x.manuel ? x.km : interneEstime(x.jours);
  };
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
      interne: parcours.map((e) => ({ km: kmInterne(e.nom) || 0 })),
      consommation: valeur('consommation'),
      prixL: valeur('prixL') === '__ajout__' ? '' : valeur('prixL'),
      participants: valeur('participants'),
      fraisPeage: valeur('fraisPeage')
    });
    const j = joursMission(valeur('dateDepart'), valeur('dateRetour'));
    champ('jours').value = j === null || j < 1 ? '—' : `${j} j`;
    const jSurPlace = scopeForm.querySelector('[data-interne-jours]');
    if (jSurPlace) {
      const surPlace = parcours.reduce((s2, e) => s2 + num(ligneInterne(e.nom).jours), 0);
      jSurPlace.textContent = `${fmt(surPlace)} jour(s) sur place` + (j !== null && j > 0 ? ` — la mission dure ${j} jour(s)` : '');
    }
    champ('fraisOm').value = `${fmt(r.fraisOm)} F  (${fmt(r.participants)} × ${fmt(r.fraisOmUnitaire)} F)`;
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

  /**
   * Une ligne par destination du parcours : jours sur place x km par jour
   * = km en interne. Le resultat est propose, et reste modifiable ; une
   * valeur corrigee se remet au calcul par « ↺ ».
   */
  const dessinerInterne = (bloc) => {
    const taux = kmInterneParJour();
    bloc.innerHTML =
      '<h5>Parcours en interne — distance estimée à l’intérieur de chaque destination</h5>' +
      (taux
        ? `<div class="subEntryRow" style="border:none"><span><small>Réglage : <b>${fmt(taux)} km par jour</b> sur place (RÉGLAGES)</small></span></div>`
        : '<div class="subEntryRow" style="border:none"><span><small style="color:#b26a00">Km par jour non réglés : ' +
          'fixez-les dans RÉGLAGES → Modifier les réglages, ou saisissez les km à la main.</small></span></div>') +
      (parcours.length
        ? parcours.map((e, i) => {
            const x = ligneInterne(e.nom);
            const km = kmInterne(e.nom);
            return '<div class="subEntryRow" style="align-items:center;gap:6px;flex-wrap:wrap">' +
              `<span style="flex:1 1 140px">${i + 1}. ${esc(e.nom)}</span>` +
              '<span style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">' +
                `<input type="number" min="0" step="any" data-jours="${i}" value="${esc(x.jours)}" placeholder="0" ` +
                  'title="Jours passés sur place" style="width:64px"><small>j ×</small>' +
                `<small>${taux ? fmt(taux) : '?'} km =</small>` +
                `<input type="number" min="0" step="any" data-interne="${i}" value="${esc(km)}" placeholder="0" ` +
                  `title="Km parcourus à l’intérieur de ${esc(e.nom)}" style="width:80px${x.manuel ? ';border-color:#F47B20' : ''}"><small>km</small>` +
                (x.manuel
                  ? `<button type="button" class="miniBtn" style="background:${COLORS.grey};padding:4px 7px" data-recalcul="${i}" ` +
                    'title="Revenir au calcul jours × km par jour">↺</button>'
                  : '') +
              '</span></div>';
          }).join('') +
          '<div class="subEntryRow" style="border:none"><span><b>Total en interne</b><br><small data-interne-jours></small></span>' +
          '<b data-interne-total></b></div>'
        : '<div class="subEntryRow"><span><small>Ajoutez d’abord les destinations.</small></span></div>');

    const totaux = () => {
      const t = bloc.querySelector('[data-interne-total]');
      if (t) t.textContent = `${fmt(parcours.reduce((s2, e) => s2 + num(kmInterne(e.nom)), 0))} km`;
      const j = bloc.querySelector('[data-interne-jours]');
      if (j) {
        const surPlace = parcours.reduce((s2, e) => s2 + num(ligneInterne(e.nom).jours), 0);
        const mission = joursMission(valeur('dateDepart'), valeur('dateRetour'));
        j.textContent = `${fmt(surPlace)} jour(s) sur place` +
          (mission !== null && mission > 0 ? ` — la mission dure ${mission} jour(s)` : '');
      }
    };
    bloc.querySelectorAll('[data-jours]').forEach((n) => {
      n.oninput = () => {
        const nom = parcours[Number(n.dataset.jours)].nom;
        ligneInterne(nom).jours = n.value === '' ? '' : Number(n.value);
        // Les km suivent les jours, sauf s'ils ont ete corriges a la main.
        const champKm = bloc.querySelector(`[data-interne="${n.dataset.jours}"]`);
        if (champKm && !ligneInterne(nom).manuel) champKm.value = kmInterne(nom);
        totaux();
        recalculer();
      };
    });
    bloc.querySelectorAll('[data-interne]').forEach((n) => {
      n.oninput = () => {
        const x = ligneInterne(parcours[Number(n.dataset.interne)].nom);
        x.km = n.value === '' ? '' : Number(n.value);
        x.manuel = true;
        n.style.borderColor = '#F47B20';
        totaux();
        recalculer();
      };
      // Le bouton « ↺ » n'apparait qu'au redessin : on le fait en quittant le champ.
      n.onchange = () => dessinerInterne(bloc);
    });
    bloc.querySelectorAll('[data-recalcul]').forEach((b) => {
      b.onclick = () => {
        ligneInterne(parcours[Number(b.dataset.recalcul)].nom).manuel = false;
        dessinerInterne(bloc);
        recalculer();
      };
    });
    totaux();
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
      if (values.fraisPeage !== '' && num(values.fraisPeage) < 0) return 'Les frais de péage ne peuvent pas être négatifs.';
      if ([...interne.values()].some((x) => (x.km !== '' && num(x.km) < 0) || (x.jours !== '' && num(x.jours) < 0))) {
        return 'Une distance ou un nombre de jours ne peut pas être négatif.';
      }

      const noms = enregistrerParcours(parcours, saisies, values.destination);
      if (!noms.length) return 'Ajoutez au moins une destination.';
      const p = parcoursDe(noms);
      // Les corrections de distance viennent d'etre enregistrees : le
      // parcours relu ici est celui que le formulaire affichait.
      const lignesInterne = noms.map((nom) => {
        const x = ligneInterne(nom);
        return { nom, jours: x.jours, km: num(kmInterne(nom)), manuel: x.manuel };
      });
      const r = calculerSimulation({
        parcoursKm: p.total,
        interne: lignesInterne,
        consommation: values.consommation,
        prixL: values.prixL,
        participants: values.participants,
        fraisPeage: values.fraisPeage
      });

      const payload = Object.assign({
        dateDepart: values.dateDepart,
        dateRetour: values.dateRetour,
        jours: jours === null ? '' : jours,
        destinations: noms,
        parcoursComplet: p.complet,
        interne: lignesInterne,
        vehicule: String(values.vehicule || '').trim().toUpperCase(),
        energie: values.energie,
        consommation: num(values.consommation),
        prixL: num(values.prixL)
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
