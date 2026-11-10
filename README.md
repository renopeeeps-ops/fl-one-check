# Réception chantier – Lampadaires solaires

Application web 100 % statique (aucun serveur, aucune base de données) :
fiches de points non conformes, photos, GPS, signatures, export PDF, partage.
Les fiches restent **dans le navigateur de l'appareil** (IndexedDB) ; utilise
**Export JSON** pour sauvegarder ou transférer une fiche d'un appareil à l'autre.

## Mettre en ligne (GitHub Pages, sous TON compte)

1. Crée un compte sur https://github.com si besoin, puis **New repository**
   (nom conseillé : `fl-one-check`, visibilité Public — requis par Pages en offre gratuite).
2. Clique **uploading an existing file**, glisse **tout le contenu de ce dossier**
   (`index.html`, `style.css`, `js/`, `lib/`, `img/`), puis **Commit changes**.
3. Dans le dépôt : **Settings → Pages → Build and deployment**
   - Source : *Deploy from a branch*
   - Branch : `main` / dossier `/ (root)` → **Save**
4. Après ~1 minute, le site est en ligne sur
   `https://TON-PSEUDO.github.io/fl-one-check/`.

> Le site est public : n'y mets pas de données sensibles dans le code.
> Les fiches saisies, elles, ne quittent jamais l'appareil.

## Modifier le site

| Je veux changer…                         | Fichier / endroit                                  |
|------------------------------------------|----------------------------------------------------|
| Liste des poseurs / contrôleurs          | `js/app.js` → bloc `CONFIG` en haut                |
| Catégories, gravités, titre du PDF       | `js/app.js` → bloc `CONFIG`                        |
| Taille / qualité des photos              | `js/app.js` → `photoMaxPx`, `photoQualite`         |
| Couleurs, tailles, apparence             | `style.css` (variables `:root` en haut)            |
| Mise en page du PDF                      | `js/app.js` → fonction `buildPdf()`                |
| Textes et champs du formulaire           | `index.html`                                       |
| Logo à l'écran                           | remplacer `img/logo.png`                           |
| Logo dans le PDF                         | régénérer `js/logo-data.js` (voir ci-dessous)      |

Modifier un fichier directement sur GitHub : ouvre-le → icône crayon ✏️ → **Commit changes**.
Le site se met à jour en ~1 minute.

### Changer le logo du PDF
Le PDF utilise `js/logo-data.js` (logo encodé en base64, pour fonctionner hors ligne).
Pour le régénérer depuis un nouveau `img/logo.png` :

```bash
python3 -c "import base64;b=base64.b64encode(open('img/logo.png','rb').read()).decode();open('js/logo-data.js','w').write('window.LOGO_DATA=\"data:image/png;base64,'+b+'\";\n')"
```

## Bouton « ✅ Pas de réserves »

Génère un PV de réception « sans réserve » (infos chantier + texte de réception + 3 signatures).
Il est refusé si la fiche contient des points non conformes.
Le texte se modifie dans `js/app.js` → `CONFIG.texteSansReserve` (variables : `{controleur}`
`{poseur}` `{commune}` `{projet}` `{adresse}` `{date}`).

## Envoyer les photos sur Google Drive (à l'export)

À chaque « Exporter PDF » (ou « Partager »), si la case **☁️ Envoyer aussi les photos…** est cochée,
les photos sont envoyées en haute résolution (2048 px) dans ton Drive :
`Mon Drive / FL One Check – Photos / <date - commune - projet> /`
(fichiers nommés `Point 01 - <nom> - photo 1.jpg`). Une photo déjà envoyée n'est pas renvoyée.
Si Drive échoue (pas de réseau, connexion refusée…), le PDF est généré quand même.
Le site n'a accès qu'aux fichiers qu'il a lui-même créés (portée `drive.file`) : jamais au reste de ton Drive.

### Configuration unique (≈ 10 min) — nécessaire car l'accès Drive passe par TON projet Google

1. Va sur https://console.cloud.google.com, crée un projet (ex. « FL One Check »).
2. **APIs et services → Bibliothèque** → cherche **Google Drive API** → **Activer**.
3. **Google Auth Platform** (ou « Écran de consentement OAuth ») : renseigne le nom de l'appli et ton e-mail,
   public **Externe**. Dans **Accès aux données**, ajoute la portée `.../auth/drive.file`.
   Tant que l'appli est « en test », ajoute ton adresse Google (et celles de tes collègues) comme
   **utilisateurs de test**. Google affichera un avertissement « appli non validée » :
   **Paramètres avancés → Continuer** (normal pour ta propre appli).
4. **Clients (ou Identifiants) → Créer un client OAuth** → type **Application Web** →
   **Origines JavaScript autorisées** : `https://TON-PSEUDO.github.io` (sans `/` final ni nom de dépôt).
5. Copie l'**ID client** (`xxxx.apps.googleusercontent.com`) et colle-le dans `js/app.js` :
   `googleClientId: "xxxx.apps.googleusercontent.com",`
   (cet identifiant n'est pas secret, il peut rester dans le dépôt public).

Options dans `CONFIG` : `driveRootFolder` (nom du dossier racine), `driveLinkInPdf: true`
(ajoute au PDF un lien vers le dossier ; seules les personnes ayant accès au dossier pourront l'ouvrir —
partage-le depuis Drive si besoin).

## Tester en local
Ouvre `index.html` dans le navigateur, ou lance `python3 -m http.server` dans ce dossier
puis va sur http://localhost:8000 (le GPS et le partage de fichiers exigent HTTPS ou localhost).

## Bibliothèques
- [jsPDF 2.5.1](https://github.com/parallax/jsPDF) (licence MIT), copiée dans `lib/` : aucun CDN requis.
