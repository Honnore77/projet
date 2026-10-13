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

**Les données ne quittent jamais ce poste.** Deux postes ne partagent rien : pour transporter les données, passez par **Réglages → Exporter une sauvegarde**, puis **Restaurer une sauvegarde** sur l'autre poste. **Sauvegarde hebdomadaire** : chaque **vendredi à 18 h 30**, une copie est écrite dans le sous-dossier **« SAUVEGADE AUTOMATIQUE HEBDO »** du dossier de sauvegarde choisi dans RÉGLAGES (`pdu-parc-auto-hebdo-AAAA-MM-JJ.json`, photos comprises, 52 semaines conservées). Elle s'ajoute aux copies quotidiennes. Si l'application est fermée le vendredi soir, la copie de la semaine se fait à son lancement suivant. RÉGLAGES affiche la dernière copie et la prochaine échéance.

Sauvegardez régulièrement — c'est le seul filet en cas de panne du disque.

Les données des versions précédentes de l'application (y compris le fichier HTML d'origine) sont reprises automatiquement au premier lancement.

## 3. Ce que fait l'application

- **Véhicules** — pool / mission / service. Chaque sous-rubrique affiche les véhicules en tableau, une ligne par véhicule. Changement de catégorie, refus des immatriculations en doublon (deux véhicules sans plaque ne sont pas des doublons), saisie guidée (voir ci-dessous), suivi de la vidange. Aucun montant carburant ou entretien n’apparaît dans cette rubrique — ni dans les tableaux, ni sur la fiche véhicule, ni dans ses exports. La fiche compte les **litres**, les **passages au garage** et les **missions** ; les montants font l’objet du rapport **Coûts par véhicule**, dans RAPPORTS, qui les détaille au lieu de les résumer en bout de ligne.
- **Utilisateurs** — agents du PDU en tableau dès l’ouverture (cinq conducteurs du pool sont pré-enregistrés sur une base vierge), avec les informations du formulaire et les véhicules qui leur sont attribués. Le **téléphone** tient sur trois lignes pré-inscrites — `- FLOTTE PDU :`, `- Tel Perso 1 :`, `- Tel Perso 2 :` — et une **adresse email** figure à côté. Ils alimentent le champ « Utilisateur » des fiches véhicule de pool et de service — dans les deux sens, voir ci-dessous — et le tour de rôle des missions. L’historique des incidents s’ouvre par le bouton de la colonne « Incidents ».
- **Dotation** — deux sous-rubriques, chacune en tableau : *Dotation en carburant pool* (saisie sur place, avec le suivi de la carte carburant décrit ci-dessous) et *Dotation en carburant mission* (lecture de ce qui a été saisi dans le rapport de mission). Le carburant de mission ne se saisit qu’à un seul endroit, le rapport, ce qui évite tout double comptage.
- **Mission** — deux sous-rubriques :
  - *Tableau de suivi des missions* : toutes les missions en tableau, avec les informations du formulaire, plus le nombre de missions et le cumul des jours de chaque conducteur. Le **nombre de jours inclut le jour de départ** : partir et revenir le même jour fait une mission d'un jour, du 1<sup>er</sup> au 3 septembre en fait trois. La **référence suit l'ordre des départs** (voir ci-dessous). Un bandeau **tour de rôle** indique quel conducteur du pool doit partir ensuite (celui qui n'est jamais parti, puis celui dont la dernière mission est la plus ancienne). **Seuls les conducteurs du pool y figurent** : ils sont les seuls autorisés à conduire les véhicules de mission. Un agent y entre par la mention « conducteur du pool » de sa fiche, dans UTILISATEURS.
  - **Plusieurs destinations par mission** : dans « Ajouter une mission », chaque destination choisie dans la liste rejoint le parcours, dans l'ordre (↑ pour le modifier, ✕ pour en retirer une) ; « + Nouvelle destination » en ajoute une absente de la liste. **Chaque étape se compte depuis la précédente** : Abidjan → Yamoussoukro, Yamoussoukro → Bouaké, Bouaké → Korhogo…, et la distance de la mission est la somme des étapes. Entre deux villes sur la même route, l'étape vaut la différence de leurs distances depuis Abidjan ; sinon elle est estimée d'après leurs coordonnées (« ≈ »). Le parcours se termine par le **retour à Abidjan** depuis la dernière destination : le total est l'aller-retour. Dans le rapport de mission, la **distance parcourue sur place** — les déplacements à l'intérieur des destinations — vaut le compteur (km arrivée − km départ) moins ce parcours aller-retour ; elle figure aussi sur le rapport imprimé et dans l'export du carburant des missions. Toute distance d'étape corrigée est gardée dans *Destinations → Trajets entre villes* et resservira. 🧭 ouvre l'itinéraire de l'étape, **Parcours sur Google Maps** le trajet complet. Le tableau de suivi, le rapport de mission et les exports reprennent les étapes et le total.
  - *Destinations* : les lieux de mission, avec leur **distance depuis Abidjan** et leur localisation. Les 45 principales villes du pays sont fournies avec une distance routière indicative ; une nouvelle destination s'ajoute depuis le formulaire de mission (« + Nouvelle destination ») ou depuis cette liste. Coller les coordonnées du lieu (clic droit sur Google Maps) calcule une distance estimée, marquée « ≈ » ; les boutons **Carte** et **Itinéraire depuis Abidjan** ouvrent Google Maps pour situer le lieu et lire la distance exacte par la route. La distance figure dans le tableau de suivi, la liste des rapports, le rapport de mission imprimé et les exports.
  - *Rapport de mission* : la liste des rapports en tableau (conducteur, immatriculation, période, destination), chacun ouvrable par le bouton « Voir ». Le bouton « Remplir le rapport » reste visible sous la liste. Le document reprend le formulaire papier du PDU — participants, dotation en carburant et points de ravitaillement, kilométrage départ/arrivée, observations — et s'imprime ou s'exporte en PDF à l'identique.
- **Entretien** — la rubrique tient dans un **tableau récapitulatif**, avec exactement les colonnes du fichier exporté, une ligne par passage au garage. Le détail — interventions, retour, boutons d'action — s'ouvre par le bouton **« Fiche »** en bout de ligne, qui mène à la fiche du véhicule, **comme dans VÉHICULES**. Entrée au garage, interventions successives, retour, durée d'immobilisation. Marque et modèle repris des listes de VÉHICULES. Dates et kilométrages incohérents refusés. **Motif / problème** et **Observation du conducteur** s'écrivent en lignes tiretées (voir ci-dessous).
- **Décharge** — deux sous-rubriques, chacune en tableau :
  - *Les décharges* : les courriers remis contre décharge — référence (proposée à la suite, `D-001`, `D-002`…, doublons refusés), n° de courrier, objet(s) en lignes tiretées, destinataire, date, personne qui a récupéré la décharge, conducteur et véhicule. Formulaire « Nouvelle décharge », avec la **photo de la décharge signée** (JPEG/PNG) ; la colonne « Décharge signée » signale celles où elle manque (« à joindre »). Un destinataire tapé pour la première fois rejoint de lui-même la liste des destinataires.
  - *Les destinataires* : les structures — nom, contacts, localisation. Formulaire « Nouveau destinataire ». La localisation accepte une adresse ou un lien copié depuis Google Maps, et s'ouvre sur la carte d'un clic. Renommer une structure met à jour ses décharges.
- **Simulation** — sous-rubrique *Simulation de mission* : estimer les frais d'une mission avant le départ. Formulaire « Nouvelle simulation » : période, destinations (même parcours étape par étape que dans MISSION, retour à Abidjan compris), parcours en interne (pour chaque destination : jours sur place × **km par jour réglés dans RÉGLAGES**, résultat proposé et modifiable — une valeur corrigée s'encadre en orange, « ↺ » revient au calcul), véhicule (immatriculation et énergie), consommation (L/100 km, reprise de la dernière simulation du véhicule), prix du litre (réglé dans RÉGLAGES), total des participants, péages (libellé et prix, les péages déjà saisis sont proposés avec leur dernier prix). Calculés en direct :
  - **Frais OM** = participants × 1 000 F (montant réglable dans **RÉGLAGES → Frais OM par participant**) ;
  - **Frais de péage** = somme des péages ;
  - **Carburant** = (parcours aller-retour + parcours en interne) × consommation ÷ 100 × prix du litre ;
  - **Estimation des frais de mission** = frais OM + frais de péage + carburant.

  Les simulations enregistrées sont listées en tableau, modifiables, et s'exportent en Excel et PDF. Le bouton **« Créer la mission »** ouvre le formulaire de mission prérempli (dates, parcours, véhicule) ; le conducteur et les frais restent à saisir. Une fois la mission créée, la simulation affiche sa référence (« → M-006 »).
