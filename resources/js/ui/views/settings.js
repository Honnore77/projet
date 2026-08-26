/* ===================================================================
   RÉGLAGES — comptes, serveur, synchronisation, seuils, sauvegardes.
   Rubrique reservee aux administrateurs (voir MODULES dans shell.js).
   =================================================================== */

import { DB, persistNow, replaceDB, emptyDB, saveSettings, queueEverything, outboxSize, remove } from '../../core/db.js';
import {
  ROLES, currentUser, canAdmin, roleLabel, isOfflineSession,
  fetchAccounts, createAccount, updateAccount, deleteAccount, resetPassword,
  changeOwnPassword, forgetDevice
} from '../../core/auth.js';
import { platformName, dataLocation, saveFile, openTextFile, isDesktop } from '../../core/storage.js';
import { api, setServerUrl, getServerUrl, ApiError } from '../../core/api.js';
import { syncNow, syncState, resetSyncState } from '../../core/sync.js';
import { esc, el, num } from '../../core/utils.js';
import {
  card, toolbar, openForm, confirmDialog, toast, sectionLabel, dataTable, emptyState, COLORS
} from '../components.js';
import { rerender } from '../shell.js';

export function renderSettings(page) {
  if (!canAdmin()) {
    page.appendChild(card('ACCÈS RESTREINT', 'Cette rubrique est réservée aux administrateurs.', COLORS.red));
    return;
  }

  page.appendChild(
    card('RÉGLAGES', 'Comptes utilisateurs, serveur et synchronisation, seuils d’alerte, sauvegarde et restauration.', COLORS.purple)
  );

  renderSyncSection(page);
  renderAccountsSection(page);
  renderThresholdsSection(page);
  renderBackupSection(page);
}

/* --------------------------- Synchronisation ----------------------- */

function renderSyncSection(page) {
  page.appendChild(sectionLabel('SERVEUR ET SYNCHRONISATION', COLORS.blue));

  const s = syncState();
  const etat = isOfflineSession()
    ? '🟠 Session ouverte hors ligne — reconnectez-vous pour synchroniser'
    : s.online
      ? '🟢 Connecté au serveur'
      : '🔴 Hors ligne — les modifications sont mises en attente';

  const box = el('<div class="card"><h3 style="color:#1976D2">ÉTAT</h3><p></p></div>');
  box.querySelector('p').textContent =
    `${etat}\n` +
    `Serveur : ${getServerUrl() || (isDesktop ? 'non configuré' : window.location.origin)}\n` +
    `Modifications en attente d’envoi : ${s.pending}\n` +
    `Dernière synchronisation : ${s.lastPull ? new Date(s.lastPull).toLocaleString('fr-FR') : 'jamais'}` +
    (s.lastError ? `\nDernière erreur : ${s.lastError}` : '');
  page.appendChild(box);

  page.appendChild(
    toolbar([
      {
        label: '🔄 Synchroniser maintenant',
        cls: 'addBtn',
        color: COLORS.blue,
        onClick: async () => {
          toast('Synchronisation en cours…', 'info');
          const res = await syncNow({ full: false });
          toast(
            res.ok
              ? `Synchronisé — ${res.sent || 0} envoyée(s), ${res.received || 0} reçue(s).`
              : res.error,
            res.ok ? 'ok' : 'err'
          );
          rerender();
        }
      },
      {
        label: '⬆ Tout renvoyer au serveur',
        color: COLORS.orange,
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Tout renvoyer au serveur',
            message:
              `Les ${countRecords()} enregistrements de ce poste seront renvoyés au serveur.\n\n` +
              'Pour chaque fiche, la version de ce poste remplacera celle du serveur si elle est plus récente. ' +
              'À utiliser après une restauration de sauvegarde, ou si vous doutez que tout soit bien remonté.',
            okLabel: 'Tout renvoyer'
          });
          if (!ok) return;
          queueEverything();
          const res = await syncNow();
          toast(res.ok ? 'Envoi terminé.' : res.error, res.ok ? 'ok' : 'err');
          rerender();
        }
      },
      isDesktop && {
        label: '🖧 Changer l’adresse du serveur',
        color: COLORS.grey,
        onClick: openServerForm
      },
      {
        label: '🚪 Déconnecter ce poste',
        color: COLORS.red,
        onClick: async () => {
          const pending = outboxSize();
          const ok = await confirmDialog({
            title: 'Déconnecter ce poste',
            message:
              (pending
                ? `⚠ ${pending} modification(s) n’ont pas encore été envoyées au serveur et seront perdues.\n\n`
                : '') +
              'Le jeton d’accès sera révoqué sur le serveur et ce poste oubliera le compte : ' +
              'la prochaine connexion exigera le réseau.',
            okLabel: 'Déconnecter',
            danger: true
          });
          if (!ok) return;
          await forgetDevice();
          window.location.reload();
        }
      }
    ])
  );
}

