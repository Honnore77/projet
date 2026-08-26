# PDU — Gestion de parc automobile

Application de gestion du parc automobile du PDU. **Une base de données centrale, trois façons d'y accéder :**

| Accès | Livrable | Usage |
|---|---|---|
| Site web | déployé sur Laravel Cloud | Depuis n'importe quel navigateur, poste ou téléphone |
| Application Windows (installateur) | `release/PDU Parc Auto Setup 3.0.0.exe` | Poste de travail : raccourci bureau et menu Démarrer |
| Application Windows (portable) | `release/PDU Parc Auto 3.0.0.exe` | Clé USB, poste sans droits d'installation |

Le site et l'application de bureau **lisent et écrivent la même base**. Une saisie faite sur un poste apparaît sur les autres à la synchronisation suivante. L'application de bureau garde une copie locale complète : elle reste utilisable sans connexion, et remonte ce qui a été saisi dès que le réseau revient.

---

## 1. Déployer sur Laravel Cloud

### Ce qu'il faut avoir

- un dépôt Git (GitHub, GitLab ou Bitbucket) contenant ce projet ;
- un compte Laravel Cloud.

### Envoyer le code sur GitHub

Le projet n'est pas encore versionné. Depuis le dossier du projet :

```bash
git init && git add . && git commit -m "Application de gestion du parc automobile PDU"
```

Créez ensuite un dépôt **privé** sur GitHub, puis :

```bash
git remote add origin https://github.com/VOTRE-COMPTE/pdu-parc-auto.git && git branch -M main && git push -u origin main
```

> Le dépôt doit rester privé : il décrit la structure de vos données et la configuration du serveur.
> Le fichier `.env`, les dépendances et la base locale sont exclus par `.gitignore` — rien de secret n'est envoyé.

### Créer l'application dans Laravel Cloud

1. **New Application** → connectez le dépôt, branche `main`.
2. **Database** : ajoutez une base **PostgreSQL** (ou MySQL). Laravel Cloud renseigne seul les variables `DB_*`.
3. **Build commands** — ce qui construit l'application à chaque déploiement :

```bash
composer install --no-dev --optimize-autoloader --no-interaction && npm ci && npm run build
```

4. **Deploy commands** — ce qui s'exécute une fois construit :

```bash
php artisan migrate --force && php artisan db:seed --force && php artisan config:cache && php artisan route:cache
```

`db:seed` crée le compte administrateur **au tout premier déploiement seulement** ; il ne touche à rien si des comptes existent déjà. Vous pouvez donc le laisser dans la commande.

5. **Environment** : vérifiez `APP_ENV=production`, `APP_DEBUG=false`, et que `APP_URL` correspond à l'adresse réelle de l'application. `APP_KEY` est généré par la plateforme.
6. Déployez.

### Première connexion

Ouvrez l'adresse fournie par Laravel Cloud. Vous êtes redirigé vers l'application.

**Identifiant `admin`, mot de passe `admin`.** L'application impose immédiatement un nouveau mot de passe. Créez ensuite les comptes de vos collaborateurs dans **Réglages → Comptes et accès**.

### Raccorder l'application de bureau

Au premier lancement, l'exécutable demande l'adresse du serveur — celle fournie par Laravel Cloud, par exemple `https://parc-pdu.laravel.cloud`. Il vérifie qu'elle répond avant de l'enregistrer. Cette adresse n'est demandée qu'une fois ; elle se change dans **Réglages → Serveur et synchronisation**.

---

## 2. Comment la synchronisation fonctionne

Toute écriture suit le même chemin, connecté ou non :

1. la modification est appliquée à la copie locale — l'interface répond immédiatement ;
2. l'opération correspondante est empilée dans une file d'attente ;
3. la file part vers le serveur dès qu'une connexion existe.

Il n'y a donc **qu'un seul code d'écriture**, et l'application se comporte de la même manière avec ou sans réseau. La pastille en haut de l'écran indique l'état :

| Pastille | Signification |
|---|---|
| 🟢 | À jour avec le serveur |
| 🟠 *n* | Connecté, *n* modifications en attente d'envoi |
| 🔴 *n* | Hors ligne, *n* modifications en attente |
| 🔄 | Échange en cours |

Un clic sur la pastille force une synchronisation. La descente automatique a lieu toutes les 30 secondes, au retour du réseau, et quand la fenêtre reprend le premier plan.

### Arbitrage des conflits

Si deux postes modifient la **même fiche** pendant que l'un des deux est hors ligne, **la modification la plus récente l'emporte** — celle de l'autre est abandonnée et le poste concerné reçoit la version du serveur. Aucune fusion champ par champ n'est tentée.

