/* ===================================================================
   RÉGLAGES — comptes, seuils d'alerte, sauvegarde et restauration.
   Rubrique reservee aux administrateurs (voir MODULES dans shell.js).
   =================================================================== */

import { DB, persistNow, replaceDB, emptyDB, saveSettings, fraisOmParParticipant, FRAIS_OM_PAR_PARTICIPANT, kmInterneParJour, nomsUtilisateurs } from '../../core/db.js';
import { ROLES_ACCES, NIVEAUX, RUBRIQUES_ACCES, reglesDuRole, reglesParDefaut } from '../../core/acces.js';
import {
  ROLES, currentUser, canAdmin, roleLabel, listAccounts,
  createAccount, updateAccount, deleteAccount, resetPassword, changeOwnPassword
} from '../../core/auth.js';
import {
  platformName, dataLocation, saveFile, openBinaryFile,
  backupEtat, backupChoisirDossier, backupListe
} from '../../core/storage.js';
import { esc, el, num, francSup } from '../../core/utils.js';
import { construireArchive, lireArchive } from '../../core/archive.js';
import {
  card, toolbar, openForm, confirmDialog, toast, sectionLabel, dataTable, COLORS
} from '../components.js';
import { rerender } from '../shell.js';
import { renderSynchroSection, renderReseauSection } from './synchroUI.js';
import { apparenceNode } from '../apparence.js';

export function renderSettings(page) {
  if (!canAdmin()) {
    page.appendChild(card('ACCÈS RESTREINT', 'Cette rubrique est réservée aux administrateurs.', COLORS.red));
    return;
  }

  page.appendChild(
    card('RÉGLAGES', 'Comptes utilisateurs, seuils d’alerte du tableau de bord, sauvegarde et restauration des données.', COLORS.purple)
  );

  renderAccountsSection(page);
  renderNiveauxSection(page);
  renderThresholdsSection(page);
  renderApparenceSection(page);
  renderReseauSection(page);
  renderSynchroSection(page);
  renderAutoBackupSection(page);
  renderBackupSection(page);

  // Mention du createur de l'application, discrete, en bas des reglages.
  page.appendChild(el(
    '<p class="mentionCreateur">Application créée par Delon Calixe César le 14/08/2026 — Tous droits réservés</p>'
  ));
}

/* ----------------------------- Apparence ---------------------------- */

/**
 * Le style de l'interface, propre a cet appareil (voir ui/theme.js).
 * Un clic l'applique tout de suite : on voit le resultat sans quitter
 * la page.
 */
function renderApparenceSection(page) {
  // Style et taille de l'affichage : rubrique RÉGLAGES PRÉDÉFINIS, ouverte
  // a tous. Ici ne reste que le fond de la page de connexion.
  page.appendChild(sectionLabel('PAGE DE CONNEXION', COLORS.green));
  page.appendChild(apparenceNode({ style: false, taille: false }));
}

/* ------------------- Sauvegarde automatique datee ------------------ */

/**
 * Copies datees dans un dossier choisi.
 *
 * La copie de securite du poste est ecrasee a chaque enregistrement : elle
 * protege d'une ecriture interrompue, pas d'une erreur remarquee le
 * lendemain, et elle est sur le meme disque que l'original. D'ou ce second
 * filet, date et ailleurs.
 */
