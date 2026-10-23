// Position du joueur : dernier lieu du Game.log (écran de chargement, inventaire ouvert),
// mis à jour en direct par l'événement `gamelog:location`.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function usePlayerZone(): string | null {
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let live = false; // un événement reçu prime sur la lecture initiale (plus ancienne)
    invoke<string | null>("get_current_location")
      .then((z) => alive && !live && setZone(z))
      .catch(() => {});
    const un = listen<{ location: string }>("gamelog:location", (e) => {
      live = true;
      setZone(e.payload?.location ?? null);
    });
    return () => {
      alive = false;
      void un.then((f) => f());
    };
  }, []);
  return zone;
}
