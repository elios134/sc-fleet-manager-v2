#!/usr/bin/env python3
"""CCU Updater — app de bureau (WebView2 + HTML/CSS aux couleurs de SC Fleet Manager).

Un bouton : scrape RSI (session invitée, headless) → merge no-delete → publie sur le
repo ccu-data. Aucun login, aucun serveur. Compilable en .exe portable (PyInstaller).
"""
import json
import os
import sys
import threading
import time

# ── Fix Playwright figé (PyInstaller) : pointer vers les navigateurs du cache utilisateur
#    (%LOCALAPPDATA%\ms-playwright) au lieu du bundle temporaire _MEI. À faire AVANT tout
#    import/usage de Playwright (importé tardivement dans ccu_scrape.scrape).
if "PLAYWRIGHT_BROWSERS_PATH" not in os.environ:
    _cache = os.path.join(os.environ.get("LOCALAPPDATA", ""), "ms-playwright")
    if os.path.isdir(_cache):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = _cache

import webview  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import ccu_publish  # noqa: E402
import ccu_scrape  # noqa: E402

REPO = ccu_publish.DEFAULT_REPO
STAMP = os.path.join(REPO, ".ccu_last_run")


def human_since(ts):
    if ts is None:
        return "jamais"
    s = max(0, time.time() - ts)
    if s < 3600:
        return f"il y a {int(s // 60)} min"
    if s < 86400:
        return f"il y a {int(s // 3600)} h"
    return f"il y a {int(s // 86400)} j"


HTML = r"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0a0a0f; --fg:#e9e9ee; --muted:rgba(255,255,255,.42); --muted2:rgba(255,255,255,.60);
    --accent:#6366f1; --accent2:#818cf8; --emerald:#2ee9a5; --amber:#f59e0b; --red:#f87171;
    --card:rgba(255,255,255,.03); --border:rgba(255,255,255,.10); --border2:rgba(255,255,255,.16);
    --sys:"Segoe UI",system-ui,-apple-system,sans-serif; --hud:"Rajdhani",var(--sys);
  }
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;font-family:var(--sys);color:var(--fg);overflow:hidden;
    background:
      radial-gradient(ellipse at 20% 45%, rgba(99,102,241,.16) 0%, transparent 60%),
      radial-gradient(ellipse at 82% 18%, rgba(139,92,246,.11) 0%, transparent 55%),
      var(--bg);}
  .wrap{height:100%;display:flex;flex-direction:column;padding:22px 22px 18px;gap:14px}
  .head{display:flex;align-items:center;gap:12px}
  .logo{width:42px;height:42px;flex:none}
  .head h1{font-family:var(--hud);font-weight:700;letter-spacing:.06em;text-transform:uppercase;
    font-size:22px;margin:0;line-height:1}
  .head p{margin:3px 0 0;color:var(--muted);font-size:12px}
  .card{border:1px solid var(--border);background:var(--card);border-radius:16px;padding:14px 16px;
    backdrop-filter:blur(8px)}
  .status{font-size:13px;font-weight:600;color:var(--fg)}
  .status.ok{color:var(--emerald)} .status.warn{color:var(--amber)} .status.err{color:var(--red)}
  .last{margin-top:4px;font-size:11px;color:var(--muted)}
  .btn{width:100%;border:0;border-radius:12px;padding:13px;font-family:var(--sys);font-size:14px;
    font-weight:600;color:#0a0a0f;background:var(--accent);cursor:pointer;transition:.15s;
    box-shadow:0 8px 22px -10px rgba(99,102,241,.8)}
  .btn:hover{background:var(--accent2)}
  .btn:disabled{background:var(--border2);color:var(--muted);cursor:default;box-shadow:none}
  .logwrap{flex:1;min-height:0;display:flex;flex-direction:column}
  .logwrap .lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
  .log{flex:1;overflow:auto;background:rgba(0,0,0,.35);border:1px solid var(--border);border-radius:12px;
    padding:10px 12px;font-family:"Cascadia Mono","Consolas",monospace;font-size:11.5px;color:var(--muted2);
    line-height:1.55;white-space:pre-wrap}
  .log::-webkit-scrollbar{width:8px} .log::-webkit-scrollbar-thumb{background:var(--border2);border-radius:8px}
  .log .a{color:var(--accent2)} .log .g{color:var(--emerald)}