function renderAutoBackupSection(page) {
  page.appendChild(sectionLabel('SAUVEGARDE AUTOMATIQUE', COLORS.blue));

  const bloc = el('<div class="card"><h3 style="color:#1976D2">COPIES DATÉES</h3><p>Chargement…</p></div>');
  page.appendChild(bloc);

  const dessiner = async () => {
    const etat = await backupEtat();
    const dossier = DB.settings.dossierSauvegarde || '';
    const p = bloc.querySelector('p');

    if (etat.indisponible) {
      p.textContent =
        'La sauvegarde automatique n’existe que dans l’application de bureau : ' +
        'le navigateur n’a pas accès à un dossier du disque.\n' +
        'Depuis le navigateur, utilisez « Exporter une sauvegarde » ci-dessous.';
      return;
    }

    if (!dossier) {
      p.textContent =
        'Aucun dossier choisi : aucune copie datée n’est faite.\n\n' +
        'Une copie par jour serait écrite dans le sous-dossier « SAUVEGARDE AUTOMATIQUE QUOTIDIENNE » du dossier que vous désignez — clé USB, ' +
        'disque réseau ou dossier synchronisé. Le fichier du jour est réécrit tant que ' +
        'la journée dure ; celui de la veille reste intact, ce qui permet de rattraper ' +
        'une erreur remarquée le lendemain.';
      return;
    }

    const liste = await backupListe(dossier);
    p.textContent =
      `Dossier : ${etat.dossier || `${dossier}\\SAUVEGARDE AUTOMATIQUE QUOTIDIENNE`}\n` +
      `Copies conservées : ${DB.settings.sauvegardesConservees} au plus — ${liste.length} présente(s)\n` +
      (etat.erreur
        ? `⚠ Dernière tentative en échec : ${etat.erreur}\n` +
          '   Le dossier est-il accessible ? La saisie, elle, reste enregistrée sur ce poste.'
        : etat.fait
          ? `Dernière copie : ${etat.fichier} — ${new Date(etat.fait).toLocaleString('fr-FR')}`
          : 'Aucune copie encore écrite : elle se fera au prochain enregistrement.') +
      (liste.length ? `\nLa plus ancienne remonte au ${liste[liste.length - 1].date}.` : '');
  };

  page.appendChild(
    toolbar([
      { label: '📁 Choisir le dossier', cls: 'addBtn', color: COLORS.blue, onClick: async () => {
        const choisi = await backupChoisirDossier();
        if (!choisi) return;
        saveSettings({ dossierSauvegarde: choisi });
        // Une copie part tout de suite : on ne fait pas attendre la preuve
        // que le dossier fonctionne jusqu'au prochain enregistrement.
        await persistNow();
        toast('Dossier enregistré, une première copie vient d’être écrite.', 'ok');
        rerender();
      } },
      DB.settings.dossierSauvegarde && { label: '⚙ Nombre de copies', color: COLORS.grey, onClick: openRetentionForm },
      DB.settings.dossierSauvegarde && { label: '✕ Ne plus sauvegarder', color: COLORS.red, onClick: async () => {
        if (!(await confirmDialog({
          title: 'Arrêter la sauvegarde automatique',
          message: 'Plus aucune copie datée ne sera écrite. Les copies déjà présentes dans le dossier sont conservées.',
          okLabel: 'Arrêter', danger: true
        }))) return;
        saveSettings({ dossierSauvegarde: '' });
        toast('Sauvegarde automatique arrêtée.', 'ok');
        rerender();
      } }
    ])
  );

  dessiner();
}

function openRetentionForm() {
  openForm({
    title: 'Nombre de copies conservées',
    intro: 'Au-delà, la plus ancienne est effacée à chaque nouvelle copie.',
    fields: [
      { key: 'sauvegardesConservees', label: 'Copies conservées', type: 'number',
        value: DB.settings.sauvegardesConservees,
        hint: 'Une copie par jour. Trente couvrent un mois, pour quelques centaines de kilo-octets.' }
    ],
    okLabel: 'Enregistrer',
    onSubmit: (v) => {
      const n = num(v.sauvegardesConservees);
      if (n < 1) return 'Il faut conserver au moins une copie.';
      saveSettings({ sauvegardesConservees: n });
      toast('Réglage enregistré.', 'ok');
      rerender();
      return null;
    }
  });
}

/* ------------------------------ Comptes ---------------------------- */