- **Fiche véhicule** — pour une immatriculation : caractéristiques, litres consommés, dotations, missions, historique garage, et toutes les **photos et documents** qui la concernent, d'où qu'ils viennent.
- **Rapports** — sept documents, en Excel, en PDF ou à imprimer directement.

### Carte carburant et soldes

La dotation pool enregistre le **numéro de la carte carburant**, le **solde avant prise** et le **solde après prise**, à côté de la quantité et du montant.

Le formulaire enchaîne les prises sans qu'on retape quoi que ce soit :

- choisir l'immatriculation reprend la **carte** et le **solde après prise** de la dernière dotation du véhicule, ce dernier devenant le solde avant de la nouvelle prise ;
- le **solde après prise** vaut `solde avant prise − montant calculé`. Ce n'est pas une valeur à constater mais une soustraction : le champ est calculé et en lecture seule. Le saisir à la main ouvrait la porte à un solde qui ne correspond pas à la dépense.

Carte et solde avant prise sont pré-remplis, jamais imposés : une valeur déjà saisie n'est pas écrasée. Les trois colonnes figurent dans le tableau et dans les exports Excel et PDF de la dotation pool.

### Prix du litre

Le prix à la pompe est le même pour tout le monde à une date donnée : il se règle **une fois**, dans **Réglages → Modifier les réglages**, et se **choisit** ensuite dans une liste déroulante — au lieu de se retaper, et de se faire fautiver, à chaque prise.

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| Prix du litre (Essence) | 0 | Proposé dans le champ « Prix / L » quand l'énergie est l'essence. |
| Prix du litre (Diesel) | 0 | Idem pour le diesel. |

