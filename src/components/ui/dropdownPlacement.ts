// Sens d'ouverture d'un menu déroulant (logique pure, testée) : vers le bas par défaut, vers le
// haut quand il serait coupé en bas (bord de la fenêtre ou d'un conteneur qui masque ce qui
// dépasse, ex. la barre collée au bas du viewer 3D) et qu'il y a plus de place au-dessus.
type Span = { top: number; bottom: number };

export function menuPlacement(button: Span, clip: Span, menuHeight: number): "up" | "down" {
  const below = clip.bottom - button.bottom;
  const above = button.top - clip.top;
  return below < menuHeight && above > below ? "up" : "down";
}

/** Zone visible d'un élément : la fenêtre, réduite par chaque ancêtre qui masque ce qui dépasse. */
export function visibleSpan(el: HTMLElement): Span {
  let top = 0;
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "visible") continue;
    const r = p.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  return { top, bottom };
}
