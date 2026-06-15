-- Bloc 4 — Nettoyage : suppression de la table de prix héritée de SC Trade Tools.
-- La source de prix est désormais UEX (UexCommodityPrice). CargoPriceListing (Phase B',
-- crowdsource commodity-listings) n'est plus ni écrite ni lue par le moteur → on la DROP
-- pour éviter toute reconfusion. Les autres tables Cargo* (référentiels) restent car
-- encore peuplées par la sync « lieux » (sync_cargo_reference / positions SC Wiki).
DROP TABLE IF EXISTS CargoPriceListing;
