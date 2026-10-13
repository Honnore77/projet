/* ===================================================================
   Serveur de synchronisation — cote PC.

   Ouvert seulement pendant que le code QR est affiche (dix minutes au plus),
   sur le reseau local : le telephone, qui a lu l'adresse et le jeton dans le
   code QR, s'y connecte par le Wi-Fi. Rien ne passe par Internet.

   Le serveur ne fusionne rien lui-meme : il transmet la base du telephone a
   la fenetre de l'application (qui tient la base du PC), et rend ce qu'elle
   repond. Les photos, elles, sont lues et ecrites directement dans le
   dossier des images.

   Chaque requete doit porter le jeton du code QR. Le jeton change a chaque
   affichage : un code photographie la veille ne sert plus a rien.
   =================================================================== */

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DUREE_MS = 10 * 60 * 1000;
const TAILLE_MAX = 64 * 1024 * 1024;

/** Adresses IPv4 de ce PC sur le reseau local, les plus probables d'abord. */
function adressesLocales() {
  const rang = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : a.startsWith('172.') ? 2 : 3);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .sort((a, b) => rang(a) - rang(b));
}

function egaux(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    let taille = 0;
    req.on('data', (m) => {
      taille += m.length;
      if (taille > TAILLE_MAX) { reject(new Error('trop volumineux')); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', () => resolve(Buffer.concat(morceaux)));
    req.on('error', reject);
  });
}

/**
 * @param {object} o
 * @param {() => string} o.imagesDir
 * @param {(id:string) => string|null} o.imageFile  chemin d'une image, ou null si l'identifiant est invalide
 * @param {(payload:object) => Promise<object>} o.demanderFusion
 * @param {(etat:object) => void} o.surEtat
 * @param {string} o.nom  nom de ce PC
 */
function creerServeurSynchro(o) {
  let serveur = null;
  let jeton = '';
  let minuterie = null;

  const etat = (e) => { try { o.surEtat(e); } catch (err) { /* fenetre fermee */ } };

  function repondre(res, code, corps, type = 'application/json') {
    res.writeHead(code, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, x-pdu-jeton',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Cache-Control': 'no-store'
    });
    res.end(type === 'application/json' ? JSON.stringify(corps) : corps);
  }

  async function traiter(req, res) {
    if (req.method === 'OPTIONS') return repondre(res, 204, '');
    const url = new URL(req.url, 'http://pdu');
    if (!egaux(req.headers['x-pdu-jeton'] || url.searchParams.get('t'), jeton)) {
      return repondre(res, 403, { erreur: 'Code QR expiré ou invalide : affichez-en un nouveau sur le PC.' });
    }
    try {
      if (req.method === 'GET' && url.pathname === '/pdu/ping') {
        etat({ etape: 'connecte' });
        return repondre(res, 200, { ok: true, nom: o.nom });
      }
      if (req.method === 'POST' && url.pathname === '/pdu/synchro') {
        etat({ etape: 'fusion' });
        const payload = JSON.parse((await lireCorps(req)).toString('utf8'));
        const resultat = await o.demanderFusion(payload);
        etat({ etape: 'fusionne', rapport: resultat.rapportPC, autre: payload.appareil });
        return repondre(res, 200, { db: resultat.db, rapport: resultat.rapport, pc: resultat.pc });
      }
      if (req.method === 'GET' && url.pathname === '/pdu/images') {
        let ids = [];
        try { ids = fs.readdirSync(o.imagesDir()).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)); } catch (e) { /* aucun dossier */ }
        return repondre(res, 200, { ids });
      }
      const m = /^\/pdu\/image\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const fichier = o.imageFile(decodeURIComponent(m[1]));
        if (!fichier) return repondre(res, 400, { erreur: 'identifiant d’image invalide' });
        // Les photos voyagent en base64 dans du JSON : c'est ce que les deux
        // bouts (fenetre du PC, pont natif du telephone) transportent le plus
        // surement.
        if (req.method === 'GET') {
          if (!fs.existsSync(fichier)) return repondre(res, 404, { erreur: 'image absente' });
          return repondre(res, 200, { b64: fs.readFileSync(fichier).toString('base64') });
        }
        if (req.method === 'PUT') {
          const corps = JSON.parse((await lireCorps(req)).toString('utf8'));
          const octets = Buffer.from(String(corps.b64 || ''), 'base64');
          if (!octets.length) return repondre(res, 400, { erreur: 'image vide' });
          fs.mkdirSync(o.imagesDir(), { recursive: true });
          fs.writeFileSync(`${fichier}.tmp`, octets);
          fs.renameSync(`${fichier}.tmp`, fichier);
          return repondre(res, 200, { ok: true });
        }
      }
      if (req.method === 'POST' && url.pathname === '/pdu/termine') {
        const corps = JSON.parse((await lireCorps(req)).toString('utf8') || '{}');
        etat({ etape: 'termine', images: corps.images || {} });
        repondre(res, 200, { ok: true });
        // Synchronisation faite : le serveur se ferme, le jeton ne sert plus.
        setTimeout(arreter, 500);
        return undefined;
      }
      return repondre(res, 404, { erreur: 'inconnu' });
    } catch (e) {
      etat({ etape: 'erreur', message: String((e && e.message) || e) });
      return repondre(res, 500, { erreur: String((e && e.message) || e) });
    }
  }

  function arreter() {
    clearTimeout(minuterie);
    minuterie = null;
    jeton = '';
    if (serveur) {
      try { serveur.close(); } catch (e) { /* deja ferme */ }
      serveur = null;
      etat({ etape: 'arrete' });
    }
  }

  /** Ouvre le serveur et rend ce que le code QR doit contenir. */
  function demarrer() {
    arreter();
    jeton = crypto.randomBytes(18).toString('base64url');
    return new Promise((resolve, reject) => {
      serveur = http.createServer((req, res) => { traiter(req, res); });
      serveur.on('error', (e) => reject(e));
      // Port choisi par le systeme : il est dans le code QR.
      serveur.listen(0, '0.0.0.0', () => {
        const expire = Date.now() + DUREE_MS;
        minuterie = setTimeout(arreter, DUREE_MS);
        resolve({ adresses: adressesLocales(), port: serveur.address().port, jeton, expire, nom: o.nom });
      });
    });
  }

  return { demarrer, arreter, actif: () => !!serveur };
}

module.exports = { creerServeurSynchro, adressesLocales };
