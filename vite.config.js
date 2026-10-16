import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/*
 * Une seule construction sert les deux applications.
 *
 * `base: './'` produit des chemins relatifs : le meme dossier fonctionne
 * servi par Laravel sous /app/ et charge depuis le disque par Electron
 * (file://). Il n'y a donc qu'un artefact a produire et a verifier.
 *
 * La sortie est ecrite dans public/app/ pour que le serveur web la serve en
 * fichiers statiques, sans passer par PHP.
 */
export default defineConfig({
  base: './',
  publicDir: 'resources/static',
  build: {
    outDir: 'public/app',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Le moteur de rendu PDF (pdf.js, pour l'apercu sur Android) arrive
        // en « .mjs » ; le serveur interne de l'application Android ne
        // reconnait pas cette extension comme du JavaScript, et refuserait
        // de le lancer. Il sort donc en « .js ».
        assetFileNames(info) {
          const nom = (info.names && info.names[0]) || info.name || '';
          return nom.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]';
        },
        // Les trois grosses bibliotheques (Excel, PDF, graphiques) sont
        // isolees : elles ne changent jamais, le cache du navigateur les
        // garde d'une mise a jour a l'autre.
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'vendor_xlsx';
          if (id.includes('node_modules/jspdf')) return 'vendor_pdf';
          if (id.includes('node_modules/chart.js')) return 'vendor_chart';
          return null;
        }
      }
    }
  },
  server: { port: 5173, strictPort: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // L'enregistrement se fait dans main.js, et seulement pour la version
      // web : dans l'APK, le cache servait l'ancienne version au premier
      // lancement apres une mise a jour.
      injectRegister: null,
      includeAssets: ['logo-pdu.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Les appels a l'API ne doivent jamais etre servis depuis le cache :
        // la fraicheur des donnees est geree par la synchronisation.
        navigateFallbackDenylist: [/^\/api\//]
      },
      manifest: {
        name: 'PDU - Gestion de parc automobile',
        short_name: 'PDU Parc Auto',
        description: 'Gestion du parc automobile du PDU : vehicules, missions, dotations, entretien.',
        lang: 'fr',
        start_url: './index.html',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F5F7F8',
        theme_color: '#008A3B',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
});
