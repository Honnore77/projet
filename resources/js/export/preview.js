/* ===================================================================
   Aperçu avant export.

   Tout export passe par ici : on montre d'abord le document, puis on
   n'écrit le fichier que si l'utilisateur le confirme. Une erreur de
   filtre ou de période se voit à l'écran plutôt que dans un fichier
   déjà envoyé.

   - PDF   : le document lui-même, rendu dans le lecteur intégré.
   - Excel et Word : les tableaux tels qu'ils seront écrits. Un classeur ne
             se rend pas dans une fenêtre ; on montre donc son contenu,
             feuille par feuille, avec les mêmes colonnes.
   =================================================================== */

import { saveFile, isDesktop } from '../core/storage.js';
import { esc, escLignes, el, fmt, mentionLieuDate } from '../core/utils.js';
import { DB } from '../core/db.js';
import { openModal, toast } from '../ui/components.js';

/** Au-delà, l'aperçu se contente d'un extrait : afficher 5 000 lignes fige la fenêtre. */
const LIGNES_APERCU = 150;

/**
 * Montre le document puis, si l'utilisateur confirme, l'enregistre.
 *
 * @param {object} cfg
 * @param {'pdf'|'excel'|'word'} cfg.kind
 * @param {Uint8Array} cfg.bytes      contenu du fichier
 * @param {string} cfg.filename       nom proposé à l'enregistrement
 * @param {string} cfg.mime
 * @param {Array}  [cfg.datasets]     feuilles à afficher (Excel)
 * @param {string} [cfg.title]        titre de la fenêtre
 * @returns {Promise<string|null>} chemin écrit, ou null si annulé
 */
export function previewAndSave({ kind, bytes, filename, mime, datasets = [], title }) {
  return new Promise((resolve) => {
    const corps = el('<div style="display:flex;flex-direction:column;height:100%"></div>');
    const poids = bytes && bytes.length ? `${(bytes.length / 1024).toFixed(0)} Ko` : '—';

    const entete = el(
      '<div class="apercuEntete">' +
        `<span>Fichier : <b>${esc(filename)}</b></span>` +
        `<span>Format : <b>${kind === 'pdf' ? 'PDF' : kind === 'word' ? 'Document Word' : 'Classeur Excel'}</b></span>` +
        `<span>Taille : <b>${esc(poids)}</b></span>` +
        (kind === 'excel' ? `<span>Feuilles : <b>${datasets.length}</b></span>` : '') +
        (kind === 'word' ? `<span>Tableaux : <b>${datasets.length}</b></span>` : '') +
      '</div>'
    );
    corps.appendChild(entete);

    let objectUrl = null;

    if (kind === 'pdf' && lecteurPdfIntegre()) {
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const cadre = el(`<iframe class="apercuCadre" src="${objectUrl}#toolbar=1&navpanes=0"></iframe>`);
      corps.appendChild(cadre);
    } else if (kind === 'pdf') {
      corps.appendChild(pagesPdfNode(bytes));
    } else {
      corps.appendChild(tablesNode(datasets));
    }

    let repondu = false;
    const terminer = (valeur) => {
      if (repondu) return;
      repondu = true;
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      resolve(valeur);
    };

    openModal({
      title: title || 'Aperçu avant export',
      bodyNode: corps,
      wide: true,
      onClose: () => terminer(null),
      buttons: [
        { label: 'Annuler', cls: 'cancel', onClick: (close) => { close(); terminer(null); } },
        {
          label: isDesktop ? '💾 Enregistrer sous…' : '💾 Télécharger',
          cls: 'ok',
          onClick: async (close) => {
            close();
            try {
              terminer(await saveFile(filename, bytes, mime));
            } catch (e) {
              console.error(e);
              toast("L'enregistrement a échoué.", 'err');
              terminer(null);
            }
          }
        }
      ]
    });
  });
}

/**
 * Le PC et les navigateurs de bureau affichent un PDF eux-memes. Le
 * navigateur integre d'Android, non : un cadre PDF y reste vide.
 */
function lecteurPdfIntegre() {
  if (isDesktop) return true;
  return typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === true;
}

