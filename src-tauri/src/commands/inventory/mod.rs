// Inventaire in-game (V3) — lecture PASSIVE du Game.log (zéro écriture jeu).
// Sous-modules : model (état + helpers purs), parse (lignes → mouvements), apply
// (mouvement → état + rejeu), session (reprise offset), service (I/O + commandes).
pub mod apply;
pub mod model;
pub mod parse;
pub mod service;
pub mod session;