function renderAccountsSection(page) {
  page.appendChild(sectionLabel('COMPTES ET ACCÈS', COLORS.purple));
  page.appendChild(
    toolbar([
      { label: '+ Créer un compte', cls: 'addBtn', color: COLORS.purple, onClick: openCreateAccount },
      { label: '🔑 Changer mon mot de passe', color: COLORS.blue, onClick: () => openChangeOwnPassword() }
    ])
  );

  // Les inscriptions faites depuis la page de connexion d'abord.
  const accounts = listAccounts().sort((a, b) => (b.enAttente ? 1 : 0) - (a.enAttente ? 1 : 0));
  const enAttente = accounts.filter((a) => a.enAttente);
  if (enAttente.length) {
    page.appendChild(el(
      `<div class="card" style="border-left-color:${COLORS.orange}"><h3>⏳ ${enAttente.length} INSCRIPTION(S) À VALIDER</h3>` +
      '<p>Ces personnes se sont inscrites depuis la page de connexion. Elles ne peuvent pas se connecter tant que ' +
      'vous n’avez pas validé leur compte : « ✓ Valider » leur donne un rôle et l’agent lié ; ✕ refuse la demande.</p></div>'
    ));
  }
  page.appendChild(
    dataTable(
      ['Identifiant', 'Nom', 'Rôle', 'Agent lié', 'État', 'Dernière connexion', 'Actions'],
      accounts.map((a) => [
        `<b>${esc(a.login)}</b>${a.mustChange ? '<br><small style="color:#F47B20">mot de passe à changer</small>' : ''}`,
        esc(a.nom || ''),
        esc(roleLabel(a.role)),
        a.agent ? esc(a.agent) : (a.role === 'conducteur' ? '<span style="color:#D32F2F">à lier</span>' : '—'),
        a.enAttente
          ? `⏳ Inscription à valider<br><small>${esc(new Date(a.inscritLe || a.createdAt).toLocaleString('fr-FR'))}</small>`
          : a.actif ? '🟢 Actif' : '🔴 Désactivé',
        a.lastLogin ? new Date(a.lastLogin).toLocaleString('fr-FR') : '—',
        (a.enAttente ? `<button class="miniBtn" style="background:${COLORS.orange};padding:5px 8px" data-valider>✓ Valider</button> ` : '') +
          `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.orange};padding:5px 8px" data-reset>🔑</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del>✕</button>`
      ]),
      (tr, i) => {
        const a = accounts[i];
        tr.querySelector('[data-edit]').onclick = () => openEditAccount(a);
        const val = tr.querySelector('[data-valider]');
        if (val) val.onclick = () => openValiderInscription(a);
        tr.querySelector('[data-reset]').onclick = () => openResetPassword(a);
        tr.querySelector('[data-del]').onclick = async () => {
          if (!(await confirmDialog({ title: 'Supprimer le compte', message: `Supprimer définitivement le compte « ${a.login} » ?`, okLabel: 'Supprimer', danger: true }))) return;
          const res = deleteAccount(a.id);
          toast(res.ok ? 'Compte supprimé.' : res.error, res.ok ? 'ok' : 'err');
          rerender();
        };
      }
    )
  );

  page.appendChild(
    el(
      '<div class="card"><h3 style="color:#5b7178">RÔLES</h3><p>' +
        ROLES.map((r) => `${r.label} — ${r.desc}`).join('\n') +
        '\n\nCe que chaque rôle voit et peut faire, rubrique par rubrique, se règle juste en dessous ' +
        '(NIVEAUX D’ACCÈS). Un compte « Conducteur » doit être lié à son agent de la liste UTILISATEURS : ' +
        'c’est ce nom qui lui fait retrouver ses missions, son véhicule et ses demandes.' +
        '</p></div>'
    )
  );
}

/* -------------------------- Niveaux d'acces ------------------------- */

/**
 * Le tableau des droits : une colonne par role, une ligne par rubrique.
 * Chaque changement s'applique aussitot, et suit la synchronisation.
 * L'administrateur a toujours tout : sa colonne n'est pas modifiable.
 */