function openServerForm() {
  openForm({
    title: 'Adresse du serveur',
    intro: 'Changer de serveur revient à repartir d’une base différente. Les données déjà présentes sur ce poste restent, mais devront être renvoyées.',
    fields: [{ key: 'url', label: 'Adresse', required: true, full: true, value: getServerUrl(), placeholder: 'https://…' }],
    okLabel: 'Tester et enregistrer',
    onSubmit: async (v) => {
      const previous = getServerUrl();
      setServerUrl(v.url);
      try {
        await api.health();
      } catch (e) {
        setServerUrl(previous);
        return e instanceof ApiError && e.isOffline
          ? 'Serveur injoignable à cette adresse.'
          : `Réponse inattendue : ${e.message}`;
      }
      DB.sync.serverUrl = getServerUrl();
      resetSyncState();
      await persistNow();
      toast('Adresse enregistrée. Reconnectez-vous pour ouvrir une session.', 'ok');
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

  const holder = el('<div></div>');
  page.appendChild(holder);
  holder.appendChild(emptyState('Chargement des comptes…'));

  fetchAccounts()
    .then((accounts) => {
      holder.innerHTML = '';
      if (!accounts.length) {
        holder.appendChild(emptyState('Aucun compte.'));
        return;
      }
      holder.appendChild(
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
              const res = await deleteAccount(a.id);
              toast(res.ok ? 'Compte supprimé.' : res.error, res.ok ? 'ok' : 'err');
              rerender();
            };
          }
        )
      );
    })
    .catch((e) => {
      holder.innerHTML = '';
      holder.appendChild(
        emptyState(
          e instanceof ApiError && e.isOffline
            ? 'La gestion des comptes demande une connexion au serveur.'
            : `Comptes indisponibles : ${e.message}`
        )
      );
    });

  page.appendChild(
    el(
      '<div class="card"><h3 style="color:#5b7178">RÔLES</h3><p>' +
        ROLES.map((r) => `${r.label} — ${r.desc}`).join('\n') +
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
    onSubmit: async (v) => {
      const res = await updateAccount(a.id, { nom: v.nom, role: v.role, actif: v.actif === 'oui' });
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
    intro: 'Le titulaire devra le changer à sa prochaine connexion. Ses sessions ouvertes seront fermées.',
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
  if (!u) {
    toast('Aucun compte connecté.', 'info');
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
        `Intervalle de vidange indicatif : ${num(s.seuilVidangeKm)} km\n\n` +
        'Ces réglages sont partagés : ils s’appliquent à tous les postes.' +
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
      { key: 'seuilVidangeKm', label: 'Intervalle de vidange (km)', type: 'number', value: s.seuilVidangeKm }
    ],
    okLabel: 'Enregistrer',
    onSubmit: (v) => {
      saveSettings({
        organisation: v.organisation || 'PDU',
        devise: v.devise || 'F',
        seuilImmobilisationJours: num(v.seuilImmobilisationJours) || 7,
        seuilMissionImpayeeJours: num(v.seuilMissionImpayeeJours) || 30,
        seuilVidangeKm: num(v.seuilVidangeKm) || 5000
      });
      toast('Réglages enregistrés et partagés.', 'ok');
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
      `Copie locale : ${loc}\n` +
      `Base de référence : ${getServerUrl() || window.location.origin}\n` +
      `Version du format local : ${DB.version}\n` +
      `Dernière modification locale : ${new Date(DB.meta.updatedAt).toLocaleString('fr-FR')}\n` +
      `Contenu : ${countRecords()} enregistrement(s)`;
  });
}

function countRecords() {
  return (
    DB.vehicles.pool.length + DB.vehicles.mission.length + DB.vehicles.service.length +
    DB.users.length + DB.dotationPool.length + DB.dotationMission.length +
    DB.missions.length + DB.maintenance.length
  );
}

async function doBackup() {
  try {
    await persistNow();
    const copy = Object.assign({}, DB);
    delete copy.sync;         // jeton d'acces : ne doit pas voyager dans une sauvegarde
    delete copy.credentials;  // empreinte du mot de passe : idem
    const json = JSON.stringify(copy, null, 2);
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
      'Elle remplacera les données de ce poste, puis sera envoyée au serveur — donc à tous les autres postes. ' +
      'Cette action est irréversible.',
    okLabel: 'Restaurer',
    danger: true
  });
  if (!ok) return;
  await replaceDB(parsed, { push: true });
  const res = await syncNow();
  toast(res.ok ? 'Sauvegarde restaurée et envoyée au serveur.' : 'Sauvegarde restaurée localement ; envoi en attente.', 'ok');
  rerender();
}

async function doWipe() {
  const ok = await confirmDialog({
    title: 'Vider toutes les données',
    message:
      'Tous les véhicules, utilisateurs, dotations, missions et fiches d’entretien seront effacés — ' +
      'sur ce poste puis, à la synchronisation, sur le serveur et donc sur tous les autres postes.\n\n' +
      'Les comptes d’accès sont conservés. Exportez une sauvegarde avant de continuer.',
    okLabel: 'Tout effacer',
    danger: true
  });
  if (!ok) return;
  const second = await confirmDialog({
    title: 'Confirmation finale',
    message: 'Confirmez-vous la suppression définitive de toutes les données du parc, pour tout le monde ?',
    okLabel: 'Oui, tout effacer',
    danger: true
  });
  if (!second) return;

  // On passe par des suppressions unitaires : le serveur doit apprendre que
  // chaque fiche a disparu, sans quoi la prochaine descente les ramenerait.
  ['pool', 'mission', 'service'].forEach((cat) => {
    DB.vehicles[cat].slice().forEach((v) => remove(`vehicles.${cat}`, v.id));
  });
  ['users', 'dotationPool', 'dotationMission', 'missions', 'maintenance'].forEach((name) => {
    DB[name].slice().forEach((r) => remove(name, r.id));
  });

  await persistNow();
  const res = await syncNow();
  toast(res.ok ? 'Toutes les données ont été effacées.' : 'Données effacées localement ; suppression en attente d’envoi.', 'ok');
  rerender();
}

export { emptyDB };