/**
 * Sans lecteur integre, les pages sont dessinees une a une par pdf.js,
 * charge seulement a ce moment-la : le PC ne le telecharge jamais.
 */
function pagesPdfNode(bytes) {
  const zone = el('<div class="apercuPages"><p class="apercuNote">Préparation de l’aperçu…</p></div>');
  (async () => {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // pdf.js garde le tableau qu'on lui passe : une copie laisse intact
      // celui qui sera enregistre.
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      zone.innerHTML = '';
      // Assez de points pour un texte net, sans saturer la memoire du
      // telephone sur un long document.
      const largeur = Math.min(Math.max(zone.clientWidth || 360, 320), 1100);
      const finesse = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vue = page.getViewport({ scale: (largeur / base.width) * finesse });
        const toile = document.createElement('canvas');
        toile.width = Math.floor(vue.width);
        toile.height = Math.floor(vue.height);
        toile.className = 'apercuPage';
        zone.appendChild(toile);
        if (doc.numPages > 1) zone.appendChild(el(`<p class="apercuNumero">Page ${n} / ${doc.numPages}</p>`));
        await page.render({ canvasContext: toile.getContext('2d'), viewport: vue }).promise;
      }
      doc.destroy();
    } catch (e) {
      console.error(e);
      zone.innerHTML = '<p class="apercuNote">L’aperçu n’a pas pu s’afficher. Le fichier peut tout de même être téléchargé.</p>';
    }
  })();
  return zone;
}

/** Rend les feuilles du classeur sous forme de tableaux. */
function tablesNode(datasets) {
  const wrap = el('<div class="apercuTables"></div>');

  if (!datasets.length) {
    wrap.appendChild(el('<p class="apercuNote">Aucune donnée à exporter.</p>'));
    return wrap;
  }

  datasets.forEach((ds) => {
    wrap.appendChild(el(`<h4>${esc(ds.title)} — ${ds.rows.length} ligne(s)</h4>`));

    const lignes = ds.rows.slice(0, LIGNES_APERCU);
    const table =
      '<div class="tableWrap"><table class="dataTable"><thead><tr>' +
      ds.columns.map((c) => `<th>${esc(c.label)}</th>`).join('') +
      '</tr></thead><tbody>' +
      (lignes.length
        ? lignes
            .map(
              (r) =>
                '<tr>' +
                ds.columns
                  .map((c) => {
                    const v = r[c.key];
                    // L'apercu doit montrer le fichier tel qu'il sera : une
                    // cellule surveillee et vide y part en rouge clair.
                    if (c.alerteSiVide && (v === '' || v === undefined || v === null)) {
                      return '<td class="celluleManquante">non renseignée</td>';
                    }
                    const nombre = typeof v === 'number';
                    // Telephone, motif d'entretien, observation du retour :
                    // plusieurs lignes dans une cellule. Ecrasees ici, elles
                    // ne diraient plus ce que le fichier dira.
                    return `<td${nombre ? ' style="text-align:right"' : ''}>${nombre ? esc(fmt(v)) : escLignes(v === undefined || v === null ? '' : v)}</td>`;
                  })
                  .join('') +
                '</tr>'
            )
            .join('')
        : `<tr><td colspan="${ds.columns.length}" style="text-align:center;color:#8aa0a6">Feuille vide</td></tr>`) +
      '</tbody></table></div>';
    wrap.appendChild(el(table));

    // Le classeur ferme chaque feuille par la mention de lieu et de date :
    // l'apercu ne serait plus fidele s'il l'omettait.
    wrap.appendChild(
      el(`<p class="apercuMention">${esc(mentionLieuDate(DB.settings && DB.settings.ville))}</p>`)
    );

    if (ds.rows.length > LIGNES_APERCU) {
      wrap.appendChild(
        el(`<p class="apercuNote">Aperçu des ${LIGNES_APERCU} premières lignes. Le fichier en contiendra ${ds.rows.length}.</p>`)
      );
    }
    if (ds.note) wrap.appendChild(el(`<p class="apercuNote">${esc(ds.note)}</p>`));
  });

  return wrap;
}
