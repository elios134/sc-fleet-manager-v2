import { describe, expect, it } from "vitest";
import { fmtSize, safeFolders, totalBytes } from "./cache";

const f = (name: string, kind: string, bytes: number) => ({ name, kind, bytes, files: 1, version: null });

describe("cache", () => {
  const folders = [
    f("starcitizen_(sc-alpha-4.10.0)_x", "shaders_old", 3135 * 2 ** 20),
    f("starcitizen_(sc-alpha-4.10.2)_x", "shaders_current", 3089 * 2 ** 20),
    f("crashes", "crashes", 312 * 2 ** 20),
    f("autre", "other", 5),
  ];
  it("sans risque = anciennes versions + plantages", () => {
    expect(safeFolders(folders).map((x) => x.name)).toEqual(["starcitizen_(sc-alpha-4.10.0)_x", "crashes"]);
    expect(totalBytes(safeFolders(folders))).toBe(3447 * 2 ** 20);
  });
  it("tailles lisibles (Mo sous 1 Go, Go au-delà)", () => {
    expect(fmtSize(312 * 2 ** 20, "fr")).toBe("312 Mo");
    expect(fmtSize(3447 * 2 ** 20, "fr")).toBe("3,4 Go");
    expect(fmtSize(0, "fr")).toBe("0 Mo");
  });
});
