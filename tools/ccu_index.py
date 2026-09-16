#!/usr/bin/env python3
"""Génère/merge l'index CCU partagé (ccu-index.json) depuis la/les base(s) SQLite de l'app.

Source de vérité pour l'onglet CCU en ligne (repo `ccu-data`, MAJ hebdo). Consommé côté
app par la commande Rust `sync_ccu_from_index`. Le schéma colle 1:1 aux tables CcuSku /
CcuUpgrade / RsiShipName.

Philosophie « no-delete » : on ne supprime jamais une entrée. Un merge avec l'index déjà
publié conserve les vaisseaux/SKU disparus (available devient false, dernier prix connu
gardé) → un vaisseau retiré du store reste planifiable.

Usage :
  python tools/ccu_index.py --db A.db [--db B.db ...] [--existing ccu-index.json] --out ccu-index.json

Les bases passées en premier gagnent en cas de conflit (prix/dispo les plus à jour).
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone

SCHEMA_VERSION = 1


def read_db(path):
    """Retourne (ships{ id:name }, skus{ id:row }, upgrades{ (from,toSku):price })."""
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    ships, skus, upgrades = {}, {}, {}
    try:
        for r in cur.execute("SELECT shipId, name FROM RsiShipName"):
            if r["name"]:
                ships[int(r["shipId"])] = r["name"]
        for r in cur.execute(
            "SELECT skuId, shipId, priceCents, available, unlimitedStock, availableStock FROM CcuSku"
        ):
            skus[int(r["skuId"])] = {
                "skuId": int(r["skuId"]),
                "shipId": int(r["shipId"]),
                "priceCents": int(r["priceCents"]),
                "available": bool(r["available"]),
                "unlimitedStock": bool(r["unlimitedStock"]),
                "availableStock": (int(r["availableStock"]) if r["availableStock"] is not None else None),
            }
        for r in cur.execute("SELECT fromShipId, toSkuId, upgradePriceCents FROM CcuUpgrade"):
            upgrades[(int(r["fromShipId"]), int(r["toSkuId"]))] = int(r["upgradePriceCents"])
    finally:
        con.close()
    return ships, skus, upgrades


def load_existing(path):
    """Index déjà publié → mêmes dicts (base du merge no-delete)."""
    ships, skus, upgrades = {}, {}, {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            idx = json.load(f)
    except FileNotFoundError:
        return ships, skus, upgrades
    for s in idx.get("ships", []):
        ships[int(s["shipId"])] = s["name"]
    for sk in idx.get("skus", []):
        sk = dict(sk)
        sk["skuId"] = int(sk["skuId"])
        skus[sk["skuId"]] = sk
    for u in idx.get("upgrades", []):
        upgrades[(int(u["fromShipId"]), int(u["toSkuId"]))] = int(u["upgradePriceCents"])
    return ships, skus, upgrades


def build(db_paths, existing=None):
    # Base = index existant (conserve l'historique), puis les bases écrasent (les 1res gagnent).
    ships, skus, upgrades = ({}, {}, {})
    if existing:
        ships, skus, upgrades = load_existing(existing)
    # On applique les bases en ordre INVERSE pour que la 1re listée ait le dernier mot.
    for path in reversed(db_paths):
        d_ships, d_skus, d_upgrades = read_db(path)
        ships.update(d_ships)
        skus.update(d_skus)
        upgrades.update(d_upgrades)

    # Intégrité FK côté consommateur : une arête ne peut pointer que vers un SKU présent.
    sku_ids = set(skus.keys())
    upgrades = {k: v for k, v in upgrades.items() if k[1] in sku_ids}

    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "sc-fleet-manager-v2",
        "ships": [{"shipId": i, "name": n} for i, n in sorted(ships.items())],
        "skus": [skus[i] for i in sorted(skus.keys())],
        "upgrades": [
            {"fromShipId": f, "toSkuId": t, "upgradePriceCents": p}
            for (f, t), p in sorted(upgrades.items())
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", action="append", required=True, help="chemin d'une base SQLite (répétable)")
    ap.add_argument("--existing", help="ccu-index.json déjà publié (merge no-delete)")
    ap.add_argument("--out", required=True, help="fichier de sortie")
    args = ap.parse_args()

    idx = build(args.db, args.existing)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(
        f"OK → {args.out} : {len(idx['ships'])} ships, {len(idx['skus'])} skus, "
        f"{len(idx['upgrades'])} upgrades",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