Un prix laissé à **0** vaut « pas encore renseigné » : il n'est pas proposé. La liste s'ouvre dans les deux formulaires qui portent un prix au litre — **Nouvelle dotation POOL** et le bloc *ravitaillements* du **rapport de mission**. Elle contient le prix de l'énergie concernée en tête, l'autre ensuite, puis **tous les prix déjà pratiqués** : une prise ancienne reste saisissable. La dernière entrée, **« + Autre prix »**, bascule le champ en saisie libre.

Dans la dotation pool, changer d'énergie remet en tête le prix correspondant — mais **un prix choisi à la main n'est jamais écrasé**.

### Arrondi au franc supérieur

Le franc CFA n'a pas de subdivision : un montant à virgule ne se paie pas. **Tous les montants sont donc arrondis au franc supérieur, dans toutes les rubriques** — jamais au plus proche, car arrondir vers le bas ferait payer à la caisse un franc qu'elle n'a pas encaissé.

L'arrondi est posé **là où le montant naît** — au calcul et à la saisie —, pas à l'affichage. Un total calculé sur des valeurs à virgule ne tomberait pas sur la somme des lignes affichées, et le tableau montrerait un franc d'écart que rien n'expliquerait.

| Rubrique | Montants arrondis |
| --- | --- |
| Dotation pool | Prix / L, montant calculé, solde avant prise, solde après prise |
| Mission | Montant des frais, montant versé, dotation en carburant, prix / L des ravitaillements |
| Entretien | Coût de chaque intervention |
| Réglages | Prix du litre (essence et diesel) |