function renderNiveauxSection(page) {
  page.appendChild(sectionLabel('NIVEAUX D’ACCÈS', COLORS.purple));
  const roles = ROLES_ACCES.filter((r) => r.key !== 'admin');
  const bloc = document.createElement('div');
  bloc.className = 'card';
  const option = (n, choisi) => {
    const x = NIVEAUX.find((y) => y.key === n);
    return `<option value="${n}"${n === choisi ? ' selected' : ''}>${x.signe} ${esc(x.label)}</option>`;
  };
  bloc.innerHTML =
    '<h3>QUI VOIT QUOI, QUI FAIT QUOI</h3>' +
    '<p>Choisissez, pour chaque rôle, son niveau dans chaque rubrique. Le changement vaut tout de suite, ' +
    'pour tous les comptes de ce rôle, sur le PC comme sur le téléphone après synchronisation.</p>' +
    '<div class="tableWrap"><table class="dataTable niveauxTable"><thead><tr><th>Rubrique</th>' +
    '<th>Administrateur</th>' +
    roles.map((r) => `<th>${esc(r.label)}</th>`).join('') +
    '</tr></thead><tbody>' +
    RUBRIQUES_ACCES.map((rub) =>
      `<tr><td><b>${esc(rub.label)}</b></td><td class="niveauFixe">✅ Complet</td>` +
      roles.map((r) => {
        const n = reglesDuRole(r.key).niveaux[rub.key];
        return `<td><select data-role="${r.key}" data-rub="${esc(rub.key)}">${rub.niveaux.map((x) => option(x, n)).join('')}</select></td>`;
      }).join('') + '</tr>'
    ).join('') +
    '<tr><td><b>Valider les congés et absences</b><br><small>jamais sa propre demande</small></td><td class="niveauFixe">Oui</td>' +
    roles.map((r) => {
      const v = reglesDuRole(r.key).valider;
      return `<td><select data-role="${r.key}" data-valider><option value="oui"${v ? ' selected' : ''}>Oui</option>` +
        `<option value="non"${v ? '' : ' selected'}>Non</option></select></td>`;
    }).join('') +
    '</tr></tbody></table></div>' +
    '<p class="niveauxLegende">' +
    NIVEAUX.map((x) => `<span>${x.signe} <b>${esc(x.label)}</b></span>`).join('') +
    '</p>' +
    '<p><small>⛔ Masqué : la rubrique n’apparaît pas. 👁 Consultation : tout voir et exporter. ' +
    '✏️ Saisie : ajouter et modifier, sans supprimer. ✅ Complet : tout, suppression comprise. ' +
    '👤 Ses fiches : seulement ce qui concerne l’agent lié au compte — ' +
    RUBRIQUES_ACCES.filter((x) => x.siennes).map((x) => `${x.label.toLowerCase()} : ${x.siennes}`).join(' ; ') +
    '.</small></p>';

  const enregistrer = (role, modif) => {
    const acces = JSON.parse(JSON.stringify(DB.settings.acces || {}));
    const actuel = reglesDuRole(role);
    acces[role] = modif({ niveaux: Object.assign({}, actuel.niveaux), valider: actuel.valider });
    saveSettings({ acces });
    toast(`Niveaux du rôle « ${roleLabel(role)} » enregistrés.`, 'ok');
  };
  bloc.querySelectorAll('select[data-rub]').forEach((s) => {
    s.addEventListener('change', () => enregistrer(s.dataset.role, (r) => { r.niveaux[s.dataset.rub] = s.value; return r; }));
  });
  bloc.querySelectorAll('select[data-valider]').forEach((s) => {
    s.addEventListener('change', () => enregistrer(s.dataset.role, (r) => { r.valider = s.value === 'oui'; return r; }));
  });
  page.appendChild(bloc);

  page.appendChild(
    toolbar([
      {
        label: '↺ Rétablir les niveaux par défaut',
        color: COLORS.grey,
        onClick: async () => {
          if (!(await confirmDialog({
            title: 'Rétablir les niveaux par défaut',
            message: 'Tous les rôles reprennent les niveaux d’origine. Continuer ?',
            okLabel: 'Rétablir'
          }))) return;
          const acces = {};
          roles.forEach((r) => { acces[r.key] = reglesParDefaut(r.key); });
          saveSettings({ acces });
          toast('Niveaux par défaut rétablis.', 'ok');
          rerender();
        }
      }
    ])
  );
}

