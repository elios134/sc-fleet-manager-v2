#!/usr/bin/env python3
"""Scrape autonome du catalogue CCU RSI (session INVITÉE) via Chromium headless, puis publie.

Rejoue exactement le flux du scrape in-app, mais sans login ni WebView de l'app :
  1. ouvre une page RSI (guest) → csrf + cookies invités,
  2. setAuthToken {} + setContextToken(null) + filterShips(null) → liste des vaisseaux,
  3. pour chaque vaisseau : setContextToken(id) + filterShips(id) → SKU + arêtes d'upgrade,
  4. merge no-delete avec l'index publié (SKU disparus → available=false, prix gardé),
  5. écrit ccu-index.json dans le clone ccu-data et push (via ccu_publish.write_and_push).

Tourne sur IP résidentielle (ta machine) → passe Cloudflare. Aucun credential, aucun serveur.

Pré-requis (une fois) :  pip install playwright  &&  playwright install chromium
Usage :                  python tools/ccu_scrape.py [--repo C:/Users/andre/ccu-data] [--headed]
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ccu_index  # noqa: E402
import ccu_publish  # noqa: E402

ORIGIN = "https://robertsspaceindustries.com"

# Fonction JS rejouée dans la page : un appel filterShips (catalogue si fromId==null,
# sinon par vaisseau de départ). Renvoie {from:[{id,name}], to:[{id,name,skus[...]}]}.
JS_FILTER_SHIPS = r"""
async (fromId) => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  if (!csrf) return { error: 'no-csrf' };
  const O = 'https://robertsspaceindustries.com';
  const jsonH = { 'content-type': 'application/json', 'accept': 'application/json' };
  const gqlH  = { 'content-type': 'application/json', 'x-csrf-token': csrf };
  const query = `query filterShips($fromId: Int, $toId: Int, $fromFilters: [FilterConstraintValues], $toFilters: [FilterConstraintValues]) {
  from(to: $toId, filters: $fromFilters) { ships { id name } }
  to(from: $fromId, filters: $toFilters) {
    ships { id name skus { id price upgradePrice unlimitedStock showStock available availableStock } } }
}`;
  try {
    if (fromId === null) {
      await fetch(O + '/api/account/v2/setAuthToken', { method:'POST', headers: jsonH, credentials:'include', body:'{}' });
    }
    await fetch(O + '/api/ship-upgrades/setContextToken', { method:'POST', headers: jsonH, credentials:'include',
      body: JSON.stringify({ fromShipId: fromId, toShipId: null, toSkuId: null, pledgeId: null }) });
    const vars = fromId === null ? { fromFilters: [], toFilters: [] } : { fromId, fromFilters: [], toFilters: [] };
    const r = await fetch(O + '/pledge-store/api/upgrade/v2/graphql', { method:'POST', headers: gqlH, credentials:'include',
      body: JSON.stringify({ operationName: 'filterShips', variables: vars, query }) });
    const j = await r.json().catch(() => null);
    if (!j || j.errors) return { error: (j && j.errors) ? JSON.stringify(j.errors).slice(0,200) : 'parse', status: r.status };
    return { from: (j.data.from && j.data.from.ships) || [], to: (j.data.to && j.data.to.ships) || [] };
  } catch (e) { return { error: String(e) }; }
}
"""


def scrape(headed=False):
    from playwright.sync_api import sync_playwright  # import tardif → message clair si absent

    ships, skus, upgrades = {}, {}, {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        page = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ).new_page()
        page.goto(ORIGIN + "/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)  # laisse le csrf/cookies se poser (challenge CF éventuel)

        # 1) Catalogue : liste complète des vaisseaux (from.ships).
        cat = page.evaluate(JS_FILTER_SHIPS, None)
        if not isinstance(cat, dict) or cat.get("error"):
            browser.close()
            raise RuntimeError(f"catalogue échoué : {cat}")
        from_ships = cat.get("from", [])
        for s in from_ships:
            if s.get("name"):
                ships[int(s["id"])] = s["name"]
        total = len(from_ships)
        print(f"catalogue : {total} vaisseaux", file=sys.stderr)
        if total == 0:
            browser.close()
            raise RuntimeError("catalogue vide (Cloudflare ? endpoint changé ?)")

        # 2) Par vaisseau de départ : SKU + arêtes.
        errs = 0
        for i, s in enumerate(from_ships):
            fid = int(s["id"])
            res = page.evaluate(JS_FILTER_SHIPS, fid)
            if not isinstance(res, dict) or res.get("error"):
                # 1 retry après une courte pause.
                page.wait_for_timeout(400)
                res = page.evaluate(JS_FILTER_SHIPS, fid)
            if not isinstance(res, dict) or res.get("error"):
                errs += 1
                continue
            for ts in res.get("to", []):
                tid = int(ts["id"])
                if ts.get("name") and tid not in ships:
                    ships[tid] = ts["name"]
                for sku in ts.get("skus", []):
                    if sku.get("id") is None:
                        continue
                    sid = int(sku["id"])
                    if sid not in skus:
                        show = bool(sku.get("showStock"))
                        skus[sid] = {
                            "skuId": sid,
                            "shipId": tid,
                            "priceCents": int(sku.get("price") or 0),
                            "available": bool(sku.get("available")),
                            "unlimitedStock": bool(sku.get("unlimitedStock")),
                            "availableStock": (sku.get("availableStock") if show else None),
                        }
                    up = sku.get("upgradePrice")
                    if up is not None:
                        upgrades[(fid, sid)] = int(up)
            if (i + 1) % 25 == 0:
                print(f"  … {i + 1}/{total} vaisseaux, {len(skus)} skus, {len(upgrades)} upgrades", file=sys.stderr)
            time.sleep(0.05)  # poli avec RSI
        browser.close()
        print(f"scrape OK : {len(ships)} ships, {len(skus)} skus, {len(upgrades)} upgrades ({errs} erreurs)", file=sys.stderr)
    return ships, skus, upgrades


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=ccu_publish.DEFAULT_REPO, help="clone local du repo ccu-data")
    ap.add_argument("--out", help="écrire l'index ici SANS publier (test)")
    ap.add_argument("--headed", action="store_true", help="navigateur visible (debug)")
    args = ap.parse_args()

    try:
        s_ships, s_skus, s_upg = scrape(headed=args.headed)
    except ModuleNotFoundError:
        print("Playwright manquant. Installe :  pip install playwright && playwright install chromium",
              file=sys.stderr)
        return 2
    if not s_skus:
        print("Scrape vide — on ne publie pas (protection anti-écrasement).", file=sys.stderr)
        return 1

    # Merge no-delete avec l'index publié : les SKU non revus passent available=false.
    existing = os.path.join(args.repo, "ccu-index.json")
    base_ships, base_skus, base_upg = (
        ccu_index.load_existing(existing) if os.path.exists(existing) else ({}, {}, {})
    )
    seen = set(s_skus)
    for sid, row in list(base_skus.items()):
        if sid not in seen and row.get("available"):
            row = dict(row)
            row["available"] = False
            base_skus[sid] = row
    base_ships.update(s_ships)
    base_skus.update(s_skus)
    base_upg.update(s_upg)
    idx = ccu_index.assemble(base_ships, base_skus, base_upg)
    print(f"index: {len(idx['ships'])} ships, {len(idx['skus'])} skus, {len(idx['upgrades'])} upgrades")

    if args.out:
        import json
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        print(f"écrit → {args.out} (non publié)")
        return 0

    ccu_publish.write_and_push(idx, args.repo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
