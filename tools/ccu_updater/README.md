# CCU Updater

Petite app de bureau (DA SC Fleet) qui rafraîchit le **catalogue CCU en ligne** :
scrape RSI en session **invitée** (headless, sans login) → merge no-delete → push sur
le repo `ccu-data`. Un seul bouton.

## Lancer (dev)
```
python tools/ccu_updater/updater.py
```

## Régénérer l'icône
```
python tools/ccu_updater/make_icon.py   # → icon.ico + icon.png
```

## Compiler le .exe portable
Pré-requis : `pip install pyinstaller playwright` + `playwright install chromium`.
```
python -m PyInstaller --onefile --windowed --noconfirm ^
  --name "CCU Updater" ^
  --icon tools/ccu_updater/icon.ico ^
  --paths tools ^
  --add-data "<chemin absolu>/tools/ccu_updater/icon.ico;." ^
  --collect-all playwright ^
  tools/ccu_updater/updater.py
```
Le `.exe` (~53 Mo) est dans `dist/`. **Portabilité** : il réutilise le Chromium de
Playwright installé dans le cache utilisateur (`%LOCALAPPDATA%\ms-playwright`). Sur une
machine neuve, refaire `playwright install chromium` une fois.

Dépendances runtime : `git` sur le PATH + auth GitHub de la machine (pour le push).
