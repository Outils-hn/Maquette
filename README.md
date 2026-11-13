# Maquette

Ouvrir les maquettes IFC reçues des architectes, et les fichiers STEP (pièces et assemblages fournisseurs), sans logiciel à installer : vue 3D, plans et élévations, coupes, fiche de chaque élément (étage, matériau, dimensions, propriétés), listes des fenêtres et des murs à copier dans Excel, mesures, et coupes exportées en DXF pour AutoCAD.

- Le fichier est lu par le navigateur et n'est envoyé nulle part (pas de base de données pour les maquettes).
- Lecture IFC, géométrie, coupes et DXF dans `js/core.js` (testé : `npm test`), lancée en arrière-plan par `js/worker.js` ; affichage dans `js/app.js` (vue 3D en WebGL).
- Formes lues : B-rep facettés, extrusions (rectangle, cercle, polyligne), maillages IFC4 (triangulés, polygonaux), éléments répétés (mapped items) ; ouvertures découpées dans les murs droits. Les découpes booléennes complexes sont simplifiées (un bandeau le signale).
- Fichiers STEP (`.stp`, `.step`) : lus par OpenCascade (`vendor/occt/`, version figée et vérifiée par empreinte), dans une iframe isolée sans accès au réseau (`js/step.js`) ; `core.js` convertit le résultat (`depuisStep`) : une pièce par solide, couleurs, arêtes de contour, surface et volume. Voir `vendor/occt/LISEZMOI.md`.
- Vues 2D d'un STEP en DXF (`IFC.projection`, `core.js`) : tampon de profondeur pour les arêtes visibles/cachées, cercles et arcs reconnus, diamètres, axes, cotes ; mention « à contrôler » sur tout chiffre calculé.
- Comparaison de deux versions (`IFC.comparer`, `IFC.fusionComparaison`, `core.js`) : appariement par GlobalId (IFC) ou par type et nom puis par forme (STEP), statuts ajouté / supprimé / modifié / déplacé (tolérance 1 mm), affichage fusionné dans la vue 3D.
- Relevé gros-œuvre en DXF (`IFC.releve`, `core.js`) : un plan par niveau (murs, poteaux, dalles, escaliers), axes déduits des murs, cotes, niveaux ; calques GO-*, mention « à contrôler ».
- Orientation d'un STEP (`IFC.pivoter`, `matricePoser`, `matriceAxe`, `annulerPivot`) : rotation réversible de toute la géométrie autour d'un pivot fixe ; poser sur une face, rotations de 90°.
- Exemple : `exemples/TinyHouse.ifc` (bouton « Voir un exemple »).
- Check-up navigateur : `e2e/checkup.mjs` (lancé par le workflow « Captures » sur chaque branche).
- Publication : GitHub Pages, branche `main`, adresse `https://outils-hn.github.io/Maquette/`.
- En préparation : réservée au concepteur (`RESERVEE_CONCEPTEUR` dans `js/app.js`) tant qu'elle n'est pas ouverte à l'équipe.
