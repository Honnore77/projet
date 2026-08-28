# PDU — Gestion de parc automobile

Application Windows autonome de gestion du parc automobile du PDU.

**Un seul fichier : `release/PDU-Parc-Auto-4.0.0.exe`** (74,7 Mo). Rien à installer, rien à configurer, aucun serveur ni connexion Internet. Copiez-le où vous voulez — disque local, clé USB — et double-cliquez.

---

## 1. Démarrer

Double-cliquez sur l'exécutable.

> Windows affiche un avertissement SmartScreen au premier lancement, car le fichier n'est pas signé numériquement : *Informations complémentaires → Exécuter quand même*. Voir §5.

**Première connexion : identifiant `admin`, mot de passe `admin`.** L'application impose aussitôt le choix d'un nouveau mot de passe.

Le bouton **« Continuer en visiteur »** ouvre une session de consultation sans compte : tout est visible et exportable, rien n'est modifiable.

## 2. Où sont les données

Dans un fichier JSON du dossier de l'utilisateur Windows :

```
%APPDATA%\PDU Parc Auto\pdu-parc-auto.json
```

Une copie de la version précédente (`pdu-parc-auto.backup.json`) est conservée à chaque écriture, et l'écriture passe par un fichier temporaire renommé : une coupure de courant en cours d'enregistrement ne peut pas corrompre le fichier principal.

Le menu **Fichier → Ouvrir le dossier des données** l'ouvre dans l'explorateur ; le chemin exact est aussi rappelé dans **Réglages → Informations techniques**.

**Les données ne quittent jamais ce poste.** Deux postes ne partagent rien : pour transporter les données, passez par **Réglages → Exporter une sauvegarde**, puis **Restaurer une sauvegarde** sur l'autre poste. Sauvegardez régulièrement — c'est le seul filet en cas de panne du disque.

Les données des versions précédentes de l'application (y compris le fichier HTML d'origine) sont reprises automatiquement au premier lancement.

## 3. Ce que fait l'application