function accountFields(a = {}, withPassword) {
  return [
    { key: 'login', label: 'Identifiant', required: true, value: a.login, readonly: !!a.id },
    { key: 'nom', label: 'Nom complet', value: a.nom },
    { key: 'role', label: 'Rôle', type: 'select', options: ROLES.map((r) => ({ value: r.key, label: r.label })), value: a.role || 'direction' },
    { key: 'agent', label: 'Agent lié (UTILISATEURS)', type: 'select', allowEmpty: true, emptyLabel: '— aucun —',
      options: nomsUtilisateurs().slice().sort((x, y) => x.localeCompare(y, 'fr')), value: a.agent,
      hint: 'Indispensable pour un conducteur : ses missions, son véhicule et ses demandes se retrouvent par ce nom' },
    ...(withPassword
      ? [
          { key: 'password', label: 'Mot de passe', type: 'password', required: true, full: true, hint: '6 caractères minimum, avec au moins une lettre et un chiffre' },
          { key: 'password2', label: 'Confirmer le mot de passe', type: 'password', required: true, full: true }
        ]
      : [{ key: 'actif', label: 'État du compte', type: 'select', options: [{ value: 'oui', label: 'Actif' }, { value: 'non', label: 'Désactivé' }], value: a.actif === false ? 'non' : 'oui' }])
  ];
}

function openCreateAccount() {
  openForm({
    title: 'Créer un compte',
    intro: 'Le titulaire devra changer son mot de passe à la première connexion.',
    fields: accountFields({}, true),
    okLabel: 'Créer le compte',
    onSubmit: async (v) => {
      if (v.password !== v.password2) return 'Les deux mots de passe ne correspondent pas.';
      if (v.role === 'conducteur' && !v.agent) return 'Un compte « Conducteur » doit être lié à son agent.';
      const res = await createAccount({ login: v.login, nom: v.nom, role: v.role, agent: v.agent, password: v.password });
      if (!res.ok) return res.error;
      toast('Compte créé.', 'ok');
      rerender();
      return null;
    }
  });
}

function openEditAccount(a) {
  openForm({
    title: `Modifier le compte — ${a.login}`,
    fields: accountFields(a, false),
    okLabel: 'Enregistrer',
    onSubmit: (v) => {
      if (v.role === 'conducteur' && !v.agent) return 'Un compte « Conducteur » doit être lié à son agent.';
      const res = updateAccount(a.id, { nom: v.nom, role: v.role, agent: v.agent || '', actif: v.actif === 'oui' });
      if (!res.ok) return res.error;
      toast('Compte mis à jour.', 'ok');
      rerender();
      return null;
    }
  });
}

/** Valider une inscription : lui donner un role, un agent, et l'activer. */
function openValiderInscription(a) {
  const agent = DB.users.find((u) => `${u.nom || ''} ${u.prenoms || ''}`.trim() === a.agent);
  const role = agent && agent.poolConducteur === 'Oui' ? 'conducteur' : 'direction';
  openForm({
    title: `Valider l’inscription — ${a.nom || a.login}`,
    intro: `${a.nom || a.login} s’est inscrit(e) avec l’identifiant « ${a.login} ». Choisissez son rôle et l’agent lié ; ` +
      'le compte pourra servir aussitôt.',
    fields: [
      { key: 'role', label: 'Rôle', type: 'select', options: ROLES.map((r) => ({ value: r.key, label: r.label })), value: role },
      { key: 'agent', label: 'Agent lié (UTILISATEURS)', type: 'select', allowEmpty: true, emptyLabel: '— aucun —',
        options: nomsUtilisateurs().slice().sort((x, y) => x.localeCompare(y, 'fr')), value: a.agent,
        hint: a.agent ? 'Retrouvé d’après le nom donné à l’inscription' : 'Aucun agent ne porte exactement ce nom : choisissez-le' }
    ],
    okLabel: '✓ Valider le compte',
    onSubmit: (v) => {
      if (v.role === 'conducteur' && !v.agent) return 'Un compte « Conducteur » doit être lié à son agent.';
      const res = updateAccount(a.id, { role: v.role, agent: v.agent || '', actif: true });
      if (!res.ok) return res.error;
      toast(`Compte de ${a.nom || a.login} validé.`, 'ok');
      rerender();
      return null;
    }
  });
}

