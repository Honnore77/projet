/* ===================================================================
   SYNCHRONISATION — fusion de deux bases (le PC et le telephone).

   Le code QR ne fait que relier les deux appareils ; ce module dit ce que
   devient la base une fois les deux versions reunies. Il ne connait ni le
   reseau ni l'ecran : il prend deux bases, rend la base fusionnee et un
   compte rendu, et se teste donc pour de vrai.

   Trois idees :

   1. Chaque fiche porte la date de sa derniere modification (`maj`) et
      l'appareil qui l'a faite (`majPar`). Ces champs sont poses
      automatiquement a l'enregistrement (voir estampiller), en comparant
      chaque fiche a son empreinte d'avant : aucune rubrique n'a a y penser.

   2. Une fiche supprimee laisse une trace (`synchro.suppressions`) : sans
      elle, l'autre appareil, qui l'a encore, la ferait revenir.

   3. A la fusion, une fiche presente des deux cotes et differente garde sa
      version la plus recente. Si les deux ont change depuis la derniere
      synchronisation entre ces deux appareils, c'est un conflit : la plus
      recente l'emporte, et le compte rendu le dit.
   =================================================================== */

/** Collections synchronisees, telles qu'elles sont rangees dans la base. */
export const COLLECTIONS_SYNCHRO = [
  'accounts', 'users', 'dotationPool', 'missions', 'maintenance',
  'decharges', 'destinataires', 'garages', 'vidanges', 'destinationsMission', 'trajets', 'simulations', 'indisponibilites',
  'demandes', 'notes', 'suiviComptes', 'etatsVehicules'
];

/** Les vehicules, ranges par categorie, se synchronisent comme une seule liste. */
const VEHICULES = 'vehicules';
const CATEGORIES = ['pool', 'mission', 'service', 'reforme'];

/**
 * Reglages propres a chaque appareil : le dossier de sauvegarde d'un PC n'a
 * aucun sens sur un telephone.
 */
const REGLAGES_LOCAUX = ['dossierSauvegarde', 'sauvegardesConservees'];

/** Les traces de suppression sont oubliees au bout de 400 jours. */
const DUREE_TRACES_MS = 400 * 24 * 3600 * 1000;

/** Libelles des collections, pour le compte rendu. */
export const LIBELLES_COLLECTIONS = {
  accounts: 'Comptes', users: 'Utilisateurs', dotationPool: 'Dotations pool', missions: 'Missions',
  maintenance: 'Entretien', decharges: 'Courses', destinataires: 'Destinataires', garages: 'Garages', vidanges: 'Vidanges',
  destinationsMission: 'Destinations', trajets: 'Trajets', simulations: 'Simulations',
  indisponibilites: 'Congés et absences', demandes: 'Demandes de congé et d’absence', notes: 'Notes', suiviComptes: 'Suivi des comptes', etatsVehicules: 'État des véhicules', vehicules: 'Véhicules', reglages: 'Réglages'
};

/* ---------------------------- Empreintes ---------------------------- */

/** Empreinte courte d'une fiche (FNV-1a 32 bits), sans ses champs de datation. */
export function empreinte(fiche) {
  const copie = Object.assign({}, fiche);
  delete copie.maj;
  delete copie.majPar;
  const texte = JSON.stringify(copie);
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i += 1) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Les fiches d'une collection, avec leur identifiant. */
function fichesDe(db, collection) {
  if (collection === VEHICULES) {
    return CATEGORIES.flatMap((cat) => ((db.vehicles || {})[cat] || []).map((v) => ({ fiche: v, cat })));
  }
  if (collection === 'reglages') return [{ fiche: db.settings || {}, id: 'reglages' }];
  return (db[collection] || []).map((fiche) => ({ fiche }));
}

