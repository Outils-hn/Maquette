# Maquette

Ouvrir les maquettes IFC reçues des architectes, sans logiciel à installer : vue 3D, plans et élévations, coupes, fiche de chaque élément (étage, matériau, dimensions, propriétés), listes des fenêtres et des murs à copier dans Excel, mesures, et coupes exportées en DXF pour AutoCAD.

- Le fichier est lu par le navigateur et n'est envoyé nulle part (pas de base de données pour les maquettes).
- Lecture IFC, géométrie, coupes et DXF dans `js/core.js` (testé : `npm test`), lancée en arrière-plan par `js/worker.js` ; affichage dans `js/app.js` (vue 3D en WebGL).
- Formes lues : B-rep facettés, extrusions (rectangle, cercle, polyligne), maillages IFC4 (triangulés, polygonaux), éléments répétés (mapped items) ; ouvertures découpées dans les murs droits. Les découpes booléennes complexes sont simplifiées (un bandeau le signale).
- Exemple : `exemples/TinyHouse.ifc` (bouton « Voir un exemple »).
- Check-up navigateur : `e2e/checkup.mjs` (lancé par le workflow « Captures » sur chaque branche).
- Publication : GitHub Pages, branche `main`, adresse `https://outils-hn.github.io/Maquette/`.
- En préparation : réservée au concepteur (`RESERVEE_CONCEPTEUR` dans `js/app.js`) tant qu'elle n'est pas ouverte à l'équipe.