function openResetPassword(a) {
  openForm({
    title: `Réinitialiser le mot de passe — ${a.login}`,
    intro: 'Le titulaire devra le changer à sa prochaine connexion.',
    fields: [
      { key: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, full: true },
      { key: 'password2', label: 'Confirmer', type: 'password', required: true, full: true }
    ],
    okLabel: 'Réinitialiser',
    onSubmit: async (v) => {
      if (v.password !== v.password2) return 'Les deux mots de passe ne correspondent pas.';
      const res = await resetPassword(a.id, v.password);
      if (!res.ok) return res.error;
      toast('Mot de passe réinitialisé.', 'ok');
      rerender();
      return null;
    }
  });
}

/** Accessible aussi depuis la connexion quand un changement est impose. */
export function openChangeOwnPassword(onDone) {
  const u = currentUser();
  if (!u || u.guest) {
    toast('Le mode visiteur n’a pas de mot de passe.', 'info');
    return;
  }
  openForm({
    title: 'Changer mon mot de passe',
    fields: [
      { key: 'old', label: 'Mot de passe actuel', type: 'password', required: true, full: true },
      { key: 'pw', label: 'Nouveau mot de passe', type: 'password', required: true, full: true, hint: '6 caractères minimum, avec au moins une lettre et un chiffre' },
      { key: 'pw2', label: 'Confirmer le nouveau mot de passe', type: 'password', required: true, full: true }
    ],
    okLabel: 'Changer le mot de passe',
    onSubmit: async (v) => {
      if (v.pw !== v.pw2) return 'Les deux mots de passe ne correspondent pas.';
      const res = await changeOwnPassword(v.old, v.pw);
      if (!res.ok) return res.error;
      toast('Mot de passe modifié.', 'ok');
      if (onDone) onDone();
      return null;
    }
  });
}

/* ------------------------------ Seuils ----------------------------- */

function renderThresholdsSection(page) {
  page.appendChild(sectionLabel('SEUILS D’ALERTE ET IDENTITÉ', COLORS.orange));
  const s = DB.settings;
  page.appendChild(
    el(
      '<div class="card"><h3 style="color:#F47B20">PARAMÈTRES ACTUELS</h3><p>' +
        `Organisation : ${esc(s.organisation)}\n` +
        `Ville des documents : ${esc(s.ville)}\n` +
        `Devise : ${esc(s.devise)}\n` +
        `Prix du litre (Essence) : ${s.prixLitreEssence ? `${num(s.prixLitreEssence)} ${esc(s.devise)}` : 'non renseigné'}\n` +
        `Prix du litre (Diesel) : ${s.prixLitreDiesel ? `${num(s.prixLitreDiesel)} ${esc(s.devise)}` : 'non renseigné'}\n` +
        `Frais OM par participant et par destination (simulations) : ${num(fraisOmParParticipant())} ${esc(s.devise)}\n` +
        `Parcours en interne (simulations) : ${kmInterneParJour() ? `${num(kmInterneParJour())} km par jour` : 'non réglé'}\n` +
        `Immobilisation signalée au-delà de : ${num(s.seuilImmobilisationJours)} jour(s)\n` +
        `Mission impayée signalée au-delà de : ${num(s.seuilMissionImpayeeJours)} jour(s)\n` +
        `Intervalle de vidange : ${num(s.seuilVidangeKm)} km
` +
        `Alerte vidange quand il reste moins de : ${num(s.seuilAlerteVidangeKm)} km` +
        '</p></div>'
    )
  );
  page.appendChild(
    toolbar([{ label: '✎ Modifier les réglages', cls: 'addBtn', color: COLORS.orange, onClick: openSettingsForm }])
  );
}

