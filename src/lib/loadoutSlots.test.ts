import { describe, it, expect } from "vitest";
import { mapHardpointType, humanizePortName } from "./loadoutSlots";

describe("mapHardpointType", () => {
  it("TURRET exact reste TURRET (conteneur, avant la règle WEAPON)", () => {
    expect(mapHardpointType("turret")).toBe("TURRET");
    expect(mapHardpointType("TURRET")).toBe("TURRET");
  });
  it("missiles / roquettes → MISSILE", () => {
    expect(mapHardpointType("missile_rack")).toBe("MISSILE");
    expect(mapHardpointType("rocket_pod")).toBe("MISSILE");
  });
  it("armes (gun/cannon/turret composé) → WEAPON", () => {
    expect(mapHardpointType("weapon_gun")).toBe("WEAPON");
    expect(mapHardpointType("ball_turret")).toBe("WEAPON"); // contient TURRET mais ≠ exact
    expect(mapHardpointType("cannon")).toBe("WEAPON");
  });
  it("systèmes", () => {
    expect(mapHardpointType("shield_generator")).toBe("SHIELD");
    expect(mapHardpointType("power_plant")).toBe("POWER_PLANT");
    expect(mapHardpointType("quantum_drive")).toBe("QUANTUM_DRIVE");
    expect(mapHardpointType("qdrive")).toBe("QUANTUM_DRIVE");
    expect(mapHardpointType("cooler")).toBe("COOLER");
  });
  it("inconnu → null", () => {
    expect(mapHardpointType("seat")).toBeNull();
  });
});

describe("humanizePortName", () => {
  it("retire le préfixe et met en majuscules", () => {
    expect(humanizePortName("hardpoint_weapon_left")).toBe("WEAPON LEFT");
    expect(humanizePortName("hardpoint_shield")).toBe("SHIELD");
  });
});
