/* ===================================================================
   Copie l'EXE qui vient d'etre construit (release/PDU-Parc-Auto-4.4.xx.exe)
   sous un nom sans numero : release/PDU-Parc-Auto.exe.

   Le raccourci du bureau pointe sur ce nom fixe : il ouvre ainsi toujours
   la derniere version, sans qu'on ait a le refaire a chaque build.
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8'));
const source = path.join(racine, 'release', `PDU-Parc-Auto-${version}.exe`);
const cible = path.join(racine, 'release', 'PDU-Parc-Auto.exe');

if (!fs.existsSync(source)) {
  console.error(`EXE introuvable : ${source}`);
  process.exit(1);
}
try {
  fs.copyFileSync(source, cible);
  console.log(`Raccourci du bureau : ${path.basename(cible)} = version ${version}`);
} catch (e) {
  // L'application ouverte depuis le raccourci verrouille le fichier.
  console.error(`Copie impossible vers ${cible} (${e.code}) : fermez l'application puis relancez « node scripts/exe-courant.mjs ».`);
  process.exit(1);
}
