/* ===================================================================
   DEMANDES DE CONGE ET D'ABSENCE — sous-rubrique CONGES ET ABSENCES AU
   POOL de UTILISATEURS.

   Deux formulaires, rangés dans une même liste `demandes` :

     type 'conge'    DEMANDE DE CONGE : la demande de départ en congé et
                     la fiche d'intérim qui l'accompagne ;
     type 'absence'  DEMANDE D'ABSENCE : la demande d'autorisation
                     d'absence (quelques heures ou quelques jours).

   Chaque demande s'exporte sur les imprimés officiels du PDU
   (export/demandes.js). Elle peut aussi s'inscrire au tableau des congés
   et absences : le conducteur sort alors du tour de rôle pendant son
   absence, comme pour une absence saisie à la main.
   =================================================================== */

import { daysBetween } from './utils.js';

export const TYPES_DEMANDE = {
  conge: 'Demande de congé',
  absence: 'Demande d’absence'
};

/** Motif de l'absence inscrite au tableau, selon la demande. */
export const MOTIF_DEMANDE = { conge: 'En congé', absence: 'Permissionnaire' };

/** Le lendemain d'une date ISO. */
export function lendemain(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Durée d'un congé, du premier au dernier jour compris : du 5 au 8, quatre
 * jours. Vide tant qu'une date manque ou si la fin précède le début.
 */
export function dureeConge(debut, fin) {
  const d = daysBetween(debut, fin);
  if (d === null || d < 0) return '';
  const n = d + 1;
  return `${n} jour${n > 1 ? 's' : ''}`;
}

/** Minutes depuis minuit d'une heure « hh:mm », ou null. */
function minutes(h) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Total demandé pour une absence. Le même jour : les heures entre le
 * départ et le retour (« 3 h 30 »). Sur plusieurs jours : les jours
 * d'absence, le jour du retour n'en faisant pas partie.
 */
export function totalAbsence(dateDebut, heureDebut, dateRetour, heureRetour) {
  if (!dateDebut) return '';
  const fin = dateRetour || dateDebut;
  const jours = daysBetween(dateDebut, fin);
  if (jours === null || jours < 0) return '';
  if (jours === 0) {
    const a = minutes(heureDebut), b = minutes(heureRetour);
    if (a === null || b === null || b <= a) return '';
    const t = b - a, h = Math.floor(t / 60), mn = t % 60;
    return mn ? `${h} h ${String(mn).padStart(2, '0')}` : `${h} h`;
  }
  return `${jours} jour${jours > 1 ? 's' : ''}`;
}

/**
 * Les dates de l'absence à inscrire au tableau des congés et absences,
 * dont la date de reprise est le jour du retour au poste. Une absence de
 * quelques heures compte pour sa journée.
 */
export function periodeAuTableau(d) {
  if (d.type === 'conge') {
    if (!d.dateDebut) return null;
    return { dateDepart: d.dateDebut, dateReprise: d.dateReprise || lendemain(d.dateFin) };
  }
  if (!d.dateDebut) return null;
  const retour = d.dateRetour && d.dateRetour > d.dateDebut ? d.dateRetour : lendemain(d.dateDebut);
  return { dateDepart: d.dateDebut, dateReprise: retour };
}

/**
 * Où en est la décision sur une demande : 'oui', 'non' ou 'en cours'.
 * La demande d'absence la porte dans « Absence autorisée » (imprimée sur
 * la fiche), la demande de congé dans « Demande validée ».
 */
export function etatValidation(d) {
  const v = String((d && (d.type === 'absence' ? d.autorisee : d.validee)) || '').toLowerCase();
  return v === 'oui' ? 'oui' : v === 'non' ? 'non' : 'en cours';
}

/** Motifs d'absence qui ne se soumettent pas a validation. */
export const MOTIFS_SANS_VALIDATION = ['Repos maladie'];

/**
 * La décision sur une absence du tableau : 'oui', 'non', 'en cours', ou
 * 'non soumis' pour un repos maladie. Une absence née d'une demande prend
 * la décision de sa demande ; une absence saisie à la main porte la sienne.
 */
export function validationAbsence(i, demandes = []) {
  if (!i) return 'en cours';
  if (MOTIFS_SANS_VALIDATION.includes(i.motif)) return 'non soumis';
  const d = demandes.find((x) => x.id === i.demandeId || (x.indispoId && x.indispoId === i.id));
  if (d) return etatValidation(d);
  const v = String(i.validee || '').toLowerCase();
  return v === 'oui' ? 'oui' : v === 'non' ? 'non' : 'en cours';
}

/**
 * Ce qu'il faut écrire sur la demande pour qu'elle porte la décision
 * saisie sur son absence : « Demande validée » ou « Absence autorisée ».
 */
export function decisionPourDemande(d, validee) {
  const v = validee === 'Oui' ? 'oui' : validee === 'Non' ? 'non' : '';
  if (d.type === 'absence') return { autorisee: v === 'oui' ? 'OUI' : v === 'non' ? 'NON' : '' };
  return { validee: v === 'oui' ? 'Oui' : v === 'non' ? 'Non' : '' };
}

/** Les lignes d'une zone de texte, sans les vides, dans la limite donnée. */
export function lignes(texte, max) {
  return String(texte || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}