C'est un compromis assumé : il rend le comportement prévisible et évite d'imposer un arbitrage manuel à des utilisateurs de terrain. En pratique deux personnes modifient rarement la même fiche le même jour ; les créations, elles, ne se perdent jamais, puisque chaque fiche porte un identifiant propre dès sa création.

Une limite à connaître : « la plus récente » se juge sur l'heure du poste. L'application corrige en permanence l'écart avec l'horloge du serveur, mais un poste dont la date serait grossièrement fausse fausserait l'arbitrage.

### Suppressions

Une fiche supprimée n'est pas effacée de la base : elle est marquée comme supprimée et conservée. Sans cela, les autres postes ne sauraient jamais qu'elle a disparu et la feraient réapparaître à leur prochaine remontée.

---

## 3. Organisation du code

```
app/
  Models/            SyncRecord (base), Vehicle, Personnel, Mission, Maintenance…
    Concerns/SyncsWithClient.php   traduction base ⇄ interface, dans les deux sens
  Http/Controllers/Api/
    AuthController      connexion, jeton, changement de mot de passe
    SyncController      /pull et /push — tout le protocole tient ici
    AccountController   gestion des comptes (administrateurs)
  Http/Middleware/EnsureIsAdmin.php
database/migrations/   schéma des tables métier
routes/
  api.php              l'API consommée par le web ET par le bureau
  web.php              entrée du site
tests/Feature/         31 tests : authentification, synchronisation, droits

resources/
  js/
    core/
      api.js           client HTTP, résolution de l'adresse du serveur
      sync.js          file d'attente, descente, remontée, état en ligne
      db.js            copie locale + file d'attente d'écritures
      auth.js          connexion serveur, repli hors ligne
      storage.js       persistance — bascule bureau/web, une seule interface
      crypto.js        PBKDF2 (empreinte du mot de passe pour l'accès hors ligne)
      utils.js
    ui/                coquille, composants, une vue par rubrique
    export/            Excel, PDF, colonnes partagées
  static/              logo et icônes, copiés tels quels dans le build

electron/
  main.cjs             fenêtre, menu, fichier de données local, dialogues
  preload.cjs          pont sécurisé (5 fonctions, aucune API Node exposée)

public/app/            interface construite (regénérée, non versionnée)
```

**Principe directeur** : aucun module d'interface ne sait sur quelle plateforme il tourne, ni s'il y a du réseau. `core/storage.js` est le seul endroit où bureau et web divergent, `core/sync.js` le seul qui parle de connexion.

### Une seule construction pour les deux applications

`npm run build` produit `public/app/` avec des chemins **relatifs**. Le même dossier fonctionne servi par Laravel sous `/app/index.html` et chargé depuis le disque par Electron en `file://`. Il n'y a donc qu'un artefact à produire et à vérifier.

L'interface est servie à `/app/index.html` plutôt qu'à la racine pour que le service worker — qui rend le site utilisable hors ligne — ait une portée correspondant exactement aux fichiers de l'application. La racine y redirige.

---

## 4. Comptes et sécurité

| Rôle | Consultation | Saisie / modification | Comptes et réglages |
|---|---|---|---|
| Administrateur | ✅ | ✅ | ✅ |
| Gestionnaire | ✅ | ✅ | ❌ |
| Visiteur | ✅ | ❌ | ❌ |

Les droits sont appliqués **sur le serveur**, pas seulement dans l'interface : un compte visiteur qui tenterait d'écrire reçoit un refus, quels que soient les boutons affichés.

Les mots de passe sont hachés par Laravel (bcrypt) et ne quittent jamais le serveur en clair. L'authentification se fait par jeton porteur (Sanctum) ; il n'y a pas de cookie de session, donc pas de risque de requête forgée depuis un autre site.

Garde-fous : impossible de supprimer, rétrograder ou désactiver le dernier administrateur actif, ni de supprimer le compte avec lequel on est connecté. Réinitialiser un mot de passe révoque les sessions ouvertes avec l'ancien. Dix tentatives de connexion échouées par minute et par identifiant déclenchent un blocage temporaire.

**Accès hors ligne.** Pour qu'un poste sans réseau puisse quand même ouvrir l'application, il conserve localement le jeton d'accès et une empreinte PBKDF2 du mot de passe (jamais le mot de passe lui-même). Conséquence à connaître : **quiconque a accès à la session Windows d'un poste a accès aux données déjà téléchargées sur ce poste.** Sur un poste partagé ou perdu, utilisez **Réglages → Déconnecter ce poste**, qui révoque le jeton et efface ce que le poste retenait du compte ; côté serveur, désactiver le compte ou réinitialiser son mot de passe révoque également tous ses jetons.

