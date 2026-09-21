# Rapporteur pour Windows et Mac

L'application de bureau de [Rapporteur](https://lerapporteur.com) — vos réunions
deviennent des comptes rendus. Une coquille Electron sans aucune logique du
service : elle charge lerapporteur.com et lui ajoute la seule chose qu'un
navigateur ne sait pas faire — capter le son de tout l'ordinateur (Teams, Zoom,
Skype installés, ou une réunion rejouée).

Téléchargements : l'onglet **Releases** — `Rapporteur-Setup.exe` (Windows) et
`Rapporteur.dmg` (Mac) — ou directement depuis lerapporteur.com.

## Construire

```
npm ci
npm start            # lancer en développement
npm run dist:win     # l'installateur Windows (sur Windows)
npm run dist:mac     # l'image disque Mac (sur macOS)
```

Le workflow **Construire et publier** (GitHub Actions) fait les deux à chaque
poussée, lance chaque application sur sa machine et garde une capture d'écran
en artefact. Avec `publier = true`, il attache les fichiers à la Release.

## Windows — Microsoft Store

Le `.exe` n'est pas signé : Windows affiche « Éditeur inconnu » et, depuis
septembre 2026, Edge et Chrome retiennent le fichier (« n'est pas fréquemment
téléchargé », SmartScreen). L'édition Store règle cela : le Store signe le
paquet et l'installe sans téléchargement. Une fois le compte développeur
ouvert sur Partner Center et le nom « Rapporteur » réservé, la page
*Identité du produit* donne trois valeurs à poser en variables du dépôt
(`STORE_IDENTITY_NAME`, `STORE_PUBLISHER`, `STORE_PUBLISHER_DISPLAY`) ;
le job **store** produit alors `Rapporteur-Store.appx` (artefact) à déposer
dans la soumission. Dans cette édition, `process.windowsStore` est vrai et
l'application ne propose jamais le `.exe` du site : le Store la met à jour.

## Mac — signature et notarisation

Sans signature, macOS refuse d'ouvrir l'image disque (« impossible de vérifier
le développeur ») : il faut alors clic droit → Ouvrir, puis Réglages Système →
Confidentialité et sécurité → Ouvrir quand même. Avec un compte développeur
Apple (le même que pour l'application iPhone, voir le guide du dépôt
`rapporteur-ios`), le workflow signe et notarise si les secrets `MAC_CERT_P12`,
`MAC_CERT_MDP`, `ASC_CLE_ID`, `ASC_EMETTEUR_ID` et `ASC_CLE_P8` sont posés.

Point à vérifier sur un vrai Mac : la capture du son des autres applications
(`audio: "loopback"` d'Electron) n'est pas offerte par toutes les versions ;
`main.js` retombe alors sur l'écran seul et la réunion se capte au micro,
haut-parleur allumé.

## Fichiers

| Fichier | Rôle |
|---|---|
| `main.js` | Le processus principal : fenêtre, capture système, permissions, liens externes, mise à jour (`/docs/bureau.json`). |
| `preload.js` | Le seul pont page ↔ application (`window.rapporteurBureau`). |
| `accueil.html`, `reserve.html` | Les écrans locaux : hors connexion, et « réservé aux clients ». |
| `entitlements.mac.plist` | Le hardened runtime macOS (JIT d'Electron, micro). |
| `icon.png`, `icon-mac.png` | Les icônes Windows et Mac. |
