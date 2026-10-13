/* ===================================================================
   SYNCHRONISATION — les deux bouts de l'echange.

   Cote PC : la fenetre recoit, par le serveur local (electron), la base du
   telephone ; elle la fusionne avec la sienne, s'installe la base fusionnee
   et la renvoie.

   Cote telephone : apres lecture du code QR, il joint le PC sur le reseau
   local, lui envoie sa base, installe la base fusionnee, puis echange les
   photos qui manquent de part et d'autre.
   =================================================================== */

import { DB, appareilSynchro, derniereSynchroAvec, appliquerSynchro, imagesCitees } from './db.js';
import { fusionner, rapportInverse } from './synchro.js';
import { toutesLesImages, octetsImage, poserImage } from './images.js';

/** Prefixe du contenu du code QR : il dit que le code est bien le notre. */
export const PREFIXE_QR = 'PDU-SYNC:';

/* ------------------------------ Code QR ----------------------------- */

/** Ce que le code QR du PC contient : adresses, port, jeton, nom. */
export function contenuQR(info) {
  return PREFIXE_QR + JSON.stringify({ v: 1, a: info.adresses, p: info.port, t: info.jeton, n: info.nom });
}

/** Relit un code QR ; rend null si ce n'est pas un code de synchronisation PDU. */
export function lireQR(texte) {
  const t = String(texte || '').trim();
  if (!t.startsWith(PREFIXE_QR)) return null;
  try {
    const o = JSON.parse(t.slice(PREFIXE_QR.length));
    if (!o || o.v !== 1 || !Array.isArray(o.a) || !o.a.length || !o.p || !o.t) return null;
    return { adresses: o.a, port: o.p, jeton: o.t, nom: o.n || 'PC' };
  } catch (e) {
    return null;
  }
}

/* ------------------------------ Cote PC ----------------------------- */

/**
 * Traite la demande du telephone : fusion, installation, reponse.
 * @param {{appareil:{id:string,nom:string}, db:object}} payload
 */
export async function traiterDemandePC(payload) {
  if (!payload || !payload.db || !payload.appareil || !payload.appareil.id) {
    throw new Error('demande de synchronisation incomplète');
  }
  const maintenant = new Date().toISOString();
  const { db, rapport } = fusionner(JSON.parse(JSON.stringify(DB)), payload.db, {
    maintenant,
    derniereSynchro: derniereSynchroAvec(payload.appareil.id),
    // A date egale, le PC fait foi.
    iciGagneEgalite: true
  });
  await appliquerSynchro(db, payload.appareil, maintenant);
  return {
    db: JSON.parse(JSON.stringify(DB)),
    // Le compte rendu vu du telephone, et celui du PC pour son propre ecran.
    rapport: rapportInverse(rapport),
    rapportPC: rapport,
    pc: Object.assign(appareilSynchro(), { quand: maintenant })
  };
}

/* --------------------------- Cote telephone -------------------------- */

/** Une requete au PC, avec le jeton et un delai au-dela duquel on abandonne. */
async function requete(base, jeton, chemin, { methode = 'GET', corps, delai = 15000 } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const minuterie = ctrl ? setTimeout(() => ctrl.abort(), delai) : null;
  try {
    const r = await fetch(`${base}${chemin}`, {
      method: methode,
      headers: Object.assign({ 'x-pdu-jeton': jeton }, corps ? { 'content-type': 'application/json' } : {}),
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.erreur || `réponse ${r.status} du PC`);
    return json;
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

/** La premiere adresse du PC qui repond (le PC peut en avoir plusieurs). */
async function joindrePC(qr) {
  for (const adresse of qr.adresses) {
    const base = `http://${adresse}:${qr.port}`;
    try {
      await requete(base, qr.jeton, '/pdu/ping', { delai: 4000 });
      return base;
    } catch (e) {
      if (/expiré|invalide/i.test(String(e.message))) throw e;
      // adresse injoignable : on essaie la suivante
    }
  }
  throw new Error(
    'Le PC ne répond pas. Vérifiez que le téléphone et le PC sont sur le même Wi-Fi, ' +
    'que le code QR est toujours affiché, et que le pare-feu Windows autorise PDU Parc Auto.'
  );
}

const enBase64 = (octets) => {
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(s);
};
const depuisBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Toute la synchronisation, du cote du telephone.
 * @param {object} qr           contenu du code QR (lireQR)
 * @param {(etape:string) => void} [suivre]  avancement, pour l'ecran
 * @returns {Promise<{rapport:object, pc:object, images:{recues:number, envoyees:number}}>}
 */
export async function synchroniserAvecPC(qr, suivre = () => {}) {
  suivre('Connexion au PC…');
  const base = await joindrePC(qr);

  suivre('Échange des données…');
  const reponse = await requete(base, qr.jeton, '/pdu/synchro', {
    methode: 'POST',
    corps: { appareil: appareilSynchro(), db: DB },
    delai: 60000
  });
  await appliquerSynchro(reponse.db, reponse.pc, reponse.pc.quand);

  // Les photos : chacun recoit celles qui lui manquent. On ne transfere que
  // les photos citees par une fiche ; les autres ne servent a rien.
  suivre('Échange des photos…');
  const citees = imagesCitees();
  const ici = new Set(await toutesLesImages());
  const la = new Set(((await requete(base, qr.jeton, '/pdu/images')).ids) || []);
  let recues = 0;
  let envoyees = 0;
  for (const id of citees) {
    if (!ici.has(id) && la.has(id)) {
      const { b64 } = await requete(base, qr.jeton, `/pdu/image/${encodeURIComponent(id)}`, { delai: 30000 });
      if (b64) { await poserImage(id, depuisBase64(b64)); recues += 1; }
    } else if (ici.has(id) && !la.has(id)) {
      const octets = await octetsImage(id);
      if (octets) {
        await requete(base, qr.jeton, `/pdu/image/${encodeURIComponent(id)}`, { methode: 'PUT', corps: { b64: enBase64(octets) }, delai: 30000 });
        envoyees += 1;
      }
    }
  }

  await requete(base, qr.jeton, '/pdu/termine', { methode: 'POST', corps: { images: { recues: envoyees, envoyees: recues } } });
  return { rapport: reponse.rapport, pc: reponse.pc, images: { recues, envoyees } };
}
