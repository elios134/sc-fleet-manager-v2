export interface ShipRow {
  id: number;
  name: string;
  manufacturer: string;
  role: string | null;
  classification: string;
  length: number | null;
  beam: number | null;
  height: number | null;
  crewMin: number | null;
  crewMax: number | null;
  cargoScu: number | null;
  imageUrl: string | null;
}

export interface SpecItem {
  k: string;
  v: string;
  u?: string;
  icon?: import("react").ReactNode;
}