Ce qui n'est **pas** un montant garde ses décimales : les **litres** (33,33 L reste 33,33 L) et les **kilométrages**.

Le montant d'une prise vaut donc `litres × prix du litre`, arrondi une seule fois, à la fin : 33,33 L à 715 F font 23 830,95 F, soit **23 831 F**. Le solde après prise reste exactement le solde avant moins ce montant.

Les fiches enregistrées avant cette règle sont reprises au chargement : elles ne gardent pas leurs centimes, sinon un même tableau mélangerait des lignes rondes et des lignes à virgule.

### Kilométrage relevé ailleurs

Le kilométrage d'une fiche véhicule vieillit dès qu'on la ferme. Ce sont les autres rubriques qui relèvent le compteur au fil de l'usage :

| Relevé | Où il est saisi |
| --- | --- |
| Kilométrage | Nouvelle dotation — POOL |
| Km entrée | Nouvelle fiche d'entretien — entrée au garage |
| Km sortie | Retour du garage |

La fiche véhicule affiche **le plus récent des trois**, plutôt que d'attendre qu'on le reporte à la main d'une rubrique à l'autre. Le champ **Kilométrage** passe alors en lecture seule et un champ **Origine du kilométrage** nomme d'où vient le chiffre — par exemple *« retour du garage du 20/04/2026 »*. Sans aucun relevé, il se saisit normalement.

Le tableau des véhicules, la fiche véhicule, les exports et le **suivi de la vidange** s'appuient tous sur ce même kilométrage : une seule valeur, une seule vérité.

### Lignes tiretées

Un passage au garage cumule souvent plusieurs problèmes, un retour plusieurs observations. Deux champs de la rubrique ENTRETIEN s'écrivent donc **une ligne par élément, ouverte par un tiret** :

- **Motif / problème**, dans *Nouvelle fiche d'entretien — entrée au garage* ;
- **Observation du conducteur**, dans *Retour du garage*.

Le champ s'ouvre sur `- `, la touche **Entrée** passe à la ligne en posant le tiret suivant, et une ligne collée depuis ailleurs en reçoit un à la sortie du champ. La touche reste libre : une ligne effacée le reste. Les lignes sont conservées telles quelles à l'écran, dans l'aperçu, dans le PDF et dans le classeur Excel — où la cellule passe en renvoi à la ligne.

### Synchronisation UTILISATEURS ↔ véhicules

Une fiche véhicule retient un **nom**, pas un identifiant : c'est ce qui s'imprime et ce qu'on lit dans un tableau. Le nom doit donc suivre l'agent, dans les deux sens, sans quoi les deux rubriques divergent au premier changement et plus personne ne sait laquelle dit vrai.

- **Un nom saisi sur une fiche véhicule** (pool ou service, via « + Autre nom ») **crée sa ligne dans UTILISATEURS**, remplie avec ce que la fiche sait de lui :

  | Champ de l'agent | Valeur reprise |
  | --- | --- |
  | Nom | premier mot du nom saisi |
  | Prénoms | le reste |
  | Section | celle du véhicule |
  | Statut | Actif |
  | Conducteur du pool | Non |
  | Observations | « Créé depuis la fiche véhicule *immatriculation* » |
  | Véhicule(s) attribué(s) | le véhicule, aussitôt visible dans la colonne |

  Le reste (fonction, téléphone, adresse email, permis) se complète dans UTILISATEURS, et le découpage nom/prénoms s'y corrige si besoin. Si l'agent existe déjà, sa fiche n'est pas écrasée : seule une **section** encore vide est complétée.