- **Véhicules** — pool / mission / service. Chaque sous-rubrique affiche les véhicules en tableau, une ligne par véhicule. Changement de catégorie, refus des immatriculations en doublon, saisie guidée (voir ci-dessous), suivi de la vidange. Aucun montant carburant ou entretien n’apparaît dans cette rubrique — ni dans les tableaux, ni sur la fiche véhicule, ni dans ses exports. La fiche compte les **litres**, les **passages au garage** et les **missions** ; les montants font l’objet du rapport **Coûts par véhicule**, dans RAPPORTS, qui les détaille au lieu de les résumer en bout de ligne.
- **Utilisateurs** — agents du PDU en tableau dès l’ouverture (cinq conducteurs du pool sont pré-enregistrés sur une base vierge), avec les informations du formulaire. Ils alimentent le champ « Utilisateur » des fiches véhicule de pool et de service, et le tour de rôle des missions. L’historique des incidents s’ouvre par le bouton de la colonne « Incidents ».
- **Dotation** — deux sous-rubriques, chacune en tableau : *Dotation en carburant pool* (saisie sur place, avec le suivi de la carte carburant décrit ci-dessous) et *Dotation en carburant mission* (lecture de ce qui a été saisi dans le rapport de mission). Le carburant de mission ne se saisit qu’à un seul endroit, le rapport, ce qui évite tout double comptage.
- **Mission** — deux sous-rubriques :
  - *Tableau de suivi des missions* : toutes les missions en tableau, avec les informations du formulaire, plus le nombre de missions et le cumul des jours de chaque conducteur. Un bandeau **tour de rôle** indique quel conducteur du pool doit partir ensuite (celui qui n'est jamais parti, puis celui dont la dernière mission est la plus ancienne). Un agent entre dans la rotation par la mention « conducteur du pool » de sa fiche, dans UTILISATEURS.
  - *Rapport de mission* : la liste des rapports en tableau (conducteur, immatriculation, période, destination), chacun ouvrable par le bouton « Voir ». Le bouton « Remplir le rapport » reste visible sous la liste. Le document reprend le formulaire papier du PDU — participants, dotation en carburant et points de ravitaillement, kilométrage départ/arrivée, observations — et s'imprime ou s'exporte en PDF à l'identique.
- **Entretien** — entrée au garage, interventions successives, retour, durée d'immobilisation. Dates et kilométrages incohérents refusés.
- **Fiche véhicule** — pour une immatriculation : caractéristiques, litres consommés, dotations, missions, historique garage.
- **Rapports** — sept documents, en Excel, en PDF ou à imprimer directement.

### Carte carburant et soldes

La dotation pool enregistre le **numéro de la carte carburant**, le **solde avant prise** et le **solde après prise**, à côté de la quantité et du montant.

Le formulaire enchaîne les prises sans qu'on retape quoi que ce soit :

- choisir l'immatriculation reprend la **carte** et le **solde après prise** de la dernière dotation du véhicule, ce dernier devenant le solde avant de la nouvelle prise ;
- le **solde après prise** est proposé à `solde avant − montant`, et reste modifiable ;
- un champ **Contrôle du solde** compare en direct la différence des deux soldes au montant de la prise, et signale l'écart le cas échéant.

Tous ces champs sont pré-remplis, jamais imposés : une valeur déjà saisie n'est pas écrasée. Les trois colonnes figurent dans le tableau et dans les exports Excel et PDF de la dotation pool.

### Saisie guidée d'un véhicule

Le formulaire propose ce qui est déjà connu plutôt que d'attendre une saisie libre à chaque fois :

| Champ | Comportement |
| --- | --- |
| Modèle | Liste déroulante : TERRA, NAVARA, KICKS, QASHQAI, XTRAIL, TERRITORY, CROSS, PRADO, LAND CRUISER. La dernière entrée, **« + Autre modèle »**, bascule le champ en saisie libre ; « ↩ » revient à la liste. |
| Couleur | Même principe : BLANCHE, NOIRE, GRISE, ROUGE, BLEU, puis **« + Autre couleur »**. |
| Utilisateur | Liste des agents enregistrés dans UTILISATEURS. Un véhicule attribué à un agent depuis supprimé garde son nom. |
| Nouvelle immatriculation | Pré-remplie avec **D45 50 ** ; il ne reste que la fin de la plaque à saisir. Le préfixe seul est refusé à l'enregistrement. |
| Ancienne immatriculation | Pré-remplie avec **D45 ** ; laissée telle quelle, elle est enregistrée comme vide. |
| Statut | Disponible, En entretien, Immobilisé. « En mission » a été retiré : la mission en cours se lit dans la rubrique MISSION, et deux endroits pour un même fait finissaient par se contredire. Un véhicule encore marqué ainsi garde son statut tant qu'on ne le change pas. |

Toute valeur ajoutée à la main rejoint la liste : elle est reproposée dès la fiche suivante, sans réglage à faire.

### Suivi de la vidange

Dans les fiches de véhicule, **« Kilométrage de vidange »** est le kilométrage **auquel la vidange doit être faite**, pas celui de la dernière. L'application le compare en permanence au kilométrage courant du véhicule et affiche le résultat à trois endroits :

- dans le formulaire, un champ **« Suivi de la vidange »** se met à jour pendant la saisie ;
- dans le tableau des véhicules, une colonne **« Suivi vidange »** — verte tant qu'il reste de la marge, orange à l'approche, rouge une fois dépassée ;
- sur le tableau de bord, deux alertes cliquables : les véhicules **à vidanger sans délai** et ceux qui **approchent de la vidange**, avec pour chacun le nombre de kilomètres concernés.

Deux réglages pilotent ce suivi (**Réglages → Modifier les réglages**) :

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| Intervalle de vidange (km) | 5 000 | À la saisie d'un véhicule, propose une première fois `kilométrage actuel + intervalle`. La valeur proposée reste modifiable, et n'est plus reproposée ensuite. |
| Alerte vidange (km restants) | 500 | Marge à partir de laquelle l'alerte « approche » se déclenche. |

Après une vidange, il suffit de reporter le nouveau kilométrage cible dans la fiche : les pastilles et les alertes repassent au vert.

Un véhicule sans kilométrage de vidange n'est simplement pas suivi (« non suivie ») ; il ne déclenche aucune alerte. Les exports Excel et PDF du parc reprennent les colonnes *Vidange due à (km)*, *Km avant vidange* et *Suivi vidange*.

### Aperçu avant export

Tout export — Excel comme PDF, depuis n’importe quelle rubrique — ouvre d’abord une fenêtre d’aperçu. Rien n’est écrit sur le disque tant que « Enregistrer » n’a pas été confirmé : une erreur de filtre ou de période se voit à l’écran plutôt que dans un fichier déjà transmis.

Le PDF s’affiche tel quel dans le lecteur intégré. Un classeur Excel ne se rend pas dans une fenêtre : l’aperçu montre donc son contenu feuille par feuille, avec les mêmes colonnes, limité aux 150 premières lignes de chaque feuille pour rester fluide (le fichier, lui, les contient toutes).
- **Tableau de bord** — indicateurs (véhicules, garage, utilisateurs, missions, entretien), alertes cliquables et quatre graphiques.

Chaque rubrique porte sa couleur dans la barre de gauche — teinte légère au repos, aplat plein une fois ouverte — pour se repérer à la couleur avant même d'avoir lu le libellé.

### Écran de connexion

L'écran reprend la charte du PDU : logo à gauche, titre au centre, armoirie nationale à droite, formulaire au milieu et bandeau illustré au-dessus du pied de page.

- **Afficher le mot de passe** : l'œil bascule le champ en clair.
- **Se souvenir de moi** : ne retient que l'**identifiant**, jamais le mot de passe. Le conserver ferait de l'écran de connexion une formalité pour quiconque ouvre la session Windows du poste.
- **Mot de passe oublié** : les mots de passe étant chiffrés localement, ils ne peuvent pas être retrouvés. La fenêtre explique les deux issues — réinitialisation par un administrateur, ou restauration d'une sauvegarde si l'on est le seul administrateur.

L'illustration du bas (`resources/js/styles/bandeau-connexion.png`) mesure 396 px de large. Au-delà de 600 px de fenêtre elle n'est plus agrandie, sinon elle deviendrait floue : elle reste centrée à sa taille utile, ses bords latéraux estompés sur un fond reprenant ses propres tons. Pour la remplacer, déposez une image de même proportion (environ 2,6:1) sous ce nom.

### Sections

Les sections du PDU sont une liste fermée, partagée par la fiche véhicule et la fiche agent : COORDINATION, AFFAIRE ADMINISTRATIVE ET FINANCIERE, OPERATION, MARCHE ET AFFAIRES JURIDIQUES, AGENCE COMPTABLE, COMMUNICATION. Deux listes séparées finiraient par diverger, et les filtres par section ne retrouveraient plus leurs petits. Elle se modifie dans `resources/js/core/db.js`.

### Comptes et rôles

| Rôle | Consultation | Saisie / modification | Comptes et réglages |
|---|---|---|---|
| Administrateur | ✅ | ✅ | ✅ |
| Gestionnaire | ✅ | ✅ | ❌ |
| Visiteur | ✅ | ❌ | ❌ |

Les mots de passe sont hachés en PBKDF2-HMAC-SHA256, 150 000 itérations, sel aléatoire — jamais stockés en clair. Garde-fous : impossible de supprimer, rétrograder ou désactiver le dernier administrateur actif, ni de supprimer le compte avec lequel on est connecté.

Ces comptes protègent l'usage courant de l'application, pas le fichier de données lui-même : **qui a accès à la session Windows du poste a accès aux données.** Si le poste est partagé, appuyez-vous sur les comptes Windows.

## 4. Organisation du code

```
index.html               page hôte (Vite y injecte les scripts)
vite.config.js           construction + service worker (PWA)
electron/
  main.cjs               fenêtre, menu, fichier de données, dialogues Windows
  preload.cjs            pont sécurisé (5 fonctions, aucune API Node exposée)
resources/
  js/
    main.js              point d'entrée : init, session, aiguillage
    core/
      utils.js           formatage, dates, normalisation de recherche
      storage.js         persistance — bascule bureau/navigateur, une seule interface
      crypto.js          PBKDF2 (WebCrypto + repli JS pur vérifié)
      db.js              schéma, CRUD, vues dérivées, calcul des alertes
      auth.js            comptes, rôles, session
    ui/                  coquille, composants, une vue par rubrique
    export/
      datasets.js        colonnes — partagées Excel / PDF / impression
      excel.js           classeur .xlsx (SheetJS)
      pdf.js             document .pdf (jsPDF + autoTable)
  static/                logo PDU, armoirie et icônes, copiés tels quels dans le build
public/app/              interface construite (regénérée, non versionnée)
```

Construire :

```bash
npm install && npm run build
```

Produire l'exécutable :

```bash
npm run dist:win
```

Travailler sur l'interface avec rechargement à chaud :

```bash
npm run dev
```

## 5. Notes techniques

**Signature de l'exécutable.** `signAndEditExecutable: false` est positionné dans `package.json` : sans lui, l'empaquetage échoue sur ce poste, Windows refusant la création des liens symboliques contenus dans l'archive de signature d'electron-builder (droit réservé au mode développeur ou à une session administrateur). L'exécutable fonctionne mais n'est pas signé, d'où l'avertissement SmartScreen. Pour le signer : fournissez un certificat via `CSC_LINK` et `CSC_KEY_PASSWORD`, retirez ce réglage, activez le mode développeur de Windows.

**PDF et encodage.** Les polices standard du PDF sont encodées en WinAnsi : les accents français passent, mais pas les caractères typographiques (tiret cadratin, apostrophe courbe, puce, flèche) — ni, plus insidieux, l'**espace insécable étroite** que le formatage français des nombres insère comme séparateur de milliers. Quand jsPDF rencontre un caractère absent de WinAnsi, il bascule la chaîne entière en encodage large et « 75 000 F » ressort en caractères parasites, sans la moindre erreur. `resources/js/export/winansi.js` assainit tout texte avant écriture, et les deux générateurs de PDF enveloppent `doc.text` pour qu'aucune valeur ne puisse y échapper — y compris celles que jspdf-autotable dessine lui-même dans les cellules.

**jspdf-autotable.** Ce module se présente tantôt comme une fonction exportée par défaut, tantôt comme une méthode greffée sur l'instance jsPDF, selon la façon dont l'outil de construction le résout. `pdf.js` accepte les deux formes : n'en gérer qu'une produit des PDF vides sans lever d'erreur visible.

## 6. La version partagée entre plusieurs postes

Une version connectée à un serveur — base PostgreSQL centrale, site web déployable sur Laravel Cloud, application de bureau synchronisée, mode hors ligne avec file d'attente — a été construite et testée, puis mise de côté au profit de cette version autonome.

Elle reste disponible sur GitHub : https://github.com/Honnore77/projet, commit `33713ed`.

```bash
git checkout 33713ed
```

Le dossier du projet contient encore le serveur Laravel de cette version (`app/`, `routes/`, `database/`, `config/`, `tests/`). **L'application ne s'en sert plus** et il n'entre pas dans l'exécutable ; il est là uniquement pour ne rien perdre. Vous pouvez le supprimer sans conséquence.

## 7. Limites connues

- **Les données sont locales à ce poste.** Aucun partage automatique entre postes ; l'échange se fait par sauvegarde `.json`. C'est le choix assumé de cette version.
- **Aucune sauvegarde automatique hors du poste.** Si le disque tombe, les données tombent avec lui. Exportez régulièrement une sauvegarde vers un autre support.
- **L'exécutable n'est pas signé** (voir §5).
