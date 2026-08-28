/* ===================================================================
   Aperçu avant export.

   Tout export passe par ici : on montre d'abord le document, puis on
   n'écrit le fichier que si l'utilisateur le confirme. Une erreur de
   filtre ou de période se voit à l'écran plutôt que dans un fichier
   déjà envoyé.

   - PDF   : le document lui-même, rendu dans le lecteur intégré.
   - Excel : les feuilles telles qu'elles seront écrites. Un classeur ne
             se rend pas dans une fenêtre ; on montre donc son contenu,
             feuille par feuille, avec les mêmes colonnes.
   =================================================================== */

import { saveFile, isDesktop } from '../core/storage.js';
import { esc, el, fmt, mentionLieuDate } from '../core/utils.js';
import { DB } from '../core/db.js';
import { openModal, toast } from '../ui/components.js';

/** Au-delà, l'aperçu se contente d'un extrait : afficher 5 000 lignes fige la fenêtre. */
const LIGNES_APERCU = 150;

/**
 * Montre le document puis, si l'utilisateur confirme, l'enregistre.
 *
 * @param {object} cfg
 * @param {'pdf'|'excel'} cfg.kind
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
        `<span>Format : <b>${kind === 'pdf' ? 'PDF' : 'Classeur Excel'}</b></span>` +
        `<span>Taille : <b>${esc(poids)}</b></span>` +
        (kind === 'excel' ? `<span>Feuilles : <b>${datasets.length}</b></span>` : '') +
      '</div>'
    );
    corps.appendChild(entete);

    let objectUrl = null;

    if (kind === 'pdf') {
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const cadre = el(`<iframe class="apercuCadre" src="${objectUrl}#toolbar=1&navpanes=0"></iframe>`);
      corps.appendChild(cadre);
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
                    return `<td${nombre ? ' style="text-align:right"' : ''}>${esc(nombre ? fmt(v) : v === undefined || v === null ? '' : v)}</td>`;
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
