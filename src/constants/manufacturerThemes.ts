// Presets de thème par constructeur SC (port V1 manufacturerThemes.ts).
// Chaque thème = une couleur d'accent ; cliquer reteinte toute la DA via applyAccent.

export type ManufacturerTheme = {
  id: string;
  name: string;
  flavor: string;
  color: string;
};

export const MANUFACTURER_THEMES: ManufacturerTheme[] = [
  { id: "aegis", name: "AEGIS", flavor: "Militaire", color: "#FFC56A" },
  { id: "drake", name: "DRAKE", flavor: "Pirate", color: "#FF6B47" },
  { id: "origin", name: "ORIGIN", flavor: "Luxe", color: "#2EC4FF" },
  { id: "crusader", name: "CRUSADER", flavor: "Civil", color: "#4FA3FF" },
  { id: "misc", name: "MISC", flavor: "Tech", color: "#4CD964" },
  { id: "esperia", name: "ESPERIA", flavor: "Alien", color: "#8B7CC7" },
];
