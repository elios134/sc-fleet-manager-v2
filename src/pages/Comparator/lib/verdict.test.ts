import { describe, it, expect } from "vitest";
import { duelVerdict } from "./verdict";

describe("duelVerdict", () => {
  it("gagnant = plus de critères gagnés, avec son score et le total comparable", () => {
    expect(duelVerdict({ winsA: 6, winsB: 3, comparable: 10 })).toEqual({ winner: "a", wins: 6, total: 10 });
    expect(duelVerdict({ winsA: 2, winsB: 7, comparable: 9 })).toEqual({ winner: "b", wins: 7, total: 9 });
  });
  it("égalité : même nombre de critères gagnés", () => {
    expect(duelVerdict({ winsA: 4, winsB: 4, comparable: 10 })).toEqual({ winner: "tie", wins: 4, total: 10 });
  });
  it("aucun critère comparable : égalité à 0", () => {
    expect(duelVerdict({ winsA: 0, winsB: 0, comparable: 0 })).toEqual({ winner: "tie", wins: 0, total: 0 });
  });
});
