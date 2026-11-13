# Lecteur STEP (OpenCascade) — fichiers tiers, version figée

Ces fichiers ne sont **pas** écrits pour Maquette : ils viennent du projet libre
[occt-import-js](https://github.com/kovacsv/occt-import-js) (auteur : Viktor Kovacs, aussi auteur d'Online 3D Viewer),
qui est OpenCascade (le moteur de CAO libre utilisé par FreeCAD) compilé pour le navigateur (WebAssembly).

| Fichier | Rôle | SHA-256 |
|---|---|---|
| `occt-import-js.js` | chargeur JavaScript (97 Ko, relu) | `8b090be386bc8ffba32222aa19f38742ae8ed35707819beb7f8ab4938a28c97a` |
| `occt-import-js.wasm` | moteur OpenCascade compilé (7,6 Mo) | `33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952` |
| `license.occt-import-js.txt`, `license.occt.txt` | licences LGPL 2.1 | |

- **Version** : commit `41e4708` du dépôt occt-import-js (3 décembre 2024), dossier `dist/`.
- **Aucune mise à jour automatique.** Pour changer de version, remplacer ces fichiers, mettre à jour les empreintes ci-dessus
  **et** celles de `js/step.js` ; Maquette refuse de lancer un fichier dont l'empreinte ne correspond pas.
- **Licence** : LGPL 2.1 (usage libre, y compris professionnel). Les fichiers ne sont pas modifiés ; le reste de Maquette n'est pas concerné.

## Comment Maquette limite le risque

1. L'empreinte SHA-256 des deux fichiers est vérifiée avant chaque lecture.
2. Le moteur tourne dans une iframe isolée (`sandbox="allow-scripts"`, sans accès à la page, au stockage ni aux cookies),
   dont la politique de sécurité (CSP) interdit toute connexion sortante (`connect-src 'none'`, images, formulaires, sous-cadres…).
   Le fichier STEP entre dans cette boîte, la géométrie en sort : rien ne peut en sortir autrement.
   Une seule autorisation particulière : `'unsafe-eval'` à l'intérieur de la boîte, parce que le chargeur (embind) fabrique ses fonctions d'appel
   avec `new Function` à partir de chaînes internes (types C++), jamais à partir du fichier STEP. Cela ne donne aucun accès au réseau.
3. Un test automatique (`e2e/checkup.mjs`) essaie de faire sortir des données depuis la boîte (fetch, XHR, WebSocket, balise, image,
   depuis la boîte et depuis son worker) et échoue si une seule tentative passe.
4. Tout est lu sur le poste : rien n'est envoyé nulle part.
