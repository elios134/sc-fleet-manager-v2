// Fond animé global : le fond choisi dans la galerie (themes/backgrounds.ts).
import { StarsBackground } from "./StarsBackground";
import { VortexBackground } from "./VortexBackground";
import type { BackgroundDef } from "./themes/backgrounds";

export function AppBackground({ enabled, bg }: { enabled: boolean; bg: BackgroundDef }) {
  return bg.id === "stars" ? <StarsBackground enabled={enabled} /> : <VortexBackground enabled={enabled} />;
}
