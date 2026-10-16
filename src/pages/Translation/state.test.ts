import { describe, it, expect } from "vitest";
import { packState, checkSourceUrl, withOrphan } from "./state";
import type { ChannelInfo, InstallRow, Pack } from "./types";

const pack = (id: string): Pack => ({
  id, name: id, author: "", description: "", lang: ["fr"], folder: "french_(france)",
  url: `https://h/${id}/global.ini`, featured: false, updatedAt: null, custom: false,
});
const install = (packId: string, updateAvailable: boolean): InstallRow => ({
  channelPath: "C:/SC/LIVE", packId, folder: "french_(france)", url: "", etag: null,
  lastModified: null, updateAvailable, installedAt: "", checkedAt: null,
});
const chan = (inst: InstallRow | null): ChannelInfo => ({
  path: "C:/SC/LIVE", label: "LIVE", manual: false, install: inst, currentLanguage: null,
});

describe("packState", () => {
  it("aucune install → notInstalled", () => {
    expect(packState(pack("a"), chan(null))).toBe("notInstalled");
    expect(packState(pack("a"), null)).toBe("notInstalled");
  });
  it("autre pack installé → otherActive", () => {
    expect(packState(pack("a"), chan(install("b", false)))).toBe("otherActive");
  });
  it("même pack à jour → upToDate", () => {
    expect(packState(pack("a"), chan(install("a", false)))).toBe("upToDate");
  });
  it("même pack, maj dispo → updateAvailable", () => {
    expect(packState(pack("a"), chan(install("a", true)))).toBe("updateAvailable");
  });
});

describe("checkSourceUrl", () => {
  it("https + .ini → ok", () => {
    expect(checkSourceUrl("https://x/a/global.ini")).toBe("ok");
    expect(checkSourceUrl(" https://x/global.ini?raw=1 ")).toBe("ok");
    expect(checkSourceUrl("https://x/globalfr.ini")).toBe("ok");
  });
  it("http refusé", () => {
    expect(checkSourceUrl("http://x/global.ini")).toBe("notHttps");
  });
  it("pas un .ini refusé", () => {
    expect(checkSourceUrl("https://x/readme.md")).toBe("notIni");
  });
});

describe("withOrphan", () => {
  it("ajoute une carte pour un pack installé absent de la liste", () => {
    const list = withOrphan([pack("a")], chan({ ...install("custom:https://h/x/global.ini", false), url: "https://h/x/global.ini" }));
    expect(list.map((p) => p.id)).toEqual(["a", "custom:https://h/x/global.ini"]);
    expect(list[1].url).toBe("https://h/x/global.ini");
    expect(list[1].folder).toBe("french_(france)");
    expect(packState(list[1], chan({ ...install("custom:https://h/x/global.ini", true) }))).toBe("updateAvailable");
  });
  it("inchangé si le pack installé est listé ou si rien n'est installé", () => {
    expect(withOrphan([pack("a")], chan(install("a", false))).length).toBe(1);
    expect(withOrphan([pack("a")], chan(null)).length).toBe(1);
  });
});