/** Empreinte d'une fiche de vehicule : sa categorie en fait partie (un vehicule deplace a change). */
function empreinteEntree(e, collection) {
  if (collection === VEHICULES) return empreinte(Object.assign({}, e.fiche, { _cat: e.cat }));
  if (collection === 'reglages') return empreinte(sansReglagesLocaux(e.fiche));
  return empreinte(e.fiche);
}

function sansReglagesLocaux(s) {
  const c = Object.assign({}, s);
  REGLAGES_LOCAUX.forEach((k) => delete c[k]);
  return c;
}

const TOUTES = () => [...COLLECTIONS_SYNCHRO, VEHICULES, 'reglages'];

/** Empreintes de toute la base : { collection: { id: empreinte } }. */
export function empreintesDe(db) {
  const out = {};
  TOUTES().forEach((c) => {
    out[c] = {};
    fichesDe(db, c).forEach((e) => {
      const id = e.id || e.fiche.id;
      if (id) out[c][id] = empreinteEntree(e, c);
    });
  });
  return out;
}

/**
 * Pose la date de modification sur les fiches qui ont change depuis les
 * empreintes donnees, et note les suppressions. Rend les nouvelles
 * empreintes.
 *
 * @param {object} db
 * @param {object} avant      empreintes precedentes (empreintesDe)
 * @param {string} maintenant date ISO
 * @param {string} appareil   identifiant de cet appareil
 */
export function estampiller(db, avant, maintenant, appareil) {
  const apres = {};
  if (!db.synchro) db.synchro = {};
  if (!Array.isArray(db.synchro.suppressions)) db.synchro.suppressions = [];
  TOUTES().forEach((c) => {
    apres[c] = {};
    const precedent = (avant && avant[c]) || {};
    fichesDe(db, c).forEach((e) => {
      const id = e.id || e.fiche.id;
      if (!id) return;
      const h = empreinteEntree(e, c);
      apres[c][id] = h;
      if (precedent[id] !== h) {
        e.fiche.maj = maintenant;
        e.fiche.majPar = appareil;
      }
    });
    Object.keys(precedent).forEach((id) => {
      if (apres[c][id] === undefined && c !== 'reglages') {
        db.synchro.suppressions.push({ c, id, date: maintenant, par: appareil });
      }
    });
  });
  return apres;
}

/* ------------------------------ Fusion ------------------------------ */

/** Traces de suppression des deux cotes, la plus recente par fiche, les trop vieilles oubliees. */
function reunirSuppressions(a, b, maintenant) {
  const limite = new Date(new Date(maintenant).getTime() - DUREE_TRACES_MS).toISOString();
  const par = new Map();
  [...(a || []), ...(b || [])].forEach((t) => {
    if (!t || !t.c || !t.id || (t.date || '') < limite) return;
    const k = `${t.c}|${t.id}`;
    if (!par.has(k) || (par.get(k).date || '') < (t.date || '')) par.set(k, t);
  });
  return [...par.values()];
}

/** Un libelle lisible pour une fiche, dans le compte rendu. */
export function libelleFiche(c, f) {
  if (!f) return '';
  if (c === VEHICULES) return [f.immatNouvelle || f.immatAncienne, `${f.marque || ''} ${f.modele || ''}`.trim()].filter(Boolean).join(' — ');
  if (c === 'users') return `${f.nom || ''} ${f.prenoms || ''}`.trim();
  if (c === 'accounts') return f.login || f.nom || '';
  if (c === 'missions') return [f.ref, f.conducteur].filter(Boolean).join(' — ');
  if (c === 'dotationPool') return [f.date, f.immat].filter(Boolean).join(' — ');
  if (c === 'maintenance') return [f.dateEntree, f.immat].filter(Boolean).join(' — ');
  if (c === 'decharges') return [f.ref, f.destinataire].filter(Boolean).join(' — ');
  if (c === 'indisponibilites') return [f.conducteur, f.motif, f.dateDepart].filter(Boolean).join(' — ');
  if (c === 'demandes') return [f.agent || f.nomPrenoms, f.type === 'conge' ? 'congé' : 'absence', f.dateDebut].filter(Boolean).join(' — ');
  if (c === 'suiviComptes') return f.id;
  if (c === 'etatsVehicules') return [f.immat, f.probleme && f.probleme.split('\n')[0]].filter(Boolean).join(' — ');
  if (c === 'notes') return [f.auteurNom, f.sujet].filter(Boolean).join(' — ');
  if (c === 'trajets') return `${f.a || ''} — ${f.b || ''}`;
  if (c === 'simulations') return (f.destinations || []).join(', ') || f.dateDepart || '';
  return f.nom || f.ref || f.id || '';
}

