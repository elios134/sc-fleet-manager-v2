#!/usr/bin/env python3
"""CCU Updater — petite app de bureau pour rafraîchir le catalogue CCU en ligne.

Interface simple aux couleurs de SC Fleet Manager. Un bouton : scrape RSI (session
invitée, headless) → merge no-delete → publie sur le repo ccu-data. Aucun login,
aucun serveur. Pensée pour être compilée en .exe portable (PyInstaller).
"""
import os
import queue
import sys
import threading
import time
import tkinter as tk

# Modules partagés (tools/) — importables directement une fois figés par PyInstaller.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import ccu_publish  # noqa: E402
import ccu_scrape  # noqa: E402

# ── Palette SC Fleet (theme.css) ─────────────────────────────────────────────
BG = "#0a0a0f"
CARD = "#14141c"
BORDER = "#26262e"
ACCENT = "#6366f1"
ACCENT_HOVER = "#7c7ff5"
ACCENT_2 = "#818cf8"
EMERALD = "#2ee9a5"
AMBER = "#f59e0b"
RED = "#f87171"
TXT = "#e9e9ee"
MUTED = "#8a8a99"
FONT = "Segoe UI"

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


class App:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        self.running = False
        root.title("CCU Updater")
        root.configure(bg=BG)
        root.geometry("560x520")
        root.minsize(520, 480)
        try:
            root.iconbitmap(os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico"))
        except Exception:
            pass

        wrap = tk.Frame(root, bg=BG)
        wrap.pack(fill="both", expand=True, padx=22, pady=20)

        # En-tête
        tk.Label(wrap, text="CCU UPDATER", bg=BG, fg=TXT,
                 font=(FONT, 20, "bold")).pack(anchor="w")
        tk.Label(wrap, text="Rafraîchit le catalogue CCU en ligne partagé par l'app.",
                 bg=BG, fg=MUTED, font=(FONT, 10)).pack(anchor="w", pady=(2, 0))

        # Carte statut
        card = tk.Frame(wrap, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        card.pack(fill="x", pady=(16, 14))
        self.status = tk.Label(card, text="Prêt.", bg=CARD, fg=TXT, font=(FONT, 11, "bold"),
                               anchor="w", justify="left")
        self.status.pack(fill="x", padx=14, pady=(12, 2))
        self.last = tk.Label(card, text="", bg=CARD, fg=MUTED, font=(FONT, 9), anchor="w")
        self.last.pack(fill="x", padx=14, pady=(0, 12))

        # Bouton principal
        self.btn = tk.Button(wrap, text="Mettre à jour le catalogue", command=self.on_click,
                             bg=ACCENT, fg="#0a0a0f", activebackground=ACCENT_HOVER,
                             activeforeground="#0a0a0f", relief="flat", bd=0,
                             font=(FONT, 12, "bold"), cursor="hand2", padx=16, pady=12)
        self.btn.pack(fill="x")
        self.btn.bind("<Enter>", lambda e: self.btn.config(bg=ACCENT_HOVER) if not self.running else None)
        self.btn.bind("<Leave>", lambda e: self.btn.config(bg=ACCENT) if not self.running else None)

        # Journal
        tk.Label(wrap, text="Journal", bg=BG, fg=MUTED, font=(FONT, 9, "bold")).pack(anchor="w", pady=(16, 4))
        logframe = tk.Frame(wrap, bg=BORDER, highlightbackground=BORDER, highlightthickness=1)
        logframe.pack(fill="both", expand=True)
        self.log = tk.Text(logframe, bg="#0c0c13", fg=MUTED, insertbackground=TXT,
                           relief="flat", bd=0, font=("Consolas", 9), wrap="word",
                           state="disabled", padx=10, pady=8)
        self.log.pack(side="left", fill="both", expand=True)
        sb = tk.Scrollbar(logframe, command=self.log.yview)
        sb.pack(side="right", fill="y")
        self.log.config(yscrollcommand=sb.set)

        self.refresh_last()
        self.root.after(100, self.pump)

    # ── UI helpers ──
    def refresh_last(self):
        ts = ccu_scrape.read_stamp(STAMP)
        self.last.config(text=f"Dernière mise à jour : {human_since(ts)}")

    def logline(self, msg, color=None):
        self.log.config(state="normal")
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def pump(self):
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "log":
                    self.logline(payload)
                    self.status.config(text=payload)
                elif kind == "done":
                    self.finish(payload)
        except queue.Empty:
            pass
        self.root.after(100, self.pump)

    # ── Action ──
    def on_click(self):
        if self.running:
            return
        if not os.path.isdir(REPO):
            self.logline(f"Dossier introuvable : {REPO}")
            self.status.config(text="Erreur : repo ccu-data introuvable.", fg=RED)
            return
        self.running = True
        self.btn.config(text="Mise à jour en cours…", bg=BORDER, fg=MUTED, cursor="watch", state="disabled")
        self.status.config(text="Démarrage…", fg=TXT)
        self.log.config(state="normal")
        self.log.delete("1.0", "end")
        self.log.config(state="disabled")
        threading.Thread(target=self.work, daemon=True).start()

    def work(self):
        try:
            res = ccu_scrape.run_update(REPO, on_progress=lambda m: self.q.put(("log", m)))
            self.q.put(("done", res))
        except ModuleNotFoundError:
            self.q.put(("done", {"ok": False, "reason": "playwright"}))
        except Exception as e:  # noqa: BLE001
            self.q.put(("done", {"ok": False, "reason": "error", "detail": str(e)}))

    def finish(self, res):
        self.running = False
        self.btn.config(text="Mettre à jour le catalogue", bg=ACCENT, fg="#0a0a0f",
                        cursor="hand2", state="normal")
        self.refresh_last()
        if not res.get("ok"):
            reason = res.get("reason")
            if reason == "playwright":
                self.status.config(text="Chromium manquant — lance : playwright install chromium", fg=AMBER)
            elif reason == "empty":
                self.status.config(text="Scrape vide — rien publié (protection).", fg=AMBER)
            else:
                self.status.config(text="Échec — voir le journal.", fg=RED)
                if res.get("detail"):
                    self.logline(res["detail"])
            return
        c = res.get("counts", {})
        summary = f"{c.get('ships','?')} vaisseaux · {c.get('skus','?')} SKU · {c.get('upgrades','?')} upgrades"
        if res.get("published"):
            self.status.config(text=f"À jour ✓  ({summary})", fg=EMERALD)
        else:
            self.status.config(text=f"Déjà à jour  ({summary})", fg=EMERALD)


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