- **Un agent renommé dans UTILISATEURS** est renommé sur toutes les fiches véhicule qui le portaient. Le message de confirmation indique combien de fiches ont suivi.
- **Un agent supprimé** : la fenêtre de confirmation liste les véhicules concernés et annonce que leur champ « Utilisateur » sera vidé. Les véhicules eux-mêmes sont conservés.
- La colonne **Véhicule(s) attribué(s)** du tableau UTILISATEURS montre le lien en permanence — badge vert pour un véhicule de pool, violet pour un véhicule de service.

Les véhicules de **mission** ne sont pas concernés : ils n'ont pas d'utilisateur attitré, ils partent au tour de rôle.

### Saisie guidée d'un véhicule

Le formulaire propose ce qui est déjà connu plutôt que d'attendre une saisie libre à chaque fois :

| Champ | Comportement |
| --- | --- |
| Marque | Liste déroulante : NISSAN, TOYOTA, FORD, plus toutes celles déjà enregistrées. Dernière entrée **« + Autre marque »**. |
| Modèle | Liste déroulante : TERRA, NAVARA, KICKS, QASHQAI, XTRAIL, TERRITORY, CROSS, PRADO, LAND CRUISER. La dernière entrée, **« + Autre modèle »**, bascule le champ en saisie libre ; « ↩ » revient à la liste. |
| Couleur | Même principe : BLANCHE, NOIRE, GRISE, ROUGE, BLEU, puis **« + Autre couleur »**. |
| Utilisateur | Liste des agents enregistrés dans UTILISATEURS, plus **« + Autre nom »** pour saisir quelqu’un qui n’y figure pas encore. Le nom saisi est aussitôt ajouté à UTILISATEURS. |
| Nouvelle immatriculation | **Facultative.** Pré-remplie avec **D45 50 ** ; il ne reste que la fin de la plaque à saisir. Laissée au préfixe seul, elle est enregistrée comme absente et **signalée en rouge clair** (voir ci-dessous). |
| Ancienne immatriculation | Pré-remplie avec **D45 ** ; laissée telle quelle, elle est enregistrée comme vide. |
| Statut | Disponible, En entretien, Immobilisé. « En mission » a été retiré : la mission en cours se lit dans la rubrique MISSION, et deux endroits pour un même fait finissaient par se contredire. Un véhicule encore marqué ainsi garde son statut tant qu'on ne le change pas. |

Toute valeur ajoutée à la main rejoint la liste : elle est reproposée dès la fiche suivante, sans réglage à faire.

**Les fiches d'entretien puisent dans les mêmes listes.** Marque et Modèle y sont les mêmes menus déroulants que dans VÉHICULES : c'est le même parc, il n'a pas à s'y présenter sous deux inventaires différents. Choisir l'immatriculation les remplit d'ailleurs automatiquement, et un véhicule retiré du parc depuis garde sa marque sur ses anciennes fiches.

> Les missions enregistrées avant ce changement sont recomptées à l'ouverture, à partir de leurs dates. L'opération se relance sans risque : elle recalcule au lieu d'ajouter.
>
> L'immobilisation au garage garde l'écart brut entre les dates : on y mesure un temps d'indisponibilité, pas des journées de mission à indemniser.

### Mention de lieu et de date

Tout document produit par l'application se termine par **« Fait à Abidjan le *date du jour* »**, en bas à droite. Un fichier exporté circule ensuite seul : sans cette mention, on ne sait plus à quel état du parc il correspond.

| Sortie | Où la mention apparaît |
| --- | --- |
| Document PDF | pied de chaque page, à droite ; le numéro de page passe au centre |
| Rapport de mission (PDF) | pied de page, à droite |
| Classeur Excel | dernière ligne de chaque feuille, dernière colonne, en italique gris aligné à droite |
| Impression directe | après le dernier tableau, aligné à droite |
| Fenêtre d'aperçu | sous chaque feuille, comme dans le fichier |

