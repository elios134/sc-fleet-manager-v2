// Installateur de trad FR (V3) — packs global.ini communautaires dans l'install SC.
// Logique pure (cfg, ini, feed) testée ; I/O bornée (fsops, registry) ; commandes (service).
pub mod cfg;
pub mod ini;
pub mod feed;
pub mod fsops;
pub mod registry;
