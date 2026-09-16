#!/usr/bin/env python3
"""Publie/rafraîchit l'index CCU en ligne (repo ccu-data) depuis la base locale de l'app.

Job hebdomadaire (option B du plan) : lit la base SQLite de l'app, merge **no-delete** avec
l'index déjà publié, écrit `ccu-index.json` dans le clone `ccu-data`, commit + push.

Freshness : l'index reflète l'état de la base locale. Pour capter de NOUVELLES données du
store, lancer d'abord une synchro CCU dans l'app (le scrape RSI nécessite une session
connectée — non automatisable en headless). Le merge no-delete garantit qu'on ne perd
jamais d'historique entre deux runs.

Usage :
  python tools/ccu_publish.py [--repo C:/Users/andre/ccu-data] [--db <app.db> ...]
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ccu_index  # noqa: E402

DEFAULT_REPO = r"C:\Users\andre\ccu-data"
APPDATA = os.path.join(os.environ.get("APPDATA", ""), "com.andre.sc-fleet-manager-v2")
DEFAULT_DBS = [
    os.path.join(APPDATA, "scfleet-dev.db"),
    os.path.join(APPDATA, "scfleet.db"),
]


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=DEFAULT_REPO, help="clone local du repo ccu-data")
    ap.add_argument("--db", action="append", help="base(s) SQLite de l'app (la 1re gagne)")
    args = ap.parse_args()

    repo = args.repo
    dbs = [d for d in (args.db or DEFAULT_DBS) if os.path.exists(d)]
    if not dbs:
        print("Aucune base trouvée — rien à publier.", file=sys.stderr)
        return 1
    out = os.path.join(repo, "ccu-index.json")

    # Récupère la dernière version publiée avant de merger (évite un push périmé).
    try:
        git(repo, "pull", "--quiet", "--ff-only")
    except subprocess.CalledProcessError:
        pass

    import json
    existing = out if os.path.exists(out) else None
    idx = ccu_index.build(dbs, existing)
    print(f"index: {len(idx['ships'])} ships, {len(idx['skus'])} skus, {len(idx['upgrades'])} upgrades")

    # Ne publie QUE si le catalogue lui-même a changé (on ignore `generatedAt`, qui bouge
    # à chaque run) → pas de commit-bruit hebdomadaire quand rien n'a bougé côté store.
    def payload(d):
        return {k: d.get(k) for k in ("ships", "skus", "upgrades")}

    if existing:
        with open(existing, "r", encoding="utf-8") as f:
            if payload(json.load(f)) == payload(idx):
                print("Aucun changement du catalogue — pas de publication.")
                return 0

    with open(out, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    git(repo, "add", "ccu-index.json")
    git(repo, "-c", "user.name=André", "-c", "user.email=andrebribanick@gmail.com",
        "commit", "-q", "-m", f"data: MAJ catalogue CCU ({idx['generatedAt']})")
    git(repo, "push", "--quiet")
    print("Publié sur ccu-data.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