/* ------------------------- Cles naturelles ------------------------- */

const norme = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Cle naturelle des fiches de reference : la meme chose saisie de chaque
 * cote, avant toute synchronisation, a deux identifiants differents. Sans
 * cette cle, le meme vehicule ou le meme agent apparaitrait deux fois.
 * Les fiches datees (missions, dotations…) n'en ont pas : deux missions
 * semblables peuvent etre deux missions.
 */
const CLES_NATURELLES = {
  accounts: (f) => norme(f.login),
  users: (f) => norme(`${f.nom || ''} ${f.prenoms || ''}`),
  vehicules: (f) => {
    const i = norme(f.immatNouvelle || f.immatAncienne).replace(/\s/g, '');
    return i && !['d45', 'd4550'].includes(i) ? i : '';
  },
  destinationsMission: (f) => norme(f.nom),
  destinataires: (f) => norme(f.nom),
  garages: (f) => norme(f.nom),
  trajets: (f) => [norme(f.a), norme(f.b)].sort().join('|')
};

/**
 * Rend a la base d'en face les identifiants d'ici pour les fiches qui ont
 * la meme cle naturelle. La fusion les traite ensuite comme une seule fiche.
 */
function aligner(ici, la) {
  const copie = JSON.parse(JSON.stringify(la));
  Object.entries(CLES_NATURELLES).forEach(([c, cle]) => {
    const ids = new Map();
    fichesDe(ici, c).forEach((e) => { const k = cle(e.fiche); if (k && e.fiche.id && !ids.has(k)) ids.set(k, e.fiche.id); });
    const pris = new Set(fichesDe(copie, c).map((e) => e.fiche.id));
    fichesDe(copie, c).forEach((e) => {
      const k = cle(e.fiche);
      const id = k && ids.get(k);
      if (id && id !== e.fiche.id && !pris.has(id)) {
        pris.delete(e.fiche.id);
        e.fiche.id = id;
        pris.add(id);
      }
    });
  });
  return copie;
}

/**
 * Fusionne la base de cet appareil (`ici`) et celle de l'autre (`la`).
 *
 * @param {object} ici
 * @param {object} la
 * @param {object} opts
 * @param {string} opts.maintenant
 * @param {string} [opts.derniereSynchro] date de la derniere synchronisation
 *   entre ces deux appareils ('' : jamais) — sert a reconnaitre un conflit
 * @param {boolean} [opts.iciGagneEgalite] a date egale, la version d'ici
 *   l'emporte (le PC)
 * @returns {{ db: object, rapport: object }}
 */