function openSettingsForm() {
  const s = DB.settings;
  openForm({
    title: 'Réglages de l’application',
    fields: [
      { key: 'organisation', label: 'Nom de l’organisation', value: s.organisation, full: true },
      { key: 'ville', label: 'Ville des documents', value: s.ville,
        hint: 'Portée par la mention « Fait à … le … » en pied des exports' },
      { key: 'devise', label: 'Symbole monétaire', value: s.devise },
      // Le prix a la pompe est le meme pour tout le monde a une date donnee :
      // il se fixe ici et se choisit ensuite dans une liste, au lieu de se
      // retaper a chaque prise de carburant.
      { key: 'prixLitreEssence', label: 'Prix du litre (Essence)', type: 'number', value: s.prixLitreEssence,
        hint: 'Proposé dans le champ « Prix / L » des dotations et des rapports de mission' },
      { key: 'prixLitreDiesel', label: 'Prix du litre (Diesel)', type: 'number', value: s.prixLitreDiesel,
        hint: 'Laisser à 0 tant que le prix n’est pas connu : il n’est alors pas proposé' },
      { key: 'fraisOmParParticipant', label: 'Frais OM par participant et par destination', type: 'number', value: fraisOmParParticipant(),
        hint: 'Utilisé par SIMULATION : frais OM = participants × ce montant' },
      { key: 'parcoursInterneKmParJour', label: 'Parcours en interne (km par jour)', type: 'number', value: kmInterneParJour(),
        hint: 'Utilisé par SIMULATION : km à l’intérieur d’une destination = jours sur place × ce nombre. 0 = non réglé' },
      { key: 'seuilImmobilisationJours', label: 'Alerte immobilisation (jours)', type: 'number', value: s.seuilImmobilisationJours },
      { key: 'seuilMissionImpayeeJours', label: 'Alerte mission impayée (jours)', type: 'number', value: s.seuilMissionImpayeeJours },
      { key: 'seuilVidangeKm', label: 'Intervalle de vidange (km)', type: 'number', value: s.seuilVidangeKm,
        hint: 'Sert à proposer le kilométrage de la prochaine vidange' },
      { key: 'seuilAlerteVidangeKm', label: 'Alerte vidange (km restants)', type: 'number', value: s.seuilAlerteVidangeKm,
        hint: 'Alerte dès qu’il reste moins que cela à parcourir' }
    ],
    okLabel: 'Enregistrer',
    onSubmit: (v) => {
      saveSettings({
        organisation: v.organisation || 'PDU',
        ville: v.ville || 'Abidjan',
        devise: v.devise || 'F',
        prixLitreEssence: francSup(v.prixLitreEssence),
        prixLitreDiesel: francSup(v.prixLitreDiesel),
        // Vide : on revient aux 1 000 F d'origine ; zero reste un choix possible.
        fraisOmParParticipant: v.fraisOmParParticipant === '' ? FRAIS_OM_PAR_PARTICIPANT : francSup(v.fraisOmParParticipant),
        parcoursInterneKmParJour: Math.max(0, num(v.parcoursInterneKmParJour)),
        seuilImmobilisationJours: num(v.seuilImmobilisationJours) || 7,
        seuilMissionImpayeeJours: num(v.seuilMissionImpayeeJours) || 30,
        seuilVidangeKm: num(v.seuilVidangeKm) || 5000,
        seuilAlerteVidangeKm: num(v.seuilAlerteVidangeKm) || 500
      });
      toast('Réglages enregistrés.', 'ok');
      rerender();
      return null;
    }
  });
}

/* --------------------------- Sauvegardes --------------------------- */

function renderBackupSection(page) {
  page.appendChild(sectionLabel('SAUVEGARDE ET RESTAURATION', COLORS.green));
  page.appendChild(
    toolbar([
      { label: '💾 Exporter une sauvegarde (.json)', cls: 'addBtn', color: COLORS.green, onClick: doBackup },
      { label: '📂 Restaurer une sauvegarde', color: COLORS.blue, onClick: doRestore },
      { label: '🗑 Vider toutes les données', color: COLORS.red, onClick: doWipe }
    ])
  );

  const info = el('<div class="card"><h3 style="color:#008A3B">INFORMATIONS TECHNIQUES</h3><p>Chargement…</p></div>');
  page.appendChild(info);
  dataLocation().then((loc) => {
    info.querySelector('p').textContent =
      `Plateforme : ${platformName}\n` +
      `Emplacement des données : ${loc}\n` +
      `Version du format : ${DB.version}\n` +
      `Créée le : ${new Date(DB.meta.createdAt).toLocaleString('fr-FR')}\n` +
      `Dernière modification : ${new Date(DB.meta.updatedAt).toLocaleString('fr-FR')}\n` +
      `Contenu : ${countRecords()} enregistrement(s)`;
  });
}

