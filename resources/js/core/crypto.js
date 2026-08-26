/* ===================================================================
   Hachage des mots de passe — PBKDF2-HMAC-SHA256.

   On utilise WebCrypto quand il est disponible (navigateur en HTTPS,
   localhost, et Electron). Une implementation JS de secours prend le
   relais si l application est servie sur un intranet en http:// simple,
   ou crypto.subtle est desactive par le navigateur.
   =================================================================== */

const ITERATIONS = 150000;
const DK_LEN = 32; // octets
const SALT_LEN = 16;

const subtle = (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) || null;

/** Genere un sel aleatoire encode en hexadecimal. */
export function randomSalt() {
  const b = new Uint8Array(SALT_LEN);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return toHex(b);
}

/**
 * Hache un mot de passe.
 * @returns {Promise<{algo:string, salt:string, iterations:number, hash:string}>}
 */
export async function hashPassword(password, salt = randomSalt(), iterations = ITERATIONS) {
  const dk = await pbkdf2(password, salt, iterations, DK_LEN);
  return { algo: 'pbkdf2-sha256', salt, iterations, hash: toHex(dk) };
}

/** Verifie un mot de passe contre un enregistrement produit par hashPassword. */
export async function verifyPassword(password, record) {
  if (!record || !record.hash) return false;
  const dk = await pbkdf2(password, record.salt, record.iterations || ITERATIONS, DK_LEN);
  return timingSafeEqual(toHex(dk), record.hash);
}

async function pbkdf2(password, saltHex, iterations, dkLen) {
  const pw = new TextEncoder().encode(String(password));
  const salt = fromHex(saltHex);
  if (subtle) {
    try {
      const key = await subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        key,
        dkLen * 8
      );
      return new Uint8Array(bits);
    } catch (e) {
      console.warn('WebCrypto indisponible, repli sur l implementation JS', e);
    }
  }
  return pbkdf2Js(pw, salt, iterations, dkLen);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function fromHex(hex) {
  const h = String(hex || '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/* ----------------- Implementation de secours (JS pur) ----------------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256(msg) {
  const len = msg.length;
  const bitLen = len * 8;
  const withPad = new Uint8Array((((len + 9) >> 6) + 1) << 6);
  withPad.set(msg);
  withPad[len] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0, false);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296), false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255;
    out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255;
  }
  return out;
}

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function hmacSha256(key, msg) {
  let k = key;
  if (k.length > 64) k = sha256(k);
  const pad = new Uint8Array(64);
  pad.set(k);
  const ipad = new Uint8Array(64 + msg.length);
  const opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    ipad[i] = pad[i] ^ 0x36;
    opad[i] = pad[i] ^ 0x5c;
  }
  ipad.set(msg, 64);
  opad.set(sha256(ipad), 64);
  return sha256(opad);
}

function pbkdf2Js(pw, salt, iterations, dkLen) {
  const blocks = Math.ceil(dkLen / 32);
  const out = new Uint8Array(blocks * 32);
  const block = new Uint8Array(salt.length + 4);
  block.set(salt);
  for (let i = 1; i <= blocks; i++) {
    block[salt.length] = (i >>> 24) & 255;
    block[salt.length + 1] = (i >>> 16) & 255;
    block[salt.length + 2] = (i >>> 8) & 255;
    block[salt.length + 3] = i & 255;
    let u = hmacSha256(pw, block);
    const acc = u.slice();
    for (let j = 1; j < iterations; j++) {
      u = hmacSha256(pw, u);
      for (let k2 = 0; k2 < 32; k2++) acc[k2] ^= u[k2];
    }
    out.set(acc, (i - 1) * 32);
  }
  return out.slice(0, dkLen);
}