export function fusionner(ici, laBrute, opts) {
  const maintenant = opts.maintenant;
  const la = aligner(ici, laBrute);
  const depuis = opts.derniereSynchro || '';
  const suppressions = reunirSuppressions(
    ici.synchro && ici.synchro.suppressions, la.synchro && la.synchro.suppressions, maintenant
  );
  const supprimee = new Map(suppressions.map((t) => [`${t.c}|${t.id}`, t.date || '']));
  const rapport = { recues: 0, envoyees: 0, supprimees: 0, conflits: [], parCollection: {} };
  const compter = (c, cle) => {
    rapport[cle] += 1;
    rapport.parCollection[c] = rapport.parCollection[c] || { recues: 0, envoyees: 0, supprimees: 0 };
    rapport.parCollection[c][cle] += 1;
  };

  const db = Object.assign({}, ici);
  TOUTES().filter((c) => c !== 'reglages').forEach((c) => {
    const ordre = [];
    const mapIci = new Map();
    const mapLa = new Map();
    fichesDe(ici, c).forEach((e) => { if (e.fiche.id) { mapIci.set(e.fiche.id, e); ordre.push(e.fiche.id); } });
    fichesDe(la, c).forEach((e) => { if (e.fiche.id) { mapLa.set(e.fiche.id, e); if (!mapIci.has(e.fiche.id)) ordre.push(e.fiche.id); } });

    const resultat = [];
    ordre.forEach((id) => {
      const a = mapIci.get(id);
      const b = mapLa.get(id);
      const trace = supprimee.get(`${c}|${id}`);
      // Une fiche supprimee d'un cote ne revient que si elle a ete modifiee
      // de l'autre apres la suppression.
      if (trace !== undefined) {
        const plusRecente = [a, b].filter(Boolean).map((e) => e.fiche.maj || '').sort().pop() || '';
        if (plusRecente <= trace) {
          if (a && !b) compter(c, 'supprimees');
          return;
        }
      }
      if (a && b) {
        if (empreinteEntree(a, c) === empreinteEntree(b, c)) { resultat.push(a); return; }
        const ma = a.fiche.maj || '';
        const mb = b.fiche.maj || '';
        const gagneLa = mb > ma || (mb === ma && !opts.iciGagneEgalite);
        if (ma > depuis && mb > depuis) {
          rapport.conflits.push({
            collection: c,
            libelle: libelleFiche(c, (gagneLa ? b : a).fiche),
            gardee: gagneLa ? 'autre' : 'ici',
            dateIci: ma,
            dateLa: mb
          });
        }
        if (gagneLa) { resultat.push(b); compter(c, 'recues'); } else { resultat.push(a); compter(c, 'envoyees'); }
        return;
      }
      if (a) { resultat.push(a); compter(c, 'envoyees'); return; }
      resultat.push(b);
      compter(c, 'recues');
    });

    if (c === VEHICULES) {
      db.vehicles = { pool: [], mission: [], service: [], reforme: [] };
      resultat.forEach((e) => db.vehicles[CATEGORIES.includes(e.cat) ? e.cat : 'pool'].push(e.fiche));
    } else {
      db[c] = resultat.map((e) => e.fiche);
    }
  });

  // Reglages : la version la plus recente, sauf ce qui est propre a cet appareil.
  const ri = ici.settings || {};
  const rl = la.settings || {};
  if (empreinte(sansReglagesLocaux(ri)) !== empreinte(sansReglagesLocaux(rl)) && (rl.maj || '') > (ri.maj || '')) {
    const locaux = {};
    REGLAGES_LOCAUX.forEach((k) => { if (k in ri) locaux[k] = ri[k]; });
    db.settings = Object.assign({}, rl, locaux);
    compter('reglages', 'recues');
  } else {
    db.settings = Object.assign({}, ri);
  }

  db.synchro = Object.assign({}, ici.synchro || {}, { suppressions });
  return { db, rapport };
}

/**
 * Le meme compte rendu, vu de l'autre appareil : ce qui a ete recu ici a
 * ete envoye de la-bas, et inversement.
 */
export function rapportInverse(r) {
  const parCollection = {};
  Object.entries(r.parCollection || {}).forEach(([c, v]) => {
    parCollection[c] = { recues: v.envoyees, envoyees: v.recues, supprimees: v.supprimees };
  });
  return {
    recues: r.envoyees,
    envoyees: r.recues,
    supprimees: r.supprimees,
    parCollection,
    conflits: (r.conflits || []).map((x) => Object.assign({}, x, { gardee: x.gardee === 'ici' ? 'autre' : 'ici', dateIci: x.dateLa, dateLa: x.dateIci }))
  };
}
