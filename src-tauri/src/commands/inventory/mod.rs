// Inventaire in-game (V3) — lecture PASSIVE du Game.log (zéro écriture jeu).
// Sous-modules : model (état + helpers purs), parse (lignes → mouvements), apply
// (mouvement → état + rejeu), session (reprise offset), service (I/O + commandes).
pub mod model;
