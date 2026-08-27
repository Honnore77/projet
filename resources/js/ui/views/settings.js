/* ===================================================================
   RÉGLAGES — comptes, seuils d'alerte, sauvegarde et restauration.
   Rubrique reservee aux administrateurs (voir MODULES dans shell.js).
   =================================================================== */

import { DB, persistNow, replaceDB, emptyDB, saveSettings } from '../../core/db.js';
import {
  ROLES, currentUser, canAdmin, roleLabel, listAccounts,
  createAccount, updateAccount, deleteAccount, resetPassword, changeOwnPassword
} from '../../core/auth.js';
import { platformName, dataLocation, saveFile, openTextFile } from '../../core/storage.js';
import { esc, el, num } from '../../core/utils.js';
import {
  card, toolbar, openForm, confirmDialog, toast, sectionLabel, dataTable, COLORS
} from '../components.js';
import { rerender } from '../shell.js';

export function renderSettings(page) {
  if (!canAdmin()) {
    page.appendChild(card('ACCÈS RESTREINT', 'Cette rubrique est réservée aux administrateurs.', COLORS.red));
    return;
  }

  page.appendChild(
    card('RÉGLAGES', 'Comptes utilisateurs, seuils d’alerte du tableau de bord, sauvegarde et restauration des données.', COLORS.purple)
  );

  renderAccountsSection(page);
  renderThresholdsSection(page);
  renderBackupSection(page);
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

  const accounts = listAccounts();
  page.appendChild(
    dataTable(
      ['Identifiant', 'Nom', 'Rôle', 'État', 'Dernière connexion', 'Actions'],
      accounts.map((a) => [
        `<b>${esc(a.login)}</b>${a.mustChange ? '<br><small style="color:#F47B20">mot de passe à changer</small>' : ''}`,
        esc(a.nom || ''),
        esc(roleLabel(a.role)),
        a.actif ? '🟢 Actif' : '🔴 Désactivé',
        a.lastLogin ? new Date(a.lastLogin).toLocaleString('fr-FR') : '—',
        `<button class="miniBtn" style="background:${COLORS.green};padding:5px 8px" data-edit>✎</button> ` +
          `<button class="miniBtn" style="background:${COLORS.orange};padding:5px 8px" data-reset>🔑</button> ` +
          `<button class="miniBtn" style="background:${COLORS.red};padding:5px 8px" data-del>✕</button>`
      ]),
      (tr, i) => {
        const a = accounts[i];
        tr.querySelector('[data-edit]').onclick = () => openEditAccount(a);
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
        '\n\nLe bouton « Continuer en visiteur » de l’écran de connexion ouvre une session ' +
        'de consultation sans compte.' +
        '</p></div>'
    )
  );
}

function accountFields(a = {}, withPassword) {
  return [
    { key: 'login', label: 'Identifiant', required: true, value: a.login, readonly: !!a.id },
    { key: 'nom', label: 'Nom complet', value: a.nom },
    { key: 'role', label: 'Rôle', type: 'select', options: ROLES.map((r) => ({ value: r.key, label: r.label })), value: a.role || 'visiteur' },
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
      const res = await createAccount({ login: v.login, nom: v.nom, role: v.role, password: v.password });
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
      const res = updateAccount(a.id, { nom: v.nom, role: v.role, actif: v.actif === 'oui' });
      if (!res.ok) return res.error;
      toast('Compte mis à jour.', 'ok');
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
        `Devise : ${esc(s.devise)}\n` +
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
      { key: 'devise', label: 'Symbole monétaire', value: s.devise },
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
        devise: v.devise || 'F',
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
    DB.vehicles.pool.length + DB.vehicles.mission.length + DB.vehicles.service.length +
    DB.users.length + DB.dotationPool.length +
    DB.missions.length + DB.maintenance.length
  );
}

async function doBackup() {
  try {
    await persistNow();
    const json = JSON.stringify(DB, null, 2);
    const res = await saveFile(`PDU_sauvegarde_${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
    toast(res ? 'Sauvegarde enregistrée.' : 'Sauvegarde annulée.', res ? 'ok' : 'info');
  } catch (e) {
    console.error(e);
    toast('La sauvegarde a échoué.', 'err');
  }
}

async function doRestore() {
  const raw = await openTextFile();
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    toast('Fichier illisible : ce n’est pas une sauvegarde valide.', 'err');
    return;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.vehicles) {
    toast('Ce fichier ne ressemble pas à une sauvegarde PDU.', 'err');
    return;
  }
  const nb =
    (parsed.vehicles.pool || []).length + (parsed.vehicles.mission || []).length + (parsed.vehicles.service || []).length;
  const ok = await confirmDialog({
    title: 'Restaurer la sauvegarde',
    message:
      `La sauvegarde contient ${nb} véhicule(s), ${(parsed.users || []).length} utilisateur(s) et ${(parsed.missions || []).length} mission(s).\n\n` +
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
