# Maquette

Ouvrir les maquettes IFC reçues des architectes, et les fichiers STEP (pièces et assemblages fournisseurs), sans logiciel à installer : vue 3D, plans et élévations, coupes, fiche de chaque élément (étage, matériau, dimensions, propriétés), listes des fenêtres et des murs à copier dans Excel, mesures, et coupes exportées en DXF pour AutoCAD.

- Le fichier est lu par le navigateur et n'est envoyé nulle part (pas de base de données pour les maquettes).
- Lecture IFC, géométrie, coupes et DXF dans `js/core.js` (testé : `npm test`), lancée en arrière-plan par `js/worker.js` ; affichage dans `js/app.js` (vue 3D en WebGL).
- Formes lues : B-rep facettés, extrusions (rectangle, cercle, polyligne), maillages IFC4 (triangulés, polygonaux), éléments répétés (mapped items) ; ouvertures découpées dans les murs droits. Les découpes booléennes complexes sont simplifiées (un bandeau le signale).
- Fichiers STEP (`.stp`, `.step`) : lus par OpenCascade (`vendor/occt/`, version figée et vérifiée par empreinte), dans une iframe isolée sans accès au réseau (`js/step.js`) ; `core.js` convertit le résultat (`depuisStep`) : une pièce par solide, couleurs, arêtes de contour, surface et volume. Voir `vendor/occt/LISEZMOI.md`.
- Vues 2D d'un STEP en DXF (`IFC.projection`, `core.js`) : tampon de profondeur pour les arêtes visibles/cachées, cercles et arcs reconnus, diamètres, axes, cotes ; mention « à contrôler » sur tout chiffre calculé.
- Exemple : `exemples/TinyHouse.ifc` (bouton « Voir un exemple »).
- Check-up navigateur : `e2e/checkup.mjs` (lancé par le workflow « Captures » sur chaque branche).
- Publication : GitHub Pages, branche `main`, adresse `https://outils-hn.github.io/Maquette/`.
- En préparation : réservée au concepteur (`RESERVEE_CONCEPTEUR` dans `js/app.js`) tant qu'elle n'est pas ouverte à l'équipe.
