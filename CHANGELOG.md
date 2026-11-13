# Journal des versions — Maquette

Chaque version qui change quelque chose de visible pour l'équipe a une puce « Nouveauté : … », en langage courant : c'est la seule phrase affichée sur la page « Nouveautés » de l'Accueil.

## 1.9 — 13 novembre 2026

- Nouveauté : disposition « Atelier ». La 3D prend toute la place ; un rail d'icônes à gauche ouvre le contenu, la recherche ou les remarques ; la fiche s'ouvre quand on sélectionne un élément ; les listes se replient en bas. Tous les panneaux s'élargissent en tirant leur bord (double-clic pour replier), et les tailles sont gardées.
- Nouveauté : recherche d'éléments par nom, type, étage, matériau ou identifiant (touche « / »).
- Barre d'outils de la 3D compacte, en icônes, sur une seule ligne.
- Corrigé : allège fausse (plusieurs centaines de mètres) sur les maquettes placées à leur altitude réelle ; certains murs complexes pouvaient encore bloquer la lecture.

## 1.8 — 13 novembre 2026

- Nouveauté : l'appli occupe toute la fenêtre, avec un bouton plein écran ; le contenu, la fiche de l'élément et les listes se replient d'un clic (choix gardé sur le poste).
- Nouveauté : en plan et en coupe, la matière coupée est remplie au lieu d'apparaître creuse.
- Les remarques sur la maquette tiennent dans une petite pastille à déplier, et le cadrage ignore les éléments isolés très loin du bâtiment.
- Corrigé : les murs de façade légère percés de nombreuses fenêtres pouvaient bloquer la lecture (temps de découpe désormais limité par élément).

## 1.7 — 13 novembre 2026

- Corrigé : la lecture pouvait rester bloquée sur certaines ouvertures (arcs de cercle avec un angle hors norme). Par sécurité, un élément qui bloque le calcul plus de 30 s est maintenant ignoré automatiquement et signalé, et la lecture reprend sans lui.

## 1.6 — 13 novembre 2026

- Corrigé : une grosse maquette avec beaucoup d'ouvertures (dalles percées de trémies, murs-rideaux…) pouvait tourner plusieurs minutes. La lecture affiche maintenant son étape (lecture, indexation, ouvertures, éléments) et signale par leur nom les éléments très longs à calculer.

## 1.5 — 13 novembre 2026

- Nouveauté : onglet « Façades » avec le métré de chaque face (longueur, hauteur, surfaces brute et nette, fenêtres, portes, tableaux, linteaux, appuis), à copier dans Excel.
- Nouveauté : élévation de façade en DXF pour AutoCAD, avec les cotes des ouvertures par étage, les dimensions et allèges de chaque ouverture et les niveaux. Bouton « DXF coté » dans l'onglet Façades, ou bouton DXF quand une face (A à D) est affichée.
- Les faces A à D suivent l'orientation du bâtiment, même s'il est tourné dans la maquette.

## 1.4 — 13 novembre 2026

- Nouveauté : les très grosses maquettes s'ouvrent (testé jusqu'à 317 Mo), avec une barre de progression, et les fichiers compressés .ifczip aussi. La sélection d'un élément est instantanée.
- Nouveauté : armatures, mains courantes et tubes sont dessinés.
- Corrigé : la sélection et les arêtes s'affichaient en noir ; certains fichiers « pièges » faisaient planter ou ralentissaient fortement la lecture.

## 1.3 — 13 novembre 2026

- Nouveauté : les vraies maquettes Revit et ArchiCAD s'ouvrent correctement (bonne échelle, ouvertures découpées dans tous les murs, profils arrondis et profilés acier, murs coupés sous les toitures), plus vite et avec des messages clairs.
- Signature : « Conçu par Hugo N. · Imaginé par Virgile G. ».
- Corrigé : certains fichiers Revit s'affichaient 1000 fois trop grands (deux unités déclarées), et un fichier pouvait faire planter la lecture.

## 1.2 — 13 novembre 2026

- Nouveauté : l'export STEP donne de vrais solides 3D (murs avec leurs ouvertures, menuiseries…) au lieu d'un maillage dans AutoCAD.

## 1.1 — 13 novembre 2026

- Nouveauté : export STEP pour AutoCAD et les logiciels 3D. L'élément sélectionné, les éléments affichés ou toute la maquette, un solide par élément rangé dans un assemblage, en millimètres.

## 1.0 — 13 novembre 2026

- Nouveauté : première version. Ouvrir une maquette IFC des architectes dans le navigateur (rien n'est envoyé) : 3D, plans et élévations, coupes, fiche de chaque élément, listes des fenêtres et des murs à copier dans Excel, mesures, et coupes en DXF pour AutoCAD.