La ville se règle dans **Réglages → Modifier les réglages → Ville des documents** (Abidjan par défaut).

> La date qui figurait en haut à droite des PDF (« Édité le … ») a été retirée : elle disait la même chose que la mention du pied, et deux dates pour un même fait ne valent rien.

### Informations manquantes signalées

Un véhicule peut être enregistré **sans nouvelle immatriculation** : elle arrive parfois après le véhicule. Pour qu'un trou ne passe pas inaperçu dans un document transmis, la cellule vide est peinte en **rouge clair** et porte la mention *« non renseignée »* — aux quatre endroits où la donnée circule :

| Où | Rendu |
| --- | --- |
| Tableau des véhicules | pastille rouge clair, texte en italique |
| Fenêtre d'aperçu avant export | identique, pour voir le fichier avant de l'écrire |
| Classeur Excel | remplissage `#F8D7DA`, texte `#9B2C2C` en italique |
| Document PDF | même fond et même texte dans la cellule |

Le mécanisme est déclaratif : une colonne d'export marquée `alerteSiVide` est traitée ainsi par les trois rendus. Ajouter un autre champ à surveiller ne demande donc rien de plus que ce marqueur.

> L'écriture des styles de cellule Excel demande `xlsx-js-style`, fork de SheetJS 0.18.5 : la version communautaire de `xlsx` sait les lire mais pas les écrire. L'API est la même, et `xlsx` a été retiré des dépendances pour ne pas embarquer deux fois la même bibliothèque.

### Suivi de la vidange

Dans les fiches de véhicule, **« Kilométrage de vidange »** est le kilométrage **auquel la vidange doit être faite**, pas celui de la dernière. L'application le compare en permanence au **kilométrage courant** du véhicule — le dernier relevé, d'où qu'il vienne (voir *Kilométrage relevé ailleurs*) — et affiche le résultat à trois endroits :

- dans le formulaire, un champ **« Suivi de la vidange »** se met à jour pendant la saisie ;
- dans le tableau des véhicules, une colonne **« Prochaine vidange »** donne le kilométrage visé et une colonne **« Suivi vidange »** l'état — verte tant qu'il reste de la marge, orange à l'approche, rouge une fois dépassée ;
- sur le tableau de bord, deux alertes cliquables : les véhicules **à vidanger sans délai** et ceux qui **approchent de la vidange**, avec pour chacun le nombre de kilomètres concernés.

Deux réglages pilotent ce suivi (**Réglages → Modifier les réglages**) :

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| Intervalle de vidange (km) | 5 000 | À la saisie d'un véhicule, propose une première fois `kilométrage courant + intervalle`. La valeur proposée reste modifiable, et n'est plus reproposée ensuite. |
| Alerte vidange (km restants) | 500 | Marge à partir de laquelle l'alerte « approche » se déclenche. |

Après une vidange, il suffit de reporter le nouveau kilométrage cible dans la fiche : les pastilles et les alertes repassent au vert.

Un véhicule sans kilométrage de vidange n'est simplement pas suivi (« non suivie ») ; il ne déclenche aucune alerte. Les exports Excel et PDF du parc reprennent les colonnes *Prochaine vidange (km)*, *Km avant vidange* et *Suivi vidange*.

### Bandeau d'alerte

Les alertes du tableau de bord ne se voient que sur le tableau de bord. Un **bandeau** les porte donc en permanence, **au centre de la ligne du logo**, quelle que soit la rubrique ouverte. Il reste **vide quand tout va bien** : un bandeau qui affiche toujours quelque chose finit par ne plus rien vouloir dire.

