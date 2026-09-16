# CCU Updater

App de bureau **WebView2 + HTML/CSS** aux vraies couleurs de SC Fleet Manager (glass,
glow indigo, glyphe d'upgrade) qui rafraîchit le **catalogue CCU en ligne** : scrape RSI
en session **invitée** (headless, sans login) → merge no-delete → push sur `ccu-data`.
Un seul bouton + journal de progression en direct.

Dépendances : `playwright`, `pywebview` (WebView2, déjà présent sur Windows).

## Lancer (dev)
```
python tools/ccu_updater/updater.py
```

## Régénérer l'icône
```
python tools/ccu_updater/make_icon.py   # → icon.ico + icon.png
```

## Compiler le .exe portable
Pré-requis : `pip install pyinstaller playwright pywebview` + `playwright install chromium`.
```
python -m PyInstaller --onefile --windowed --noconfirm ^
  --name "CCU Updater" ^
  --icon tools/ccu_updater/icon.ico ^
  --paths tools ^
  --add-data "<chemin absolu>/tools/ccu_updater/icon.ico;." ^
  --collect-all playwright --collect-all pywebview ^
  --collect-all clr_loader --collect-all pythonnet ^
  --hidden-import clr --hidden-import webview.platforms.winforms ^
  tools/ccu_updater/updater.py
```
Le `.exe` (~55 Mo) est dans `dist/`. **Portabilité** : il réutilise le Chromium de
Playwright du cache utilisateur (`%LOCALAPPDATA%\ms-playwright`) — `updater.py` force
`PLAYWRIGHT_BROWSERS_PATH` vers ce cache au démarrage (sinon le Playwright figé cherche le
navigateur dans le bundle temporaire et échoue). Sur une machine neuve, refaire
`playwright install chromium` une fois.

Dépendances runtime : `git` sur le PATH + auth GitHub de la machine (pour le push) +
WebView2 (fourni par Windows / Edge).
