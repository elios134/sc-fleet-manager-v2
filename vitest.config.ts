import { defineConfig } from "vitest/config";

// Tests unitaires des helpers purs (placement, sélection de texture). Environnement
// node : aucun rendu DOM/r3f n'est testé ici (validation visuelle au runtime).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