---

## 5. Fonctionnement de l'application

- **Véhicules** — pool / mission / service, changement de catégorie, refus des immatriculations en doublon, coûts carburant et entretien calculés par véhicule.
- **Utilisateurs** — agents et historique des incidents, chacun modifiable individuellement.
- **Dotation** — pool (montant calculé) et mission (ravitaillements multiples, totaux litres et montants).
- **Mission** — référence proposée automatiquement, durée calculée, cumuls par conducteur, suivi du paiement avec date et référence.
- **Entretien** — entrée au garage, interventions successives, retour, durée d'immobilisation. Dates et kilométrages incohérents refusés.
- **Fiche véhicule** — pour une immatriculation : caractéristiques, dotations, missions, historique garage, coût total.
- **Rapports** — sept documents en Excel, en PDF ou à imprimer.
- **Tableau de bord** — indicateurs, alertes cliquables et quatre graphiques.

Les seuils qui déclenchent les alertes se règlent dans **Réglages** ; comme les données, ils sont partagés par tous les postes.

---

## 6. Développer et vérifier

Le projet demande **PHP 8.3+**, **Composer** et **Node 20+**.

```bash
composer install && npm install && cp .env.example .env && php artisan key:generate && touch database/database.sqlite && php artisan migrate --seed
```

Deux serveurs, dans deux terminaux :

```bash
php artisan serve --port=8000
```

```bash
npm run dev
```

L'interface de développement tourne sur http://localhost:5173 et parle à l'API sur le port 8000. Pour viser un autre serveur, définissez `VITE_API_URL`.

Fenêtre de bureau branchée sur le serveur de développement :

```bash
npm run dev:desktop
```

Vérifications :

```bash
php artisan test && ./vendor/bin/pint --test
```

Produire les livrables :

```bash
npm run build
```

```bash
npm run dist:win
```

---

## 7. Notes techniques

**Modélisation.** Chaque rubrique a sa table, avec de vraies colonnes typées et des index sur les champs de recherche — la base reste interrogeable en SQL. Les listes imbriquées (incidents d'un agent, ravitaillements d'une dotation, interventions d'un passage au garage) sont stockées en JSON : elles n'existent jamais sans leur parent, sont toujours lues et écrites avec lui, et ne sont jamais interrogées seules ; les normaliser n'apporterait que des jointures.

**Identifiants.** Les clés primaires sont des chaînes générées par le poste qui crée la fiche, et non des entiers auto-incrémentés : un poste hors ligne doit pouvoir créer une fiche sans rien demander au serveur, et l'identifiant doit rester le même après synchronisation.

**Signature de l'exécutable.** `signAndEditExecutable: false` est positionné dans `package.json` : sans lui, l'empaquetage échoue sur ce poste, Windows refusant la création des liens symboliques contenus dans l'archive de signature d'electron-builder (droit réservé au mode développeur ou à une session administrateur). Les exécutables fonctionnent mais ne sont pas signés — Windows affiche donc un avertissement SmartScreen au premier lancement (*Informations complémentaires → Exécuter quand même*). Pour les signer : fournissez un certificat via `CSC_LINK` et `CSC_KEY_PASSWORD`, retirez ce réglage, activez le mode développeur de Windows.

**PDF et accents.** Les polices standard du PDF sont encodées en WinAnsi : les accents français passent, mais les caractères typographiques (tiret cadratin, apostrophe courbe, puce, flèche) en sont absents et disparaîtraient silencieusement. `resources/js/export/pdf.js` les convertit en équivalents ASCII avant écriture.

---

## 8. Limites connues

- **Arbitrage des conflits par dernière écriture**, sans fusion ni historique des versions (voir §2). Une modification écrasée est perdue.
- **Pas de notification en temps réel** : les changements des autres postes apparaissent à la synchronisation suivante, au plus tard 30 secondes après.
- **Le mode hors ligne dépend d'une connexion préalable.** Un poste qui n'a jamais joint le serveur n'a rien à afficher, et un compte qui ne s'est jamais connecté sur ce poste ne peut pas y ouvrir de session.
- **L'enregistrement du service worker n'a pas pu être vérifié** : le navigateur utilisé pendant le développement les bloque. Les fichiers produits (`sw.js`, manifeste de pré-cache) sont corrects et pointent vers des chemins existants, mais le fonctionnement hors ligne du **site web** reste à confirmer sur un navigateur réel — celui de l'application de bureau, lui, a été vérifié de bout en bout.
- **Les exécutables ne sont pas signés** (voir §7).