</style></head>
<body>
  <div class="wrap">
    <div class="head">
      <svg class="logo" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="14" width="228" height="228" rx="52" fill="#0a0a0f" stroke="#6366f1" stroke-width="6"/>
        <rect x="58" y="196" width="140" height="18" rx="8" fill="#6366f1" opacity=".28"/>
        <rect x="58" y="196" width="96" height="18" rx="8" fill="#6366f1"/>
        <path d="M78 150 L128 106 L178 150" fill="none" stroke="#818cf8" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M78 118 L128 74 L178 118" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <h1>CCU Updater</h1>
        <p>Rafraîchit le catalogue CCU en ligne partagé par l'app.</p>
      </div>
    </div>

    <div class="card">
      <div id="status" class="status">Prêt.</div>
      <div id="last" class="last">Dernière mise à jour : …</div>
    </div>

    <button id="btn" class="btn" onclick="startUpdate()">Mettre à jour le catalogue</button>

    <div class="logwrap">
      <div class="lbl">Journal</div>
      <div id="log" class="log"></div>
    </div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);
  function ready(fn){ if(window.pywebview&&window.pywebview.api){fn()} else {window.addEventListener('pywebviewready',fn)} }
  ready(() => { window.pywebview.api.get_last().then(t => $('last').textContent = 'Dernière mise à jour : ' + t); });

  function startUpdate(){
    const b = $('btn');
    b.disabled = true; b.textContent = 'Mise à jour en cours…';
    $('log').textContent = '';
    setStatus('Démarrage…','');
    window.pywebview.api.start_update();
  }
  function addLog(msg){
    const el = $('log');
    const cls = msg.includes('Publié') ? 'g' : (msg.startsWith('  …') ? 'a' : '');
    const span = document.createElement('div'); if(cls) span.className = cls; span.textContent = msg;
    el.appendChild(span); el.scrollTop = el.scrollHeight;
    setStatus(msg,'');
  }
  function setStatus(text, cls){ const s = $('status'); s.className = 'status ' + (cls||''); s.textContent = text; }
  function finish(res){
    const b = $('btn'); b.disabled = false; b.textContent = 'Mettre à jour le catalogue';
    window.pywebview.api.get_last().then(t => $('last').textContent = 'Dernière mise à jour : ' + t);
    if(!res.ok){
      if(res.reason==='playwright') setStatus('Chromium manquant — lance : playwright install chromium','warn');
      else if(res.reason==='empty') setStatus('Scrape vide — rien publié (protection).','warn');
      else { setStatus('Échec — voir le journal.','err'); if(res.detail) addLog(res.detail); }
      return;
    }
    const c = res.counts || {};
    const sum = `${c.ships||'?'} vaisseaux · ${c.skus||'?'} SKU · ${c.upgrades||'?'} upgrades`;
    setStatus((res.published ? 'À jour ✓  (' : 'Déjà à jour  (') + sum + ')','ok');
  }
  window.addLog = addLog; window.finish = finish; window.setStatus = setStatus;
</script>
</body></html>"""


class Api:
    def __init__(self):
        self.window = None
        self.busy = False

    def get_last(self):
        return human_since(ccu_scrape.read_stamp(STAMP))

    def start_update(self):
        if self.busy:
            return
        self.busy = True
        threading.Thread(target=self._run, daemon=True).start()

    def _push(self, fn, arg):
        try:
            self.window.evaluate_js(f"window.{fn}({json.dumps(arg)})")
        except Exception:
            pass

    def _run(self):
        try:
            if not os.path.isdir(REPO):
                self._push("finish", {"ok": False, "reason": "error", "detail": f"Dossier introuvable : {REPO}"})
                return
            res = ccu_scrape.run_update(REPO, on_progress=lambda m: self._push("addLog", m))
            self._push("finish", res)
        except ModuleNotFoundError:
            self._push("finish", {"ok": False, "reason": "playwright"})
        except Exception as e:  # noqa: BLE001
            self._push("finish", {"ok": False, "reason": "error", "detail": str(e)})
        finally:
            self.busy = False


def main():
    api = Api()
    icon = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico")
    win = webview.create_window(
        "CCU Updater", html=HTML, js_api=api,
        width=580, height=580, background_color="#0a0a0f",
    )
    api.window = win
    kwargs = {}
    if os.path.exists(icon):
        kwargs["icon"] = icon
    try:
        webview.start(**kwargs)
    except TypeError:
        webview.start()  # anciennes versions sans param icon


if __name__ == "__main__":
    main()