function countRecords() {
  return (
    DB.vehicles.pool.length + DB.vehicles.mission.length + DB.vehicles.service.length + DB.vehicles.reforme.length +
    DB.users.length + DB.dotationPool.length +
    DB.missions.length + DB.maintenance.length
  );
}

async function doBackup() {
  try {
    await persistNow();
    // Une archive, et non plus un .json : depuis que les fiches portent des
    // photos rangées hors de la base, un fichier de données seul ne
    // ramènerait qu'une moitié de sauvegarde.
    const { octets, images, manquantes } = await construireArchive(DB);
    const res = await saveFile(
      `PDU_sauvegarde_${new Date().toISOString().slice(0, 10)}.zip`, octets, 'application/zip'
    );
    if (!res) return toast('Sauvegarde annulée.', 'info');
    toast(
      manquantes.length
        ? `Sauvegarde enregistrée (${images} image(s)) — ${manquantes.length} introuvable(s), non incluse(s).`
        : `Sauvegarde enregistrée : données et ${images} image(s).`,
      manquantes.length ? 'info' : 'ok'
    );
  } catch (e) {
    console.error(e);
    toast('La sauvegarde a échoué.', 'err');
  }
}

async function doRestore() {
  const fichier = await openBinaryFile();
  if (!fichier) return;
  let parsed;
  let imagesReprises = 0;
  try {
    // Archive ou ancien .json : la lecture accepte les deux. Une restauration
    // ne doit pas dépendre de la version qui a produit la sauvegarde.
    const lu = await lireArchive(fichier.octets);
    parsed = lu.base;
    imagesReprises = lu.images;
  } catch (e) {
    toast('Fichier illisible : ce n’est pas une sauvegarde valide.', 'err');
    return;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.vehicles) {
    toast('Ce fichier ne ressemble pas à une sauvegarde PDU.', 'err');
    return;
  }
  const nb =
    (parsed.vehicles.pool || []).length + (parsed.vehicles.mission || []).length + (parsed.vehicles.service || []).length +
    (parsed.vehicles.reforme || []).length;
  const ok = await confirmDialog({
    title: 'Restaurer la sauvegarde',
    message:
      `La sauvegarde contient ${nb} véhicule(s), ${(parsed.users || []).length} utilisateur(s) et ${(parsed.missions || []).length} mission(s).\n\n` +
      `${imagesReprises ? `L’archive apporte aussi ${imagesReprises} image(s).\n` : ''}` +
      'Toutes les données actuelles seront remplacées. Cette action est irréversible.',
    okLabel: 'Restaurer',
    danger: true
  });
  if (!ok) return;
  await replaceDB(parsed);
  toast('Sauvegarde restaurée.', 'ok');
  rerender();
}

async function doWipe() {
  const ok = await confirmDialog({
    title: 'Vider toutes les données',
    message:
      'Tous les véhicules, utilisateurs, dotations, missions et fiches d’entretien seront définitivement effacés.\n\n' +
      'Les comptes d’accès sont conservés. Pensez à exporter une sauvegarde avant de continuer.',
    okLabel: 'Tout effacer',
    danger: true
  });
  if (!ok) return;
  const second = await confirmDialog({
    title: 'Confirmation finale',
    message: 'Confirmez-vous la suppression définitive de toutes les données du parc ?',
    okLabel: 'Oui, tout effacer',
    danger: true
  });
  if (!second) return;

  const fresh = emptyDB();
  fresh.accounts = DB.accounts;
  fresh.settings = DB.settings;
  await replaceDB(fresh);
  toast('Toutes les données ont été effacées.', 'ok');
  rerender();
}