**Voyants de vidange** — dès qu'il reste moins de 1 000 km avant l'échéance, un voyant **clignotant** donne l'immatriculation et les kilomètres restants :

| Kilomètres restants | Voyant |
| --- | --- |
| 1 000 à 750 | 🟡 jaune |
| 750 à 500 | 🟠 orange |
| moins de 500 | 🔴 rouge |

Une valeur pile sur un seuil prend la couleur la plus grave : à 750 km on est déjà orange. Une fois l'échéance dépassée, le voyant reste rouge et compte le retard (« 300 km de retard ») **jusqu'à ce que la vidange soit faite** — c'est-à-dire jusqu'à ce que le kilométrage cible de la fiche soit reporté plus loin. Le voyant s'éteint alors immédiatement, sans qu'on ait à recharger.

Ces seuils sont **fixes** et ne se règlent pas : c'est une règle d'atelier, pas une préférence. Le réglage *Alerte vidange* garde son rôle ailleurs — il décide de la pastille « approche » dans le tableau des véhicules.

**Véhicules immobilisés** — un voyant **gris, fixe**, avec l'immatriculation et le nombre de jours d'immobilisation. Sont retenus les véhicules **au garage** (fiche d'entretien sans retour) et ceux qu'une fiche déclare *Immobilisé* — réunis, pour qu'aucun ne paraisse deux fois ni ne manque. Le gris est délibéré : il laisse le jaune, l'orange et le rouge ne vouloir dire qu'une seule chose, l'échéance de vidange.

Chaque voyant est **cliquable** et ouvre la fiche du véhicule. Au-delà de cinq, un voyant **« +N »** mène à la liste des véhicules.

Sur un **écran étroit**, une immatriculation par voyant ne tient pas : le bandeau donne alors le **nombre par couleur** (« 🛢️ 2 », « 🔧 1 »), et le titre de la rubrique s'efface le temps de l'alerte — l'onglet actif dit déjà où l'on est. Pour qui a demandé **moins d'animation** dans son système, le voyant ne clignote pas : il porte un liseré à la place.

### Photos et documents

Cinq formulaires acceptent des images **JPEG et PNG** : véhicules, utilisateurs, entretien, dotation et rapport de mission. Vignettes, agrandissement au clic, retrait. La **fiche véhicule** rassemble ensuite toutes celles qui la concernent — la sienne, celles de ses passages au garage, celles de ses prises de carburant — chacune disant d'où elle vient.

| Rubrique | Ce qu'on y met en général |
| --- | --- |
| Véhicules | Photo du véhicule, carte grise, assurance, visite technique |
| Entretien | Avarie à l'entrée, facture du garage, pièce remplacée |
| Utilisateurs | Photo de l'agent, permis de conduire |
| Dotation | Reçu de la station, ticket de la carte carburant |
| Rapport de mission | Ordre de mission signé, justificatifs de frais |

**Les images ne sont pas dans la base**, et c'est délibéré. La base est un seul fichier réécrit en entier à chaque saisie, et sur le web elle tient dans un stockage limité à quelques méga-octets. Deux photos par fiche y feraient une quinzaine de méga-octets : **la version web et l'APK cesseraient d'enregistrer**. Les octets vivent donc à côté — un dossier `images/` sur le bureau, IndexedDB dans le navigateur — et la fiche ne retient qu'un identifiant.

Chaque image est **ramenée à 1 600 px en JPEG** à l'import : une photo de téléphone de 3 Mo tombe à une trentaine de kilo-octets sans qu'une carte grise cesse d'être déchiffrable. Un PNG transparent reçoit un fond blanc, sans quoi il virerait au noir.

Une image est écrite dès qu'on la choisit, avant même de valider le formulaire — pour que la vignette apparaisse tout de suite. Annuler laisse donc quelques octets orphelins, balayés au démarrage suivant.

### Sauvegarde automatique

La copie `pdu-parc-auto.backup.json` du poste est **écrasée à chaque enregistrement** : elle protège d'une écriture interrompue, pas d'une erreur remarquée le lendemain, et elle est sur le même disque que l'original.

**Réglages → Sauvegarde automatique** ouvre un second filet : une **copie datée par jour** dans le dossier que vous désignez — clé USB, disque réseau, dossier synchronisé.

- Le fichier du jour est réécrit tant que la journée dure ; **celui de la veille reste intact**.
- Au-delà du nombre conservé (30 par défaut), la plus ancienne s'en va.
- Les **images sont recopiées à côté**, en miroir : une image ne changeant jamais, les trente copies partagent un seul jeu au lieu de le dupliquer trente fois. Rien n'y est effacé — une sauvegarde doit survivre à une suppression, y compris regrettée.
- Une clé débranchée **ne fait jamais échouer un enregistrement** : la copie vient après l'écriture qui compte, et l'échec s'affiche dans la rubrique.

L'**export manuel** produit désormais une **archive `.zip`** contenant les données et les images. Les anciennes sauvegardes `.json` restent restaurables : une restauration ne doit pas dépendre de la version qui l'a produite.

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

Les sections du PDU sont une liste fermée, partagée par la fiche véhicule et la fiche agent : COORDINATION, AFFAIRE ADMINISTRATIVE ET FINANCIERE, OPERATION ET SUIVI-EVALUATION, MARCHE ET AFFAIRES JURIDIQUES, AGENCE COMPTABLE, COMMUNICATION. Deux listes séparées finiraient par diverger, et les filtres par section ne retrouveraient plus leurs petits. Elle se modifie dans `resources/js/core/db.js`.

> **OPERATION** est devenue **OPERATION ET SUIVI-EVALUATION**. Les fiches qui portaient l'ancien libellé sont reportées au chargement : sans cela, elles seraient muettes dans la liste déroulante — un `<select>` ignore en silence une valeur absente de ses options — et invisibles au filtre par section. La table des renommages (`SECTIONS_RENOMMEES`, dans `db.js`) sert au prochain changement de nom.

### Référence des missions

La référence dit le **rang chronologique** de la mission : la date de départ la plus ancienne porte **M-001**, la suivante M-002, et ainsi de suite. Une mission sans date de départ passe en fin de liste.

Elle est donc **calculée, pas saisie** : le champ du formulaire est en lecture seule et affiche, pendant la saisie, le rang qu'occupera la mission. Une mission ajoutée après coup pour un départ antérieur prend sa place dans la suite et décale celles d'après — c'est le prix à payer pour que la colonne se lise dans l'ordre. La renumérotation est relancée à chaque enregistrement, à chaque suppression et à chaque ouverture de la base ; elle recalcule au lieu d'ajouter, et se relance donc sans risque.

> Le champ **Objet de la mission** a été retiré du formulaire : la destination et le rapport de mission disent ce que la mission allait faire, et une colonne de plus dans un tableau déjà large ne se lisait pas.

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

Le serveur Laravel de cette version (`app/`, `routes/`, `database/`, `config/`, `storage/`, `bootstrap/`, `tests/`, `artisan`, `composer.json`) **a été retiré du dossier de travail**. L'application ne s'en servait plus et il n'entrait pas dans l'exécutable ; il ne restait que pour mémoire, et son dossier `tests/` faisait croire à des tests qui ne testaient rien d'ici.

Rien n'est perdu : le commit `33713ed` le contient en entier, et la commande ci-dessus le fait réapparaître.

## 7. Limites connues

- **Les données sont locales à ce poste.** Aucun partage automatique entre postes ; l'échange se fait par sauvegarde. C'est le choix assumé de cette version.
- **L'exécutable n'est pas signé** (voir §5).
- **La sauvegarde automatique n'existe que sur le bureau.** Le navigateur et l'APK n'ont pas accès à un dossier du disque ; ils s'en remettent à l'export manuel.
